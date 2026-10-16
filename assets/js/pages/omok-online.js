// 오목 1대1: 6개 반 전체에서 먼저 온 2명끼리. 보상 없음. 흑·백은 서버가 무작위로, 흑이 먼저.
// 한 수 제한 시간을 넘기면 진다(서버가 판정). 선생님이 오목을 켠 반만, 하루 판 수 제한(AI 대전과 따로).
// 판 채널 om-<판> Broadcast로 상대에게 '새로고침' 신호 + 대기·대국 중에는 2초마다 om_state.
import { initUI, toast, esc } from '../ui.js';
import { omState, omJoin, omLeave, omPlay, onGameRefresh, sendGameRefresh, onClassRefresh } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { mountAvatar, avatarSVG, react, bindReactions, setWaiting } from '../avatar.js';
import { N, winLine } from '../omok.js';
import { loadOmokRank } from '../omok-rank-view.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const login = readLogin();
const COLOR = { 1: 'black', 2: 'white' };
const nameOf = (p) => (p.me ? '나' : `${p.class_id}반 ${p.nickname ?? '닉네임 미정'}`);

let info = null;      // om_state 결과(game 빼고)
let game = null;      // 지금 보는 판
let gameId = null;
let avatarEl = null;
let busy = false;
let deadline = 0;     // 지금 차례가 끝나는 시각(performance.now 기준)
let shown = null;     // 결과를 띄운 판 번호

/* ---------- 판 ---------- */
(function buildBoard() {
  const step = 100 / N, half = step / 2;
  let lines = '';
  for (let i = 0; i < N; i++) {
    const p = half + i * step;
    lines += `<line x1="${half}" y1="${p}" x2="${100 - half}" y2="${p}"/><line x1="${p}" y1="${half}" x2="${p}" y2="${100 - half}"/>`;
  }
  const stars = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]
    .map(([r, c]) => `<circle cx="${half + c * step}" cy="${half + r * step}" r="0.75"/>`).join('');
  let cells = '';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells += `<button type="button" class="oc" data-i="${r * N + c}"><i></i></button>`;
  $('board').innerHTML = `<svg class="omok-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}<g>${stars}</g></svg>${cells}`;
})();
const cells = [...$('board').querySelectorAll('.oc')];

$('board').addEventListener('click', (e) => {
  const b = e.target.closest('.oc');
  if (b) play(Number(b.dataset.i));
});

const myTurn = () => game?.status === 'playing' && game.turn === game.me && !busy;
const used = () => !!info && info.today >= info.daily;

function winCells(g) {
  if (g.end_reason !== 'five' || g.last == null) return new Set();
  const b = Array.from({ length: N }, (_, r) => g.board.slice(r * N, r * N + N).map((v) => COLOR[v] ?? null));
  const r = Math.floor(g.last / N), c = g.last % N;
  return new Set(winLine(b, r, c, COLOR[g.winner]).map(([y, x]) => y * N + x));
}

/* ---------- 그리기 ---------- */
function render() {
  const playing = game && (game.status === 'playing' || game.status === 'done');
  $('lobby').classList.toggle('hidden', !!playing);
  $('table').classList.toggle('hidden', !playing);
  $('hero').classList.toggle('hidden', !!playing);   // 판이 한 화면에 들어오게
  if (playing) renderTable(); else renderLobby();
}

function renderInfo() {
  if (!info) return;
  $('turn-sec').textContent = info.turn;
  $('dots').innerHTML = Array.from({ length: info.daily }, (_, i) => `<i class="${i < info.today ? 'on' : ''}"></i>`).join('');
  $('today').textContent = `${Math.min(info.today, info.daily)} / ${info.daily}`;
}

function renderLobby() {
  const waiting = game?.status === 'waiting';
  const open = !!info?.open;
  const me = `<div class="rk-seat is-in"><div class="rk-seat-av">${avatarSVG(info?.avatar, 72, { label: '나' })}</div><span>나</span></div>`;
  const other = `<div class="rk-seat"><div class="rk-seat-av rk-seat-empty${waiting ? ' wait' : ''}" aria-hidden="true">?</div><span class="muted">${waiting ? '찾는 중' : '상대'}</span></div>`;
  $('seats').innerHTML = me + other;
  $('lobby-h').textContent = waiting ? '상대를 찾고 있어요' : '2명이 모이면 시작해요';
  $('find').classList.toggle('hidden', waiting);
  $('cancel').classList.toggle('hidden', !waiting);
  $('find').disabled = busy || !open || used();
  $('cancel').disabled = busy;
  $('closed').classList.toggle('hidden', !info || open);
  $('limit').classList.toggle('hidden', !open || !used() || waiting);
}

function renderTable() {
  const g = game;
  const done = g.status === 'done';
  const line = done ? winCells(g) : new Set();
  const mine = myTurn();
  cells.forEach((el, i) => {
    const v = COLOR[g.board[i]];
    el.className = 'oc' + (v ? ' ' + v : '') + (g.last === i ? ' last' : '') + (line.has(i) ? ' win' : '');
    el.disabled = !mine || !!v;
    const r = Math.floor(i / N), c = i % N;
    el.setAttribute('aria-label', `${r + 1}행 ${c + 1}열 ${v === 'black' ? '흑' : v === 'white' ? '백' : '빈 칸'}`);
  });

  $('turn').textContent = done ? resultTitle(g) : mine ? '내 차례' : busy ? '두는 중' : '상대 차례';
  $('turn').className = 'omok-turn' + (done && g.winner === g.me ? ' won' : '') + (!done && !mine ? ' thinking' : '');

  $('players').innerHTML = [...g.players].sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0)).map((p) => `
    <div class="rk-opp glass${!done && g.turn === p.color ? ' is-turn' : ''}${p.left ? ' is-left' : ''}">
      <span class="omok-stone ${COLOR[p.color]}" aria-label="${p.color === 1 ? '흑' : '백'}"></span>
      <div class="rk-opp-av">${avatarSVG(p.avatar, 44, { label: nameOf(p) })}</div>
      <div class="rk-opp-main"><b>${esc(nameOf(p))}</b><span class="muted">${p.color === 1 ? '흑' : '백'}${p.left ? ' · 나감' : ''}</span></div>
      ${!done && g.turn === p.color ? '<div class="rk-opp-bar"><i></i></div>' : ''}
    </div>`).join('');

  $('resign').classList.toggle('hidden', done);
  $('resign').disabled = busy;
  $('again2').classList.toggle('hidden', !done);
  $('again2').disabled = busy || !info?.open || used();
  $('again').disabled = busy || !info?.open || used();
  renderClock();
}

function resultTitle(g) {
  if (g.winner == null) return '무승부';
  return g.winner === g.me ? '승리!' : '패배';
}

function resultSub(g) {
  const won = g.winner === g.me;
  if (g.end_reason === 'time') return won ? '상대 시간 초과' : '시간 초과';
  if (g.end_reason === 'left') return won ? '상대가 나갔어요' : '기권했어요';
  if (g.end_reason === 'full') return '판이 가득 찼어요';
  return `${g.moves}수`;
}

/* ---------- 시계 ---------- */
let clockTimer = 0;
function renderClock() {
  clearTimeout(clockTimer);
  if (game?.status !== 'playing') {
    $('clock').textContent = '';
    return;
  }
  const left = Math.max(0, deadline - performance.now());
  const sec = Math.min(game.turn_sec, Math.ceil(left / 1000));
  $('clock').textContent = `${sec}초`;
  $('clock').classList.toggle('warn', sec <= 10);
  const frac = Math.min(1, left / (game.turn_sec * 1000));
  document.querySelectorAll('.om-players .rk-opp-bar > i').forEach((el) => { el.style.transform = `scaleX(${frac})`; });
  if (left > 0) clockTimer = setTimeout(renderClock, 250);
}

/* ---------- 결과 ---------- */
const BITS = [['12%', '#2457E6', 0], ['28%', '#F59E0B', .5], ['46%', '#22C582', .2], ['64%', '#B79CFF', .8], ['82%', '#FF7A45', .35]];

function showResult(g) {
  const win = g.winner != null && g.winner === g.me;
  const card = $('result-card');
  card.className = 'omok-cover-card glass-strong pop' + (win ? ' is-win' : '');
  card.querySelectorAll('.confetti-bit').forEach((x) => x.remove());
  if (win) card.insertAdjacentHTML('afterbegin', BITS.map(([l, c, d]) => `<span class="confetti-bit" aria-hidden="true" style="left:${l};background:${c};--d:${d}s"></span>`).join(''));
  $('result-h').textContent = resultTitle(g);
  $('result-s').textContent = resultSub(g);
  $('result').classList.remove('hidden');
  $('again').focus();
  if (avatarEl) react(avatarEl, win ? 'jump' : 'tilt');
}

/* ---------- 상태 받기 ---------- */
function apply(res) {
  if (!res?.ok) return relogin();
  const first = !info;
  const { game: g, ...rest } = res;
  info = rest;
  renderInfo();
  if (first) {
    avatarEl = mountAvatar($('av'), res.avatar, 120, { label: '내 캐릭터', live: true });
    $('v-game').classList.remove('hidden');
  }
  if (!g) {
    // 끝난 판을 보고 있으면 그대로 둔다([한 판 더]를 누를 때까지)
    if (game?.status !== 'done') {
      game = null;
      gameId = null;
      onGameRefresh(null);
    }
  } else {
    if (g.id !== gameId) {
      gameId = g.id;
      onGameRefresh(gameId, () => refresh(), 'om-');
    }
    const prev = game?.id === g.id ? game.status : null;
    if (g.status === 'playing') deadline = performance.now() + (g.left_ms ?? 0);
    game = g;
    if (prev === 'waiting' && g.status === 'playing' && avatarEl) react(avatarEl, 'jump');
    if (g.status === 'done' && shown !== g.id) {
      shown = g.id;
      // 처음 열었는데 이미 끝난 판이면 결과를 다시 띄우지 않는다
      if (prev) showResult(g);
    }
  }
  if (avatarEl) setWaiting(avatarEl, game?.status === 'waiting');
  render();
  schedule();
}

async function refresh() {
  if (!login) return;
  try {
    apply(await omState(login.token, gameId));
  } catch (err) {
    console.error(err);
    if (!info) toast('불러오지 못했어요', 'error');
    schedule();
  }
}

// 버튼 하나에 요청 하나
async function send(job, onFail) {
  if (busy) return;
  busy = true;
  render();
  const gid = gameId;
  try {
    const res = await job();
    if (res?.ok === false) {
      if (res.error === 'NO_SESSION') return relogin();
      onFail?.(res);
      if (res.state) apply(res.state);
      return;
    }
    apply(res);
    sendGameRefresh(gameId ?? gid, 'om-');
  } catch (err) {
    console.error(err);
    toast('연결을 확인해 주세요', 'error');
  } finally {
    busy = false;
    render();
  }
}

/* ---------- 조작 ---------- */
function play(i) {
  if (!myTurn() || game.board[i]) return;
  // 바로 보이게 먼저 놓는다(서버가 거절하면 받은 판으로 되돌림)
  game = { ...game, board: game.board.map((v, k) => (k === i ? game.me : v)), last: i };
  send(() => omPlay(login.token, game.id, i), (res) => {
    if (res.error === 'TAKEN') toast('둘 수 없는 칸이에요', 'error');
  });
}

function findGame() {
  $('result').classList.add('hidden');
  game = null;
  gameId = null;
  onGameRefresh(null);
  send(() => omJoin(login.token), (res) => {
    if (res.error === 'LIMIT') info = { ...info, today: res.today, daily: res.daily };
    else if (res.error === 'CLOSED') info = { ...info, open: false };
    else toast('상대를 찾지 못했어요', 'error');
    renderInfo();
  });
}

$('find').addEventListener('click', findGame);
$('again').addEventListener('click', findGame);
$('again2').addEventListener('click', findGame);
$('view').addEventListener('click', () => $('result').classList.add('hidden'));
$('cancel').addEventListener('click', () => {
  if (gameId) send(() => omLeave(login.token, gameId));
});
$('resign').addEventListener('click', () => {
  if (!gameId || game?.status !== 'playing') return;
  if (!confirm('기권할까요? 상대가 이긴 것으로 끝나요.')) return;
  send(() => omLeave(login.token, gameId));
});

/* ---------- 갱신 ---------- */
function relogin() {
  clearLogin();
  toast('다시 로그인해 주세요', 'error');
  setTimeout(() => location.replace('index.html'), 1200);
}

let pollTimer = 0;
let dueTimer = 0;
function schedule() {
  clearTimeout(pollTimer);
  clearTimeout(dueTimer);
  const active = game && (game.status === 'waiting' || game.status === 'playing');
  // 대기·대국 중에는 화면이 숨겨져도 '아직 있음'을 알린다(15초 넘게 소식이 없으면 대기에서 빠짐)
  const wait = active ? (document.hidden ? 5000 : 2000) : document.hidden ? 0 : 20000 + Math.random() * 3000;
  if (wait) pollTimer = setTimeout(refresh, wait);
  // 차례 시간이 끝나면 서버가 판정하도록(서버는 2초 더 기다림)
  if (game?.status === 'playing') dueTimer = setTimeout(refresh, Math.max(0, deadline - performance.now()) + 2300);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && login) refresh();
  else schedule();
});

/* ---------- 시작 ---------- */
if (!login) {
  $('v-login').classList.remove('hidden');
} else {
  await refresh();
  try { onClassRefresh(login.class_id, () => refresh()); } catch {}
  loadOmokRank($('rank'), login.token).catch((err) => console.error(err));
}
