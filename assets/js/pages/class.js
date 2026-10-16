// 반 페이지: [개인 학습지] [모둠활동] 탭. 모둠활동은 오늘 보드(패들렛 + 시뮬레이션), 우리 모둠 제출(모둠원 캐릭터), 모둠 현황
// 학생 기기가 느리고 와이파이가 약해서: 패들렛은 [패들렛 열기]를 눌러야 불러오고,
// 갱신이 실패하면 마지막 화면을 그대로 두고 '연결 확인 중'만 띄운다
import { CLASSES, GRADE } from '../config.js';
import { initUI, esc, toast, prepareDraw, countUp } from '../ui.js';
import { sb, getClassPage, submitGroup, getWorksheet, saveWorksheetAnswers, submitWorksheetPage, onClassRefresh, sendClassRefresh, onWsOpen } from '../db.js';
import { avatarSVG, react, setWaiting, bindReactions } from '../avatar.js';
import { readLogin, clearLogin } from '../login.js';
import { renderPage, markFields, closeSims } from '../worksheet.js';

initUI();
bindReactions();

const REFRESH_MS = 15000;
const JITTER_MS = 3000;     // 15초 갱신에 더하는 0~3초 무작위 지연 (한 반 30대가 같은 순간에 요청하지 않게)
const RETRY_MS = 5000;      // 연결이 끊겼을 때는 더 자주 다시 시도
const SUBMIT_WAIT_MS = 10000;
const classId = Number(new URLSearchParams(location.search).get('c'));
if (!CLASSES.includes(classId)) location.replace('index.html');

const $ = (id) => document.getElementById(id);
const titleText = `${GRADE}학년 ${classId}반`;
$('title').textContent = titleText;
document.title = titleText;
$('me-link').href = `me.html?c=${classId}`;
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

// 이 탭에서 한 번 열면 갱신 때 닫거나 다시 불러오지 않는다
let padletOpen = false;

function renderPadlet(src) {
  if (!isHttp(src)) {
    showEmpty('패들렛이 아직 연결되지 않았어요');
    return;
  }
  if (!padletOpen) {
    const key = 'closed:' + src;
    if (key === shown.padlet) return;
    shown.padlet = key;
    $('padlet-actions').classList.add('hidden');
    $('padlet-slot').innerHTML = `
      <div class="empty padlet-empty padlet-closed">
        ${ICON_BOARD}
        <button type="button" class="btn btn-primary btn-big press" id="padlet-go">패들렛 열기</button>
      </div>`;
    $('padlet-go').addEventListener('click', () => {
      padletOpen = true;
      renderPadlet(src);
    });
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
  TIMEOUT: '응답이 없어요. 다시 보내 주세요',
  NO_SESSION: '다시 로그인해 주세요',
  CLOSED: '제출이 마감됐어요',
  BOARD_CHANGED: '오늘 수업이 바뀌었어요',
  NO_GROUP: '오늘 모둠 명단에 없어요',
  ALREADY: '이미 제출했어요',
};

// 로그인(출입증)이 이 반 것일 때만 쓴다. 로그인 안 했으면 패들렛만 보이고 제출 칸은 로그인 버튼
let login = readLogin();
if (login && login.class_id !== classId) login = null;

let page = null;
let mineKey;    // 지금 보이는 우리 모둠 화면
let mineState;  // 지금 보이는 상태 (바뀌면 뒤집히며 전환)
let swapTimer;

const loginBox = () => `
  <div class="state-box is-idle login-need">
    <span class="state-title">로그인하면 제출할 수 있어요</span>
    <a class="btn btn-primary press" href="index.html">로그인</a>
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
  $('mine-h').textContent = myGroup ? `우리 모둠 · ${myGroup}모둠` : '우리 모둠';
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

let tab = store.get('classTab') === 'group' ? 'group' : 'sheet';
let hasSheet = false;

function applyTab() {
  const sheetOn = hasSheet && tab === 'sheet';
  $('tabs').classList.toggle('hidden', !hasSheet);
  $('sheet').classList.toggle('hidden', !sheetOn);
  $('group-tab').classList.toggle('hidden', sheetOn);
  document.querySelectorAll('.class-tab').forEach((b) => {
    const on = b.dataset.tab === (sheetOn ? 'sheet' : 'group');
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  if (sheetOn) ensureSheet();
  else { closeSims($('sheet')); fitFrame(); }
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.class-tab');
  if (!b || b.dataset.tab === tab) return;
  tab = b.dataset.tab;
  store.set('classTab', tab);
  applyTab();
});

/* ---------- 개인 학습지 ----------
   본문(get_worksheet)은 무거워서 버전이 바뀔 때만 받는다. 15초 갱신에는 완료 여부만 온다.
   쓰는 대로 기기에 임시 저장(ws-<보드>-<번호>, 학생마다 따로)하고 몇 초 뒤 서버에 저장한다. 끊기면 연결되면 다시.
   로그인하지 않았으면 빈 학습지만 보인다(같은 기기를 쓴 다른 학생의 답이 보이지 않게)
   쪽마다 [이 쪽 제출]: 서버가 그 쪽 칸만 채점해 틀리거나 빈 칸의 위치만 돌려준다(정답은 오지 않는다).
   맞은 쪽은 잠긴다(passed). 칸이 있는 쪽을 모두 제출해야 완료 + XP·코인, 완료 화면(#wsdone) */

const SAVE_DELAY_MS = 2500;
const WS_ERR = {
  TIMEOUT: '응답이 없어요. 다시 제출해 주세요',
  NO_SESSION: '다시 로그인해 주세요',
  BOARD_CHANGED: '오늘 수업이 바뀌었어요',
  NO_SHEET: '학습지가 바뀌었어요',
  NO_PAGE: '학습지가 바뀌었어요',
  LOCKED: '아직 수업에서 안 나간 쪽이에요',
  NOT_OPEN: '선생님이 [제출 시작]을 누르면 낼 수 있어요',
};

const ws = {
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
  opened: new Set(), // 선생님이 [제출 시작]을 누른 쪽(pages 순서). 칸이 있는 쪽은 열린 뒤에만 제출
  bad: {},          // { f1: 'wrong' | 'empty' }
  badPts: {},       // 점 찍기 칸의 틀린 점 순서 { f9: [2, 5] } (제출 결과)
  dirty: false,     // 서버에 아직 저장 안 된 답이 있음
  saving: false,
  submitting: false,
  fetching: false,
  saveTimer: null,
  status: '',
};

const draftKey = () => (login ? `ws-${ws.boardId}-${login.number}` : null);
const pageKey = () => `ws-page-${ws.boardId}`;
const persist = () => { if (draftKey()) store.set(draftKey(), { answers: ws.answers, dirty: ws.dirty }); };
const pages = () => ws.sheet?.pages ?? [];
const hasFields = (p) => (p?.fields?.length ?? 0) > 0;
const isClosed = (p) => !!p?.locked; // 아직 수업에서 안 나간 쪽(본문이 오지 않음)
const pageDone = (p) => ws.done || (hasFields(p) && p.fields.every((f) => ws.passed.has(f.key)));
const locked = () => !login || ws.done || pageDone(pages()[ws.idx]);
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

function setOpened(list) {
  const next = new Set(list ?? []);
  const changed = next.size !== ws.opened.size || [...next].some((p) => !ws.opened.has(p));
  ws.opened = next;
  if (changed && ws.sheet) renderWsFoot();
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
  fresh.forEach((f) => toast(`첫 답 인정!${f.slide ? ` ${f.slide}쪽` : ''}${f.xp || f.coins ? ` +${f.xp} XP · +${f.coins}코인` : ''}`, 'ok'));
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
    if (fresh) {
      const saved = Number(store.get(pageKey()));
      ws.idx = Number.isInteger(saved) && saved >= 0 && saved < pages().length ? saved : 0;
      ws.bad = {};
      ws.badPts = {};
    }
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

function renderWsPage() {
  const list = pages();
  const page = list[ws.idx];
  $('ws-slide').textContent = page ? `수업자료 ${page.slide}쪽` : '';
  $('ws-h').textContent = isClosed(page) ? '' : page?.title || ws.sheet.title || '';
  const chip = [ws.done ? '완료' : login && hasFields(page) && pageDone(page) ? '제출함' : '', ws.firsts.has(ws.idx) ? '첫 답 ★' : '']
    .filter(Boolean).join(' · ');
  $('ws-chip').textContent = chip;
  $('ws-chip').classList.toggle('hidden', !chip);
  if (isClosed(page)) $('ws-page').innerHTML = `<div class="empty ws-closed">${LOCK_SVG}<strong>아직 수업에서 안 나간 쪽이에요</strong></div>`;
  else renderPage($('ws-page'), page, ws.answers, { locked: locked() });
  markFields($('ws-page'), ws.bad, wsMarks());
  $('ws-prev').disabled = ws.idx <= 0;
  $('ws-next').disabled = ws.idx >= list.length - 1;
  renderDots();
}

// 쪽 점: 지금 쪽, 제출한 쪽(초록 + 체크), 다 썼지만 아직 제출 안 한 쪽, 고칠 칸이 있는 쪽
const DOT_CHECK = '<svg class="ws-dot-ck" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const LOCK_SVG = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
function renderDots() {
  $('ws-dots').innerHTML = pages().map((p, i) => {
    const keys = p.fields.map((f) => f.key);
    const done = !!login && hasFields(p) && pageDone(p);
    const full = !done && keys.length > 0 && keys.every((k) => (ws.answers[k] ?? '') !== '');
    const bad = !done && keys.some((k) => ws.bad[k]);
    const closed = isClosed(p);
    const st = closed ? ' · 아직 수업 전' : done ? ' · 제출함' : bad ? ' · 고칠 칸 있음' : full ? ' · 다 씀, 제출 전' : '';
    return `<button type="button" class="ws-dot${i === ws.idx ? ' on' : ''}${closed ? ' is-closed' : ''}${done ? ' is-done' : ''}${full ? ' is-full' : ''}${bad ? ' is-bad' : ''}"
      data-i="${i}" aria-label="${p.slide}쪽${st}" ${i === ws.idx ? 'aria-current="step"' : ''}>${done ? DOT_CHECK : ''}<span class="num">${p.slide}</span></button>`;
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
        ${g.xp || g.coins ? `<span class="pass-sub num">+${g.xp} XP · +${g.coins}코인</span>` : ''}
      </div>`;
    return;
  }
  const page = pages()[ws.idx];
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
      ${next >= 0 ? `<button type="button" class="btn btn-line press" id="ws-left" data-i="${next}">제출 안 한 쪽으로</button>` : ''}`;
    if (just) prepareDraw(foot);
    return;
  }
  if (!ws.opened.has(ws.idx)) {
    foot.innerHTML = `${status}${prog}<span class="ws-wait-open">${LOCK_SVG}선생님이 [제출 시작]을 누르면 낼 수 있어요</span>`;
    return;
  }
  const nBad = page.fields.filter((f) => ws.bad[f.key]).length;
  foot.innerHTML = `${status}${prog}
    ${nBad ? `<span class="ws-badn">고칠 칸 ${nBad}개</span>` : ''}
    <button type="button" class="btn btn-primary btn-big press" id="ws-submit">${nBad ? '고쳐서 다시 제출' : '이 쪽 제출'}</button>`;
}

function setStatus(text) {
  ws.status = text;
  const el = $('ws-save');
  if (el) el.textContent = text;
}

function goPage(i) {
  if (i < 0 || i >= pages().length || i === ws.idx) return;
  ws.idx = i;
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
  }
  ws.dirty = true;
  persist();
  renderDots();
  clearTimeout(ws.saveTimer);
  ws.saveTimer = setTimeout(saveSheet, SAVE_DELAY_MS);
}

$('ws-page').addEventListener('input', (e) => {
  const el = e.target.closest('.ws-in');
  if (!el || locked()) return;
  setAnswer(el.dataset.k, el.value.trim() ? el.value : '');
});

$('ws-page').addEventListener('click', (e) => {
  const b = e.target.closest('.ws-opt');
  if (!b || b.disabled || locked()) return;
  const k = b.dataset.k;
  const v = ws.answers[k] === b.dataset.v ? '' : b.dataset.v;
  b.parentElement.querySelectorAll('.ws-opt').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
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
async function submitPage(btn) {
  if (ws.submitting || ws.done || !login || !ws.sheet) return;
  const idx = ws.idx;
  const pg = pages()[idx];
  if (!hasFields(pg) || pageDone(pg)) return;
  ws.submitting = true;
  clearTimeout(ws.saveTimer);
  btn.disabled = true;
  btn.textContent = '채점 중';
  const sent = JSON.stringify(ws.answers);
  let res;
  try {
    res = await withTimeout(submitWorksheetPage(login.token, ws.boardId, idx, ws.answers), SUBMIT_WAIT_MS);
  } catch (err) {
    console.error(err);
    ws.submitting = false;
    toast(WS_ERR[err.message] || '보내지 못했어요. 다시 제출해 주세요', 'error');
    if (btn.isConnected) { btn.disabled = false; btn.textContent = '다시 제출'; }
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
    renderSheet();
    if (ws.dirty) saveSheet();
    return;
  }
  if (res?.error === 'NOT_YET') {
    if (JSON.stringify(ws.answers) === sent) ws.dirty = false;
    persist();
    pg.fields.forEach((f) => { delete ws.bad[f.key]; delete ws.badPts[f.key]; });
    (res.empty ?? []).forEach((k) => { ws.bad[k] = 'empty'; });
    (res.wrong ?? []).forEach((k) => { ws.bad[k] = 'wrong'; });
    Object.entries(res.points ?? {}).forEach(([k, v]) => { if (ws.bad[k] === 'wrong') ws.badPts[k] = v; });
    const empty = (res.empty ?? []).length;
    const n = empty + (res.wrong ?? []).length;
    toast(empty === n ? `빈 칸이 ${n}개 있어요` : `틀리거나 빈 칸이 ${n}개 있어요`, 'error');
    ws.status = '';
    renderSheet();
    if (ws.dirty) saveSheet();
    return;
  }
  toast(WS_ERR[res?.error] || '제출하지 못했어요', 'error');
  sheetError(res?.error);
  if (btn.isConnected) { btn.disabled = false; btn.textContent = '이 쪽 제출'; }
}

/* ---------- 학습지 완료 화면 (마지막 쪽까지 제출했을 때 한 번)
   쪽 카드가 차례로 뒤집히며 초록 → '완료' 도장이 찍힘 → XP·코인 숫자가 올라감 → 색종이.
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
    syncSheet(data);
    updateSide();
    if (!board) showEmpty('오늘 수업이 아직 없어요');
    else renderPadlet(board.padlet_src);
    setNetDown(false);
    if (ws.dirty) saveSheet(); // 끊겨서 못 보낸 학습지 답
  } catch (err) {
    console.error(err);
    if (err.message === 'NOT_CONFIGURED') showEmpty('config.js에 Supabase 주소와 키를 넣어야 해요');
    else {
      if (shown.padlet === undefined) showEmpty('불러오지 못했어요', true);
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

// [제출 시작]은 먼저 낸 순서를 겨루므로 흩지 않고 바로 읽는다
if (sb) onWsOpen(classId, () => { if (!document.hidden) load(); });
if (sb) onClassRefresh(classId, () => {
  // 신호는 모든 학생 기기에 한꺼번에 가므로 0~2초 흩어서 읽는다
  if (!document.hidden) setTimeout(load, Math.random() * 2000);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) closeSims(); // 학습지 시뮬레이션은 화면이 숨겨지면 없앤다(학생 기기 부담)
  else load();
});
addEventListener('online', () => { load(); saveSheet(); });
addEventListener('offline', () => setNetDown(true));
