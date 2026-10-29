// 쿼리도: 6개 반 전체에서 판 크기(2명·4명)별로 먼저 온 사람끼리 온라인 대전. 판은 서버가 들고 있다(qd_* 함수).
// 차례마다 말을 한 칸(뛰어넘기 포함) 움직이거나 벽을 하나 놓는다. 한 수 제한 시간이 지나면 서버가 차례를 넘기고, 2번 연속이면 나간 것으로.
// 갱신: 판 채널(qd-<판>) Broadcast 신호 + 대기·대국 중 2초마다 qd_state. 신호 내용은 믿지 않고 항상 다시 읽는다.
// 판은 내 자리가 늘 아래에 오도록 돌려서 그린다(벽 번호·칸 번호는 서버 기준 그대로).
import { initUI, toast, esc } from '../ui.js';
import { qdState, qdJoin, qdLeave, qdPlay, onGameRefresh, sendGameRefresh, onClassRefresh } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { mountAvatar, avatarSVG, react, bindReactions, setWaiting } from '../avatar.js';
import { N, moves, wallOk } from '../quoridor.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const login = readLogin();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const SEAT_NAME = ['파랑', '초록', '주황', '보라'];
const nameOf = (p) => (p.me ? '나' : `${p.class_id}반 ${p.nickname ?? '닉네임 미정'}`);
const U = 12;           // 칸 + 홈 간격(칸 10, 홈 2)

let info = null;        // qd_state 결과(game 빼고)
let game = null;        // 지금 보는 판
let gameId = null;
let avatarEl = null;
let busy = false;
let deadline = 0;       // 지금 차례가 끝나는 시각(performance.now 기준)
let shown = null;       // 결과를 띄운 판 번호
let mode = 'move';      // move | wall
let ghost = null;       // 미리 보는 벽 번호
let lastPointer = 'mouse';

const myTurn = () => game?.status === 'playing' && game.turn === game.me && !busy && !me()?.left;
const used = () => !!info && info.today >= info.daily;
const me = () => game?.players.find((p) => p.me);
const player = (seat) => game?.players.find((p) => p.seat === seat);
const active = () => game.players.filter((p) => !p.left && p.cell != null);
const wallSet = () => new Set(game.walls);

/* ---------- 판 그리기 ---------- */
const svgNS = 'http://www.w3.org/2000/svg';
const cx = (cell) => (cell % N) * U + 5;
const cy = (cell) => Math.floor(cell / N) * U + 5;

function wallRect(code) {
  const o = code >> 6, r = (code >> 3) & 7, c = code & 7;
  return o === 0 ? { x: c * U, y: r * U + 10.2, w: 21.6, h: 1.6 } : { x: c * U + 10.2, y: r * U, w: 1.6, h: 21.6 };
}
const rectTag = (code, cls) => {
  const { x, y, w, h } = wallRect(code);
  return `<rect class="${cls}" x="${x - (w > h ? 0 : .2)}" y="${y - (h > w ? 0 : .2)}" width="${w + (w > h ? 0 : .4)}" height="${h + (h > w ? 0 : .4)}" rx=".8"/>`;
};

// 도착 줄 띠: 자리 0 위쪽, 1 오른쪽, 2 아래쪽, 3 왼쪽
const GOAL = [
  '<rect x="0" y="-3" width="106" height="1.6" rx=".8"/>',
  '<rect x="107.4" y="0" width="1.6" height="106" rx=".8"/>',
  '<rect x="0" y="107.4" width="106" height="1.6" rx=".8"/>',
  '<rect x="-3" y="0" width="1.6" height="106" rx=".8"/>',
];

(function buildBoard() {
  let cells = '';
  for (let i = 0; i < N * N; i++) cells += `<rect class="qd-cell" data-cell="${i}" x="${(i % N) * U}" y="${Math.floor(i / N) * U}" width="10" height="10" rx="1.6"/>`;
  $('board').innerHTML = `<g id="rot"><g id="goals"></g>${cells}<g id="qd-dots"></g><g id="walls"></g><g id="ghost"></g><g id="pawns"></g></g>`;
})();

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
  $('rw-xp').textContent = info.xp;
  $('rw-co').textContent = info.xp + (info.silver ?? 0);
  $('rw-today').textContent = `${Math.min(info.rewarded, info.reward_daily)} / ${info.reward_daily}`;
  $('dots').innerHTML = Array.from({ length: info.daily }, (_, i) => `<i class="${i < info.today ? 'on' : ''}"></i>`).join('');
  $('today').textContent = `${Math.min(info.today, info.daily)} / ${info.daily}`;
}

function renderLobby() {
  const waiting = game?.status === 'waiting';
  const open = !!info?.open;
  if (waiting) {
    const ps = game.players;
    const seats = ps.map((p) => `<div class="rk-seat is-in"><div class="rk-seat-av">${avatarSVG(p.avatar, 72, { label: nameOf(p) })}</div><span>${esc(nameOf(p))}</span></div>`);
    for (let i = ps.length; i < game.size; i++) seats.push('<div class="rk-seat"><div class="rk-seat-av rk-seat-empty wait" aria-hidden="true">?</div><span class="muted">찾는 중</span></div>');
    $('seats').innerHTML = seats.join('');
    $('lobby-h').textContent = `${game.size}명 판 · ${ps.length} / ${game.size}명 모였어요`;
  } else {
    $('seats').innerHTML = `<div class="rk-seat is-in"><div class="rk-seat-av">${avatarSVG(info?.avatar, 72, { label: '나' })}</div><span>나</span></div>`;
    $('lobby-h').textContent = '몇 명이서 할까요?';
  }
  $('sizes').classList.toggle('hidden', waiting);
  $('cancel').classList.toggle('hidden', !waiting);
  $('cancel').disabled = busy;
  for (const b of document.querySelectorAll('.qd-size')) b.disabled = busy || !open || used();
  const q = info?.queue ?? {};
  $('q2').textContent = q[2] ? `지금 ${q[2]}명 기다려요` : '';
  $('q4').textContent = q[4] ? `지금 ${q[4]}명 기다려요` : '';
  $('closed').classList.toggle('hidden', !info || open);
  $('limit').classList.toggle('hidden', !open || !used() || waiting);
}

function renderTable() {
  const g = game;
  const done = g.status === 'done';
  const mine = myTurn();
  const walls = wallSet();
  const my = me();

  // 내 자리가 아래로 오게 돌린다(자리 0이 아래에서 출발)
  $('rot').setAttribute('transform', `rotate(${-90 * (g.me ?? 0)} 53 53)`);

  $('goals').innerHTML = g.players.filter((p) => !p.left).map((p) => `<g class="qd-goal s${p.seat}">${GOAL[p.seat]}</g>`).join('');

  const can = mine && mode === 'move' && my?.cell != null
    ? moves(walls, new Set(active().filter((p) => !p.me).map((p) => p.cell)), my.cell) : [];
  const canSet = new Set(can);
  $('board').querySelectorAll('.qd-cell').forEach((el) => {
    const i = Number(el.dataset.cell);
    el.classList.toggle('can', canSet.has(i));
    el.classList.toggle('from', g.last?.kind === 'move' && g.last.from === i);
  });
  $('qd-dots').innerHTML = can.map((i) => `<circle class="qd-dot s${g.me}" cx="${cx(i)}" cy="${cy(i)}" r="1.6"/>`).join('');

  $('walls').innerHTML = g.walls.map((w) => rectTag(w, 'qd-wall' + (g.last?.kind === 'wall' && g.last.wall === w ? ' recent' : ''))).join('');

  if (ghost != null && (!mine || mode !== 'wall')) ghost = null;
  $('ghost').innerHTML = ghost == null ? '' : rectTag(ghost, 'qd-ghost' + (ghostOk(ghost) ? '' : ' bad'));

  // 말: 이미 있는 것은 옮기기만(움직임이 보이게)
  const pawns = $('pawns');
  for (const p of g.players) {
    let el = pawns.querySelector(`[data-seat="${p.seat}"]`);
    if (p.cell == null) { el?.remove(); continue; }
    if (!el) {
      el = document.createElementNS(svgNS, 'g');
      el.dataset.seat = p.seat;
      el.innerHTML = '<circle class="qd-ring" r="4.6"/><circle class="qd-pawn-c" r="3.6"/>';
      pawns.appendChild(el);
    }
    el.setAttribute('class', `qd-pawn s${p.seat}${p.me ? ' me' : ''}${!done && g.turn === p.seat ? ' turn' : ''}${done && g.winner === p.seat ? ' win' : ''}`);
    el.style.transform = `translate(${cx(p.cell)}px, ${cy(p.cell)}px)`;
  }
  pawns.querySelectorAll('[data-seat]').forEach((el) => { if (!player(Number(el.dataset.seat))) el.remove(); });

  const tp = player(g.turn);
  $('turn').textContent = done ? resultTitle(g) : mine ? '내 차례' : busy ? '보내는 중' : tp ? `${nameOf(tp)} 차례` : '';
  $('turn').className = 'omok-turn' + (done && g.winner === g.me ? ' won' : '') + (!done && !mine ? ' thinking' : '');
  $('last').textContent = lastText(g);

  const left = my?.walls ?? 0;
  $('m-wall-n').textContent = left;
  $('m-move').classList.toggle('on', mode === 'move');
  $('m-wall').classList.toggle('on', mode === 'wall');
  $('m-move').setAttribute('aria-pressed', mode === 'move');
  $('m-wall').setAttribute('aria-pressed', mode === 'wall');
  $('m-move').disabled = done;
  $('m-wall').disabled = done || left <= 0;
  if (left <= 0 && mode === 'wall') mode = 'move';
  $('hint').textContent = done || !mine ? '' : mode === 'move' ? '점이 찍힌 칸을 누르세요' : '칸 사이 홈을 누르세요';
  $('board').classList.toggle('wall-mode', mine && mode === 'wall');

  $('players').innerHTML = [...g.players].sort((a, b) => a.seat - b.seat).map((p) => `
    <div class="rk-opp glass${!done && g.turn === p.seat ? ' is-turn' : ''}${p.left ? ' is-left' : ''}">
      <span class="qd-chip s${p.seat}" aria-label="${SEAT_NAME[p.seat]}"></span>
      <div class="rk-opp-av">${avatarSVG(p.avatar, 44, { label: nameOf(p) })}</div>
      <div class="rk-opp-main"><b>${esc(nameOf(p))}</b><span class="muted">${p.left ? '나감' : `벽 <span class="num">${p.walls}</span>`}</span></div>
      ${!done && g.turn === p.seat ? '<div class="rk-opp-bar"><i></i></div>' : ''}
    </div>`).join('');

  $('resign').classList.toggle('hidden', done || !!my?.left);
  $('resign').disabled = busy;
  $('again2').classList.toggle('hidden', !(done || my?.left));
  $('again2').disabled = busy || !info?.open || used();
  $('again').disabled = busy || !info?.open || used();
  renderClock();
}

function lastText(g) {
  const l = g.last;
  if (!l || g.status !== 'playing') return '';
  const p = player(l.seat);
  const who = p ? nameOf(p) : '';
  if (l.kind === 'move') return `방금: ${who} 이동`;
  if (l.kind === 'wall') return `방금: ${who} 벽`;
  if (l.kind === 'timeout') return `방금: ${who} 시간 초과`;
  if (l.kind === 'leave') return `방금: ${who} 나감`;
  return '';
}

function resultTitle(g) {
  if (me()?.left && g.winner !== g.me) return '나간 판이에요';
  if (g.winner === g.me) return '승리!';
  const w = player(g.winner);
  return w ? `${nameOf(w)} 승리` : '끝';
}

function resultSub(g) {
  const won = g.winner === g.me;
  if (g.reward) return `+${g.reward.xp} XP · +${g.reward.xp + (g.reward.silver ?? 0)}은화`;
  if (g.end_reason === 'left') return won ? '모두 나가서 끝난 판은 보상이 없어요' : '';
  if (won && (info?.rewarded ?? 0) >= (info?.reward_daily ?? 1)) return '오늘 보상은 다 받았어요';
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
  const win = g.winner === g.me && !me()?.left;
  const card = $('result-card');
  card.className = 'omok-cover-card glass-strong pop' + (win ? ' is-win' : '');
  card.querySelectorAll('.confetti-bit').forEach((x) => x.remove());
  if (win) card.insertAdjacentHTML('afterbegin', BITS.map(([l, c, d]) => `<span class="confetti-bit" aria-hidden="true" style="left:${l};background:${c};--d:${d}s"></span>`).join(''));
  $('result-h').textContent = resultTitle(g);
  $('result-s').textContent = resultSub(g);
  $('result').classList.remove('hidden');
  $('again').focus();
  if (avatarEl) react(avatarEl, win ? 'jump' : 'tilt');
  if (g.reward && g.reward.level_after > g.reward.level_before) setTimeout(() => showLevelUp(g.reward.level_after, g.reward.total_xp), 900);
}

function showLevelUp(lv, total) {
  const k = `lv-${login.class_id}-${login.number}`;
  if ((Number(store.get(k)) || 0) >= lv) return;
  store.set(k, String(lv));
  $('lvup-n').textContent = lv;
  $('lvup-s').textContent = `누적 ${total} XP 달성`;
  $('lvup-av').innerHTML = avatarSVG(info?.avatar, 160, { label: '내 캐릭터' });
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

/* ---------- 규칙 탭 ---------- */
// 규칙 그림: 작은 판(n×n)에 말·점·벽. 벽은 { o: 0 가로 | 1 세로, r, c }, bad면 빨강
function mini(n, { pawns = [], dots = [], walls = [], bad = [], goal = [] }) {
  const size = n * U - 2;
  const wr = ({ o, r, c }) => (o === 0 ? `x="${c * U}" y="${r * U + 10}" width="22" height="2"` : `x="${c * U + 10}" y="${r * U}" width="2" height="22"`);
  const stripe = { 0: `x="0" y="-3" width="${size}" height="1.6"`, 2: `x="0" y="${size + 1.4}" width="${size}" height="1.6"` };
  let cells = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells += `<rect class="qd-cell" x="${c * U}" y="${r * U}" width="10" height="10" rx="1.6"/>`;
  return `<svg class="qd-board" viewBox="-4 -4 ${size + 8} ${size + 8}" aria-hidden="true">
    ${goal.map((s) => `<rect class="qd-goal s${s}" ${stripe[s]} rx=".8"/>`).join('')}${cells}
    ${dots.map(([r, c]) => `<circle class="qd-dot s0" cx="${c * U + 5}" cy="${r * U + 5}" r="1.6"/>`).join('')}
    ${walls.map((w) => `<rect class="qd-wall" ${wr(w)} rx=".8"/>`).join('')}
    ${bad.map((w) => `<rect class="qd-ghost bad" ${wr(w)} rx=".8"/>`).join('')}
    ${pawns.map(([r, c, s]) => `<g class="qd-pawn s${s}${s === 0 ? ' me' : ''}" style="transform: translate(${c * U + 5}px, ${r * U + 5}px)"><circle class="qd-ring" r="4.6"/><circle class="qd-pawn-c" r="3.6"/></g>`).join('')}
  </svg>`;
}
const MINI = {
  goal: () => mini(5, { pawns: [[4, 2, 0], [0, 2, 2]], goal: [0, 2] }),
  move: () => mini(5, { pawns: [[2, 2, 0]], dots: [[1, 2], [3, 2], [2, 1], [2, 3]] }),
  jump: () => mini(5, { pawns: [[3, 2, 0], [2, 2, 2]], dots: [[1, 2], [3, 1], [3, 3], [4, 2]] }),
  side: () => mini(5, { pawns: [[3, 2, 0], [2, 2, 2]], walls: [{ o: 0, r: 1, c: 2 }], dots: [[2, 1], [2, 3], [3, 1], [3, 3], [4, 2]] }),
  wall: () => mini(5, { walls: [{ o: 0, r: 0, c: 0 }, { o: 1, r: 2, c: 1 }, { o: 1, r: 0, c: 3 }], bad: [{ o: 0, r: 2, c: 1 }, { o: 1, r: 1, c: 3 }] }),
  block: () => mini(5, { pawns: [[0, 2, 2]], goal: [2], walls: [{ o: 0, r: 2, c: 1 }, { o: 0, r: 2, c: 3 }, { o: 1, r: 2, c: 0 }], bad: [{ o: 0, r: 3, c: 0 }] }),
};
document.querySelectorAll('[data-mini]').forEach((el) => { el.innerHTML = MINI[el.dataset.mini](); });

let tab = 'game';
function setTab(t) {
  tab = t;
  document.querySelectorAll('.omok-modes [data-tab]').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === t);
    if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('v-rules').classList.toggle('hidden', t !== 'rules');
  if (login) $('v-game').classList.toggle('hidden', t !== 'game' || !info);
  else $('v-login').classList.toggle('hidden', t !== 'game');
  if (info) {
    $('help-turn').textContent = info.turn;
    $('help-reward').textContent = `${info.xp} XP · ${info.xp + (info.silver ?? 0)}은화`;
    $('help-daily').textContent = info.daily;
    $('help-rdaily').textContent = info.reward_daily ?? 1;
  }
  scrollTo({ top: 0 });
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

/* ---------- 상태 받기 ---------- */
function apply(res) {
  if (!res?.ok) return relogin();
  const first = !info;
  const { game: g, ...rest } = res;
  info = rest;
  renderInfo();
  if (first) {
    avatarEl = mountAvatar($('av'), res.avatar, 120, { label: '내 캐릭터', live: true });
    // 처음 들어온 기기에서는 규칙 탭부터
    if (!store.get('qd-help-seen')) {
      store.set('qd-help-seen', '1');
      setTab('rules');
    } else {
      setTab(tab);
    }
  }
  if (!g) {
    // 끝난 판·나간 판을 보고 있으면 그대로 둔다([한 판 더]를 누를 때까지)
    if (!(game && (game.status === 'done' || me()?.left))) {
      game = null;
      gameId = null;
      onGameRefresh(null);
    }
  } else {
    if (g.id !== gameId) {
      gameId = g.id;
      ghost = null;
      mode = 'move';
      $('pawns').innerHTML = '';
      onGameRefresh(gameId, () => refresh(), 'qd-');
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
    apply(await qdState(login.token, gameId));
  } catch (err) {
    console.error(err);
    if (!info) toast('불러오지 못했어요', 'error');
    schedule();
  }
}

const FAIL = {
  BAD_MOVE: '갈 수 없는 칸이에요',
  BAD_WALL: '놓을 수 없는 자리예요',
  BLOCK: '길을 완전히 막는 벽은 놓을 수 없어요',
  NO_WALLS: '남은 벽이 없어요',
  NOT_TURN: '내 차례가 아니에요',
};

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
    sendGameRefresh(gameId ?? gid, 'qd-');
  } catch (err) {
    console.error(err);
    toast('연결을 확인해 주세요', 'error');
    refresh();
  } finally {
    busy = false;
    render();
  }
}

/* ---------- 조작 ---------- */
const failToast = (res) => { if (FAIL[res.error]) toast(FAIL[res.error], 'error'); };

function moveTo(cell) {
  if (!myTurn() || mode !== 'move') return;
  const my = me();
  const ok = moves(wallSet(), new Set(active().filter((p) => !p.me).map((p) => p.cell)), my.cell);
  if (!ok.includes(cell)) return;
  // 바로 보이게 먼저 옮긴다(서버가 거절하면 받은 판으로 되돌림)
  game = { ...game, players: game.players.map((p) => (p.me ? { ...p, cell } : p)), last: { seat: game.me, kind: 'move', from: my.cell, to: cell } };
  send(() => qdPlay(login.token, game.id, 'move', cell), failToast);
}

const ghostOk = (code) => !!me() && me().walls > 0
  && wallOk(wallSet(), code, active().map((p) => ({ seat: p.seat, cell: p.cell })));

function placeWall(code) {
  if (!myTurn() || mode !== 'wall' || !ghostOk(code)) return;
  ghost = null;
  game = { ...game, walls: [...game.walls, code], players: game.players.map((p) => (p.me ? { ...p, walls: p.walls - 1 } : p)), last: { seat: game.me, kind: 'wall', wall: code } };
  send(() => qdPlay(login.token, game.id, 'wall', code), failToast);
}

// 누른 자리(판 좌표)에서 가장 가까운 홈의 벽 번호
function wallAt(e) {
  const g = $('rot');
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(g.getScreenCTM().inverse());
  const clamp = (v) => Math.max(0, Math.min(7, v));
  const gr = clamp(Math.round((pt.y - 11) / U)), gc = clamp(Math.round((pt.x - 11) / U));
  const dy = Math.abs(pt.y - (gr * U + 11)), dx = Math.abs(pt.x - (gc * U + 11));
  if (pt.x < -2 || pt.y < -2 || pt.x > 108 || pt.y > 108) return null;
  return dy <= dx ? gr * 8 + gc : 64 + gr * 8 + gc;
}

function setGhost(code) {
  if (ghost === code) return;
  ghost = code;
  $('ghost').innerHTML = ghost == null ? '' : rectTag(ghost, 'qd-ghost' + (ghostOk(ghost) ? '' : ' bad'));
}

$('board').addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; });
$('board').addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || !myTurn() || mode !== 'wall') return;
  setGhost(wallAt(e));
});
$('board').addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && mode === 'wall') setGhost(null);
});
$('board').addEventListener('click', (e) => {
  if (!myTurn()) return;
  if (mode === 'move') {
    const c = e.target.closest('[data-cell]');
    if (c) moveTo(Number(c.dataset.cell));
    return;
  }
  const code = wallAt(e);
  if (code == null) return;
  // 마우스는 바로 놓고, 터치는 한 번 미리 본 같은 자리를 다시 누르면 놓는다
  if (lastPointer === 'mouse' || ghost === code) {
    if (ghostOk(code)) placeWall(code);
    else { setGhost(code); toast(FAIL.BAD_WALL, 'error'); }
  } else {
    setGhost(code);
  }
});

function setMode(m) {
  mode = m;
  ghost = null;
  render();
}
$('m-move').addEventListener('click', () => setMode('move'));
$('m-wall').addEventListener('click', () => setMode(mode === 'wall' ? 'move' : 'wall'));

function findGame(size) {
  $('result').classList.add('hidden');
  game = null;
  gameId = null;
  onGameRefresh(null);
  send(() => qdJoin(login.token, size), (res) => {
    if (res.error === 'LIMIT') info = { ...info, today: res.today, daily: res.daily };
    else if (res.error === 'CLOSED') info = { ...info, open: false };
    else toast('판을 찾지 못했어요', 'error');
    renderInfo();
  });
}

// [한 판 더]는 판 고르기 화면으로
function backToLobby() {
  $('result').classList.add('hidden');
  game = null;
  gameId = null;
  onGameRefresh(null);
  render();
  refresh();
}

document.querySelectorAll('.qd-size').forEach((b) => b.addEventListener('click', () => findGame(Number(b.dataset.size))));
$('again').addEventListener('click', backToLobby);
$('again2').addEventListener('click', backToLobby);
$('view').addEventListener('click', () => $('result').classList.add('hidden'));
$('cancel').addEventListener('click', () => {
  if (gameId) send(() => qdLeave(login.token, gameId));
});
$('resign').addEventListener('click', () => {
  if (!gameId || game?.status !== 'playing') return;
  if (!confirm(game.size === 2 ? '기권할까요? 상대가 이긴 것으로 끝나요.' : '기권할까요? 내 말이 판에서 빠지고 남은 사람끼리 계속해요.')) return;
  send(() => qdLeave(login.token, gameId));
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
  const activeGame = game && (game.status === 'waiting' || (game.status === 'playing' && !me()?.left));
  // 대기·대국 중에는 화면이 숨겨져도 '아직 있음'을 알린다(15초 넘게 소식이 없으면 대기에서 빠짐)
  const wait = activeGame ? (document.hidden ? 5000 : 2000) : document.hidden ? 0 : 20000 + Math.random() * 3000;
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
  setTab('game');
} else {
  await refresh();
  try { onClassRefresh(login.class_id, () => refresh()); } catch {}
}
