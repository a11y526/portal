// 루미큐브: 6개 반 전체에서 먼저 온 3명끼리 온라인 대전. 판은 서버가 들고 있고(rk_* 함수), 여기서는 내 손패만 안다.
// 판 찾기 → 대기(3명이 되면 서버가 나눠 줌) → 차례마다 판을 고쳐 [내기] 또는 [1장 가져오기]. 한 턴 제한 시간이 지나면 서버가 1장 뽑고 넘긴다.
// 갱신: 판 채널(rk-<판>) Broadcast 신호 + 3초마다 rk_state. 신호 내용은 믿지 않고 항상 다시 읽는다.
// 조작: 타일을 눌러 고르고 세트의 [+] / [새 세트] / [손패로]를 누르거나, 끌어다 놓는다.
import { initUI, toast, esc } from '../ui.js';
import { rkState, rkJoin, rkLeave, rkDraw, rkPlay, onGameRefresh, sendGameRefresh, onClassRefresh } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { mountAvatar, avatarSVG, react, bindReactions, setWaiting } from '../avatar.js';
import { readSet, checkPlay, sortRack, isJoker, num, color, COLORS, FIRST_MELD } from '../rummikub.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const login = readLogin();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let info = null;       // rk_state 결과
let game = null;       // 서버 판(내 손패만)
let gameId = null;     // 보고 있는 판(끝난 판 포함)
let avatarEl = null;
let busy = false;      // 서버로 보내는 중
let deadline = 0;      // 지금 차례가 끝나는 시각(performance.now 기준)
let shownEnd = null;   // 결과 연출을 보여 준 판
const work = { board: [], rack: [], ver: -1 };   // 이번 차례에 고치는 판과 손패
let sel = new Set();   // 고른 타일
let order = [];        // 내 손패 보여 주는 순서

const myTurn = () => game?.status === 'playing' && !game.left && game.turn === game.me;
const fresh = () => new Set(work.board.flat().filter((t) => !game.board.flat().includes(t)));   // 이번 차례에 낸 타일
const changed = () => JSON.stringify(work.board) !== JSON.stringify(game?.board ?? []);
const nameOf = (p) => (p.me ? '나' : `${p.class_id}반 ${p.nickname ?? '닉네임 미정'}`);
const player = (seat) => game?.players.find((p) => p.seat === seat);

// 내용이 바뀔 때만 다시 그린다(3초마다 갱신해도 애니메이션이 되풀이되지 않게)
function setHTML(el, html) {
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

/* ---------- 타일 ---------- */
const JOKER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.5 5.4 5.9.7-4.4 4 1.2 5.8L12 16.2l-5.2 2.9 1.2-5.8-4.4-4 5.9-.7z" fill="currentColor"/></svg>';

function tileHTML(t, { cls = '', rep = null, drag = false } = {}) {
  const label = isJoker(t) ? `조커${rep ? ` (${rep})` : ''}` : `${['검정', '빨강', '파랑', '주황'][color(t)]} ${num(t)}`;
  const body = isJoker(t) ? `${JOKER_SVG}${rep ? `<small class="num">${rep}</small>` : ''}` : `<b class="num">${num(t)}</b><i></i>`;
  return `<button type="button" class="rt ${isJoker(t) ? 'joker' : 'c-' + COLORS[color(t)]}${sel.has(t) ? ' sel' : ''}${cls ? ' ' + cls : ''}" data-t="${t}" aria-label="${label}" aria-pressed="${sel.has(t)}"${drag ? ' draggable="true"' : ''}>${body}</button>`;
}

// 세트를 보기 좋은 순서로(맞는 세트면 줄은 숫자순, 그룹은 색순)
const arrange = (s) => readSet(s)?.order ?? s;

/* ---------- 그리기 ---------- */
function renderInfo() {
  if (!info) return;
  $('rw-xp').textContent = info.xp;
  $('rw-co').textContent = info.coins;
  $('dots').innerHTML = Array.from({ length: info.daily }, (_, i) => `<i class="${i < info.today ? 'on' : ''}"></i>`).join('');
  $('today').textContent = `${Math.min(info.today, info.daily)} / ${info.daily}`;
}

function render() {
  const g = game;
  const playing = g && (g.status === 'playing' || g.status === 'done');
  $('lobby').classList.toggle('hidden', !!playing);
  $('table').classList.toggle('hidden', !playing);
  $('hero').classList.toggle('hidden', !!playing);   // 판이 한 화면에 들어오게
  if (!playing) renderLobby();
  else renderTable();
}

function renderLobby() {
  const g = game;
  const waiting = g?.status === 'waiting';
  const open = !!info?.open;
  const seats = [0, 1, 2].map((s) => g?.players.find((p) => p.seat === s));
  // 대기 중이면 나를 맨 앞에
  if (waiting) seats.sort((a, b) => (b?.me ? 1 : 0) - (a?.me ? 1 : 0) || (a ? 0 : 1) - (b ? 0 : 1));
  setHTML($('seats'), seats.map((p) => p
    ? `<div class="rk-seat is-in pop"><div class="rk-seat-av">${avatarSVG(p.avatar, 72, { label: nameOf(p) })}</div><span>${esc(nameOf(p))}</span></div>`
    : `<div class="rk-seat"><div class="rk-seat-av rk-seat-empty${waiting ? ' wait' : ''}" aria-hidden="true">?</div><span class="muted">${waiting ? '기다리는 중' : '빈자리'}</span></div>`).join(''));
  $('lobby-h').textContent = '3명이 모이면 시작해요';
  $('lobby-s').textContent = waiting ? `${g.players.length} / 3` : '';
  $('find').classList.toggle('hidden', waiting);
  $('cancel').classList.toggle('hidden', !waiting);
  const used = !!info && info.today >= info.daily;
  $('find').disabled = busy || !open || used;
  $('cancel').disabled = busy;
  $('closed').classList.toggle('hidden', !info || open);
  $('limit').classList.toggle('hidden', !open || !used || waiting);
}

function renderTable() {
  const g = game;
  const mine = myTurn();
  const done = g.status === 'done' || g.left;
  const fr = mine ? fresh() : new Set();
  // 다른 사람이 방금 낸 타일
  const recent = new Set(!mine && g.last?.kind === 'play' && g.last.seat !== g.me ? g.last.tiles ?? [] : []);

  // 다른 사람: 내 다음 차례부터
  setHTML($('opps'), [1, 2].map((k) => player((g.me + k) % 3)).filter(Boolean).map((p) => {
    const turn = g.status === 'playing' && g.turn === p.seat;
    return `<div class="glass rk-opp${turn ? ' is-turn' : ''}${p.left ? ' is-left' : ''}">
      <div class="rk-opp-av">${avatarSVG(p.avatar, 52, { label: nameOf(p) })}</div>
      <div class="rk-opp-main">
        <b>${esc(nameOf(p))}</b>
        <span class="rk-opp-tags">
          <span class="rk-count num">${p.count}장</span>
          ${p.left ? '<span class="tag tag-off">나감</span>' : p.melded ? '' : '<span class="tag tag-off">첫 등록 전</span>'}
          ${turn ? '<span class="tag tag-pending">차례</span>' : ''}
        </span>
      </div>
      ${turn ? '<i class="rk-opp-bar" aria-hidden="true"><i></i></i>' : ''}
    </div>`;
  }).join(''));

  const turnP = player(g.turn);
  $('turn').textContent = done ? '끝' : mine ? '내 차례' : `${turnP ? nameOf(turnP) : ''} 차례`;
  $('turn').className = 'rk-turn' + (mine ? ' mine' : '');
  $('pool').textContent = `더미 ${g.pool}장`;
  $('last').textContent = lastText(g.last);

  // 판
  const bad = new Set();
  const sets = work.board.map((s, i) => {
    const r = readSet(s);
    if (!r) bad.add(i);
    const reps = r ? [...r.reps] : [];
    const tiles = (r ? r.order : s).map((t) => tileHTML(t, {
      cls: (fr.has(t) ? 'fresh' : '') + (recent.has(t) ? ' recent' : ''),
      rep: isJoker(t) && r ? reps.shift() : null,
      drag: mine && (g.melded || fr.has(t)),
    })).join('');
    const add = mine && sel.size ? `<button type="button" class="rk-add" data-add="${i}" aria-label="이 세트에 넣기">+</button>` : '';
    return `<div class="rk-set${r ? '' : ' bad'}${mine ? ' drop' : ''}" data-set="${i}">${tiles}${add}</div>`;
  });
  if (mine && sel.size) sets.push('<button type="button" class="rk-new" data-new="1">새 세트</button>');
  setHTML($('board'), sets.join('') || '<span class="rk-empty muted">판이 비어 있어요</span>');
  $('board').classList.toggle('drop', mine);

  // 내 손패
  const rack = rackOrder();
  const back = mine && [...sel].some((t) => fr.has(t));
  setHTML($('rack'), rack.map((t) => tileHTML(t, { drag: mine })).join('')
    + (back ? '<button type="button" class="rk-new rk-back" data-back="1">손패로</button>' : ''));
  $('rack').classList.toggle('drop', mine);
  $('me-meld').textContent = g.melded ? '등록함' : '첫 등록 전';
  $('me-meld').className = 'tag ' + (g.melded ? 'tag-done' : 'tag-off');

  // 힌트·버튼
  let hint = '';
  if (mine && !g.melded) {
    const meld = work.board.filter((s) => s.every((t) => fr.has(t))).reduce((a, s) => a + (readSet(s)?.value ?? 0), 0);
    hint = `첫 등록 ${meld} / ${FIRST_MELD}점`;
  } else if (mine && fr.size) hint = `낸 타일 ${fr.size}장`;
  $('hint').textContent = hint;
  $('play').disabled = !mine || busy || !fr.size || bad.size > 0;
  $('draw').disabled = !mine || busy;
  $('undo').disabled = !mine || busy || !changed();
  $('leave').disabled = busy || done;
  $('sort-run').disabled = done;
  $('sort-grp').disabled = done;
  $('table').classList.toggle('is-mine', mine);

  renderClock();
  renderResult();
}

function lastText(l) {
  if (!l || !game) return '';
  const p = player(l.seat);
  const who = p ? nameOf(p) : '';
  if (l.kind === 'play') return `${who} ${l.n}장 냄`;
  if (l.kind === 'draw') return `${who} 1장 가져감`;
  if (l.kind === 'timeout') return l.n ? `${who} 시간 초과 · 1장` : `${who} 시간 초과`;
  if (l.kind === 'pass') return `${who} 넘김`;
  if (l.kind === 'leave') return `${who} 나감`;
  return '';
}

// 손패 보여 주는 순서: 내가 정한 순서 + 새로 받은 타일은 뒤에
function rackOrder() {
  const have = new Set(work.rack);
  order = order.filter((t) => have.has(t));
  for (const t of work.rack) if (!order.includes(t)) order.push(t);
  return order;
}

/* ---------- 시계 ---------- */
let clockTimer = 0;
let dueTimer = 0;
function renderClock() {
  clearTimeout(clockTimer);
  const playing = game?.status === 'playing' && !game.left;
  if (!playing) {
    $('clock').textContent = '';
    return;
  }
  const left = Math.max(0, deadline - performance.now());
  const sec = Math.ceil(left / 1000);
  $('clock').textContent = `${sec}초`;
  $('clock').classList.toggle('warn', sec <= 10);
  const frac = Math.min(1, left / ((game.turn_sec || 60) * 1000));
  document.querySelectorAll('.rk-opp-bar > i').forEach((el) => { el.style.transform = `scaleX(${frac})`; });
  $('table').style.setProperty('--left', frac);
  if (left > 0) clockTimer = setTimeout(renderClock, 250);
}

/* ---------- 결과 ---------- */
const BITS = [['12%', '#2457E6', 0], ['28%', '#F59E0B', .5], ['46%', '#22C582', .2], ['64%', '#B79CFF', .8], ['82%', '#FF7A45', .35]];

function renderResult() {
  const g = game;
  const done = g.status === 'done' || g.left;
  $('result').classList.toggle('hidden', !done);
  if (!done) return;
  const winMe = g.status === 'done' && g.winner === g.me && !g.left;
  const w = player(g.winner);
  const card = $('result-card');
  card.className = 'omok-cover-card glass-strong pop rk-result' + (winMe ? ' is-win' : '');
  card.querySelectorAll('.confetti-bit').forEach((x) => x.remove());
  if (winMe) card.insertAdjacentHTML('afterbegin', BITS.map(([l, c, d]) => `<span class="confetti-bit" aria-hidden="true" style="left:${l};background:${c};--d:${d}s"></span>`).join(''));
  if (g.left) {
    $('result-h').textContent = '나간 판이에요';
    $('result-s').textContent = '';
  } else {
    $('result-h').textContent = winMe ? '1등!' : `${w ? nameOf(w) : ''} 1등`;
    $('result-s').textContent = g.reward ? `+${g.reward.xp} XP · +${g.reward.coins}코인`
      : winMe && g.end_reason === 'left' ? '모두 나가서 끝난 판은 보상이 없어요'
      : g.end_reason === 'pool' ? '타일이 다 떨어져 남은 점수로 정했어요' : '';
  }
  setHTML($('scores'), g.status === 'done' ? [...g.players].sort((a, b) => (b.seat === g.winner) - (a.seat === g.winner) || a.points - b.points).map((p) => `
    <div class="rk-score${p.seat === g.winner ? ' win' : ''}">
      <span>${esc(nameOf(p))}${p.left ? ' · 나감' : ''}</span><b class="num">${p.count}장 · ${p.points}점</b>
    </div>`).join('') : '');
  $('again').disabled = busy || !info?.open;

  if (shownEnd !== g.id) {
    shownEnd = g.id;
    if (avatarEl) react(avatarEl, winMe ? 'jump' : 'tilt');
    if (g.reward && g.reward.level_after > g.reward.level_before) setTimeout(() => showLevelUp(g.reward.level_after, g.reward.total_xp), 900);
  }
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

/* ---------- 규칙 ---------- */
function openHelp() {
  document.querySelectorAll('#help .rk-ex').forEach((el) => {
    const tiles = el.dataset.tiles.split(',').map(Number);
    const r = readSet(tiles);
    const reps = r ? [...r.reps] : [];
    setHTML(el, (r ? r.order : tiles).map((t) => tileHTML(t, { rep: isJoker(t) && r ? reps.shift() : null })).join(''));
  });
  if (info) {
    $('help-turn').textContent = info.turn;
    $('help-reward').textContent = `${info.xp} XP · ${info.coins}코인`;
    $('help-daily').textContent = info.daily;
  }
  $('help').showModal();
  const body = $('help').querySelector('.rk-help-body');
  body.scrollTop = 0;
  requestAnimationFrame(() => { body.scrollTop = 0; });
}
document.querySelectorAll('[data-help]').forEach((b) => b.addEventListener('click', openHelp));
for (const id of ['help-x', 'help-ok']) $(id).addEventListener('click', () => $('help').close());
$('help').addEventListener('click', (e) => { if (e.target === $('help')) $('help').close(); });

/* ---------- 서버 응답 반영 ---------- */
function apply(res) {
  if (!res) return;
  if (res.ok === false) {
    if (res.error === 'NO_SESSION') return relogin();
    if (res.state) apply(res.state);
    return;
  }
  const first = !info;
  info = res;
  renderInfo();
  if (first) {
    avatarEl = mountAvatar($('av'), res.avatar, 120, { label: '내 캐릭터', live: true });
    $('me-av').innerHTML = avatarSVG(res.avatar, 36, { label: '내 캐릭터' });
    $('v-game').classList.remove('hidden');
    if (!store.get('rk-help-seen')) {
      store.set('rk-help-seen', '1');
      openHelp();
    }
  }
  const g = res.game;
  if (!g) {
    // 끝난 판을 보고 있으면 그대로 둔다([한 판 더]를 누를 때까지)
    if (!(game && (game.status === 'done' || game.left))) {
      game = null;
      gameId = null;
      onGameRefresh(null);
    }
  } else {
    if (g.id !== gameId) {
      gameId = g.id;
      order = [];
      onGameRefresh(gameId, () => refresh());
    }
    const prevStatus = game?.status;
    if (!game || game.id !== g.id || game.version !== g.version || work.ver !== g.version) {
      work.board = g.board.map(arrange);
      work.rack = [...g.rack];
      work.ver = g.version;
      sel = new Set();
    }
    if (g.status === 'playing') deadline = performance.now() + (g.left_ms ?? 0);
    game = g;
    if (prevStatus === 'waiting' && g.status === 'playing' && avatarEl) react(avatarEl, 'jump');
    if (avatarEl) setWaiting(avatarEl, g.status === 'waiting');
  }
  render();
  schedule();
}

async function refresh() {
  if (!login) return;
  try {
    apply(await rkState(login.token, gameId));
  } catch (err) {
    console.error(err);
    if (!info) toast('불러오지 못했어요', 'error');
  }
}

// 버튼 하나에 요청 하나
async function send(job, { after } = {}) {
  if (busy) return;
  busy = true;
  render();
  try {
    const before = gameId;
    const res = await job();
    if (res?.ok === false) {
      if (res.error === 'NO_SESSION') return relogin();
      after?.(res);
      if (res.state) apply(res.state);
    } else {
      apply(res);
      // 같은 판 사람들에게 다시 읽으라는 신호(나간 판·새로 들어간 판 모두)
      for (const id of new Set([before, gameId])) sendGameRefresh(id);
    }
  } catch (err) {
    console.error(err);
    toast('연결을 확인해 주세요', 'error');
  } finally {
    busy = false;
    render();
  }
}

/* ---------- 판 찾기·나가기 ---------- */
$('find').addEventListener('click', () => send(() => rkJoin(login.token), { after: joinFail }));
$('again').addEventListener('click', () => {
  game = null;
  gameId = null;
  onGameRefresh(null);
  send(() => rkJoin(login.token), { after: joinFail });
});
function joinFail(res) {
  if (res.error === 'LIMIT') info = { ...info, today: res.today, daily: res.daily };
  else if (res.error === 'CLOSED') info = { ...info, open: false };
  else toast('시작하지 못했어요', 'error');
  renderInfo();
}
$('cancel').addEventListener('click', () => send(() => rkLeave(login.token, gameId)));
$('leave').addEventListener('click', () => {
  if (!confirm('나가면 이 판은 끝까지 할 수 없어요. 나갈까요?')) return;
  send(() => rkLeave(login.token, gameId));
});

/* ---------- 내 차례 ---------- */
const PLAY_ERR = {
  NONE: '타일을 한 장 이상 내야 해요',
  BAD_SET: '맞지 않는 세트가 있어요',
  LOST: '판에 있던 타일은 판에 남겨야 해요',
  NOT_MINE: '내 타일만 낼 수 있어요',
  FIRST_TOUCH: '첫 등록 전에는 판의 세트를 바꿀 수 없어요',
  FIRST_30: `첫 등록은 내 타일로 ${FIRST_MELD}점 이상이어야 해요`,
  NOT_TURN: '내 차례가 아니에요',
  STALE: '판이 바뀌었어요',
  OVER: '끝난 판이에요',
};

$('play').addEventListener('click', () => {
  if (!myTurn()) return;
  const chk = checkPlay(game.board, work.board, game.rack, game.melded);
  if (!chk.ok) {
    toast(PLAY_ERR[chk.error] ?? '낼 수 없어요', 'error');
    return;
  }
  const board = work.board.map((s) => [...s]);
  send(() => rkPlay(login.token, gameId, game.version, board), {
    after: (res) => toast(PLAY_ERR[res.error] ?? '낼 수 없어요', 'error'),
  });
});

$('draw').addEventListener('click', () => {
  if (!myTurn()) return;
  send(() => rkDraw(login.token, gameId, game.version), {
    after: (res) => toast(PLAY_ERR[res.error] ?? '가져오지 못했어요', 'error'),
  });
});

$('undo').addEventListener('click', () => {
  if (!game) return;
  work.board = game.board.map(arrange);
  work.rack = [...game.rack];
  sel = new Set();
  render();
});

$('sort-run').addEventListener('click', () => { order = sortRack(work.rack, '789'); render(); });
$('sort-grp').addEventListener('click', () => { order = sortRack(work.rack, '777'); render(); });

// 고를 수 있는 타일: 내 손패, 그리고 판에서는 첫 등록을 했으면 모두 / 안 했으면 이번에 낸 것만
function canPick(t) {
  if (!myTurn()) return false;
  if (work.rack.includes(t)) return true;
  return game.melded || fresh().has(t);
}

// 고른 타일을 옮기기. to = 세트 번호 | 'new' | 'rack'
function moveTo(to) {
  if (!myTurn() || !sel.size) return;
  const fr = fresh();
  let tiles = [...sel];
  if (to === 'rack') tiles = tiles.filter((t) => fr.has(t));   // 판에 있던 타일은 손패로 못 가져온다
  if (!tiles.length) return;
  const set = new Set(tiles);
  const target = typeof to === 'number' ? work.board[to] : null;
  work.rack = work.rack.filter((t) => !set.has(t));
  work.board = work.board.map((s) => s.filter((t) => !set.has(t)));
  if (to === 'rack') work.rack.push(...tiles);
  else if (to === 'new') work.board.push(tiles);
  else if (target) work.board[to] = [...work.board[to], ...tiles];
  work.board = work.board.filter((s) => s.length).map(arrange);
  sel = new Set();
  render();
}

function onTileClick(t) {
  if (!canPick(t)) return;
  if (sel.has(t)) sel.delete(t); else sel.add(t);
  render();
}

$('board').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) return moveTo(Number(add.dataset.add));
  if (e.target.closest('[data-new]')) return moveTo('new');
  const tile = e.target.closest('.rt');
  if (tile) return onTileClick(Number(tile.dataset.t));
});
$('rack').addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) return moveTo('rack');
  const tile = e.target.closest('.rt');
  if (tile) return onTileClick(Number(tile.dataset.t));
});

// 끌어다 놓기(마우스)
let dragging = false;
document.addEventListener('dragstart', (e) => {
  const tile = e.target.closest?.('.rt');
  if (!tile) return;
  const t = Number(tile.dataset.t);
  if (!canPick(t)) { e.preventDefault(); return; }
  if (!sel.has(t)) sel = new Set([t]);
  dragging = true;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(t));
  tile.classList.add('sel');
});
document.addEventListener('dragend', () => {
  if (dragging) { dragging = false; render(); }
});
function dropTarget(el) {
  const set = el.closest?.('[data-set]');
  if (set) return Number(set.dataset.set);
  if (el.closest?.('#rack')) return 'rack';
  if (el.closest?.('#board')) return 'new';
  return null;
}
document.addEventListener('dragover', (e) => {
  if (!dragging) return;
  const to = dropTarget(e.target);
  if (to === null) return;
  e.preventDefault();
  document.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on'));
  (e.target.closest('[data-set]') ?? e.target.closest('#rack') ?? e.target.closest('#board'))?.classList.add('drop-on');
});
document.addEventListener('drop', (e) => {
  if (!dragging) return;
  const to = dropTarget(e.target);
  document.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on'));
  if (to === null) return;
  e.preventDefault();
  dragging = false;
  moveTo(to);
});

/* ---------- 갱신 ---------- */
function relogin() {
  clearLogin();
  toast('다시 로그인해 주세요', 'error');
  setTimeout(() => location.replace('index.html'), 1200);
}

let pollTimer = 0;
function schedule() {
  clearTimeout(pollTimer);
  clearTimeout(dueTimer);
  const active = game && (game.status === 'waiting' || (game.status === 'playing' && !game.left));
  // 대기·대국 중에는 화면이 숨겨져도 '아직 있음'을 알린다(15초 넘게 소식이 없으면 대기에서 빠짐)
  const wait = active ? (document.hidden ? 5000 : 3000) : document.hidden ? 0 : 20000 + Math.random() * 3000;
  if (wait) pollTimer = setTimeout(refresh, wait);
  // 차례 시간이 끝나면 서버가 넘기도록(서버는 3초 더 기다림)
  if (game?.status === 'playing' && !game.left) {
    const left = deadline - performance.now();
    dueTimer = setTimeout(refresh, Math.max(0, left) + 3300);
  }
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
}
