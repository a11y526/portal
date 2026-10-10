// 모둠 편성 (교사, 프로젝터): 반의 오늘 보드에 그날 모둠을 정한다
// 결석/조퇴는 빼고, 함께 묶은 학생(모둠 선택권)은 같은 모둠에 둔 채 무작위로 나눈다
import { CLASSES } from '../config.js';
import { initUI, toast, esc } from '../ui.js';
import {
  listClasses, getBoard, listStudents, getBoardGroups, setBoardGroups, countSubmissions, sendClassRefresh,
} from '../db.js';
import { teacherGate, errMsg } from '../gate.js';

initUI();

const $ = (id) => document.getElementById(id);
const COLORS = ['#8A4B9E', '#0F8A5F', '#C2410C', '#B88600', '#2E8B7A', '#B23A5C', '#3B6E8F'];

let classId;
let board = null;
let numbers = [];        // 이 반 명단 번호
let excluded = new Set();
let clusters = [];       // [[3, 12], [5, 9, 20]]
let pending = new Set(); // 묶으려고 고른 번호
let mode = 'exclude';
let preview = null;      // 확정 전 편성 { groups, adjusted }
let saved = null;        // 저장된 편성 [[번호...], ...]
let locked = false;      // 제출이 시작됐거나 발표한 보드

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const clusterOf = (n) => clusters.findIndex((c) => c.includes(n));
const groupCount = () => Math.min(20, Math.max(2, Number($('gcount').value) || 7));

/* ---------- 반 고르기 ---------- */
function renderTabs() {
  $('cls-tabs').innerHTML = CLASSES.map((n) => `
    <button type="button" role="tab" class="cls-tab press${n === classId ? ' on' : ''}" aria-selected="${n === classId}" data-cls="${n}">${n}반</button>`).join('');
}

$('cls-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-cls]');
  if (!tab || Number(tab.dataset.cls) === classId) return;
  if (preview && !confirm('확정하지 않은 편성이 있어요. 다른 반으로 갈까요?')) return;
  pickClass(Number(tab.dataset.cls));
});

async function pickClass(n) {
  classId = n;
  store.set('groupsClass', String(n));
  history.replaceState(null, '', `?c=${n}`);
  renderTabs();
  excluded = new Set();
  clusters = [];
  pending = new Set();
  preview = null;
  saved = null;
  $('gcount').value = store.get('gcount-' + n) || 7;
  $('results').innerHTML = '';
  $('adjusted').classList.add('hidden');
  try {
    await load();
  } catch (err) {
    toast(errMsg(err), 'error');
  }
}

async function load() {
  const classes = await listClasses();
  const c = classes.find((x) => x.id === classId);
  board = c?.today_board_id ? await getBoard(c.today_board_id) : null;
  numbers = (await listStudents()).filter((s) => s.class_id === classId && s.active).map((s) => s.number);

  $('lesson').textContent = board ? [board.lesson_code && `${board.lesson_code}차시`, board.title].filter(Boolean).join(' · ') : '';
  const note = !board ? '오늘 보드가 없어요' : !numbers.length ? '명단이 없어요. 관리 화면에서 마지막 번호를 넣어 주세요' : '';
  $('note').textContent = note;
  $('note').classList.toggle('hidden', !note);
  $('panel').classList.toggle('hidden', !!note);
  if (note) return;

  const [rows, subCount] = await Promise.all([getBoardGroups(board.id), countSubmissions(board.id)]);
  locked = subCount > 0 || board.status === 'revealed';
  if (rows.length) {
    const max = rows.reduce((m, r) => Math.max(m, r.group_no), 0);
    saved = Array.from({ length: max }, (_, i) => rows.filter((r) => r.group_no === i + 1).map((r) => r.number).sort((a, b) => a - b));
    const inGroups = new Set(rows.map((r) => r.number));
    excluded = new Set(numbers.filter((n) => !inGroups.has(n)));
    $('gcount').value = max;
    renderResults(saved, new Map());
  }
  renderRoll();
  renderState();
}

/* ---------- 출석부 ---------- */
function renderRoll() {
  $('roll').innerHTML = numbers.map((n) => {
    const ci = clusterOf(n);
    let cls = 'roll-chip num';
    let style = '';
    if (excluded.has(n)) cls += ' off';
    else if (ci !== -1) { cls += ' tied'; style = `style="--c:${COLORS[ci % COLORS.length]}"`; }
    else if (mode === 'cluster' && pending.has(n)) cls += ' picking';
    const label = excluded.has(n) ? `${n}번 결석` : `${n}번`;
    return `<button type="button" class="${cls}" ${style} data-n="${n}" aria-label="${label}" ${locked ? 'disabled' : ''}>${n}</button>`;
  }).join('');

  const active = numbers.length - excluded.size;
  $('stats').textContent = `전체 ${numbers.length} · 결석 ${excluded.size} · 편성 ${active} · 묶음 ${clusters.length}`;

  $('cluster-bar').classList.toggle('hidden', mode !== 'cluster' || locked);
  const picked = [...pending].sort((a, b) => a - b);
  $('sel-text').textContent = picked.length ? `${picked.join(', ')}번 선택` : '';
  $('make-cluster').disabled = picked.length < 2;

  $('cluster-list').innerHTML = clusters.map((c, i) => `
    <span class="cluster-item" style="--c:${COLORS[i % COLORS.length]}">
      <span class="dot" aria-hidden="true"></span>
      <span class="num">${c.slice().sort((a, b) => a - b).join(', ')}</span>
      <button type="button" class="preset-del" data-uncluster="${i}" aria-label="묶음 ${i + 1} 풀기" ${locked ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </span>`).join('');
}

$('roll').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-n]');
  if (!chip || locked) return;
  const n = Number(chip.dataset.n);
  if (mode === 'exclude') {
    excluded.has(n) ? excluded.delete(n) : excluded.add(n);
  } else {
    if (clusterOf(n) !== -1 || excluded.has(n)) return;
    pending.has(n) ? pending.delete(n) : pending.add(n);
  }
  renderRoll();
});

document.querySelector('.mode-row').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  mode = btn.dataset.mode;
  pending = new Set();
  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.classList.toggle('on', b === btn);
    b.setAttribute('aria-pressed', String(b === btn));
  });
  renderRoll();
});

$('make-cluster').addEventListener('click', () => {
  if (pending.size < 2) return;
  clusters.push([...pending].sort((a, b) => a - b));
  pending = new Set();
  renderRoll();
});

$('cluster-list').addEventListener('click', (e) => {
  const x = e.target.closest('[data-uncluster]');
  if (!x || locked) return;
  clusters.splice(Number(x.dataset.uncluster), 1);
  renderRoll();
});

$('gcount').addEventListener('change', () => {
  $('gcount').value = groupCount();
  store.set('gcount-' + classId, String(groupCount()));
});

/* ---------- 무작위 편성 (조편성기와 같은 방식) ---------- */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function assignGroups(count) {
  const active = new Set(numbers.filter((n) => !excluded.has(n)));
  const units = clusters.map((c) => c.filter((n) => active.has(n))).filter((c) => c.length >= 2);
  const tied = new Set(units.flat());
  const singles = shuffle([...active].filter((n) => !tied.has(n)));

  const total = tied.size + singles.length;
  const base = Math.floor(total / count);
  const sizes = Array(count).fill(base);
  for (let r = 0; r < total % count; r++) sizes[count - 1 - r]++;

  const groups = Array.from({ length: count }, () => []);
  const room = sizes.slice();
  let adjusted = false;

  // 큰 묶음부터, 자리가 딱 맞는 모둠에 (같은 크기 묶음끼리는 순서를 섞는다)
  shuffle(units).sort((a, b) => b.length - a.length).forEach((c) => {
    let best = -1;
    room.forEach((r, g) => { if (r >= c.length && (best === -1 || r < room[best])) best = g; });
    if (best === -1) {
      best = room.indexOf(Math.max(...room));
      adjusted = true;
    }
    groups[best].push(...c);
    room[best] = Math.max(0, room[best] - c.length);
  });

  let p = 0;
  room.forEach((r, g) => { for (let k = 0; k < r && p < singles.length; k++) groups[g].push(singles[p++]); });
  while (p < singles.length) groups[count - 1].push(singles[p++]);

  // 모둠 번호 자체도 섞어서 묶음이 늘 같은 모둠 번호로 가지 않게
  return { groups: shuffle(groups).map((g) => g.sort((a, b) => a - b)), adjusted };
}

/* ---------- 결과 ---------- */
function renderResults(groups, tiedColor) {
  $('results').innerHTML = groups.map((members, i) => `
    <article class="gcard glass-strong rise" style="--d:${(i * 0.06).toFixed(2)}s">
      <header><b>${i + 1}모둠</b><span class="num">${members.length}명</span></header>
      <div class="gmembers">
        ${members.length ? members.map((n, j) => {
          const c = tiedColor.get(n);
          return `<span class="gm num pop${c ? ' tied' : ''}" style="--d:${(0.15 + i * 0.06 + j * 0.04).toFixed(2)}s${c ? `;--c:${c}` : ''}">${n}</span>`;
        }).join('') : '<span class="muted">배정된 학생 없음</span>'}
      </div>
    </article>`).join('');
}

function renderState() {
  $('shuffle').textContent = preview || saved ? '다시 섞기' : '모둠 편성';
  $('shuffle').disabled = locked;
  $('save').classList.toggle('hidden', !preview || locked);
  $('gcount').disabled = locked;
  document.querySelectorAll('[data-mode]').forEach((b) => { b.disabled = locked; });
  $('state-text').textContent = locked
    ? (board?.status === 'revealed' ? '발표한 수업이에요' : '제출이 시작돼서 다시 섞을 수 없어요')
    : preview ? '확정 전' : saved ? '확정됨' : '';
  $('state-text').classList.toggle('is-saved', !preview && !!saved);
}

$('shuffle').addEventListener('click', () => {
  if (locked) return;
  if (numbers.length - excluded.size < 1) { toast('편성할 학생이 없어요', 'error'); return; }
  const count = groupCount();
  store.set('gcount-' + classId, String(count));
  preview = assignGroups(count);
  const tiedColor = new Map();
  clusters.forEach((c, i) => c.forEach((n) => tiedColor.set(n, COLORS[i % COLORS.length])));
  renderResults(preview.groups, tiedColor);
  $('adjusted').classList.toggle('hidden', !preview.adjusted);
  renderState();
  $('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});

$('save').addEventListener('click', async () => {
  if (!preview || !board) return;
  const btn = $('save');
  btn.disabled = true;
  try {
    await setBoardGroups(board.id, preview.groups);
    saved = preview.groups;
    preview = null;
    sendClassRefresh(classId);
    toast(`${classId}반 모둠을 확정했어요`, 'ok');
  } catch (err) {
    toast(errMsg(err), 'error');
    if (/HAS_SUBMISSIONS|BOARD_REVEALED/.test(err?.message || '')) { locked = true; renderRoll(); }
  } finally {
    btn.disabled = false;
    renderState();
  }
});

addEventListener('beforeunload', (e) => { if (preview) e.preventDefault(); });

/* ---------- 시작 ---------- */
teacherGate($('app'), async () => {
  const fromUrl = Number(new URLSearchParams(location.search).get('c'));
  const last = Number(store.get('groupsClass'));
  await pickClass(CLASSES.includes(fromUrl) ? fromUrl : CLASSES.includes(last) ? last : CLASSES[0]);
});
