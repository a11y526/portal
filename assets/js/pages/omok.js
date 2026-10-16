// 오목: AI(백, 보통)와 대전. 나는 흑. 이기면 서버가 기보를 다시 두어 확인한 뒤 XP·코인을 준다.
// 하루 판 수 제한: 첫 돌을 놓을 때 서버에서 판을 받는다(그만두거나 새로고침해도 한 판).
// 선생님이 켠 반만 할 수 있고, 꺼지면(수업 모드 시작 포함) 판을 막는다. 첫 돌 말고는 대국 중 통신은 하지 않는다.
import { initUI, toast, countUp } from '../ui.js';
import { getOmok, startOmok, submitOmok, onClassRefresh } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { mountAvatar, avatarSVG, react, bindReactions } from '../avatar.js';
import { N, emptyBoard, aiMove, isWin, winLine, isFull } from '../omok.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const login = readLogin();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
// 보상 받기 전 이긴 판 {game, moves} (와이파이가 끊겨도 날아가지 않게)
const PENDING = login ? `omok-win-${login.class_id}-${login.number}` : '';

let info = null;      // get_omok 결과
let avatarEl = null;
const g = {
  board: emptyBoard(), turn: 'black', moves: [], last: null,
  over: null,         // null | 'black' | 'white' | 'draw'
  line: new Set(), thinking: false, gen: 0,
  gameId: null,       // start_omok에서 받은 판 번호(첫 돌을 놓으면 생김)
  seed: 0,            // 그 판의 AI 씨앗
  starting: false,
  tally: { black: 0, white: 0 },
};

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
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells += `<button type="button" class="oc" data-r="${r}" data-c="${c}"><i></i></button>`;
  $('board').innerHTML = `<svg class="omok-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}<g>${stars}</g></svg>${cells}`;
})();
const cells = [...$('board').querySelectorAll('.oc')];

$('board').addEventListener('click', (e) => {
  const b = e.target.closest('.oc');
  if (b) play(Number(b.dataset.r), Number(b.dataset.c));
});

// 오늘 판을 다 써서 새 판을 시작할 수 없음
const used = () => !!info && !g.gameId && info.today >= info.daily;

function render() {
  const open = !!info?.open;
  const mine = open && !g.over && !g.thinking && !g.starting && !used() && g.turn === 'black';
  cells.forEach((el, i) => {
    const r = Math.floor(i / N), c = i % N, v = g.board[r][c];
    el.className = 'oc' + (v ? ' ' + v : '')
      + (g.last && g.last[0] === r && g.last[1] === c ? ' last' : '')
      + (g.line.has(i) ? ' win' : '');
    el.disabled = !mine || v !== null;
    el.setAttribute('aria-label', `${r + 1}행 ${c + 1}열 ${v === 'black' ? '흑' : v === 'white' ? '백' : '빈 칸'}`);
  });
  $('turn').textContent = g.over === 'black' ? '승리!' : g.over === 'white' ? 'AI 승리' : g.over === 'draw' ? '무승부'
    : !open ? '닫혀 있어요' : used() ? '오늘 판을 다 했어요' : g.thinking ? 'AI가 생각 중' : '내 차례';
  $('turn').className = 'omok-turn' + (g.thinking ? ' thinking' : '') + (g.over === 'black' ? ' won' : '');
  $('moves').textContent = `${g.moves.length}수`;
  $('reset').disabled = !open || g.thinking;
  $('closed').classList.toggle('hidden', !info || open);
  $('limit').classList.toggle('hidden', !open || !used() || !!g.over);
}

function renderInfo() {
  if (!info) return;
  $('rw-xp').textContent = info.xp;
  $('rw-co').textContent = info.coins;
  const cap = info.reward_daily ?? 2;
  $('rw-cap').textContent = `· 오늘 보상 ${Math.min(info.rewarded ?? 0, cap)} / ${cap}`;
  const left = Math.max(0, info.daily - info.today);
  $('dots').innerHTML = Array.from({ length: info.daily }, (_, i) => `<i class="${i < info.today ? 'on' : ''}"></i>`).join('');
  $('today').textContent = `${Math.min(info.today, info.daily)} / ${info.daily}`;
  $('today').title = left ? `${left}판 남았어요` : '';
}

/* ---------- 대국 ---------- */
async function play(r, c) {
  if (!info?.open || g.over || g.thinking || g.starting || g.turn !== 'black' || g.board[r][c] !== null) return;
  if (!g.gameId && !(await begin())) return;
  if (g.over || g.board[r][c] !== null) return;
  place(r, c, 'black');
  if (finish(r, c, 'black')) return;
  g.turn = 'white';
  aiTurn();
}

// 첫 돌: 서버에서 판 번호를 받는다(오늘 판 수 +1). 받으면 true
async function begin() {
  g.starting = true;
  render();
  const gen = g.gen;
  try {
    const res = await startOmok(login.token);
    if (gen !== g.gen) return false;
    if (res?.ok) {
      g.gameId = res.game_id;
      g.seed = res.seed ?? 0;
      info = { ...info, today: res.today, daily: res.daily };
      renderInfo();
      return true;
    }
    if (res?.error === 'NO_SESSION') relogin();
    else if (res?.error === 'LIMIT') {
      info = { ...info, today: res.today, daily: res.daily };
      renderInfo();
    } else if (res?.error === 'CLOSED') {
      info = { ...info, open: false };
    } else toast('시작하지 못했어요', 'error');
    return false;
  } catch (err) {
    console.error(err);
    toast('연결을 확인해 주세요', 'error');
    return false;
  } finally {
    g.starting = false;
    render();
  }
}

function aiTurn() {
  g.thinking = true;
  render();
  const gen = g.gen;
  setTimeout(() => {
    if (gen !== g.gen) return;
    g.thinking = false;
    const m = aiMove(g.board, g.seed, g.moves.filter((x) => x.p === 'white').length);
    if (m) {
      place(m[0], m[1], 'white');
      if (finish(m[0], m[1], 'white')) return;
    }
    g.turn = 'black';
    render();
  }, 500);
}

function place(r, c, p) {
  g.board[r][c] = p;
  g.moves.push({ r, c, p });
  g.last = [r, c];
}

// 끝났으면 true
function finish(r, c, p) {
  if (isWin(g.board, r, c, p)) {
    g.over = p;
    g.tally[p]++;
    g.line = new Set(winLine(g.board, r, c, p).map(([y, x]) => y * N + x));
    countUp($(p === 'black' ? 'win-b' : 'win-w'), g.tally[p], 600);
    render();
    if (p === 'black') {
      const blackMoves = g.moves.filter((m) => m.p === 'black').map((m) => [m.r, m.c]);
      store.set(PENDING, JSON.stringify({ game: g.gameId, moves: blackMoves }));
      showResult('win');
      sendWin();
      if (avatarEl) react(avatarEl, 'jump');
    } else {
      showResult('lose');
      if (avatarEl) react(avatarEl, 'tilt');
    }
    return true;
  }
  if (isFull(g.board)) {
    g.over = 'draw';
    render();
    showResult('draw');
    return true;
  }
  return false;
}

function newGame() {
  g.gen++;
  Object.assign(g, { board: emptyBoard(), turn: 'black', moves: [], last: null, over: null, line: new Set(), thinking: false, gameId: null, seed: 0, starting: false });
  $('result').classList.add('hidden');
  render();
}

$('reset').addEventListener('click', () => {
  if (g.moves.length && !g.over && !confirm('지금 대국을 그만두고 새로 시작할까요? 그만둔 판도 오늘 판 수에 들어가요.')) return;
  newGame();
});
$('again').addEventListener('click', newGame);

/* ---------- 결과와 보상 ---------- */
const BITS = [['12%', '#2457E6', 0], ['28%', '#F59E0B', .5], ['46%', '#22C582', .2], ['64%', '#B79CFF', .8], ['82%', '#FF7A45', .35]];

function showResult(kind, sub = '') {
  const card = $('result-card');
  card.className = 'omok-cover-card glass-strong pop' + (kind === 'win' ? ' is-win' : '');
  card.querySelectorAll('.confetti-bit').forEach((x) => x.remove());
  if (kind === 'win') {
    card.insertAdjacentHTML('afterbegin', BITS.map(([l, c, d]) => `<span class="confetti-bit" aria-hidden="true" style="left:${l};background:${c};--d:${d}s"></span>`).join(''));
  }
  $('result-h').textContent = kind === 'win' ? '승리!' : kind === 'lose' ? 'AI 승리' : '무승부';
  $('result-s').textContent = sub || (kind === 'win' ? '보상 받는 중…' : '');
  $('retry').classList.add('hidden');
  $('result').classList.remove('hidden');
  $('again').focus();
}

let sending = false;
async function sendWin() {
  const raw = store.get(PENDING);
  if (!raw || sending || !login) return;
  let saved;
  try { saved = JSON.parse(raw); } catch { store.del(PENDING); return; }
  // 판 번호가 없는 예전 기록은 보낼 수 없다
  if (!saved?.game || !Array.isArray(saved.moves)) { store.del(PENDING); return; }
  sending = true;
  const onScreen = g.over === 'black';
  $('retry').classList.add('hidden');
  if (onScreen) $('result-s').textContent = '보상 받는 중…';
  const timer = setTimeout(() => { if (sending && onScreen) $('retry').classList.remove('hidden'); }, 10000);
  try {
    const res = await submitOmok(login.token, saved.game, saved.moves);
    store.del(PENDING);
    if (!res?.ok) {
      if (res?.error === 'NO_SESSION') return relogin();
      const msg = res?.error === 'CLOSED' ? '지금은 보상을 받을 수 없어요' : '보상을 받지 못했어요';
      if (onScreen) $('result-s').textContent = msg; else toast(msg, 'error');
      return;
    }
    info = { ...info, today: res.today, daily: res.daily, rewarded: (info.rewarded ?? 0) + (res.paid ? 1 : 0) };
    renderInfo();
    const msg = res.paid ? `+${res.xp} XP · +${res.coins}코인` : res.capped ? '오늘 보상은 다 받았어요' : '이미 받은 판이에요';
    if (onScreen) $('result-s').textContent = msg; else if (res.paid) toast(`지난 승리 보상 ${msg}`, 'ok');
    if (res.paid && res.level_after > res.level_before) showLevelUp(res.level_after, res.total_xp);
  } catch (err) {
    console.error(err);
    if (onScreen) {
      $('result-s').textContent = '연결되면 보상을 받아요';
      $('retry').classList.remove('hidden');
    }
  } finally {
    clearTimeout(timer);
    sending = false;
  }
}
$('retry').addEventListener('click', sendWin);
addEventListener('online', sendWin);

function showLevelUp(lv, total) {
  const k = `lv-${login.class_id}-${login.number}`;
  store.set(k, String(Math.max(Number(store.get(k)) || 0, lv)));
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

/* ---------- 열림 상태 ---------- */
function relogin() {
  clearLogin();
  toast('다시 로그인해 주세요', 'error');
  setTimeout(() => location.replace('index.html'), 1200);
}

async function refresh() {
  try {
    const res = await getOmok(login.token);
    if (!res?.ok) return relogin();
    const wasOpen = info?.open;
    const first = !info;
    info = res;
    renderInfo();
    if (first) {
      avatarEl = mountAvatar($('av'), res.avatar, 120, { label: '내 캐릭터', live: true });
      $('v-game').classList.remove('hidden');
    }
    // 꺼지면 하던 판은 멈춘다(다시 켜지면 이어서)
    if (wasOpen && !res.open) {
      g.gen++;
      g.thinking = false;
    }
    render();
    if (res.open && g.turn === 'white' && !g.over && !g.thinking) aiTurn();
    if (res.open) sendWin();
  } catch (err) {
    console.error(err);
    if (!info) toast('불러오지 못했어요', 'error');
  }
}

let pollTimer = 0;
function schedule() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(async () => { await refresh(); schedule(); }, 20000 + Math.random() * 3000);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && login) { refresh(); schedule(); }
});

/* ---------- 시작 ---------- */
if (!login) {
  $('v-login').classList.remove('hidden');
} else {
  render();
  await refresh();
  schedule();
  try { onClassRefresh(login.class_id, () => refresh()); } catch {}
}
