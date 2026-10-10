// 반 페이지: 오늘 보드(패들렛 + 시뮬레이션), 우리 모둠 제출, 모둠 현황
import { CLASSES, GRADE } from '../config.js';
import { initUI, esc, toast, prepareDraw } from '../ui.js';
import { sb, getClassPage, submitGroup, onClassRefresh, sendClassRefresh } from '../db.js';

initUI();

const REFRESH_MS = 15000;
const classId = Number(new URLSearchParams(location.search).get('c'));
if (!CLASSES.includes(classId)) location.replace('index.html');

const $ = (id) => document.getElementById(id);
const titleText = `${GRADE}학년 ${classId}반`;
$('title').textContent = titleText;
document.title = titleText;
try { localStorage.setItem('lastClass', String(classId)); } catch {}

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

const ICON_BOARD = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>`;

let shown = { padlet: undefined, sims: undefined, lesson: undefined, groups: undefined };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// 오른쪽 칸에 보여 줄 것이 없으면 패들렛을 넓게
function updateSide() {
  $('side').classList.toggle('hidden', !$('side').querySelector('section:not(.hidden)'));
}

function showEmpty(message, withRetry = false) {
  const key = 'empty:' + message;
  if (key === shown.padlet && !withRetry) return;
  shown.padlet = key;
  $('padlet-actions').classList.add('hidden');
  $('padlet-slot').innerHTML = `
    <div class="empty padlet-empty">
      ${ICON_BOARD}
      <strong>${esc(message)}</strong>
      ${withRetry ? '<button type="button" class="btn btn-line" id="retry">다시 불러오기</button>' : ''}
    </div>`;
  if (withRetry) $('retry').addEventListener('click', load);
}

function renderPadlet(src) {
  if (!isHttp(src)) {
    showEmpty('패들렛이 아직 연결되지 않았어요');
    return;
  }
  if (src === shown.padlet) return;
  shown.padlet = src;
  const frame = document.createElement('iframe');
  frame.className = 'padlet-frame';
  frame.src = src;
  frame.title = '오늘의 패들렛';
  frame.allow = 'camera;microphone;geolocation;display-capture;clipboard-write';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  $('padlet-slot').replaceChildren(frame);
  $('padlet-open').href = src;
  $('padlet-actions').classList.remove('hidden');
  fitFrame();
}

function renderSims(list) {
  const sims = (Array.isArray(list) ? list : []).filter((s) => s && isHttp(s.url));
  const key = JSON.stringify(sims);
  if (key === shown.sims) return;
  shown.sims = key;
  $('sim-list').innerHTML = sims.map((s) => `
    <a class="sim-link lift" href="${esc(s.url)}" target="_blank" rel="noopener">
      ${esc(s.name || s.url)}<span aria-hidden="true">↗</span>
    </a>`).join('');
  $('sims').classList.toggle('hidden', sims.length === 0);
}

/* ---------- 우리 모둠 ---------- */

const LABEL = { idle: '진행 중', pending: '검사 대기', returned: '다시 확인', passed: '통과' };
const SUBMIT_ERR = {
  BAD_CODE: '반, 번호 또는 코드가 맞지 않아요',
  LOCKED: '여러 번 틀렸어요. 10분 뒤에 다시 해 주세요',
  CLOSED: '제출이 마감됐어요',
  BOARD_CHANGED: '오늘 수업이 바뀌었어요',
  ALREADY: '이미 제출했어요',
};

// 내 번호는 이 기기에 기억해 둔다 (다음부터는 코드만 넣으면 됨)
const NUM_KEY = 'num-' + classId;
function readNum() {
  try {
    const n = Number(localStorage.getItem(NUM_KEY));
    return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
  } catch { return null; }
}
function saveNum(n) {
  try { n ? localStorage.setItem(NUM_KEY, String(n)) : localStorage.removeItem(NUM_KEY); } catch {}
}

let page = null;
let myNumber = readNum();
let numError = '';
let mineKey;    // 지금 보이는 우리 모둠 화면
let mineState;  // 지금 보이는 상태 (바뀌면 뒤집히며 전환)
let swapTimer;

const numberForm = () => `
  <form class="code-form" id="num-form">
    <label for="num-in">내 번호</label>
    <input id="num-in" class="code-input num-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" required>
    ${numError ? `<p class="form-err">${esc(numError)}</p>` : ''}
    <button class="btn btn-primary btn-big press" type="submit">확인</button>
  </form>`;

const codeForm = (btnText) => `
  <form class="code-form" id="code-form">
    <label for="code-in">내 코드 6자리</label>
    <input id="code-in" class="code-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="● ● ● ● ● ●" required>
    <button class="btn btn-primary btn-big press" type="submit">${btnText}</button>
  </form>`;

const closedBox = (text) => `
  <div class="state-box is-idle"><span class="state-title">${text}</span></div>`;

const pendingBox = () => `
  <div class="state-box is-pending">
    <div class="spinner spin" aria-hidden="true"></div>
    <span class="state-title breathe">선생님이 확인하는 중</span>
  </div>`;

const returnedBox = (feedback) => `
  <div class="state-box is-returned returned-box">
    <div class="state-row">
      <span class="bang pop" aria-hidden="true">!</span>
      <span class="state-title">다시 확인해 주세요</span>
    </div>
    ${feedback ? `<div class="memo"><b>선생님 메모</b> · ${esc(feedback)}</div>` : ''}
  </div>`;

const BITS = [['12%', '#2457E6', 0], ['28%', '#F59E0B', .5], ['46%', '#22C582', .2], ['64%', '#B79CFF', .8], ['82%', '#FF7A45', .35]];
const passedBox = (rank) => `
  <div class="state-box is-passed passed-box">
    ${BITS.map(([l, c, d]) => `<span class="confetti-bit" aria-hidden="true" style="left:${l};background:${c};--d:${d}s"></span>`).join('')}
    <span class="pass-check pop" aria-hidden="true">
      <svg class="draw" style="--d:.35s" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
    </span>
    <span class="pass-title">통과!</span>
    <span class="pass-sub">${rank ? `${rank}위` : '순위는 수업 끝에 발표돼요'}</span>
  </div>`;

function setMine(key, state, html) {
  if (key === mineKey) return;
  const body = $('mine-body');
  const flip = !reduceMotion && mineState && state && state !== mineState;
  mineKey = key;
  mineState = state;
  clearTimeout(swapTimer);
  const swap = () => { body.innerHTML = html; prepareDraw(body); };
  if (!flip) return swap();
  // 카드가 뒤집히는 중간(가장 얇을 때)에 내용을 바꾼다
  body.classList.remove('morph');
  void body.offsetWidth;
  body.classList.add('morph');
  swapTimer = setTimeout(swap, 250);
}

function renderMine(data) {
  const board = data?.board;
  const groups = data?.groups ?? [];
  const card = $('mine');
  if (!board || !groups.length) {
    card.classList.add('hidden');
    mineKey = mineState = undefined;
    return;
  }
  card.classList.remove('hidden');

  if (myNumber && data.my_group == null) {
    numError = '명단에 없는 번호예요';
    myNumber = null;
    saveNum(null);
  }
  const myGroup = myNumber ? data.my_group : null;
  $('mine-h').textContent = myGroup ? `우리 모둠 · ${myGroup}모둠` : '우리 모둠';
  $('num-change').classList.toggle('hidden', !myNumber);
  if (myNumber) $('num-change').textContent = `${myNumber}번 · 바꾸기`;

  if (!myNumber) {
    setMine('num|' + numError, null, numberForm());
    return;
  }

  const g = groups.find((x) => x.no === myGroup) ?? { state: 'idle' };
  const open = board.status === 'open';
  const key = [board.id, board.status, g.state, g.feedback ?? '', g.rank ?? ''].join('|');
  let html;
  if (g.state === 'pending') html = pendingBox();
  else if (g.state === 'passed') html = passedBox(g.rank);
  else if (g.state === 'returned') html = returnedBox(g.feedback) + (open ? codeForm('고쳐서 다시 제출') : '');
  else if (open) html = codeForm('다 했어요');
  else html = closedBox(board.status === 'revealed' ? '발표가 끝났어요' : '제출이 마감됐어요');
  setMine(key, g.state, html);
}

$('mine-body').addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'num-form') onNumber(e.target);
  if (e.target.id === 'code-form') onCode(e.target);
});

function onNumber(form) {
  const n = Number(form.querySelector('#num-in').value.trim());
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    toast('번호를 확인해 주세요', 'error');
    return;
  }
  myNumber = n;
  numError = '';
  saveNum(n);
  mineKey = undefined;
  form.querySelector('button').disabled = true;
  load();
}

$('num-change').addEventListener('click', () => {
  myNumber = null;
  numError = '';
  saveNum(null);
  mineKey = mineState = undefined;
  shown.groups = undefined;
  renderMine(page);
  renderGroups(page);
  $('num-in')?.focus();
});

async function onCode(form) {
  const input = form.querySelector('#code-in');
  const btn = form.querySelector('button');
  const code = input.value.replace(/\D/g, '');
  if (code.length !== 6) {
    toast('코드 6자리를 넣어 주세요', 'error');
    input.focus();
    return;
  }
  if (!page?.board) return;
  btn.disabled = true;
  try {
    const res = await submitGroup(page.board.id, classId, myNumber, code);
    if (res?.ok) {
      sendClassRefresh(classId);
      await load();
      return;
    }
    toast(SUBMIT_ERR[res?.error] || '제출하지 못했어요', 'error');
    if (res?.error === 'BAD_CODE' || res?.error === 'LOCKED') {
      input.value = '';
      input.focus();
    } else {
      await load();
    }
  } catch (err) {
    console.error(err);
    toast('제출하지 못했어요. 다시 눌러 주세요', 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 모둠 현황 ---------- */

let groupStates = new Map();

function renderGroups(data) {
  const groups = data?.board ? (data.groups ?? []) : [];
  $('groups').classList.toggle('hidden', !groups.length);
  if (!groups.length) return;
  const myGroup = myNumber ? data.my_group : null;
  const key = JSON.stringify(groups.map((g) => [g.no, g.state, g.rank, g.no === myGroup]));
  if (key === shown.groups) return;
  shown.groups = key;
  $('group-grid').innerHTML = groups.map((g) => {
    const label = g.state === 'passed' && g.rank ? `통과 · ${g.rank}위` : LABEL[g.state];
    const changed = groupStates.has(g.no) && groupStates.get(g.no) !== g.state;
    return `
      <div class="gs is-${g.state}${g.no === myGroup ? ' is-mine' : ''}${changed ? ' morph' : ''}">
        <span class="dot" aria-hidden="true"></span>
        <b>${g.no}모둠</b>
        <span class="lbl">${label}</span>
      </div>`;
  }).join('');
  groupStates = new Map(groups.map((g) => [g.no, g.state]));
}

function renderLesson(board) {
  const text = board ? [board.lesson_code && `${board.lesson_code}차시`, board.title].filter(Boolean).join(' · ') : '';
  if (text === shown.lesson) return;
  shown.lesson = text;
  $('lesson').textContent = text;
  $('lesson').classList.toggle('hidden', !text);
}

// 패들렛 창이 화면 아래로 잘리지 않게 남은 높이에 맞춘다
// (창 위에서 휠을 굴리면 페이지가 아니라 패들렛이 움직여서, 잘린 부분으로 내려갈 수 없기 때문)
const BOTTOM_SPACE = 46; // 카드 아래 안쪽 여백 + 페이지 아래 여백
function fitFrame() {
  const frame = document.querySelector('.padlet-frame');
  if (!frame || maxed) return;
  const top = frame.getBoundingClientRect().top + scrollY;
  frame.style.height = Math.max(360, innerHeight - top - BOTTOM_SPACE) + 'px';
}
addEventListener('resize', fitFrame);
document.querySelector('.padlet-card').addEventListener('animationend', fitFrame);

// 크게 보기: 전체 화면, 막혀 있으면 브라우저 창 안에서 꽉 채우기
const card = document.querySelector('.padlet-card');
const fullBtn = $('padlet-full');
let maxed = false;
function setMax(on) {
  maxed = on;
  card.classList.toggle('is-max', on);
  document.body.style.overflow = on ? 'hidden' : '';
  fullBtn.querySelector('span').textContent = on ? '작게 보기' : '크게 보기';
  const frame = document.querySelector('.padlet-frame');
  if (frame) frame.style.height = '';
  if (!on) fitFrame();
}
fullBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (maxed) setMax(false);
  else if (card.requestFullscreen) card.requestFullscreen().catch(() => setMax(true));
  else setMax(true);
});
document.addEventListener('fullscreenchange', () => setMax(!!document.fullscreenElement));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && maxed && !document.fullscreenElement) setMax(false); });

let loading = false;
let again = false;
async function load() {
  if (loading) { again = true; return; }
  loading = true;
  try {
    const data = await getClassPage(classId, myNumber);
    page = data;
    const board = data?.board ?? null;
    renderLesson(board);
    renderSims(board?.sim_links);
    renderMine(data);
    renderGroups(data);
    updateSide();
    if (!board) showEmpty('오늘 수업이 아직 없어요');
    else renderPadlet(board.padlet_src);
  } catch (err) {
    console.error(err);
    if (err.message === 'NOT_CONFIGURED') showEmpty('config.js에 Supabase 주소와 키를 넣어야 해요');
    else if (shown.padlet === undefined) showEmpty('불러오지 못했어요', true);
    // 이미 보이는 패들렛이 있으면 그대로 둔다
  } finally {
    loading = false;
    if (again) { again = false; load(); }
  }
}

load();

// 선생님이 검사·발표하면 "새로고침" 신호가 온다. 신호를 놓쳐도 15초마다 다시 읽는다 (화면이 숨겨져 있으면 멈춤)
if (sb) onClassRefresh(classId, () => { if (!document.hidden) load(); });
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
