// 검사 화면 (휴대폰 우선): 반을 고르면 오늘 보드의 제출이 제출 순서대로 쌓인다
import { CLASSES } from '../config.js';
import { initUI, toast, esc } from '../ui.js';
import {
  listClasses, getBoard, listSubmissions, listPresets, reviewSubmission,
  onSubmissionsChange, sendClassRefresh,
} from '../db.js';
import { teacherGate, errMsg } from '../gate.js';

initUI({
  orbs: [
    { color: 'blue',   size: 320, left: '-120px', top: '-100px' },
    { color: 'violet', size: 300, right: '-140px', top: '360px' },
    { color: 'mint',   size: 260, left: '40px', bottom: '-120px' },
  ],
});

const $ = (id) => document.getElementById(id);
const POLL_MS = 20000;

let classId;
let board = null;
let subs = [];
let presets = [];
let firstPaint = true;   // 처음 그릴 때와 반을 바꾼 직후에는 미끄러져 들어오는 연출 없이
let lastWait = 0;
let doneIds = new Set();

const fmtTime = (iso) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/* ---------- 불러오기 ---------- */
let loading = false;
let again = false;
async function load() {
  if (loading) { again = true; return; }
  loading = true;
  try {
    const classes = await listClasses();
    const c = classes.find((x) => x.id === classId);
    board = c?.today_board_id ? await getBoard(c.today_board_id) : null;
    subs = board ? await listSubmissions(board.id) : [];
    render();
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    loading = false;
    if (again) { again = false; load(); }
  }
}

let loadTimer;
const scheduleLoad = () => { clearTimeout(loadTimer); loadTimer = setTimeout(load, 250); };

/* ---------- 그리기 ---------- */
function render() {
  $('lesson').textContent = board ? [board.lesson_code && `${board.lesson_code}차시`, board.title].filter(Boolean).join(' · ') : '';
  $('reveal-link').href = `reveal.html?c=${classId}`;

  const revealed = board?.status === 'revealed';
  const note = !board ? '오늘 보드가 없어요' : revealed ? '순위를 발표했어요' : board.status === 'closed' ? '제출이 마감됐어요' : '';
  $('note').textContent = note;
  $('note').classList.toggle('hidden', !note);

  const pending = subs.filter((s) => s.status === 'pending');
  renderPending(pending, revealed);
  $('no-pending').classList.toggle('hidden', !board || pending.length > 0);
  renderWait();
  renderDone();
  firstPaint = false;
}

function renderWait() {
  const n = subs.filter((s) => s.status === 'pending').length;
  $('wait').textContent = `대기 ${n}`;
  if (n > lastWait && !firstPaint) replay($('wait'), 'bump');
  lastWait = n;
}

// 이미 있는 카드는 그대로 둔다 (메모를 쓰는 중에 새 제출이 들어와도 지워지지 않게)
function renderPending(list, locked) {
  const box = $('pending');
  box.classList.toggle('locked', locked);
  const ids = new Set(list.map((s) => s.id));
  for (const el of [...box.children]) {
    if (!ids.has(el.dataset.id) && !el.classList.contains('leaving')) el.remove();
  }
  for (const s of list) {
    if (box.querySelector(`[data-id="${s.id}"]`)) continue;
    const el = makeCard(s);
    if (!firstPaint) el.classList.add('slide-in');
    box.append(el);
  }
}

function makeCard(s) {
  const el = document.createElement('article');
  el.className = 'sub-card glass-strong';
  el.dataset.id = s.id;
  const who = s.student?.number ? ` · ${s.student.number}번` : '';
  el.innerHTML = `
    <div class="sub-top">
      <div class="sub-name">
        <b>${s.group_no}모둠</b>
        <span class="num">${fmtTime(s.submitted_at)} 제출${who}</span>
      </div>
      ${board?.padlet_src ? `<a class="padlet-go" href="${esc(board.padlet_src)}" target="_blank" rel="noopener">패들렛 보기 ↗</a>` : ''}
    </div>
    <div class="sub-actions" data-main>
      <button type="button" class="act act-again press" data-act="open">다시</button>
      <button type="button" class="act act-pass press" data-act="pass">통과</button>
    </div>
    <div class="sub-return hidden" data-return>
      <div class="presets">
        ${presets.map((p) => `<button type="button" class="preset press" aria-pressed="false" data-preset>${esc(p.text)}</button>`).join('')}
      </div>
      <label class="memo-label" for="memo-${s.id}">메모 (선택)</label>
      <input class="input memo-in" id="memo-${s.id}" type="text" maxlength="200" placeholder="예: 3번 사례" autocomplete="off">
      <div class="sub-actions stack">
        <button type="button" class="act act-send press" data-act="return">다시 보내기</button>
        <button type="button" class="act act-cancel press" data-act="close">취소</button>
      </div>
    </div>`;
  return el;
}

function renderDone() {
  const list = subs.filter((s) => s.status !== 'pending')
    .sort((a, b) => (b.reviewed_at || '').localeCompare(a.reviewed_at || ''));
  $('done').innerHTML = list.map((s) => {
    const ok = s.status === 'passed';
    const fresh = !firstPaint && !doneIds.has(s.id);
    return `
      <div class="done-row${fresh ? ' rise' : ''}">
        <b>${s.group_no}모둠</b>
        <span class="num muted">${fmtTime(s.submitted_at)}</span>
        <span class="done-tag status ${ok ? 'is-passed' : 'is-returned'}">${ok ? '통과' : '다시 보냄'}</span>
      </div>`;
  }).join('');
  $('done').classList.toggle('hidden', !list.length);
  document.querySelector('.done-h').classList.toggle('hidden', !list.length);
  doneIds = new Set(list.map((s) => s.id));
}

/* ---------- 검사 ---------- */
$('pending').addEventListener('click', async (e) => {
  const preset = e.target.closest('[data-preset]');
  if (preset) {
    preset.setAttribute('aria-pressed', preset.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.sub-card');
  const act = btn.dataset.act;
  const toggleReturn = (open) => {
    card.querySelector('[data-main]').classList.toggle('hidden', open);
    card.querySelector('[data-return]').classList.toggle('hidden', !open);
  };

  if (act === 'open') return toggleReturn(true);
  if (act === 'close') return toggleReturn(false);
  if (act === 'pass') return review(card, 'passed', null);
  if (act === 'return') {
    const picked = [...card.querySelectorAll('[data-preset][aria-pressed="true"]')].map((b) => b.textContent.trim());
    const memo = card.querySelector('.memo-in').value.trim();
    return review(card, 'returned', [...picked, memo].filter(Boolean).join(' · ') || null);
  }
});

async function review(card, status, feedback) {
  const buttons = card.querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await reviewSubmission(card.dataset.id, status, feedback);
    sendClassRefresh(classId);
    // 옆으로 밀려 나가고 처리함에 들어간다
    card.classList.add('leaving');
    replay(card, 'slide-out');
    const remove = () => card.remove();
    card.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 600);
    const s = subs.find((x) => x.id === card.dataset.id);
    if (s) { s.status = status; s.reviewed_at = new Date().toISOString(); }
    renderWait();
    renderDone();
    $('no-pending').classList.toggle('hidden', subs.some((x) => x.status === 'pending'));
    scheduleLoad();
  } catch (err) {
    toast(errMsg(err), 'error');
    buttons.forEach((b) => { b.disabled = false; });
    scheduleLoad();
  }
}

/* ---------- 반 고르기 ---------- */
function pickClass(n) {
  classId = n;
  try { localStorage.setItem('checkClass', String(n)); } catch {}
  firstPaint = true;
  lastWait = 0;
  doneIds = new Set();
  $('pending').innerHTML = '';
  load();
}

/* ---------- 시작 ---------- */
teacherGate($('app'), async () => {
  let saved = null;
  try { saved = Number(localStorage.getItem('checkClass')); } catch {}
  classId = CLASSES.includes(saved) ? saved : CLASSES[0];
  $('cls').innerHTML = CLASSES.map((n) => `<option value="${n}" ${n === classId ? 'selected' : ''}>${n}반</option>`).join('');
  $('cls').addEventListener('change', (e) => pickClass(Number(e.target.value)));

  presets = await listPresets().catch(() => []);
  await load();

  // 새 제출·검사가 생기면 바로, 놓쳐도 20초마다 다시 읽는다
  onSubmissionsChange(scheduleLoad);
  setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
});
