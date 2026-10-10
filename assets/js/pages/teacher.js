// 관리 화면: 보드 만들기(여러 반 한 번에), 반별 오늘 보드 지정, 명단(반별 마지막 번호)·코드 발급, 빠른 피드백 버튼
import { CLASSES, GRADE } from '../config.js';
import { initUI, toast, esc } from '../ui.js';
import {
  listClasses, listBoards, createBoards, updateBoard, deleteBoard, setTodayBoard, toPadletEmbed,
  listStudents, setRosterSize, updateStudent, issueCodes, resetCode,
  listPresets, addPreset, deletePreset,
} from '../db.js';
import { teacherGate, errMsg } from '../gate.js';

initUI();

const $ = (id) => document.getElementById(id);

let classes = [];
let boards = [];
let students = [];
let presets = [];

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const boardLabel = (b) => [`${b.lesson_code}차시`, b.title, fmtDate(b.created_at)].filter(Boolean).join(' · ');

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
        <div class="today-links">
          <a class="btn btn-line btn-small" href="../class.html?c=${c.id}" target="_blank" rel="noopener">보기 ↗</a>
          <a class="btn btn-line btn-small" href="groups.html?c=${c.id}">모둠</a>
          <a class="btn btn-line btn-small" href="reveal.html?c=${c.id}">발표</a>
        </div>
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
            ${b.status === 'revealed' ? '<span class="tag tag-done">발표함</span>' : ''}
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

/* ---------- 명단 ---------- */
let rosterClass = CLASSES[0];

function renderRoster() {
  const counts = new Map(CLASSES.map((n) => [n, 0]));
  for (const s of students) if (s.active) counts.set(s.class_id, (counts.get(s.class_id) || 0) + 1);
  $('roster-tabs').innerHTML = CLASSES.map((n) => `
    <button type="button" role="tab" class="cls-tab press${n === rosterClass ? ' on' : ''}" aria-selected="${n === rosterClass}" data-tab="${n}">
      ${n}반 <span class="num">${counts.get(n)}</span>
    </button>`).join('');

  const list = students.filter((s) => s.class_id === rosterClass)
    .sort((a, b) => (b.active - a.active) || (a.number - b.number));
  const active = list.filter((s) => s.active);
  const missing = active.filter((s) => !s.has_code).length;
  $('roster-count').textContent = active.length ? `${active.length}명 · 코드 없음 ${missing}명` : '';
  $('issue-missing').disabled = !missing;
  $('issue-all').disabled = !active.length;

  $('roster-list').innerHTML = list.length ? list.map((s) => `
    <div class="roster-row${s.active ? '' : ' off'}" data-sid="${s.id}">
      <b class="num">${s.number}번</b>
      ${s.active
        ? `<span class="tag ${s.has_code ? 'tag-today' : 'tag-warn'}">${s.has_code ? '코드 있음' : '코드 없음'}</span>
           <span class="roster-btns">
             <button type="button" class="btn btn-line btn-small" data-reset>코드 다시 발급</button>
             <button type="button" class="btn btn-danger btn-small" data-off>빼기</button>
           </span>`
        : `<span class="tag tag-off">명단에서 뺌</span>
           <span class="roster-btns"><button type="button" class="btn btn-line btn-small" data-on>되살리기</button></span>`}
    </div>`).join('') : '<div class="empty"><strong>명단이 없어요</strong></div>';
}

async function refreshStudents() {
  students = await listStudents();
  renderRoster();
  renderRosterSize();
}

/* ---------- 반별 마지막 번호 ---------- */
function renderRosterSize() {
  $('roster-size-grid').innerHTML = CLASSES.map((n) => {
    const last = students.filter((s) => s.class_id === n && s.active).reduce((m, s) => Math.max(m, s.number), 0);
    return `
      <label class="roster-size-item">
        <span>${n}반</span>
        <input class="input num" type="number" min="1" max="99" value="${last || ''}" data-last="${n}" aria-label="${n}반 마지막 번호">
      </label>`;
  }).join('');
}

$('roster-size').addEventListener('submit', async (e) => {
  e.preventDefault();
  const changes = [];
  for (const input of $('roster-size-grid').querySelectorAll('[data-last]')) {
    const n = Number(input.dataset.last);
    const raw = input.value.trim();
    if (!raw) continue;
    const last = Number(raw);
    if (!Number.isInteger(last) || last < 1 || last > 99) {
      toast(`${n}반 마지막 번호를 확인해 주세요`, 'error');
      input.focus();
      return;
    }
    const current = students.filter((s) => s.class_id === n && s.active).reduce((m, s) => Math.max(m, s.number), 0);
    if (last !== current) changes.push({ n, last, current });
  }
  if (!changes.length) { toast('바뀐 반이 없어요'); return; }
  const shrink = changes.filter((c) => c.last < c.current);
  if (shrink.length && !confirm(shrink.map((c) => `${c.n}반 ${c.last + 1}~${c.current}번`).join(', ') + '을(를) 명단에서 뺄까요?')) return;

  const btn = e.currentTarget.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    for (const c of changes) await setRosterSize(c.n, c.last);
    toast(`${changes.map((c) => c.n + '반').join(', ')} 명단을 저장했어요`, 'ok');
    rosterClass = changes[0].n;
    await refreshStudents();
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

$('roster-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;
  rosterClass = Number(tab.dataset.tab);
  renderRoster();
});

$('roster-list').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-sid]');
  if (!row) return;
  const s = students.find((x) => x.id === row.dataset.sid);
  if (!s) return;
  const label = `${s.class_id}반 ${s.number}번`;
  try {
    if (e.target.closest('[data-reset]')) {
      if (!confirm(`${label} 코드를 새로 만들까요? 지금 코드는 더 이상 쓸 수 없어요.`)) return;
      const code = await resetCode(s.id);
      showCodes([code], `${label} 새 코드`);
      await refreshStudents();
    } else if (e.target.closest('[data-off]')) {
      if (!confirm(`${label}을(를) 명단에서 뺄까요? 지금까지의 점수는 남아 있어요.`)) return;
      await updateStudent(s.id, { active: false });
      await refreshStudents();
    } else if (e.target.closest('[data-on]')) {
      await updateStudent(s.id, { active: true });
      await refreshStudents();
    }
  } catch (err) {
    toast(errMsg(err), 'error');
  }
});

/* ---------- 코드 발급 + A4 인쇄 ---------- */
async function issue(onlyMissing) {
  const n = rosterClass;
  if (!onlyMissing && !confirm(`${n}반 학생 전체의 코드를 새로 만들까요? 지금 코드는 더 이상 쓸 수 없어요.`)) return;
  const btn = $(onlyMissing ? 'issue-missing' : 'issue-all');
  btn.disabled = true;
  try {
    const list = await issueCodes(n, onlyMissing);
    if (!list.length) toast('발급할 학생이 없어요', 'error');
    else showCodes(list, `${n}반 코드 ${list.length}장`);
    await refreshStudents();
  } catch (err) {
    toast(errMsg(err), 'error');
    btn.disabled = false;
  }
}
$('issue-missing').addEventListener('click', () => issue(true));
$('issue-all').addEventListener('click', () => issue(false));

function siteAddress() {
  const base = new URL('../', location.href);
  return (base.host + base.pathname).replace(/\/$/, '');
}

function showCodes(list, title) {
  $('codes-title').textContent = title;
  $('codes-preview').innerHTML = list.map((c) => `<span>${c.number}번 <b>${esc(c.code)}</b></span>`).join('');
  const site = esc(siteAddress());
  $('print-sheet').innerHTML = list.map((c) => `
    <div class="code-card">
      <div class="cc-top"><b>${GRADE}학년 ${c.class_id}반 ${c.number}번</b></div>
      <div class="cc-code">${esc(c.code.slice(0, 3))} ${esc(c.code.slice(3))}</div>
      <div class="cc-bottom"><span class="cc-name">이름</span><span class="cc-url">${site}</span></div>
    </div>`).join('');
  $('codes-dlg').showModal();
}

$('codes-print').addEventListener('click', () => window.print());
$('codes-close').addEventListener('click', () => $('codes-dlg').close());
// Esc로 실수로 닫지 않게
$('codes-dlg').addEventListener('cancel', (e) => e.preventDefault());
// 닫으면 화면에서 평문 코드를 지운다
$('codes-dlg').addEventListener('close', () => {
  $('codes-preview').innerHTML = '';
  $('print-sheet').innerHTML = '';
});

/* ---------- 빠른 피드백 버튼 ---------- */
function renderPresets() {
  $('preset-list').innerHTML = presets.map((p) => `
    <span class="preset-item">
      ${esc(p.text)}
      <button type="button" class="preset-del" data-pdel="${p.id}" aria-label="${esc(p.text)} 지우기">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </span>`).join('');
}

async function refreshPresets() {
  presets = await listPresets();
  renderPresets();
}

$('preset-list').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-pdel]');
  if (!del) return;
  try {
    await deletePreset(Number(del.dataset.pdel));
    await refreshPresets();
  } catch (err) { toast(errMsg(err), 'error'); }
});

$('preset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.currentTarget.elements.text;
  const text = input.value.trim();
  if (!text) return;
  try {
    await addPreset(text, presets.reduce((m, p) => Math.max(m, p.sort), 0) + 1);
    input.value = '';
    await refreshPresets();
  } catch (err) { toast(errMsg(err), 'error'); }
});

/* ---------- 시작 ---------- */
async function refresh() {
  [classes, boards] = await Promise.all([listClasses(), listBoards()]);
  renderToday();
  renderBoards();
}

renderCreateForm();
teacherGate($('v-admin'), async () => {
  await refresh();
  await Promise.all([refreshStudents(), refreshPresets()]).catch((err) => toast(errMsg(err), 'error'));
});
