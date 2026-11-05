// 반 페이지: [개인 학습지] [모둠활동] [게시판] 탭. 게시판은 선생님이 반마다 섹션을 짜고 올린 자료(로그인한 학생만). 모둠활동은 오늘 보드(모둠 게시판 + 시뮬레이션), 우리 모둠 제출(모둠원 캐릭터), 모둠 현황
// 학생 기기가 느리고 와이파이가 약해서: 갱신이 실패하면 마지막 화면을 그대로 두고 '연결 확인 중'만 띄운다
import { CLASSES, TEST_CLASS, GRADE, clsName } from '../config.js';
import { initUI, esc, toast, prepareDraw, countUp, groupName } from '../ui.js';
import { sb, getClassPage, submitGroup, getWorksheet, saveWorksheetAnswers, submitWorksheetPage, onClassRefresh, sendClassRefresh, onWsOpen, onWsAi, onQuizShow,
  getPosts, savePost, deletePost, uploadPostPhoto, postPhotoUrl, getClassMaterials } from '../db.js';
import { moonRpgState, moonRpgFinish } from '../db.js'; // nogame
import { avatarSVG, react, setWaiting, bindReactions } from '../avatar.js';
import { readLogin, clearLogin } from '../login.js';
import { renderPage, markFields, closeSims, showSide, wakeSims, pageSims } from '../worksheet.js';
import { boardHTML, shrinkPhoto } from '../posts.js';
import { materialsHTML, bindVideos, closeVideos } from '../materials.js';

initUI();
bindReactions();

const REFRESH_MS = 15000;
const JITTER_MS = 3000;     // 15초 갱신에 더하는 0~3초 무작위 지연 (한 반 30대가 같은 순간에 요청하지 않게)
const RETRY_MS = 5000;      // 연결이 끊겼을 때는 더 자주 다시 시도
const SUBMIT_WAIT_MS = 10000;
const RECHECK_MS = 22000;    // AI 판정을 기다리는 칸이 있으면 신호를 놓쳤을 때만 이만큼(+0~5초) 뒤 그 쪽을 다시 제출. 서버는 20초 뒤 대신 판정
const classId = Number(new URLSearchParams(location.search).get('c'));
if (!CLASSES.includes(classId) && classId !== TEST_CLASS) location.replace('index.html');
// test반 입구는 test.html
const HOME = classId === TEST_CLASS ? 'test.html' : 'index.html';
if (HOME !== 'index.html') document.querySelectorAll('a[href="index.html"]').forEach((a) => { a.href = HOME; });

const $ = (id) => document.getElementById(id);
const titleText = `${GRADE}학년 ${clsName(classId)}반`;
$('title').textContent = titleText;
document.title = titleText;
$('me-link').href = `me.html?c=${classId}`;
try { localStorage.setItem('lastClass', String(classId)); } catch {}

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

const ICON_BOARD = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>`;

let shown = { board: undefined, sims: undefined, lesson: undefined, groups: undefined };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// 오른쪽 칸에 보여 줄 것이 없으면 게시판을 넓게
function updateSide() {
  $('side').classList.toggle('hidden', !$('side').querySelector('section:not(.hidden)'));
}

function showEmpty(message, withRetry = false) {
  const key = 'empty:' + message;
  if (key === shown.board && !withRetry) return;
  shown.board = key;
  postsKey = undefined;
  $('board-note').textContent = '';
  $('post-board').innerHTML = `
    <div class="empty board-empty">
      ${ICON_BOARD}
      <strong>${esc(message)}</strong>
      ${withRetry ? '<button type="button" class="btn btn-line" id="retry">다시 불러오기</button>' : ''}
    </div>`;
  if (withRetry) $('retry').addEventListener('click', load);
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
  TIMEOUT: '응답이 없어요. 다시 보내 주세요',
  NO_SESSION: '다시 로그인해 주세요',
  CLOSED: '제출이 마감됐어요',
  BOARD_CHANGED: '오늘 수업이 바뀌었어요',
  NO_GROUP: '오늘 모둠 명단에 없어요',
  ALREADY: '이미 제출했어요',
};

// 로그인(출입증)이 이 반 것일 때만 쓴다. 로그인 안 했으면 게시판만 보이고 제출 칸은 로그인 버튼
let login = readLogin();
if (login && login.class_id !== classId) login = null;

let page = null;
let mineKey;    // 지금 보이는 우리 모둠 화면
let mineState;  // 지금 보이는 상태 (바뀌면 뒤집히며 전환)
let swapTimer;

const loginBox = () => `
  <div class="state-box is-idle login-need">
    <span class="state-title">로그인하면 제출할 수 있어요</span>
    <a class="btn btn-primary press" href="${HOME}">로그인</a>
  </div>`;

const submitBtn = (text) => `
  <button type="button" class="btn btn-primary btn-big press" id="submit-btn">${text}</button>`;

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

// 우리 모둠원 캐릭터: 검사 대기면 모래시계, 다시 받으면 갸웃+물음표, 통과하면 차례로 점프
let matesKey;
let matesState;
function renderMates(members, state) {
  const box = $('mine-mates');
  const list = members ?? [];
  const key = JSON.stringify(list);
  if (!list.length) {
    box.innerHTML = '';
    box.classList.add('hidden');
    matesKey = matesState = undefined;
    return;
  }
  if (key !== matesKey) {
    matesKey = key;
    box.innerHTML = list.map((m) => `
      <figure class="mate${m.me ? ' me' : ''}">
        ${avatarSVG(m.avatar, 48, { label: m.nickname || '모둠원', live: !!m.me })}
        <figcaption>${m.me ? '나' : (m.nickname ? esc(m.nickname) : '닉네임 미정')}</figcaption>
      </figure>`).join('');
    box.classList.remove('hidden');
  }
  const svgs = [...box.querySelectorAll('svg.av')];
  svgs.forEach((s) => setWaiting(s, state === 'pending'));
  if (matesState && state !== matesState) {
    if (state === 'passed') svgs.forEach((s, i) => react(s, 'jump', { delay: 200 + i * 120 }));
    if (state === 'returned') svgs.forEach((s, i) => react(s, 'returned', { delay: i * 80 }));
  }
  matesState = state;
}

function renderMine(data) {
  const board = data?.board;
  const groups = data?.groups ?? [];
  const card = $('mine');
  if (!board || !data.has_roster) {
    card.classList.add('hidden');
    mineKey = mineState = undefined;
    renderMates(null);
    return;
  }
  card.classList.remove('hidden');

  // 출입증이 지워졌으면(로그아웃, 반 잠금, 코드 다시 발급) 로그인 풀기
  if (login && data.session === 'none') {
    clearLogin();
    login = null;
  }
  const myGroup = login ? data.my_group : null;
  $('mine-h').textContent = myGroup != null ? `우리 모둠 · ${groupName(myGroup)}` : '우리 모둠';
  $('num-change').classList.toggle('hidden', !login);
  if (login) $('num-change').textContent = login.number === 0 ? '선생님' : `${login.number}번`;

  if (!login) {
    renderMates(null);
    setMine('login', null, loginBox());
    return;
  }
  // 모둠은 수업마다 선생님이 편성한다
  if (!groups.length) {
    renderMates(null);
    setMine('nogroups|' + board.id, 'nogroups', closedBox('아직 모둠이 정해지지 않았어요'));
    return;
  }
  if (myGroup == null) {
    renderMates(null);
    setMine('absent|' + board.id, 'absent', closedBox('오늘 모둠 명단에 없어요'));
    return;
  }

  const g = groups.find((x) => x.no === myGroup) ?? { state: 'idle' };
  renderMates(data.my_members, g.state);
  const open = board.status === 'open';
  const key = [board.id, board.status, g.state, g.feedback ?? '', g.rank ?? ''].join('|');
  let html;
  if (g.state === 'pending') html = pendingBox();
  else if (g.state === 'passed') html = passedBox(g.rank);
  else if (open) html = (g.state === 'returned' ? returnedBox(g.feedback) : '') + submitBtn(g.state === 'returned' ? '고쳐서 다시 제출' : '제출');
  else html = (g.state === 'returned' ? returnedBox(g.feedback) : '') + closedBox(board.status === 'revealed' ? '발표가 끝났어요' : '제출이 마감됐어요');
  setMine(key, g.state, html);
}

$('mine-body').addEventListener('click', (e) => {
  if (e.target.closest('#submit-btn')) onSubmit(e.target.closest('#submit-btn'));
});

// 버튼 하나에 요청 하나: 누르면 바로 '보내는 중'으로 잠그고, 10초 안에 답이 없거나 실패하면 [다시 보내기]
let sending = false;

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error('TIMEOUT')), ms); }),
  ]);
}

async function onSubmit(btn) {
  if (sending || !page?.board || !login) return;
  sending = true;
  const label = btn.textContent.trim();
  btn.disabled = true;
  btn.textContent = '보내는 중';
  let res;
  try {
    res = await withTimeout(submitGroup(page.board.id, login.token), SUBMIT_WAIT_MS);
  } catch (err) {
    console.error(err);
    sending = false;
    toast(SUBMIT_ERR[err.message] || '보내지 못했어요. 다시 보내 주세요', 'error');
    btn.textContent = '다시 보내기';
    btn.disabled = false;
    return;
  }
  sending = false;
  // 앞서 보낸 요청이 늦게 들어갔으면 ALREADY: 이미 제출된 것이니 화면만 새로
  if (res?.ok || res?.error === 'ALREADY') {
    if (res.ok) sendClassRefresh(classId);
    await load();
    return;
  }
  toast(SUBMIT_ERR[res?.error] || '제출하지 못했어요', 'error');
  if (res?.error === 'NO_SESSION') {
    clearLogin();
    login = null;
    mineKey = undefined;
  }
  btn.textContent = label;
  btn.disabled = false;
  await load();
}

/* ---------- 탭: [개인 학습지] [모둠활동] (마지막 탭 기억) ----------
   오늘 차시에 학습지가 없으면 탭 없이 모둠활동만 */

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let tab = ['group', 'mats'].includes(store.get('classTab')) ? store.get('classTab') : 'sheet';
let hasSheet = false;
let hasQs = false;   // 선생님이 퀴즈 쇼를 열었을 때만 [퀴즈 쇼] 탭

function applyTab() {
  const now = tab === 'sheet' && !hasSheet ? 'group' : tab === 'qs' && !hasQs ? (hasSheet ? 'sheet' : 'group') : tab;
  $('tab-sheet').classList.toggle('hidden', !hasSheet);
  $('tab-qs').classList.toggle('hidden', !hasQs);
  $('qs-tab').classList.toggle('hidden', now !== 'qs');
  // 퀴즈 쇼 화면은 탭을 열 때만 만들고, 다른 탭으로 가면 없앤다(학생 기기 부담)
  if (now === 'qs' && !$('qs-tab').firstChild) {
    $('qs-tab').innerHTML = '<iframe class="qs-frame" src="quizshow.html?embed=1" title="퀴즈 쇼"></iframe>';
  } else if (now !== 'qs') $('qs-tab').replaceChildren();
  $('sheet').classList.toggle('hidden', now !== 'sheet');
  $('group-tab').classList.toggle('hidden', now !== 'group');
  $('mats').classList.toggle('hidden', now !== 'mats');
  document.querySelectorAll('.class-tab').forEach((b) => {
    const on = b.dataset.tab === now;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  if (now === 'sheet') { ensureSheet(); wakeSims($('sheet')); }
  else closeSims($('sheet'));
  document.querySelector('.class-wrap').classList.toggle('is-wide', now === 'sheet' && $('sheet').classList.contains('has-side'));
  if (now === 'mats') loadMats();
  else closeVideos($('mats'));
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.class-tab');
  if (!b || b.dataset.tab === tab) return;
  tab = b.dataset.tab;
  if (tab !== 'qs') store.set('classTab', tab);
  applyTab();
});

/* ---------- 반 게시판 ----------
   [게시판] 탭이 보일 때만 받는다. 버전(v)이 같으면 서버가 내용을 빼고 돌려준다 */
const mats = { v: null, busy: false };
bindVideos($('mats-board'));

function matsEmpty(text) {
  $('mats-board').innerHTML = `<div class="empty board-empty">${ICON_BOARD}<strong>${esc(text)}</strong></div>`;
}

async function loadMats() {
  if (tab !== 'mats' || mats.busy) return;
  $('mats-login').classList.toggle('hidden', !!login);
  if (!login) {
    mats.v = null;
    $('mats-board').innerHTML = '';
    return;
  }
  mats.busy = true;
  try {
    const res = await getClassMaterials(classId, login.token, mats.v);
    if (!res?.ok) {
      if (res?.error === 'NO_SESSION') { clearLogin(); login = null; mats.v = null; load(); loadMatsLater(); }
      return;
    }
    if (res.same) return;
    mats.v = res.v;
    closeVideos($('mats'));
    if (!res.sections.length) matsEmpty('아직 올린 자료가 없어요');
    else $('mats-board').innerHTML = materialsHTML(res.sections);
  } catch (err) {
    console.error(err);
    if (mats.v === null) matsEmpty('불러오지 못했어요');
  } finally {
    mats.busy = false;
  }
}
function loadMatsLater() { setTimeout(loadMats, 0); }

/* ---------- 개인 학습지 ----------
   본문(get_worksheet)은 무거워서 버전이 바뀔 때만 받는다. 15초 갱신에는 완료 여부만 온다.
   쓰는 대로 기기에 임시 저장(ws-<보드>-<번호>, 학생마다 따로)하고 몇 초 뒤 서버에 저장한다. 끊기면 연결되면 다시.
   로그인하지 않았으면 빈 학습지만 보인다(같은 기기를 쓴 다른 학생의 답이 보이지 않게)
   쪽마다 [이 쪽 제출]: 서버가 그 쪽 칸만 채점해 틀리거나 빈 칸의 위치만 돌려준다(정답은 오지 않는다).
   맞은 쪽은 잠긴다(passed). 칸이 있는 쪽을 모두 제출해야 완료 + XP·금화, 완료 화면(#wsdone) */

const SAVE_DELAY_MS = 2500;
const WS_ERR = {
  TIMEOUT: '응답이 없어요. 다시 제출해 주세요',
  NO_SESSION: '다시 로그인해 주세요',
  BOARD_CHANGED: '오늘 수업이 바뀌었어요',
  NO_SHEET: '학습지가 바뀌었어요',
  NO_PAGE: '학습지가 바뀌었어요',
  LOCKED: '아직 수업에서 안 나간 쪽이에요',
  NOT_OPEN: '선생님이 열면 쓸 수 있어요',
  NO_GROUP: '모둠 편성 뒤에 낼 수 있어요',
};

const ws = {
  preAnswered: new Set(), // 시뮬레이션 잠금이 생기기 전에 답을 써 둔 쪽(쪽 번호)
  simProg: new Map(), // '쪽|주소' → { n, total } 시뮬레이션이 알려 준 진행(잠긴 쪽 안내 띠에 표시)
  simFill: new Map(), // 칸 키 → 시뮬레이션이 보낸 답(sim:answer). 아직 쓸 수 없으면 여기 두었다가 쪽을 다시 그릴 때 넣는다
  unlocked: null,     // 방금 시뮬레이션을 끝내 칸이 열린 쪽(안내 띠를 '완료'로 한 번 보여 줌)
  blank: null,        // 수업 따라가기 중 학습지에 쓸 칸이 없는 수업자료 쪽(번호). 그 쪽 제목 카드를 띄운다
  meta: null,       // get_class_page의 worksheet
  boardId: null,
  ver: null,        // 받아 둔 본문의 '보드|버전'
  sheet: null,      // get_worksheet 결과
  answers: {},
  idx: 0,
  done: false,
  gain: null,       // { xp, coins }
  passed: new Set(), // 제출해서 맞은 칸(f1…). 이 칸들이 다 든 쪽은 잠긴다
  justPassed: -1,   // 방금 제출한 쪽(제출함 표시를 한 번 튀게)
  firsts: new Set(), // 선생님이 첫 답으로 인정한 쪽(pages 순서)
  opened: new Set(), // 선생님이 [제출 시작]으로 연 쪽(pages 순서). 칸이 있는 쪽은 열려 있을 때만 쓰고 제출(잠그면 다시 빠짐)
  bad: {},          // { f1: 'wrong' | 'empty' | 'checking'(AI 판정을 기다림) }
  badPts: {},       // 점 찍기 칸의 틀린 점 순서 { f9: [2, 5] } (제출 결과)
  dirty: false,     // 서버에 아직 저장 안 된 답이 있음
  saving: false,
  submitting: false,
  fetching: false,
  saveTimer: null,
  recheckTimer: null,
  status: '',
};

const draftKey = () => (login ? `ws-${ws.boardId}-${login.number}` : null);
const pageKey = () => `ws-page-${ws.boardId}`;
const persist = () => { if (draftKey()) store.set(draftKey(), { answers: ws.answers, dirty: ws.dirty }); };
const pages = () => ws.sheet?.pages ?? [];
const hasFields = (p) => (p?.fields?.length ?? 0) > 0;
const isClosed = (p) => !!p?.locked; // 아직 수업에서 안 나간 쪽(본문이 오지 않음)
const pageDone = (p) => ws.done || (hasFields(p) && p.fields.every((f) => ws.passed.has(f.key)));
const isShut = (p, i) => hasFields(p) && !ws.opened.has(i); // 선생님이 아직 안 열었거나 잠근 쪽
const locked = () => !login || ws.done || ws.blank != null || pageDone(pages()[ws.idx]) || isShut(pages()[ws.idx], ws.idx);

/* ---------- 수업 따라가기 (2026-11-05) ----------
   수업 모드가 열려 있는 동안(worksheet.now가 있고 free가 아님) 학습지는 수업자료의 지금 쪽을 저절로 보여 주고,
   학생은 앞뒤로 넘기지 못한다. 학습지에 없는 쪽(표지·정리 등)은 제목 카드. 수업자료가 마지막 쪽에 가면(free) 마음대로 넘김 */
const following = () => !!(ws.sheet && ws.meta?.now && !ws.meta?.free);
function applyFollow() {
  const on = following();
  const flip = on !== $('sheet').classList.contains('is-follow');
  $('sheet').classList.toggle('is-follow', on);
  if (!on) {
    if (ws.blank == null) return flip; // 수업이 끝나 다시 넘길 수 있게 되면 단추를 다시 그린다
    ws.blank = null;
    return true;
  }
  const now = Number(ws.meta.now);
  const i = pages().findIndex((p) => p.slide === now);
  const blank = i < 0 ? now : null;
  if (!flip && blank === ws.blank && (i < 0 || i === ws.idx)) return false;
  ws.blank = blank;
  if (i >= 0) ws.idx = i;
  ws.unlocked = null;
  return true;
}

/* ---------- 시뮬레이션을 끝까지 해야 쓰기 (2026-11-02) ----------
   시뮬레이션이 있는 쪽은 그 쪽 시뮬레이션이 모두 {type:'sim:done'}을 보낼 때까지 칸을 잠근다.
   끝낸 시뮬레이션은 '쪽|주소'로 기기에 기억한다(화면이 숨겨져 iframe을 새로 만들어도 그대로).
   sim:gate를 보내지 않는 옛 시뮬레이션은 다 불러온 뒤 3초 지나면 끝낸 것으로 친다.
   {type:'sim:part', label}: 끝나기 전이라도 첫 칸이 label인 표 줄의 칸은 연다(712 6·7쪽: 본 행성 줄부터 쓰기).
   이 기능이 생기기 전에 답을 써 둔 쪽은 잠그지 않는다(처음 학습지를 받을 때 답이 있던 쪽을 기기에 적어 둠) */
const SIM_OLD_MS = 3000;
const simKey = (pg, src) => `${pg}|${src}`;
const simDoneKey = () => (login ? `wssim-${ws.boardId}-${login.number}` : null);
const simDone = () => new Set(store.get(simDoneKey()) ?? []);
function simLeft(p) {
  if (!p || !hasFields(p)) return [];
  const done = simDone();
  return [...new Set(pageSims(p))].filter((src) => !done.has(simKey(p.slide, src)));
}
// 선생님이 [제출 시작](S)을 누르기 전에도 띠를 보여 시뮬레이션을 먼저 끝내 둘 수 있게 한다(칸은 S 전까지 locked로 잠김)
const gated = (p = pages()[ws.idx]) => !!login && !ws.done && !pageDone(p) && simLeft(p).length > 0
  && !ws.preAnswered.has(String(p.slide));
const partKey = (pg, label) => `${pg}|part|${label}`;
const isPartPage = (pg) => simDone().has(`${pg}|parts`); // 줄마다 여는 시뮬레이션이 있는 쪽(sim:gate parts를 받은 적 있음)
const partsSeen = (p) => {
  const pre = `${p.slide}|part|`;
  return new Set([...simDone()].filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length)));
};
function notePreAnswered() {
  const k = login ? `wsgate-pre-${ws.boardId}-${login.number}` : null;
  let v = k ? store.get(k) : [];
  if (!Array.isArray(v)) {
    v = pages().filter((p) => p.fields?.some((f) => (ws.answers[f.key] ?? '') !== '')).map((p) => String(p.slide));
    store.set(k, v);
  }
  ws.preAnswered = new Set(v);
}
// 잠긴 쪽에서 시뮬레이션이 알려 준 줄(첫 칸 글자 = label)의 칸만 연다
function openParts(page) {
  if (locked()) return; // S 전에는 본 줄도 잠근 채(S를 누르면 다시 그릴 때 열림)
  const seen = partsSeen(page);
  if (!seen.size) return;
  $('ws-page').querySelectorAll('tr').forEach((tr) => {
    if (!seen.has((tr.cells[0]?.textContent ?? '').trim())) return;
    tr.querySelectorAll('[data-k]').forEach((el) => { el.disabled = false; el.classList.add('ws-part-open'); });
  });
}
const partOpen = (el) => !!el?.closest('.ws-part-open, tr:has(.ws-part-open)');
const wsMarks = () => ({ points: ws.badPts, passed: ws.done ? new Set(Object.keys(ws.answers)) : ws.passed });
// 제출할 쪽(칸이 있는 쪽) 수와 제출한 쪽 수
function progress() {
  const list = pages().filter(hasFields);
  return { n: list.filter(pageDone).length, total: list.length + pages().filter((p) => isClosed(p) && p.has_fields).length };
}

// get_class_page를 받을 때마다
function syncSheet(data) {
  const meta = data?.board ? data.worksheet : null;
  hasSheet = !!meta;
  ws.meta = meta;
  noteFirsts(meta, data?.board?.id);
  setOpened(meta?.opened);
  if (applyFollow() && ws.sheet) { renderSheet(); if ($('sheet').getBoundingClientRect().top < 0) $('sheet').scrollIntoView({ block: 'start' }); }
  showGroupSheet(meta?.group);
  if (!meta) {
    ws.ver = null;
    ws.sheet = null;
    ws.boardId = null;
    applyTab();
    return;
  }
  const want = `${data.board.id}|${meta.version}|${meta.upto ?? ''}`; // 진도가 바뀌어도 다시 받는다
  if (ws.ver && ws.ver !== want) ws.ver = null; // 학습지를 다시 올렸거나 오늘 보드가 바뀜
  if (ws.sheet && login && meta.done && !ws.done) ws.ver = null; // 다른 기기에서 완료함
  applyTab();
  if (ws.sheet && !login && ws.lockedShown === false) { ws.ver = null; ws.answers = {}; ws.bad = {}; ws.badPts = {}; ensureSheet(); } // 로그인이 풀림
}

// 모둠 학습지(과학실처럼 모둠마다 기기 하나): 여기서 쓰고 낸 것이 그날 모둠원 모두에게 기록된다
function showGroupSheet(g) {
  const el = $('ws-group');
  const none = !!g && login && !(g.no > 0);
  el.classList.toggle('hidden', !g);
  el.classList.toggle('is-none', none);
  if (!g) return;
  el.textContent = !login ? '모둠 학습지'
    : g.no === 0 ? '모둠 학습지 · 선생님 혼자 기록'
    : none ? '모둠 학습지 · 모둠 편성 뒤에 낼 수 있어요'
    : `모둠 학습지 · ${groupName(g.no)} ${g.members}명 함께 기록`;
}

// 지금 쪽이 열리거나 잠기면 입력칸까지 다시 그린다(쓰던 답은 ws.answers에 있음)
function setOpened(list) {
  const next = new Set(list ?? []);
  const changed = next.size !== ws.opened.size || [...next].some((p) => !ws.opened.has(p));
  const here = ws.opened.has(ws.idx) !== next.has(ws.idx);
  ws.opened = next;
  if (!changed || !ws.sheet) return;
  if (here) renderSheet();
  else renderWsFoot();
}

// 쪽별 첫 답: 선생님이 [인정]한 내 답. 처음 보는 것만 알리고(wsf-<보드>-<번호>), 레벨이 올랐으면 레벨업
function noteFirsts(meta, boardId) {
  const list = login && meta ? meta.firsts ?? [] : [];
  const before = ws.firsts.size;
  ws.firsts = new Set(list.map((f) => f.page));
  if (ws.sheet && ws.firsts.size !== before) renderWsPage();
  if (!list.length) return;
  const k = `wsf-${boardId}-${login.number}`;
  const seen = new Set(store.get(k) ?? []);
  const fresh = list.filter((f) => !seen.has(f.id));
  if (!fresh.length) return;
  store.set(k, list.map((f) => f.id));
  fresh.forEach((f) => toast(`첫 답 인정!${f.slide ? ` ${f.slide}쪽` : ''}${f.xp || f.coins ? ` +${f.xp} XP · +${f.coins}금화` : ''}`, 'ok'));
  const lv = meta.level;
  let had = 0;
  try { had = Number(localStorage.getItem(`lv-${login.class_id}-${login.number}`)) || 0; } catch {}
  if (lv && had && lv.level > had) showLevelUp(lv.level, lv.total_xp, page?.my_members?.find((m) => m.me)?.avatar);
}

function ensureSheet() {
  if (!ws.meta || ws.ver || ws.fetching) return;
  fetchSheet();
}

async function fetchSheet() {
  ws.fetching = true;
  try {
    const res = await getWorksheet(classId, login?.token ?? null);
    if (!res?.ok) return;
    if (login && res.session === 'none') { clearLogin(); login = null; mineKey = undefined; }
    const fresh = ws.boardId !== res.board_id || !ws.sheet;
    ws.boardId = res.board_id;
    ws.sheet = res;
    ws.ver = `${res.board_id}|${res.version}|${res.upto ?? ''}`;
    ws.done = !!res.mine?.done_at;
    ws.gain = ws.done ? { xp: res.mine.xp ?? 0, coins: res.mine.coins ?? 0 } : null;
    ws.passed = new Set(res.mine?.passed ?? []);
    ws.opened = new Set(res.opened ?? []);
    const local = draftKey() ? store.get(draftKey()) : null;
    const server = res.mine?.answers ?? {};
    // 기기에 저장 못 한 답이 있으면 그쪽이 먼저 (제출한 칸은 서버 답 그대로)
    ws.answers = local?.dirty && !ws.done ? { ...server, ...local.answers } : { ...(local?.answers ?? {}), ...server };
    ws.passed.forEach((k) => { if (k in server) ws.answers[k] = server[k]; else delete ws.answers[k]; });
    ws.dirty = !!local?.dirty && !ws.done && !!login;
    notePreAnswered();
    if (fresh) {
      const saved = Number(store.get(pageKey()));
      ws.idx = Number.isInteger(saved) && saved >= 0 && saved < pages().length ? saved : 0;
      ws.bad = {};
      ws.badPts = {};
      ws.blank = null;
    }
    applyFollow();
    renderSheet();
    if (ws.dirty) saveSheet();
  } catch (err) {
    console.error(err);
    if (!ws.sheet) $('ws-page').innerHTML = '<div class="empty"><strong>학습지를 불러오지 못했어요</strong></div>';
  } finally {
    ws.fetching = false;
  }
}

function renderSheet() {
  if (!ws.sheet) return;
  ws.lockedShown = locked();
  $('ws-login').classList.toggle('hidden', !!login);
  renderWsPage();
  renderWsFoot();
}

const wideSheet = matchMedia('(min-width: 1100px)');
wideSheet.addEventListener('change', () => { if (ws.sheet) renderWsPage(); });

function renderBlank() {
  const n = ws.blank;
  const title = ws.sheet?.slides?.[n - 1] ?? '';
  $('ws-slide').textContent = `수업자료 ${n}쪽`;
  $('ws-h').textContent = title;
  $('ws-chip').classList.add('hidden');
  $('ws-page').innerHTML = `<div class="empty ws-blank"><strong>이 쪽은 학습지에 쓸 칸이 없어요</strong><span>앞 화면을 보세요. 수업이 넘어가면 학습지도 같이 넘어가요</span></div>`;
  showSide($('ws-side'), []);
  $('ws-side').classList.add('hidden');
  $('sheet').classList.remove('has-side', 'sim-only');
  document.querySelector('.class-wrap').classList.remove('is-wide');
  $('ws-prev').disabled = true;
  $('ws-next').disabled = true;
  renderDots();
}

function renderWsPage() {
  if (ws.blank != null) { renderBlank(); return; }
  const list = pages();
  const page = list[ws.idx];
  $('ws-slide').textContent = page ? `수업자료 ${page.slide}쪽` : '';
  $('ws-h').textContent = isClosed(page) ? '' : page?.title || ws.sheet.title || '';
  const chip = [ws.done ? '완료' : login && hasFields(page) && pageDone(page) ? '제출함' : '', ws.firsts.has(ws.idx) ? '첫 답 ★' : '']
    .filter(Boolean).join(' · ');
  $('ws-chip').textContent = chip;
  $('ws-chip').classList.toggle('hidden', !chip);
  // 넓은 화면이면 그 쪽의 시뮬레이션을 오른쪽 칸에 바로 띄운다(좁으면 쪽 안 카드 + [시뮬레이션 열기])
  const side = wideSheet.matches && !isClosed(page) ? $('ws-side') : null;
  if (isClosed(page)) $('ws-page').innerHTML = `<div class="empty ws-closed">${LOCK_SVG}<strong>아직 수업에서 안 나간 쪽이에요</strong></div>`;
  else renderPage($('ws-page'), page, ws.answers, { locked: locked() || gated(), side });
  if (!side) showSide($('ws-side'), []);
  if (!isClosed(page)) { if (gated(page)) openParts(page); renderGate(page, !!side); }
  const hasSide = !!$('ws-side').dataset.id;
  $('ws-side').classList.toggle('hidden', !hasSide);
  $('sheet').classList.toggle('has-side', hasSide);
  // 쓸 칸이 없는 쪽(칸이 모두 시뮬레이션이 채우는 .sim-in이어도): 시뮬레이션을 가운데 크게, 쪽 번호는 그 아래로
  $('sheet').classList.toggle('sim-only', hasSide && (page?.fields ?? []).every((f) => f.sim));
  document.querySelector('.class-wrap').classList.toggle('is-wide', hasSide && tab === 'sheet');
  markFields($('ws-page'), ws.bad, wsMarks());
  $('ws-prev').disabled = following() || ws.idx <= 0;
  $('ws-next').disabled = following() || ws.idx >= list.length - 1;
  renderDots();
  if (!isClosed(page)) applySimFill(page);
}

// 쪽 점: 지금 쪽, 제출한 쪽(초록 + 체크), 다 썼지만 아직 제출 안 한 쪽, 고칠 칸이 있는 쪽
const DOT_CHECK = '<svg class="ws-dot-ck" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const LOCK_SVG = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
function renderDots() {
  $('ws-dots').innerHTML = pages().map((p, i) => {
    const keys = p.fields.map((f) => f.key);
    const done = !!login && hasFields(p) && pageDone(p);
    const full = !done && keys.length > 0 && keys.every((k) => (ws.answers[k] ?? '') !== '');
    const bad = !done && keys.some((k) => ws.bad[k] && ws.bad[k] !== 'checking');
    const checking = !done && !bad && keys.some((k) => ws.bad[k] === 'checking');
    const closed = isClosed(p);
    const st = closed ? ' · 아직 수업 전' : done ? ' · 제출함' : bad ? ' · 고칠 칸 있음' : checking ? ' · 확인 중' : full ? ' · 다 씀, 제출 전' : '';
    const cur = i === ws.idx && ws.blank == null;
    return `<button type="button" class="ws-dot${cur ? ' on' : ''}${closed ? ' is-closed' : ''}${done ? ' is-done' : ''}${full ? ' is-full' : ''}${bad ? ' is-bad' : ''}${checking ? ' is-checking' : ''}"
      data-i="${i}" aria-label="${p.slide}쪽${st}" ${cur ? 'aria-current="step"' : ''}${following() ? ' tabindex="-1"' : ''}>${done ? DOT_CHECK : ''}<span class="num">${p.slide}</span></button>`;
  }).join('');
}

const CHECK_SVG = (w, d = '.35s') => `<svg class="draw" style="--d:${d}" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function renderWsFoot() {
  const foot = $('ws-foot');
  if (!login) { foot.innerHTML = ''; return; }
  if (ws.done) {
    const g = ws.gain ?? {};
    foot.innerHTML = `
      <div class="state-box is-passed passed-box ws-done">
        <span class="pass-check" aria-hidden="true">${CHECK_SVG(38)}</span>
        <span class="pass-title">학습지 완료!</span>
        ${g.xp || g.coins ? `<span class="pass-sub num">+${g.xp} XP · +${g.coins}금화</span>` : ''}
      </div>`;
    return;
  }
  const page = ws.blank != null ? null : pages()[ws.idx];
  const pr = progress();
  const prog = `<span class="ws-prog num" aria-label="제출한 쪽 ${pr.n}개, 모두 ${pr.total}쪽">제출 <b>${pr.n}</b> / ${pr.total}쪽</span>`;
  const status = `<span class="ws-save muted" id="ws-save" role="status">${esc(ws.status)}</span>`;
  if (!hasFields(page)) { foot.innerHTML = status + prog; return; }
  if (pageDone(page)) {
    const just = ws.justPassed === ws.idx;
    ws.justPassed = -1;
    const next = pages().findIndex((p) => hasFields(p) && !pageDone(p));
    foot.innerHTML = `${status}${prog}
      <span class="ws-pagedone${just ? ' pop' : ''}"><span class="ws-pagedone-ck" aria-hidden="true">${CHECK_SVG(18, just ? '.2s' : '0s')}</span>이 쪽 제출함</span>
      ${next >= 0 && !following() ? `<button type="button" class="btn btn-line press" id="ws-left" data-i="${next}">제출 안 한 쪽으로</button>` : ''}`;
    if (just) prepareDraw(foot);
    return;
  }
  if (!ws.opened.has(ws.idx)) {
    foot.innerHTML = `${status}${prog}<span class="ws-wait-open">${LOCK_SVG}선생님이 열면 쓸 수 있어요</span>`;
    return;
  }
  if (gated(page)) {
    foot.innerHTML = `${status}${prog}<span class="ws-wait-open">${PLAY_SVG}시뮬레이션을 끝까지 하면 쓸 수 있어요</span>`;
    return;
  }
  const nBad = page.fields.filter((f) => ws.bad[f.key] && ws.bad[f.key] !== 'checking').length;
  const nChk = page.fields.filter((f) => ws.bad[f.key] === 'checking').length;
  foot.innerHTML = `${status}${prog}
    ${nChk ? `<span class="ws-chkn" role="status"><i class="ws-chk-sand" aria-hidden="true"></i>확인 중 ${nChk}칸</span>` : ''}
    ${nBad ? `<span class="ws-badn">고칠 칸 ${nBad}개</span>` : ''}
    <button type="button" class="btn btn-primary btn-big press" id="ws-submit">${nBad ? '고쳐서 다시 제출' : '이 쪽 제출'}</button>`;
}

// 칸 위 안내 띠: 잠겼으면 무엇을 해야 하는지, 방금 풀렸으면 풀렸다고(그 쪽을 떠나면 사라짐)
const PLAY_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
function renderGate(page, wide) {
  const box = $('ws-page');
  const on = gated(page);
  box.classList.toggle('is-gated', on);
  $('ws-side').classList.toggle('is-need', on);
  box.querySelectorAll('.ws-sim').forEach((c) => c.classList.toggle('is-need', on));
  if (!on && ws.unlocked !== page.slide) return;
  const n = new Set(pageSims(page)).size;
  const left = simLeft(page).length;
  const prog = on ? [...ws.simProg.entries()].find(([k]) => k.startsWith(`${page.slide}|`) && simLeft(page).includes(k.slice(k.indexOf('|') + 1)))?.[1] : null;
  const el = document.createElement('div');
  el.className = `ws-gate${on ? '' : ' is-open'}`;
  el.setAttribute('role', 'status');
  el.innerHTML = on
    ? `<span class="ws-gate-ic">${PLAY_SVG}</span>
       <span class="ws-gate-txt">${isPartPage(page.slide)
         ? `<b>시뮬레이션에서 본 행성부터 쓸 수 있어요</b><small>${wide ? '오른쪽' : '아래'} 시뮬레이션에서 행성 카드를 보면 그 행성 칸이 열려요</small>`
         : `<b>시뮬레이션을 끝까지 해야 답을 쓸 수 있어요</b><small>${wide ? '오른쪽' : '아래'} 시뮬레이션을 끝까지 재생하면 칸이 열려요${n > 1 ? ` · 남은 시뮬레이션 ${left}개` : ''}</small>`}</span>
       ${prog ? `<span class="ws-gate-prog num">진행 ${prog.n} / ${prog.total}</span>` : ''}`
    : `<span class="ws-gate-ic">${CHECK_SVG(22, '0s')}</span><span class="ws-gate-txt"><b>시뮬레이션 완료 · ${isShut(page, ws.idx) ? '선생님이 열면 쓸 수 있어요' : '이제 답을 쓸 수 있어요'}</b></span>`;
  box.prepend(el);
}

// 잠긴 칸을 누르면: 알림 + 시뮬레이션 칸을 흔들어 보여 준다
function nudgeSim() {
  toast(isPartPage(pages()[ws.idx]?.slide) ? '시뮬레이션에서 그 행성 카드를 먼저 보세요' : '시뮬레이션을 끝까지 재생해야 답을 쓸 수 있어요', 'error');
  const target = $('ws-side').classList.contains('hidden') ? $('ws-page').querySelector('.ws-sim') : $('ws-side');
  if (!target) return;
  if (!target.classList.contains('is-open') && target.classList.contains('ws-sim')) target.querySelector('[data-sim-act="open"]')?.click();
  target.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  target.classList.remove('ws-pulse');
  void target.offsetWidth;
  target.classList.add('ws-pulse');
}

// 시뮬레이션에서 본 줄: 기기에 적어 두고, 지금 보는 쪽이면 그 줄 칸을 바로 연다(쓰던 칸은 그대로)
function markPart(pg, label) {
  const k = partKey(pg, label);
  const done = simDone();
  if (!simDoneKey() || !label || done.has(k)) return;
  done.add(k);
  store.set(simDoneKey(), [...done]);
  const page = pages()[ws.idx];
  if (!page || String(page.slide) !== String(pg) || !gated(page)) return;
  openParts(page);
  toast(`${label} 칸을 쓸 수 있어요`, 'ok');
}

function markSimDone(pg, src) {
  const k = simKey(pg, src);
  const done = simDone();
  if (!simDoneKey() || done.has(k)) return;
  const i = ws.idx;
  const page = pages()[i];
  const was = page && String(page.slide) === String(pg) && gated(page, i);
  done.add(k);
  store.set(simDoneKey(), [...done]);
  ws.simProg.delete(k);
  if (!was || gated(page, i)) { if (was) renderWsPage(); return; }
  ws.unlocked = page.slide;
  toast(isShut(page, i) ? '시뮬레이션 완료! 선생님이 열면 쓸 수 있어요' : '시뮬레이션 완료! 이제 답을 쓸 수 있어요', 'ok');
  renderWsPage();
  renderWsFoot();
}

// 시뮬레이션이 채우는 칸(.sim-in, fields의 sim:true): {type:'sim:answer', n, value} → 그 쪽 n번째(1부터) .sim-in 칸.
// S 전·시뮬레이션 잠금 중이면 ws.simFill에 두었다가 칸이 열려 다시 그릴 때 넣는다(제출한 칸은 그대로)
function simAnswer(pg, n, value) {
  const page = pages()[ws.idx];
  if (!page || String(page.slide) !== String(pg) || typeof value !== 'string') return;
  const f = (page.fields ?? []).filter((x) => x.sim)[Math.max(1, Math.floor(Number(n) || 1)) - 1];
  if (!f) return;
  const v = value.replace(/\s+/g, ' ').trim();
  if (f.type === 'choice' && !(f.options ?? []).includes(v)) return; // 고르기 칸은 보기 글 그대로일 때만
  ws.simFill.set(f.key, v.slice(0, f.type === 'text' ? 300 : 40));
  applySimFill(page);
}
// 시뮬레이션의 [제출](sim:answer … sim:done) → 그 쪽 칸이 모두 찼으면 [이 쪽 제출]까지 한 번에(2026-11-05).
// 다 나눌 때마다 보내는 것(712_sort 등 sim:done 없음)은 칸만 채운다
function simSubmit(pg) {
  const page = pages()[ws.idx];
  if (!page || String(page.slide) !== String(pg) || !(page.fields ?? []).some((f) => f.sim)) return;
  if (locked() || gated(page)) return;
  const empty = page.fields.filter((f) => (ws.answers[f.key] ?? '') === '').length;
  if (empty) { toast(`남은 칸 ${empty}개를 쓰고 [이 쪽 제출]을 눌러 주세요`); return; }
  submitPage($('ws-submit'));
}
function applySimFill(page) {
  if (!page || locked() || gated(page)) return;
  (page.fields ?? []).forEach((f) => {
    if (!f.sim || !ws.simFill.has(f.key) || ws.passed.has(f.key)) return;
    const v = ws.simFill.get(f.key);
    ws.simFill.delete(f.key);
    if ((ws.answers[f.key] ?? '') === v) return;
    const el = $('ws-page').querySelector(`.ws-in[data-k="${f.key}"]`);
    if (el) el.value = v;
    $('ws-page').querySelectorAll(`.ws-opt[data-k="${f.key}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    setAnswer(f.key, v);
  });
}

function setStatus(text) {
  ws.status = text;
  const el = $('ws-save');
  if (el) el.textContent = text;
}

function goPage(i) {
  if (following()) return; // 수업 중에는 수업자료를 따라감
  if (i < 0 || i >= pages().length || i === ws.idx) return;
  ws.idx = i;
  ws.unlocked = null;
  store.set(pageKey(), i);
  renderWsPage();
  renderWsFoot();
  if ($('sheet').getBoundingClientRect().top < 0) $('sheet').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
}
$('ws-prev').addEventListener('click', () => goPage(ws.idx - 1));
$('ws-next').addEventListener('click', () => goPage(ws.idx + 1));
$('ws-dots').addEventListener('click', (e) => {
  const d = e.target.closest('.ws-dot');
  if (d) goPage(Number(d.dataset.i));
});

function setAnswer(k, v) {
  if (v === '') delete ws.answers[k];
  else ws.answers[k] = v;
  if (ws.bad[k]) {
    delete ws.bad[k];
    delete ws.badPts[k];
    markFields($('ws-page'), ws.bad, wsMarks());
    renderWsFoot();
    syncRecheck();
  }
  ws.dirty = true;
  persist();
  renderDots();
  clearTimeout(ws.saveTimer);
  ws.saveTimer = setTimeout(saveSheet, SAVE_DELAY_MS);
}

$('ws-page').addEventListener('input', (e) => {
  const el = e.target.closest('.ws-in');
  if (!el || locked() || (gated() && !partOpen(el))) return;
  setAnswer(el.dataset.k, el.value.trim() ? el.value : '');
});

$('ws-page').addEventListener('click', (e) => {
  if (gated() && !partOpen(e.target)) {
    if (!e.target.closest('.ws-sim, .ws-gate') && e.target.closest('.w-q, table, .w-fill, .ws-in, .ws-ox')) nudgeSim();
    return;
  }
  const b = e.target.closest('.ws-opt');
  if (!b || b.disabled || locked()) return;
  const k = b.dataset.k;
  const opts = [...b.parentElement.querySelectorAll('.ws-opt')];
  if (b.parentElement.classList.contains('ws-multi')) {
    // 여러 개 고르기: 누를 때마다 넣고 빼기, 답은 보기 순서대로 '|'로 잇는다
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    setAnswer(k, opts.filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.v).join('|'));
    return;
  }
  const v = ws.answers[k] === b.dataset.v ? '' : b.dataset.v;
  opts.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
  setAnswer(k, v);
});

$('ws-foot').addEventListener('click', (e) => {
  const b = e.target.closest('#ws-submit');
  if (b) submitPage(b);
  const left = e.target.closest('#ws-left');
  if (left) goPage(Number(left.dataset.i));
});

function sheetError(code) {
  if (code === 'NO_SESSION') {
    clearLogin();
    login = null;
    mineKey = undefined;
    ws.ver = null; // 내 답 없이 다시 받기
    ensureSheet();
  } else if (code === 'BOARD_CHANGED' || code === 'NO_SHEET' || code === 'NO_PAGE' || code === 'LOCKED') {
    ws.ver = null;
    load();
  }
}

// 서버 저장: 한 번에 하나만. 보내는 동안 또 고쳤으면 끝난 뒤 다시
async function saveSheet() {
  clearTimeout(ws.saveTimer);
  if (!ws.dirty || ws.saving || ws.submitting || ws.done || !login || !ws.sheet) return;
  ws.saving = true;
  const sent = JSON.stringify(ws.answers);
  setStatus('저장 중');
  let ok = false;
  try {
    const res = await withTimeout(saveWorksheetAnswers(login.token, ws.boardId, ws.answers), SUBMIT_WAIT_MS);
    if (res?.ok) {
      ok = true;
      if (JSON.stringify(ws.answers) === sent) { ws.dirty = false; persist(); }
      setStatus('저장됨');
      if (res.done) { ws.ver = null; ensureSheet(); }
    } else {
      setStatus('');
      sheetError(res?.error);
    }
  } catch (err) {
    console.error(err);
    setStatus('연결되면 저장돼요');
  } finally {
    ws.saving = false;
    if (ok && ws.dirty) ws.saveTimer = setTimeout(saveSheet, SAVE_DELAY_MS);
  }
}

// 쪽별 제출. 버튼 하나에 요청 하나: 누르면 '채점 중'으로 잠그고, 10초 안에 답이 없거나 실패하면 [다시 제출]
// 답은 모두 보내 저장하고, 서버는 그 쪽 칸만 채점한다
//   auto = AI 판정을 기다리던 쪽을 저절로 다시 제출(버튼 없음, 지금 보는 쪽이 아니어도 됨. 아직 확인 중이면 조용히)
async function submitPage(btn, idx = ws.idx, auto = false) {
  if (ws.submitting || ws.done || !login || !ws.sheet) return;
  const pg = pages()[idx];
  if (!hasFields(pg) || pageDone(pg)) return;
  ws.submitting = true;
  clearTimeout(ws.saveTimer);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '채점 중';
  }
  const sent = JSON.stringify(ws.answers);
  let res;
  try {
    res = await withTimeout(submitWorksheetPage(login.token, ws.boardId, idx, ws.answers), SUBMIT_WAIT_MS);
  } catch (err) {
    console.error(err);
    ws.submitting = false;
    if (auto) return; // 다음 차례에 다시
    toast(WS_ERR[err.message] || '보내지 못했어요. 다시 제출해 주세요', 'error');
    if (btn?.isConnected) { btn.disabled = false; btn.textContent = '다시 제출'; }
    return;
  }
  ws.submitting = false;

  if (res?.ok) {
    // 답은 서버에 저장됐다
    if (JSON.stringify(ws.answers) === sent) ws.dirty = false;
    ws.passed = new Set(res.passed ?? []);
    pg.fields.forEach((f) => { delete ws.bad[f.key]; delete ws.badPts[f.key]; });
    ws.status = '';
    if (res.done) {
      ws.done = true;
      ws.dirty = false;
      ws.bad = {};
      ws.badPts = {};
      ws.gain = { xp: res.xp ?? 0, coins: res.coins ?? 0 };
      persist();
      renderSheet();
      if (!res.already) showSheetDone(res);
      return;
    }
    persist();
    ws.justPassed = idx;
    if (auto && idx !== ws.idx) toast(`${pg.slide}쪽 제출함`, 'ok');
    renderSheet();
    if (ws.dirty) saveSheet();
    syncRecheck();
    return;
  }
  if (res?.error === 'NOT_YET') {
    if (JSON.stringify(ws.answers) === sent) ws.dirty = false;
    persist();
    pg.fields.forEach((f) => { delete ws.bad[f.key]; delete ws.badPts[f.key]; });
    (res.empty ?? []).forEach((k) => { ws.bad[k] = 'empty'; });
    (res.wrong ?? []).forEach((k) => { ws.bad[k] = 'wrong'; });
    (res.checking ?? []).forEach((k) => { ws.bad[k] = 'checking'; });
    Object.entries(res.points ?? {}).forEach(([k, v]) => { if (ws.bad[k] === 'wrong') ws.badPts[k] = v; });
    const empty = (res.empty ?? []).length;
    const n = empty + (res.wrong ?? []).length;
    const where = auto && idx !== ws.idx ? `${pg.slide}쪽에 ` : '';
    if (n) toast(empty === n ? `${where}빈 칸이 ${n}개 있어요` : `${where}틀리거나 빈 칸이 ${n}개 있어요`, 'error');
    else if (!auto) toast('답을 확인하고 있어요. 잠깐만 기다려 주세요');
    ws.status = '';
    renderSheet();
    if (ws.dirty) saveSheet();
    syncRecheck();
    return;
  }
  if (auto) return;
  toast(WS_ERR[res?.error] || '제출하지 못했어요', 'error');
  sheetError(res?.error);
  if (btn?.isConnected) { btn.disabled = false; btn.textContent = '이 쪽 제출'; }
}

// AI 판정을 기다리는 칸이 있는 쪽: 신호('ws-ai')를 받으면 그 쪽을 다시 제출한다(판정은 서버 기억표에 있음).
// 신호를 놓쳤을 때만 22~27초 뒤 한 번 더 (2026-10-27 렉: 5초마다 다시 내던 것이 몰린 제출에 겹침)
const checkingPage = () => pages().findIndex((p) => hasFields(p) && !pageDone(p) && p.fields.some((f) => ws.bad[f.key] === 'checking'));
function recheck() {
  const i = checkingPage();
  if (i >= 0 && !document.hidden) submitPage(null, i, true);
}
function syncRecheck() {
  const on = checkingPage() >= 0;
  if (on && !ws.recheckTimer) {
    ws.recheckTimer = setTimeout(() => { ws.recheckTimer = null; recheck(); syncRecheck(); }, RECHECK_MS + Math.random() * 5000);
  }
  if (!on && ws.recheckTimer) { clearTimeout(ws.recheckTimer); ws.recheckTimer = null; }
}

/* ---------- 학습지 완료 화면 (마지막 쪽까지 제출했을 때 한 번)
   쪽 카드가 차례로 뒤집히며 초록 → '완료' 도장이 찍힘 → XP·금화 숫자가 올라감 → 색종이.
   [확인]을 누르면 레벨이 올랐을 때 레벨업 화면으로 이어진다 ---------- */
const DONE_BITS = ['#2457E6', '#F59E0B', '#22C582', '#B79CFF', '#FF7A45', '#6EA8FF'];
let doneLevel = null;

function showSheetDone(res) {
  const list = pages().filter(hasFields);
  const step = Math.min(70, Math.round(900 / Math.max(1, list.length))); // 쪽이 많아도 1초 안에
  const stampAt = 250 + list.length * step + 250;
  const box = $('wsdone');
  box.style.setProperty('--stamp', `${stampAt}ms`);
  $('wsdone-t').textContent = ws.sheet?.title || `학습지 ${ws.sheet?.lesson_code ?? ''}`;
  $('wsdone-tiles').innerHTML = list.map((p, i) => `
    <span class="wsd-tile" style="--d:${250 + i * step}ms"><span class="num">${p.slide}</span>${DOT_CHECK}</span>`).join('');
  $('wsdone-fx').innerHTML = reduceMotion ? '' : Array.from({ length: 22 }, (_, i) =>
    `<span class="wsd-bit" style="left:${(i * 37) % 100}%;background:${DONE_BITS[i % DONE_BITS.length]};--d:${stampAt + (i % 7) * 90}ms;--x:${((i * 53) % 41) - 20}px;--r:${(i * 97) % 360}deg"></span>`).join('');
  const xp = $('wsdone-xp');
  const co = $('wsdone-co');
  xp.dataset.value = 0; xp.textContent = '0';
  co.dataset.value = 0; co.textContent = '0';
  $('wsdone-gain').classList.toggle('hidden', !(res.xp || res.coins));
  doneLevel = res.level_after > res.level_before ? res : null;
  box.classList.remove('hidden');
  $('wsdone-ok').focus();
  setTimeout(() => { countUp(xp, res.xp ?? 0, 900); countUp(co, res.coins ?? 0, 900); }, reduceMotion ? 0 : stampAt + 350);
}

$('wsdone-ok').addEventListener('click', () => {
  $('wsdone').classList.add('hidden');
  $('wsdone-fx').innerHTML = '';
  const lv = doneLevel;
  doneLevel = null;
  if (lv) showLevelUp(lv.level_after, lv.total_xp, page?.my_members?.find((m) => m.me)?.avatar);
});

/* ---------- 레벨업 (학습지 XP로 레벨이 오르면) ---------- */
function showLevelUp(lv, total, avatar) {
  if (login) {
    const k = `lv-${login.class_id}-${login.number}`;
    try { localStorage.setItem(k, String(Math.max(Number(localStorage.getItem(k)) || 0, lv))); } catch {}
  }
  $('lvup-n').textContent = lv;
  $('lvup-s').textContent = `누적 ${total} XP 달성`;
  $('lvup-av').innerHTML = avatarSVG(avatar, 160, { label: '내 캐릭터' });
  const av = $('lvup-av').querySelector('svg.av');
  $('lvup').classList.add('lvup-plain');
  $('lvup').classList.remove('hidden');
  $('lvup-ok').focus();
  if (av) setTimeout(() => react(av, 'levelup'), 300);
}
$('lvup-ok').addEventListener('click', () => {
  $('lvup').classList.add('hidden');
  $('lvup').classList.remove('lvup-plain');
});

/* ---------- 모둠 현황 ---------- */

let groupStates = new Map();

function renderGroups(data) {
  const groups = data?.board ? (data.groups ?? []) : [];
  $('groups').classList.toggle('hidden', !groups.length);
  if (!groups.length) return;
  const myGroup = login ? data.my_group : null;
  const key = JSON.stringify(groups.map((g) => [g.no, g.state, g.rank, g.no === myGroup]));
  if (key === shown.groups) return;
  shown.groups = key;
  $('group-grid').innerHTML = groups.map((g) => {
    const label = g.state === 'passed' && g.rank ? `통과 · ${g.rank}위` : LABEL[g.state];
    const changed = groupStates.has(g.no) && groupStates.get(g.no) !== g.state;
    return `
      <div class="gs is-${g.state}${g.no === myGroup ? ' is-mine' : ''}${changed ? ' morph' : ''}">
        <span class="dot" aria-hidden="true"></span>
        <b>${groupName(g.no)}</b>
        <span class="lbl">${label}</span>
      </div>`;
  }).join('');
  groupStates = new Map(groups.map((g) => [g.no, g.state]));
}

// 퀴즈 배틀 카드: 선생님이 열었거나 우리 모둠 판이 있을 때. 로그인·그날 모둠이 있어야 들어감
let quizKey;
function renderQuiz(data) {
  const q = data?.board ? data.quiz : null;
  const show = !!q && (q.open || !!q.state);
  const key = JSON.stringify([show, q?.open, q?.state, !!login, data?.my_group]);
  if (key === quizKey) return;
  quizKey = key;
  $('quiz-card').classList.toggle('hidden', !show);
  if (!show) return;
  const go = $('quiz-go');
  let sub;
  if (!login) { sub = '로그인하면 할 수 있어요'; go.textContent = '로그인'; go.href = HOME; }
  else if (data.my_group == null) { sub = '오늘 모둠 명단에 없어요'; go.textContent = '들어가기'; go.href = 'quiz.html'; }
  else {
    sub = q.state === 'done' ? '우리 모둠 결과 보기' : q.state === 'playing' ? '우리 모둠이 푸는 중' : `${groupName(data.my_group)}끼리 오늘 학습지 문제`;
    go.textContent = q.state === 'done' ? '결과 보기' : '들어가기';
    go.href = 'quiz.html';
  }
  $('quiz-s').textContent = sub;
  go.classList.toggle('hidden', !!login && data.my_group == null);
}

// 퀴즈 쇼 탭: 선생님이 이 반에 열었을 때(대기실·진행 중, 끝난 뒤 10분은 결과 보기)만 보인다. 새 판이 열리면 한 번 저절로 그 탭으로
let qsShown = null;
function renderQuizShow(data) {
  const g = data?.quizshow ?? null;
  const had = hasQs;
  hasQs = !!g;
  if (g && g.id !== qsShown && g.status !== 'done') {
    qsShown = g.id;
    tab = 'qs';
  }
  // 퀴즈가 사라지면 그 전에 보던 탭으로
  if (!g && tab === 'qs') tab = ['group', 'mats'].includes(store.get('classTab')) ? store.get('classTab') : 'sheet';
  if (had !== hasQs || tab === 'qs') applyTab();
}

function renderLesson(board) {
  const text = board ? [board.lesson_code && `${board.lesson_code}차시`, board.title].filter(Boolean).join(' · ') : '';
  if (text === shown.lesson) return;
  shown.lesson = text;
  $('lesson').textContent = text;
  $('lesson').classList.toggle('hidden', !text);
}

/* ---------- 모둠 게시판 (패들렛 대체) ----------
   그날 모둠별 칸. 우리 모둠 칸에만 쓰고, 발표 전에는 다른 모둠 칸이 가려진다(서버가 막음).
   get_class_page의 posts_v(보이는 글 수·고친 시각)나 우리 모둠 상태가 바뀔 때만 get_posts를 부른다 */
const BOARD_WHY = { NO_SESSION: '로그인하면 쓸 수 있어요', NO_GROUP: '오늘 모둠 명단에 없어요', LOCKED: '제출한 뒤에는 고칠 수 없어요' };
const POST_ERR = {
  ...SUBMIT_ERR,
  LOCKED: '제출한 뒤에는 고칠 수 없어요',
  EMPTY: '내용을 써 주세요',
  BAD_LINK: '링크는 https://로 시작하는 주소만 돼요',
  BAD_PHOTO: '사진을 다시 골라 주세요',
  BAD_IMAGE: '이 사진은 열 수 없어요',
  FULL: '더 올릴 수 없어요',
  NOT_FOUND: '이미 지워진 글이에요',
};
const POST_UPLOAD_WAIT_MS = 30000;
let postsKey;
let posts = null; // get_posts 결과

function syncBoard(data) {
  const g = (data.groups ?? []).find((x) => x.no === data.my_group);
  const key = [data.board.id, data.board.status, data.posts_v, data.my_group, g?.state, !!login].join('|');
  if (key === postsKey) return;
  postsKey = key;
  getPosts(classId, login?.token ?? null)
    .then((res) => { posts = res; renderBoard(); })
    .catch((err) => { console.error(err); postsKey = undefined; });
}

function renderBoard() {
  if (!posts?.board_id) return;
  const groups = posts.groups ?? [];
  const my = posts.my_group;
  $('board-note').textContent = posts.can_write || posts.status === 'revealed' ? '' : (BOARD_WHY[posts.why] ?? '');
  let html;
  if (!groups.length) {
    html = `<div class="empty board-empty">${ICON_BOARD}<strong>아직 모둠이 정해지지 않았어요</strong></div>`;
  } else {
    // 우리 모둠 칸을 맨 앞에
    const ordered = [...groups].sort((a, b) => (b.no === my) - (a.no === my) || a.no - b.no);
    html = boardHTML(ordered, { myGroup: my, canWrite: posts.can_write });
  }
  if (html === shown.board) return;
  shown.board = html;
  $('post-board').innerHTML = html;
}

const myPost = (id) => posts?.groups?.find((g) => g.no === posts.my_group)?.posts?.find((p) => p.id === id) ?? null;

$('post-board').addEventListener('click', (e) => {
  if (e.target.closest('[data-post-new]')) return openCompose(null);
  const edit = e.target.closest('[data-post-edit]');
  if (edit) return openCompose(myPost(edit.dataset.postEdit));
  const del = e.target.closest('[data-post-del]');
  if (del) onDeletePost(del.dataset.postDel, del);
});

function postFail(err, fallback) {
  console.error(err);
  toast(POST_ERR[err.message] || fallback, 'error');
  if (err.message === 'NO_SESSION') {
    clearLogin();
    login = null;
    mineKey = undefined;
  }
}

async function afterPostChange() {
  sendClassRefresh(classId); // 모둠원 화면도 바로
  postsKey = undefined;
  await load();
}

async function onDeletePost(id, btn) {
  if (!login || !confirm('이 글을 지울까요?')) return;
  btn.disabled = true;
  try {
    const res = await withTimeout(deletePost(login.token, id), SUBMIT_WAIT_MS);
    if (!res?.ok) throw new Error(res?.error || 'FAIL');
  } catch (err) {
    postFail(err, '지우지 못했어요');
  }
  await afterPostChange();
}

// 글쓰기 창: 제목·내용·사진·링크. 사진은 고를 때 줄여 두고, [게시]를 누르면 올린 뒤 글을 저장
const form = $('compose-form');
// 'phet.colorado.edu'처럼 주소만 쓰면 https://를 붙인다
const withScheme = (v) => {
  const t = v.trim();
  return t && !/^[a-z][a-z0-9+.-]*:/i.test(t) && /^[^\s/]+\.[^\s/]+/.test(t) ? 'https://' + t : t;
};
let editing = null;   // 고치는 글 (새 글이면 null)
let photoBlob = null; // 새로 고른 사진(줄인 것)
let photoPath = null; // 이미 올린 사진 경로 (고치는 글의 원래 사진, 또는 실패 뒤 다시 보낼 때)
let previewUrl = null;
let posting = false;

function setPreview(src) {
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  $('compose-photo').classList.toggle('hidden', !src);
  $('compose-img').src = src || '';
}

function openCompose(post) {
  if (!posts?.can_write || !login) return;
  editing = post;
  photoBlob = null;
  photoPath = post?.photo ?? null;
  form.reset();
  form.elements.title.value = post?.title ?? '';
  form.elements.body.value = post?.body ?? '';
  form.elements.link.value = post?.link ?? '';
  setPreview(photoPath ? postPhotoUrl(photoPath) : null);
  $('compose-h').textContent = post ? '글 고치기' : `${groupName(posts.my_group)} 칸에 글쓰기`;
  $('compose-go').textContent = post ? '저장' : '게시';
  $('compose').showModal();
}

$('compose-cancel').addEventListener('click', () => $('compose').close());
$('compose').addEventListener('close', () => setPreview(null));

$('compose-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    photoBlob = await shrinkPhoto(file);
    photoPath = null;
    setPreview(null);
    previewUrl = URL.createObjectURL(photoBlob);
    $('compose-photo').classList.remove('hidden');
    $('compose-img').src = previewUrl;
  } catch (err) {
    postFail(new Error('BAD_IMAGE'), '');
  }
});

$('compose-unphoto').addEventListener('click', () => {
  photoBlob = null;
  photoPath = null;
  setPreview(null);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (posting || !posts?.board_id || !login) return;
  const btn = $('compose-go');
  const label = editing ? '저장' : '게시';
  posting = true;
  btn.disabled = true;
  btn.textContent = '보내는 중';
  try {
    if (photoBlob) {
      const up = await withTimeout(uploadPostPhoto(login.token, posts.board_id, photoBlob), POST_UPLOAD_WAIT_MS);
      if (!up?.ok) throw new Error(up?.error || 'FAIL');
      photoPath = up.path; // 다시 보낼 때 또 올리지 않게
      photoBlob = null;
    }
    const res = await withTimeout(savePost(login.token, posts.board_id, editing?.id ?? null, {
      title: form.elements.title.value,
      body: form.elements.body.value,
      link: withScheme(form.elements.link.value),
      photo: photoPath,
    }), SUBMIT_WAIT_MS);
    if (!res?.ok) throw new Error(res?.error || 'FAIL');
    btn.textContent = label;
    $('compose').close();
    await afterPostChange();
  } catch (err) {
    postFail(err, '보내지 못했어요. 다시 보내 주세요');
    btn.textContent = '다시 보내기';
    // 더 쓸 수 없게 된 경우(제출함, 마감, 오늘 수업 바뀜, 로그아웃)는 창을 닫는다
    if (['LOCKED', 'CLOSED', 'BOARD_CHANGED', 'NO_GROUP', 'NO_SESSION', 'NOT_FOUND'].includes(err.message)) {
      btn.textContent = label;
      $('compose').close();
      await afterPostChange();
    }
  } finally {
    posting = false;
    btn.disabled = false;
  }
});

/* ---------- 연결 끊김: 마지막 화면을 그대로 두고 위쪽에 작은 표시만 ---------- */
let netDown = false;
function setNetDown(on) {
  if (on === netDown) return;
  netDown = on;
  $('net').classList.toggle('hidden', !on);
  if (!on) schedule(); // 다시 이어지면 원래 간격으로
}

let loading = false;
let again = false;
async function load() {
  if (loading) { again = true; return; }
  loading = true;
  try {
    const data = await getClassPage(classId, login?.token ?? null);
    page = data;
    const board = data?.board ?? null;
    renderLesson(board);
    renderSims(board?.sim_links);
    renderMine(data);
    renderGroups(data);
    renderQuiz(data);
    renderQuizShow(data);
    syncSheet(data);
    updateSide();
    if (!board) showEmpty('오늘 수업이 아직 없어요');
    else syncBoard(data);
    setNetDown(false);
    if (ws.dirty) saveSheet(); // 끊겨서 못 보낸 학습지 답
  } catch (err) {
    console.error(err);
    if (err.message === 'NOT_CONFIGURED') showEmpty('config.js에 Supabase 주소와 키를 넣어야 해요');
    else {
      if (shown.board === undefined) showEmpty('불러오지 못했어요', true);
      // 이미 보이는 화면은 그대로 둔다
      setNetDown(true);
    }
  } finally {
    loading = false;
    if (again) { again = false; load(); }
  }
}

// 선생님이 검사·발표하면 "새로고침" 신호가 온다. 신호를 놓쳐도 15초(+0~3초)마다 다시 읽는다 (화면이 숨겨져 있으면 멈춤)
let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!document.hidden) await load();
    schedule();
  }, (netDown ? RETRY_MS : REFRESH_MS) + Math.random() * JITTER_MS);
}

load();
schedule();

// [제출 시작]·잠그기는 먼저 낸 순서를 겨루므로 흩지 않고 바로 읽는다
if (sb) onWsOpen(classId, () => { if (!document.hidden) load(); });
// AI 판정이 저장됨: 기다리던 쪽이 있는 기기만 다시 제출(0~1.5초 흩음)
if (sb) onWsAi(classId, () => { if (checkingPage() >= 0) setTimeout(recheck, Math.random() * 3000); });
// 퀴즈 쇼를 열거나 넘기면 카드가 바로 뜨게(흩어서)
if (sb) onQuizShow(classId, () => { if (!document.hidden) setTimeout(load, Math.random() * 1500); });
if (sb) onClassRefresh(classId, () => {
  // 신호는 모든 학생 기기에 한꺼번에 가므로 0~2초 흩어서 읽는다
  if (!document.hidden) setTimeout(load, Math.random() * 2000);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { closeSims(); closeVideos(); } // 학습지 시뮬레이션·영상은 화면이 숨겨지면 없앤다(학생 기기 부담)
  else { load(); if (!$('sheet').classList.contains('hidden')) wakeSims($('sheet')); }
});
addEventListener('online', () => { load(); saveSheet(); });
addEventListener('offline', () => setNetDown(true));

/* ---------- 시뮬레이션 끝 신호 (sim:gate / sim:progress / sim:done) ---------- */
const simFrameOf = (src) => [...document.querySelectorAll('iframe.ws-sim-frame')].find((f) => f.contentWindow === src);
addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || !msg.type.startsWith('sim:')) return;
  const f = e.source && simFrameOf(e.source);
  if (!f) return;
  const { sim, pg } = f.dataset;
  if (msg.type === 'sim:gate') {
    f.dataset.gate = '1';
    if (msg.parts && simDoneKey() && !isPartPage(pg)) {
      store.set(simDoneKey(), [...simDone(), `${pg}|parts`]);
      if (String(pages()[ws.idx]?.slide) === pg && gated()) renderWsPage();
    }
  } else if (msg.type === 'sim:part' && typeof msg.label === 'string') markPart(pg, msg.label.trim().slice(0, 40));
  else if (msg.type === 'sim:done') { markSimDone(pg, sim); simSubmit(pg); }
  else if (msg.type === 'sim:answer') simAnswer(pg, msg.n, msg.value);
  else if (msg.type === 'sim:progress') {
    const n = Math.max(0, Math.floor(Number(msg.n) || 0));
    const total = Math.max(1, Math.floor(Number(msg.total) || 1));
    f.dataset.gate = '1';
    ws.simProg.set(simKey(pg, sim), { n: Math.min(n, total), total });
    const tag = $('ws-page').querySelector('.ws-gate-prog');
    if (tag && String(pages()[ws.idx]?.slide) === pg) tag.textContent = `진행 ${Math.min(n, total)} / ${total}`;
    else if (String(pages()[ws.idx]?.slide) === pg && gated()) renderWsPage();
  }
});
// sim:gate를 보내지 않는 옛 시뮬레이션: 다 불러오고 3초 뒤에도 소식이 없으면 끝낸 것으로
document.addEventListener('ws-sim-load', (e) => {
  const f = e.target;
  setTimeout(() => { if (f.isConnected && !f.dataset.gate) markSimDone(f.dataset.pg, f.dataset.sim); }, SIM_OLD_MS);
});

/* nogame:start */
/* ---------- 712 달 자원 RPG 시뮬레이션 iframe 브리지 ----------
   #ws-side / .ws-sim iframe은 sandbox="allow-scripts"라 localStorage를 직접 읽지 못하므로
   postMessage로 학생 닉네임·은화 보상 지급을 연결한다.
   진행 상태도 iframe 대신 이 창이 localStorage에 맡아 둔다(moon-rpg:save / moon-rpg:load).
   화면이 숨겨지면 iframe을 새로 만들기 때문에(closeSims → wakeSims) 엔딩 정리 카드가 사라지지 않게 하려는 것. */
const moonRpgSaveKey = () => `rpg-moon-save-${classId}-${login?.number ?? 'guest'}`;
const fromSimFrame = (src) =>
  [...document.querySelectorAll('iframe.ws-sim-frame')].some((f) => f.contentWindow === src);
addEventListener('message', async (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object' || !e.source) return;
  if (typeof msg.type !== 'string' || !msg.type.startsWith('moon-rpg:')) return;
  if (!fromSimFrame(e.source)) return; // 학습지 시뮬레이션 칸에서 온 메시지만 받음
  if (msg.type === 'moon-rpg:save') {
    try {
      const raw = JSON.stringify(msg.data ?? null);
      if (raw.length < 20000) localStorage.setItem(moonRpgSaveKey(), raw);
    } catch {}
    return;
  }
  if (msg.type === 'moon-rpg:load') {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(moonRpgSaveKey()) || 'null'); } catch {}
    e.source.postMessage({ type: 'moon-rpg:load-res', data }, '*');
    return;
  }
  if (msg.type === 'moon-rpg:init') {
    if (!login?.token) {
      e.source.postMessage({ type: 'moon-rpg:state', data: { ok: false, error: 'NO_SESSION' } }, '*');
      return;
    }
    try {
      const res = await moonRpgState(login.token);
      e.source.postMessage({ type: 'moon-rpg:state', data: res }, '*');
    } catch {
      e.source.postMessage({ type: 'moon-rpg:state', data: { ok: false, error: 'NET' } }, '*');
    }
  } else if (msg.type === 'moon-rpg:finish') {
    if (!login?.token) {
      e.source.postMessage({ type: 'moon-rpg:finish-res', data: { ok: false, error: 'NO_SESSION' } }, '*');
      return;
    }
    try {
      const res = await moonRpgFinish(login.token, msg.ending, msg.stats, msg.choices);
      e.source.postMessage({ type: 'moon-rpg:finish-res', data: res }, '*');
      if (res?.ok && res.rewarded && (res.silver ?? 0) > 0) {
        toast(`달 자원 RPG 완료! +${res.silver}은화`, 'ok');
      }
    } catch {
      e.source.postMessage({ type: 'moon-rpg:finish-res', data: { ok: false, error: 'NET' } }, '*');
    }
  }
});
/* nogame:end */
