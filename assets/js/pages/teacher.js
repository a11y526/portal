// 관리 화면: 교사 로그인, 보드 만들기(여러 반 한 번에), 반별 오늘 보드 지정
import { CLASSES } from '../config.js';
import { initUI, toast, esc } from '../ui.js';
import {
  sb, isConfigured, getSession, signIn, signOut, amITeacher,
  listClasses, listBoards, createBoards, updateBoard, deleteBoard, setTodayBoard, toPadletEmbed,
} from '../db.js';

initUI();

const $ = (id) => document.getElementById(id);
const VIEWS = ['v-config', 'v-login', 'v-denied', 'v-admin'];
const show = (id) => VIEWS.forEach((v) => $(v).classList.toggle('hidden', v !== id));

let classes = [];
let boards = [];

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const boardLabel = (b) => [`${b.lesson_code}차시`, b.title, fmtDate(b.created_at)].filter(Boolean).join(' · ');

function errMsg(err) {
  console.error(err);
  const m = err?.message || '';
  if (/Invalid login/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요';
  if (/fetch|network/i.test(m)) return '인터넷 연결을 확인해 주세요';
  return '저장하지 못했어요: ' + m;
}

/* ---------- 시뮬레이션 링크 줄 ---------- */
function addSimRow(container, sim = { name: '', url: '' }) {
  const row = document.createElement('div');
  row.className = 'sim-row';
  row.innerHTML = `
    <input class="input sim-name" placeholder="이름" value="${esc(sim.name)}" aria-label="시뮬레이션 이름">
    <input class="input sim-url" placeholder="https://" value="${esc(sim.url)}" aria-label="시뮬레이션 주소">
    <button type="button" class="btn btn-line icon-btn sim-del" style="width:44px;height:44px;padding:0" aria-label="이 링크 지우기">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`;
  row.querySelector('.sim-del').addEventListener('click', () => row.remove());
  container.append(row);
}

// 반환: 링크 배열, 잘못된 주소가 있으면 null
function readSims(container) {
  const out = [];
  for (const row of container.querySelectorAll('.sim-row')) {
    const name = row.querySelector('.sim-name').value.trim();
    let url = row.querySelector('.sim-url').value.trim();
    if (!name && !url) continue;
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch {
      toast('시뮬레이션 주소를 확인해 주세요', 'error');
      row.querySelector('.sim-url').focus();
      return null;
    }
    out.push({ name: name || new URL(url).hostname, url });
  }
  return out;
}

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add-sim]');
  if (add) addSimRow(add.closest('.field').querySelector('[data-sims]'));
});

/* ---------- 패들렛 주소 입력 + 변환 결과 표시 ---------- */
function bindPadletHint(input, hint) {
  const update = () => {
    const v = input.value.trim();
    if (!v) { hint.textContent = ''; hint.classList.remove('bad'); return; }
    const embed = toPadletEmbed(v);
    hint.textContent = embed ? '→ ' + embed : '패들렛 주소가 아니에요';
    hint.classList.toggle('bad', !embed);
  };
  input.addEventListener('input', update);
  update();
}

/* ---------- 오늘 보드 ---------- */
function renderToday() {
  $('today-list').innerHTML = classes.map((c) => {
    const opts = boards.filter((b) => b.class_id === c.id)
      .map((b) => `<option value="${b.id}" ${b.id === c.today_board_id ? 'selected' : ''}>${esc(boardLabel(b))}</option>`)
      .join('');
    return `
      <div class="today-row">
        <span class="cls">${c.id}반</span>
        <select class="input" data-today="${c.id}" aria-label="${c.id}반 오늘 보드">
          <option value="" ${c.today_board_id ? '' : 'selected'}>없음</option>${opts}
        </select>
        <a class="btn btn-line btn-small open" href="../class.html?c=${c.id}" target="_blank" rel="noopener">보기 ↗</a>
      </div>`;
  }).join('');
}

$('today-list').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-today]');
  if (!sel) return;
  const classId = Number(sel.dataset.today);
  sel.disabled = true;
  try {
    await setTodayBoard(classId, sel.value || null);
    toast(`${classId}반 오늘 보드를 바꿨어요`, 'ok');
    await refresh();
  } catch (err) {
    toast(errMsg(err), 'error');
    sel.disabled = false;
  }
});

/* ---------- 보드 목록 ---------- */
function renderBoards() {
  const todayIds = new Set(classes.map((c) => c.today_board_id).filter(Boolean));
  const groups = new Map();
  for (const b of boards) {
    const key = `${b.lesson_code}|${b.title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  if (!groups.size) {
    $('board-groups').innerHTML = '<div class="empty"><strong>아직 만든 보드가 없어요</strong></div>';
    return;
  }
  $('board-groups').innerHTML = [...groups.entries()].map(([key, list]) => {
    list.sort((a, b) => a.class_id - b.class_id);
    const allToday = list.every((b) => todayIds.has(b.id));
    return `
      <div class="board-group">
        <header>
          <b>${esc(list[0].lesson_code)}차시${list[0].title ? ' · ' + esc(list[0].title) : ''}</b>
          <span class="muted num" style="font-size:13px">${fmtDate(list[0].created_at)}</span>
          <button type="button" class="btn btn-line btn-small" style="margin-left:auto" data-group-today="${esc(key)}" ${allToday ? 'disabled' : ''}>
            ${allToday ? '모두 오늘 보드' : '이 차시를 오늘 보드로'}
          </button>
        </header>
        ${list.map((b) => `
          <div class="board-item">
            <span class="cls">${b.class_id}반</span>
            ${todayIds.has(b.id) ? '<span class="tag tag-today">오늘</span>' : ''}
            ${b.padlet_src ? '' : '<span class="tag tag-warn">패들렛 없음</span>'}
            <span class="src">${esc(b.padlet_src || '')}</span>
            <button type="button" class="btn btn-line btn-small" data-edit="${b.id}">수정</button>
            <button type="button" class="btn btn-danger btn-small" data-del="${b.id}">삭제</button>
          </div>`).join('')}
      </div>`;
  }).join('');
}

$('board-groups').addEventListener('click', async (e) => {
  const groupBtn = e.target.closest('[data-group-today]');
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-del]');

  if (groupBtn) {
    const key = groupBtn.dataset.groupToday;
    const list = boards.filter((b) => `${b.lesson_code}|${b.title}` === key);
    groupBtn.disabled = true;
    try {
      // 같은 반에 같은 차시 보드가 여러 개면 가장 최근 것
      const latest = new Map();
      for (const b of list) if (!latest.has(b.class_id)) latest.set(b.class_id, b);
      for (const b of latest.values()) await setTodayBoard(b.class_id, b.id);
      toast(`${[...latest.keys()].sort((a, b) => a - b).join(', ')}반 오늘 보드를 바꿨어요`, 'ok');
    } catch (err) { toast(errMsg(err), 'error'); }
    await refresh();
  }

  if (editBtn) openEdit(boards.find((b) => b.id === editBtn.dataset.edit));

  if (delBtn) {
    const b = boards.find((x) => x.id === delBtn.dataset.del);
    if (!b || !confirm(`${b.class_id}반 ${b.lesson_code}차시 보드를 삭제할까요?`)) return;
    try {
      await deleteBoard(b.id);
      toast('삭제했어요', 'ok');
    } catch (err) { toast(errMsg(err), 'error'); }
    await refresh();
  }
});

/* ---------- 보드 만들기 ---------- */
function renderCreateForm() {
  $('padlet-rows').innerHTML = CLASSES.map((n) => `
    <div class="padlet-row">
      <label class="check"><input type="checkbox" data-include="${n}" checked> ${n}반</label>
      <input class="input" data-padlet="${n}" placeholder="패들렛 주소 또는 임베드 코드" aria-label="${n}반 패들렛 주소">
      <div class="hint" data-hint="${n}"></div>
    </div>`).join('');
  for (const n of CLASSES) {
    bindPadletHint($('padlet-rows').querySelector(`[data-padlet="${n}"]`), $('padlet-rows').querySelector(`[data-hint="${n}"]`));
  }
  const sims = $('create').querySelector('[data-sims]');
  sims.innerHTML = '';
  addSimRow(sims);
}

$('copy-first').addEventListener('click', () => {
  const inputs = [...$('padlet-rows').querySelectorAll('[data-padlet]')];
  const first = inputs.find((i) => i.value.trim());
  if (!first) { toast('먼저 주소를 하나 넣어 주세요', 'error'); return; }
  for (const i of inputs) {
    i.value = first.value;
    i.dispatchEvent(new Event('input'));
  }
});

$('create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const lesson_code = f.lesson_code.value.trim();
  const title = f.elements.title.value.trim();
  const sim_links = readSims(f.querySelector('[data-sims]'));
  if (!sim_links) return;

  const items = [];
  for (const n of CLASSES) {
    if (!f.querySelector(`[data-include="${n}"]`).checked) continue;
    const raw = f.querySelector(`[data-padlet="${n}"]`).value.trim();
    const padlet_src = raw ? toPadletEmbed(raw) : null;
    if (raw && !padlet_src) {
      toast(`${n}반 패들렛 주소를 확인해 주세요`, 'error');
      f.querySelector(`[data-padlet="${n}"]`).focus();
      return;
    }
    items.push({ class_id: n, padlet_src });
  }
  if (!items.length) { toast('반을 하나 이상 골라 주세요', 'error'); return; }

  const btn = f.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    await createBoards({ lesson_code, title, sim_links, items, setToday: f.set_today.checked });
    toast(`${items.length}개 반에 보드를 만들었어요`, 'ok');
    f.reset();
    renderCreateForm();
    await refresh();
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 보드 수정 ---------- */
let editing = null;
const editForm = $('edit-form');
bindPadletHint(editForm.padlet, $('edit-hint'));

function openEdit(b) {
  if (!b) return;
  editing = b;
  $('edit-title').textContent = `${b.class_id}반 보드 수정`;
  editForm.lesson_code.value = b.lesson_code;
  editForm.elements.title.value = b.title;
  editForm.padlet.value = b.padlet_src || '';
  editForm.padlet.dispatchEvent(new Event('input'));
  const sims = editForm.querySelector('[data-sims]');
  sims.innerHTML = '';
  (b.sim_links?.length ? b.sim_links : [{ name: '', url: '' }]).forEach((s) => addSimRow(sims, s));
  $('edit').showModal();
}

$('edit-cancel').addEventListener('click', () => $('edit').close());

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editing) return;
  const raw = editForm.padlet.value.trim();
  const padlet_src = raw ? toPadletEmbed(raw) : null;
  if (raw && !padlet_src) { toast('패들렛 주소를 확인해 주세요', 'error'); return; }
  const sim_links = readSims(editForm.querySelector('[data-sims]'));
  if (!sim_links) return;
  try {
    await updateBoard(editing.id, {
      lesson_code: editForm.lesson_code.value.trim(),
      title: editForm.elements.title.value.trim(),
      padlet_src,
      sim_links,
    });
    toast('저장했어요', 'ok');
    $('edit').close();
    await refresh();
  } catch (err) {
    toast(errMsg(err), 'error');
  }
});

/* ---------- 로그인 ---------- */
$('v-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = f.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    await signIn(f.email.value.trim(), f.password.value);
    f.reset();
    await route();
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-logout]')) return;
  await signOut();
  show('v-login');
});

/* ---------- 시작 ---------- */
async function refresh() {
  [classes, boards] = await Promise.all([listClasses(), listBoards()]);
  renderToday();
  renderBoards();
}

async function route() {
  if (!isConfigured) return show('v-config');
  const session = await getSession();
  if (!session) return show('v-login');
  if (!(await amITeacher())) return show('v-denied');
  show('v-admin');
  try { await refresh(); } catch (err) { toast(errMsg(err), 'error'); }
}

renderCreateForm();
route();
sb?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') show('v-login'); });
