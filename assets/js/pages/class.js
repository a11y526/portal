// 반 페이지: 오늘 보드(패들렛 + 시뮬레이션), 우리 모둠 제출(모둠원 캐릭터), 모둠 현황
// 학생 기기가 느리고 와이파이가 약해서: 패들렛은 [패들렛 열기]를 눌러야 불러오고,
// 갱신이 실패하면 마지막 화면을 그대로 두고 '연결 확인 중'만 띄운다
import { CLASSES, GRADE } from '../config.js';
import { initUI, esc, toast, prepareDraw } from '../ui.js';
import { sb, getClassPage, submitGroup, submitQuiz, onClassRefresh, sendClassRefresh } from '../db.js';
import { avatarSVG, react, setWaiting, bindReactions } from '../avatar.js';
import { readLogin, clearLogin } from '../login.js';

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
  if (login) $('num-change').textContent = `${login.number}번`;

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
  else if (open) html = (g.state === 'returned' ? returnedBox(g.feedback) : '') + submitBtn(g.state === 'returned' ? '고쳐서 다시 제출' : '다 했어요');
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

/* ---------- 빈칸 질문 (수업 중 선생님이 열면 맨 위에) ----------
   쓰는 중인 답은 기기에 임시 저장(quiz-<id>). 보내다 실패하면 연결되면 자동으로 다시 보낸다.
   맞았는지는 선생님이 XP를 준 뒤('graded')에만 온다. 이 화면에서 질문을 본 적이 있을 때만 결과를 띄운다
   (새로고침하거나 다음 질문이 열리면 사라짐) */

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const circled = (n) => CIRCLED[n - 1] ?? `(${n})`;
const QUIZ_ERR = {
  TIMEOUT: '응답이 없어요. 다시 내 주세요',
  NO_SESSION: '다시 로그인해 주세요',
  CLOSED: '마감됐어요',
  GONE: '질문이 바뀌었어요',
};

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const quizSeen = new Set();   // 이 화면에서 열려 있거나 마감된 상태로 본 질문
let quizKey;
let quizNow = null;
let quizDraft = {};           // { k1: '답', ... } 지금 입력칸의 답
let quizSending = false;
let quizLeveled = new Set();

const draftOf = (id) => store.get(`quiz-${id}`);   // { answers, pending: 보내다 실패해 다시 보낼 것 }
const saveDraft = (id, pending) => store.set(`quiz-${id}`, { answers: quizDraft, pending });

// 같은 문장의 빈칸(단어)은 문장 하나 아래에 칸을 나란히
function quizGroups(items) {
  const out = [];
  items.forEach((it) => {
    const last = out[out.length - 1];
    if (it.type === 'blank' && last?.type === 'blank' && last.prompt === it.prompt) last.items.push(it);
    else out.push({ type: it.type, prompt: it.prompt, items: [it] });
  });
  return out;
}

function quizField(it, locked, graded) {
  const v = quizDraft[it.key] ?? '';
  const mark = graded ? (graded.result?.[it.key] ? '<span class="qa-mark is-ok" aria-label="맞음">○</span>' : '<span class="qa-mark is-no" aria-label="틀림">✕</span>') : '';
  if (it.type === 'choice' || it.type === 'sym') {
    return `
      <div class="qa-opts${it.type === 'sym' ? ' is-sym' : ''}" role="group" aria-label="${circled(it.no)}">
        <b class="qa-no">${circled(it.no)}</b>
        ${(it.options ?? []).map((o) => `<button type="button" class="qa-opt press" data-key="${it.key}" data-val="${esc(o)}"
          aria-pressed="${v === o}" ${locked ? 'disabled' : ''}>${esc(o)}</button>`).join('')}
        ${mark}
      </div>`;
  }
  const tag = it.type === 'text'
    ? `<textarea class="input qa-in" rows="2" maxlength="200" data-key="${it.key}" ${locked ? 'disabled' : ''}>${esc(v)}</textarea>`
    : `<input class="input qa-in" type="text" maxlength="200" data-key="${it.key}" value="${esc(v)}" autocomplete="off" ${locked ? 'disabled' : ''}>`;
  return `<label class="qa-field"><b>${circled(it.no)}</b>${tag}${mark}</label>`;
}

function renderQuiz(data) {
  const box = $('quiz');
  const q = data?.board ? data.quiz : null;
  if (q && q.status !== 'graded') quizSeen.add(q.id);
  const show = q && (q.status !== 'graded' || quizSeen.has(q.id));
  if (!show) {
    if (q?.status === 'graded') store.del(`quiz-${q.id}`);
    box.classList.add('hidden');
    quizKey = undefined;
    quizNow = null;
    return;
  }
  const graded = q.status === 'graded' ? q.graded : null;
  const key = [q.id, q.status, login ? 'in' : 'out', q.mine?.submitted_at ?? '', graded ? JSON.stringify(graded) : ''].join('|');
  if (key === quizKey) return;
  const fresh = quizNow?.id !== q.id;
  quizKey = key;
  quizNow = q;

  if (fresh) {
    const d = draftOf(q.id);
    quizDraft = { ...(q.mine?.answers ?? {}), ...(d?.answers ?? {}) };
  }
  if (q.status !== 'open') quizDraft = { ...(q.mine?.answers ?? {}) };
  const locked = !login || q.status !== 'open';
  const sent = !!q.mine;
  const state = q.status === 'open'
    ? (sent ? '<span class="chip qa-chip is-sent">냈어요</span>' : '')
    : q.status === 'closed' ? '<span class="chip qa-chip is-closed">마감</span>' : '';

  let foot;
  if (!login) {
    foot = `<div class="state-box is-idle login-need"><span class="state-title">로그인하면 낼 수 있어요</span><a class="btn btn-primary press" href="index.html">로그인</a></div>`;
  } else if (graded) {
    const right = Object.values(graded.result ?? {}).filter(Boolean).length;
    foot = `<div class="state-box is-passed qa-result">
      <span class="state-title">${q.items.length}개 중 ${right}개 맞음</span>
      ${graded.xp || graded.coins ? `<span class="qa-gain num">+${graded.xp} XP · +${graded.coins}코인</span>` : ''}
    </div>`;
  } else if (q.status === 'open') {
    foot = `<button type="button" class="btn btn-primary btn-big press" id="quiz-send">${sent ? '고쳐서 다시 내기' : '내기'}</button>`;
  } else {
    foot = '';
  }

  box.innerHTML = `
    <div class="quiz-head">
      <h2 id="quiz-h">빈칸 · ${q.slide_no}쪽</h2>${state}
    </div>
    <div class="quiz-items">
      ${quizGroups(q.items).map((g) => `
        <div class="qa-q">
          ${g.prompt ? `<p class="qa-prompt">${esc(g.prompt)}</p>` : ''}
          <div class="qa-row${g.type === 'blank' ? ' is-inline' : ''}">${g.items.map((it) => quizField(it, locked, graded)).join('')}</div>
        </div>`).join('')}
    </div>
    ${foot}`;
  box.classList.remove('hidden');
  if (fresh) { box.classList.remove('rise'); void box.offsetWidth; box.classList.add('rise'); }

  if (graded) {
    store.del(`quiz-${q.id}`);
    if (graded.level_after > graded.level_before && !quizLeveled.has(q.id)) {
      quizLeveled.add(q.id);
      showLevelUp(graded.level_after, graded.total_xp, data.my_members?.find((m) => m.me)?.avatar);
    }
  }
}

// 보내다 실패한 답은 연결되면 자동으로 다시
function retryQuiz() {
  if (quizNow?.status === 'open' && login && draftOf(quizNow.id)?.pending) sendQuiz();
}

$('quiz').addEventListener('input', (e) => {
  const el = e.target.closest('.qa-in');
  if (!el || !quizNow) return;
  quizDraft[el.dataset.key] = el.value;
  saveDraft(quizNow.id, !!draftOf(quizNow.id)?.pending);
});

$('quiz').addEventListener('click', (e) => {
  const opt = e.target.closest('.qa-opt');
  if (opt && quizNow && !opt.disabled) {
    const k = opt.dataset.key;
    quizDraft[k] = quizDraft[k] === opt.dataset.val ? '' : opt.dataset.val;
    opt.parentElement.querySelectorAll('.qa-opt').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === quizDraft[k])));
    saveDraft(quizNow.id, !!draftOf(quizNow.id)?.pending);
    return;
  }
  if (e.target.closest('#quiz-send')) sendQuiz();
});

// 버튼 하나에 요청 하나: 누르면 '보내는 중'으로 잠그고, 10초 안에 답이 없거나 실패하면 [다시 보내기]
async function sendQuiz() {
  if (quizSending || !quizNow || !login || quizNow.status !== 'open') return;
  const q = quizNow;
  quizSending = true;
  saveDraft(q.id, true);
  const btn = $('quiz-send');
  if (btn) { btn.disabled = true; btn.textContent = '보내는 중'; }
  let res;
  try {
    res = await withTimeout(submitQuiz(login.token, q.id, quizDraft), SUBMIT_WAIT_MS);
  } catch (err) {
    console.error(err);
    quizSending = false;
    toast(QUIZ_ERR[err.message] || '보내지 못했어요. 연결되면 다시 보낼게요', 'error');
    if (btn?.isConnected) { btn.disabled = false; btn.textContent = '다시 보내기'; }
    return;
  }
  quizSending = false;
  if (res?.ok) {
    saveDraft(q.id, false);
    toast('냈어요', 'ok');
  } else {
    store.del(`quiz-${q.id}`);
    toast(QUIZ_ERR[res?.error] || '내지 못했어요', 'error');
    if (res?.error === 'NO_SESSION') { clearLogin(); login = null; mineKey = undefined; }
  }
  quizKey = undefined;
  await load();
}

/* ---------- 레벨업 (빈칸 XP로 레벨이 오르면) ---------- */
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
    renderQuiz(data);
    renderGroups(data);
    updateSide();
    if (!board) showEmpty('오늘 수업이 아직 없어요');
    else renderPadlet(board.padlet_src);
    setNetDown(false);
    retryQuiz();
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

if (sb) onClassRefresh(classId, () => {
  // 신호는 모든 학생 기기에 한꺼번에 가므로 0~2초 흩어서 읽는다
  if (!document.hidden) setTimeout(load, Math.random() * 2000);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
addEventListener('online', () => { quizKey = undefined; load(); });
addEventListener('offline', () => setNetDown(true));
