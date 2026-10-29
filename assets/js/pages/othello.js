// 오델로: 6개 반 전체에서 먼저 온 2명끼리 온라인 대전. 돌 개수로 이긴 판만 XP·은화(하루 정한 횟수까지). 흑·백은 서버가 무작위로, 흑이 먼저.
// 상대 돌을 하나 이상 뒤집을 수 있는 칸에만 둘 수 있고, 둘 곳이 없으면 자동으로 차례가 넘어간다(passed).
// 양쪽 모두 둘 곳이 없으면 돌이 더 많은 쪽이 이긴다. 판 채널 ot-<판> Broadcast + 대기·대국 중 2초마다 ot_state.
import { initUI, toast, esc } from '../ui.js';
import { otState, otJoin, otLeave, otPlay, onGameRefresh, sendGameRefresh, onClassRefresh } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { mountAvatar, avatarSVG, react, bindReactions, setWaiting } from '../avatar.js';
import { N, flips, validMoves, counts } from '../othello.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const login = readLogin();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const COLOR = { 1: 'black', 2: 'white' };
const nameOf = (p) => (p.me ? '나' : `${p.class_id}반 ${p.nickname ?? '닉네임 미정'}`);

let info = null;      // ot_state 결과(game 빼고)
let game = null;      // 지금 보는 판
let gameId = null;
let avatarEl = null;
let busy = false;
let deadline = 0;     // 지금 차례가 끝나는 시각(performance.now 기준)
let shown = null;     // 결과를 띄운 판 번호
let hoverCell = null; // 마우스를 올린 칸 번호(뒤집힐 돌 미리 보기)

/* ---------- 판 ---------- */
(function buildBoard() {
  const step = 100 / N;
  let lines = '';
  for (let i = 1; i < N; i++) {
    const p = i * step;
    lines += `<line x1="0" y1="${p}" x2="100" y2="${p}"/><line x1="${p}" y1="0" x2="${p}" y2="100"/>`;
  }
  const dots = [[2, 2], [2, 6], [6, 2], [6, 6]]
    .map(([r, c]) => `<circle cx="${c * step}" cy="${r * step}" r="0.85"/>`).join('');
  let html = '';
  for (let i = 0; i < N * N; i++) html += `<button type="button" class="ot-cell" data-i="${i}"><i></i></button>`;
  $('board').innerHTML = `<svg class="ot-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}<g>${dots}</g></svg>${html}`;
})();
const cells = [...$('board').querySelectorAll('.ot-cell')];

$('board').addEventListener('click', (e) => {
  const b = e.target.closest('.ot-cell');
  if (b) play(Number(b.dataset.i));
});

$('board').addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const b = e.target.closest('.ot-cell');
  const idx = b ? Number(b.dataset.i) : null;
  if (idx !== hoverCell) {
    hoverCell = idx;
    updatePreview();
  }
});

$('board').addEventListener('pointerleave', () => {
  if (hoverCell !== null) {
    hoverCell = null;
    updatePreview();
  }
});

const myTurn = () => game?.status === 'playing' && game.turn === game.me && !busy;
const used = () => !!info && info.today >= info.daily;

function updatePreview() {
  const preview = new Set(
    myTurn() && hoverCell != null ? flips(game.board, hoverCell, game.me) : []
  );
  cells.forEach((el, i) => el.classList.toggle('will-flip', preview.has(i)));
}

/* ---------- 그리기 ---------- */
function render() {
  const playing = game && (game.status === 'playing' || game.status === 'done');
  $('lobby').classList.toggle('hidden', !!playing);
  $('table').classList.toggle('hidden', !playing);
  $('hero').classList.toggle('hidden', !!playing);
  if (playing) renderTable(); else renderLobby();
}

function renderInfo() {
  if (!info) return;
  $('turn-sec').textContent = info.turn;
  $('rw-co').textContent = info.silver ?? 0;
  $('rw-today').textContent = `${Math.min(info.rewarded, info.reward_daily)} / ${info.reward_daily}`;
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
  const mine = myTurn();
  const canSet = new Set(mine ? validMoves(g.board, g.me) : []);
  const flipSet = new Set(g.flipped ?? []);

  cells.forEach((el, i) => {
    const v = COLOR[g.board[i]];
    const can = canSet.has(i);
    el.className = 'ot-cell'
      + (v ? ' ' + v : '')
      + (can ? ' can' : '')
      + (g.last === i ? ' last' : '')
      + (flipSet.has(i) ? ' flipped' : '');
    el.disabled = !can;
    const r = Math.floor(i / N), c = i % N;
    el.setAttribute('aria-label', `${r + 1}행 ${c + 1}열 ${v === 'black' ? '흑' : v === 'white' ? '백' : can ? '둘 수 있는 칸' : '빈 칸'}`);
  });
  updatePreview();

  $('turn').textContent = done ? resultTitle(g) : mine ? '내 차례' : busy ? '두는 중' : '상대 차례';
  $('turn').className = 'omok-turn' + (done && g.winner === g.me ? ' won' : '') + (!done && !mine ? ' thinking' : '');

  if (done) {
    const { black, white } = counts(g.board);
    $('pass-msg').textContent = `흑 ${black} : 백 ${white}`;
  } else if (g.passed) {
    $('pass-msg').textContent = g.turn === g.me ? '상대가 둘 곳이 없어 내 차례예요' : '둘 곳이 없어 차례가 넘어갔어요';
  } else if (mine) {
    $('pass-msg').textContent = `둘 수 있는 칸 ${canSet.size}곳`;
  } else {
    $('pass-msg').textContent = '';
  }

  const cnt = counts(g.board);
  $('players').innerHTML = [...g.players].sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0)).map((p) => {
    const stoneCnt = p.color === 1 ? cnt.black : cnt.white;
    return `
    <div class="rk-opp glass${!done && g.turn === p.color ? ' is-turn' : ''}${p.left ? ' is-left' : ''}">
      <span class="omok-stone ${COLOR[p.color]}" aria-label="${p.color === 1 ? '흑' : '백'}"></span>
      <div class="rk-opp-av">${avatarSVG(p.avatar, 44, { label: nameOf(p) })}</div>
      <div class="rk-opp-main"><b>${esc(nameOf(p))}</b><span class="muted">${p.color === 1 ? '흑' : '백'}${p.left ? ' · 나감' : ''}</span></div>
      <b class="ot-cnt num">${stoneCnt}</b>
      ${!done && g.turn === p.color ? '<div class="rk-opp-bar"><i></i></div>' : ''}
    </div>`;
  }).join('');

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
  if (g.reward) return `+${g.reward.silver ?? 0}은화`;
  if (g.end_reason === 'time') return won ? '상대 시간 초과' : '시간 초과';
  if (g.end_reason === 'left') return won ? '상대가 나갔어요' : '기권했어요';
  const { black, white } = counts(g.board);
  const myCnt = g.me === 1 ? black : white;
  const oppCnt = g.me === 1 ? white : black;
  const score = `나 ${myCnt}개 : 상대 ${oppCnt}개`;
  if (won && (info?.rewarded ?? 0) >= (info?.reward_daily ?? 1)) return `${score} · 오늘 보상은 다 받았어요`;
  return score;
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
function mini(n, { stones = [], dots = [], flipped = [], last = null }) {
  const U = 12;
  const size = n * U;
  const flipSet = new Set(flipped.map(([r, c]) => `${r},${c}`));
  let grid = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      grid += `<rect x="${c * U + .6}" y="${r * U + .6}" width="${U - 1.2}" height="${U - 1.2}" rx="1.5" fill="rgba(22,163,106,.14)"/>`;
    }
  }
  const dotTags = dots.map(([r, c]) => `<circle cx="${c * U + U / 2}" cy="${r * U + U / 2}" r="1.5" fill="#16A36A"/>`).join('');
  const stoneTags = stones.map(([r, c, col]) => {
    const cx = c * U + U / 2, cy = r * U + U / 2;
    const isLast = last && last[0] === r && last[1] === c;
    const isFlip = flipSet.has(`${r},${c}`);
    const fill = col === 1 ? '#141B29' : '#FFFFFF';
    const stroke = isLast ? '#2457E6' : isFlip ? '#16A36A' : col === 1 ? '#0B1220' : 'rgba(11,18,32,.22)';
    const sw = isLast || isFlip ? 1.1 : .6;
    return `<circle cx="${cx}" cy="${cy}" r="4.1" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }).join('');
  return `<svg class="qd-board" viewBox="-2 -2 ${size + 4} ${size + 4}" aria-hidden="true">${grid}${dotTags}${stoneTags}</svg>`;
}

const MINI = {
  start: () => mini(4, {
    stones: [[1, 1, 2], [1, 2, 1], [2, 1, 1], [2, 2, 2]],
    dots: [[0, 1], [1, 0], [2, 3], [3, 2]],
  }),
  flip: () => mini(4, {
    stones: [[1, 0, 1], [1, 1, 1], [1, 2, 1], [1, 3, 1], [2, 1, 2]],
    last: [1, 3],
    flipped: [[1, 1], [1, 2]],
  }),
  valid: () => mini(4, {
    stones: [[1, 1, 2], [1, 2, 2], [2, 1, 1], [2, 2, 1]],
    dots: [[0, 1], [0, 2], [0, 3]],
  }),
  multi: () => mini(4, {
    stones: [[0, 1, 1], [1, 1, 1], [2, 1, 1], [2, 2, 1], [2, 3, 1], [0, 3, 1], [1, 2, 1]],
    last: [2, 1],
    flipped: [[1, 1], [2, 2], [1, 2]],
  }),
  pass: () => mini(4, {
    stones: [[0, 0, 1], [0, 1, 1], [0, 2, 1], [1, 0, 1], [1, 1, 1], [1, 2, 1], [2, 0, 2], [2, 1, 2]],
  }),
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
    $('help-daily').textContent = info.daily;
    $('help-reward').textContent = `${info.silver ?? 0}은화`;
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
    if (!store.get('ot-help-seen')) {
      store.set('ot-help-seen', '1');
      setTab('rules');
    } else {
      setTab(tab);
    }
  }
  if (!g) {
    if (game?.status !== 'done') {
      game = null;
      gameId = null;
      onGameRefresh(null);
    }
  } else {
    if (g.id !== gameId) {
      gameId = g.id;
      onGameRefresh(gameId, () => refresh(), 'ot-');
    }
    const prev = game?.id === g.id ? game.status : null;
    if (g.status === 'playing') deadline = performance.now() + (g.left_ms ?? 0);
    game = g;
    if (prev === 'waiting' && g.status === 'playing' && avatarEl) react(avatarEl, 'jump');
    if (g.status === 'done' && shown !== g.id) {
      shown = g.id;
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
    apply(await otState(login.token, gameId));
  } catch (err) {
    console.error(err);
    if (!info) toast('불러오지 못했어요', 'error');
    schedule();
  }
}

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
    sendGameRefresh(gameId ?? gid, 'ot-');
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
  if (!myTurn()) return;
  const f = flips(game.board, i, game.me);
  if (!f.length) return;
  const flipSet = new Set(f);
  hoverCell = null;
  game = {
    ...game,
    board: game.board.map((v, k) => (k === i || flipSet.has(k) ? game.me : v)),
    last: i,
    flipped: f,
  };
  send(() => otPlay(login.token, game.id, i), (res) => {
    if (res.error === 'BAD_MOVE') toast('상대 돌을 뒤집을 수 있는 칸에만 놓을 수 있어요', 'error');
  });
}

function findGame() {
  $('result').classList.add('hidden');
  game = null;
  gameId = null;
  onGameRefresh(null);
  send(() => otJoin(login.token), (res) => {
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
  if (gameId) send(() => otLeave(login.token, gameId));
});
$('resign').addEventListener('click', () => {
  if (!gameId || game?.status !== 'playing') return;
  if (!confirm('기권할까요? 상대가 이긴 것으로 끝나요.')) return;
  send(() => otLeave(login.token, gameId));
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
  const wait = active ? (document.hidden ? 5000 : 2000) : document.hidden ? 0 : 20000 + Math.random() * 3000;
  if (wait) pollTimer = setTimeout(refresh, wait);
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
