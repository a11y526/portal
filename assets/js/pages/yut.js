// 윷놀이: 6개 반 전체에서 1대1(2명)·2대2 팀전(4명)으로 먼저 온 사람끼리 온라인 대전. 판은 서버가 들고 있다(yt_* 함수).
// 차례: [윷 던지기](윷·모·잡기면 한 번 더) → 나온 윷을 하나씩 골라 말을 움직인다. 쓸 수 없는 윷은 서버가 버린다.
// 갱신: 판 채널(yt-<판>) Broadcast 신호 + 대기·대국 중 2초마다 yt_state. 신호 내용은 믿지 않고 항상 다시 읽는다.
import { clsName } from '../config.js';
import { initUI, toast, esc } from '../ui.js';
import { ytState, ytJoin, ytLeave, ytPlay, onGameRefresh, sendGameRefresh, onClassRefresh } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { mountAvatar, avatarSVG, react, bindReactions, setWaiting } from '../avatar.js';
import { dest, route, XY, BIG, NAME, OFF, HOME } from '../yut.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const login = readLogin();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const TEAM_NAME = ['파랑', '주황'];
const nameOf = (p) => (p.me ? '나' : `${clsName(p.class_id)}반 ${p.nickname ?? '닉네임 미정'}`);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let info = null;        // yt_state 결과(game 빼고)
let game = null;
let gameId = null;
let avatarEl = null;
let busy = false;
let deadline = 0;
let shown = null;       // 결과를 띄운 판 번호
let sel = null;         // 고른 윷(results 안의 순서)
let hover = null;       // 미리 보는 말 번호
let seenLast = '';      // 연출한 마지막 일(같은 것을 두 번 연출하지 않게)

const me = () => game?.players.find((p) => p.me);
const player = (seat) => game?.players.find((p) => p.seat === seat);
const myTurn = () => game?.status === 'playing' && game.turn === game.me && !busy && !me()?.left;
const used = () => !!info && info.today >= info.daily;
const myTeam = () => game?.team ?? 0;
const teamPieces = (t) => [0, 1, 2, 3].map((k) => t * 4 + k);

/* ---------- 판 그리기 ---------- */
const svgNS = 'http://www.w3.org/2000/svg';
const LINES = [[0, 5], [5, 10], [10, 15], [15, 0], [5, 15], [10, 0]];

(function buildBoard() {
  const lines = LINES.map(([a, b]) => `<line class="yt-line" x1="${XY[a][0]}" y1="${XY[a][1]}" x2="${XY[b][0]}" y2="${XY[b][1]}"/>`).join('');
  let spots = '';
  for (let i = 0; i <= 28; i++) {
    const [x, y] = XY[i];
    spots += `<circle class="yt-spot${BIG.has(i) ? ' big' : ''}" data-spot="${i}" cx="${x}" cy="${y}" r="${BIG.has(i) ? 5.6 : 3.8}"/>`;
  }
  const arrow = '<path class="yt-start" d="M106 97 L106 88 M103.5 90.5 L106 87.5 L108.5 90.5"/>';
  $('board').innerHTML = `${lines}${spots}${arrow}<text class="yt-label" x="100" y="111" text-anchor="middle">참먹이</text>`
    + '<g id="marks"></g><g id="pieces"></g>';
})();

// 판 위 말 무리: { key: '팀-자리', team, pos, ids: [말 번호…] }
function groups(pieces) {
  const m = new Map();
  pieces.forEach((pos, i) => {
    if (pos < 0 || pos > 28) return;
    const team = i >> 2;
    const k = `${team}-${pos}`;
    if (!m.has(k)) m.set(k, { key: k, team, pos, ids: [] });
    m.get(k).ids.push(i);
  });
  return [...m.values()];
}

const curVal = () => (sel != null && game?.results?.[sel] != null ? game.results[sel] : null);
const canPick = () => myTurn() && game.throws === 0 && curVal() != null;
// 그 말을 지금 고른 윷으로 움직일 수 있는지
const movable = (i) => canPick() && (i >> 2) === myTeam() && dest(game.pieces[i], curVal()) != null;

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
  if (waiting) {
    const ps = game.players;
    const seats = ps.map((p) => `<div class="rk-seat is-in"><div class="rk-seat-av">${avatarSVG(p.avatar, 72, { label: nameOf(p) })}</div><span>${esc(nameOf(p))}</span></div>`);
    for (let i = ps.length; i < game.size; i++) seats.push('<div class="rk-seat"><div class="rk-seat-av rk-seat-empty wait" aria-hidden="true">?</div><span class="muted">찾는 중</span></div>');
    $('seats').innerHTML = seats.join('');
    $('lobby-h').textContent = `${game.size === 2 ? '1대1' : '2대2'} · ${ps.length} / ${game.size}명 모였어요`;
  } else {
    $('seats').innerHTML = `<div class="rk-seat is-in"><div class="rk-seat-av">${avatarSVG(info?.avatar, 72, { label: '나' })}</div><span>나</span></div>`;
    $('lobby-h').textContent = '어떻게 할까요?';
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

// 업힌 말이 여럿이면 숫자, 같은 자리에 두 편이 있을 수는 없다(잡히므로)
function pieceTag(g, mine) {
  const [x, y] = XY[g.pos];
  const can = mine && g.ids.some(movable);
  return `<g class="yt-piece t${g.team}${can ? ' can' : ''}${hover != null && g.ids.includes(hover) ? ' hover' : ''}" data-piece="${g.ids[0]}"
    style="transform: translate(${x}px, ${y}px)" ${can ? 'role="button" tabindex="0"' : ''} aria-label="${TEAM_NAME[g.team]} 말${g.ids.length > 1 ? ` ${g.ids.length}개 업힘` : ''}">
    <circle class="yt-piece-hit" r="6.5"/><circle class="yt-piece-c" r="4.4"/>
    ${g.ids.length > 1 ? `<text class="yt-piece-n" y="1.7" text-anchor="middle">${g.ids.length}</text>` : ''}
  </g>`;
}

function renderTable() {
  const g = game;
  const done = g.status === 'done';
  const mine = myTurn();
  if (sel != null && (sel >= g.results.length || g.throws > 0)) sel = null;
  if (mine && g.throws === 0 && g.results.length && sel == null) sel = 0;

  // 말
  $('pieces').innerHTML = groups(g.pieces).map((x) => pieceTag(x, x.team === myTeam())).join('');

  // 미리 보기: 마우스를 올린 말이 갈 칸과 길
  let marks = '';
  if (hover != null && movable(hover)) {
    const from = g.pieces[hover];
    const to = dest(from, curVal());
    if (curVal() > 0) {
      const path = route(from).slice(0, curVal()).filter((p) => p !== undefined);
      marks += path.slice(0, -1).map((p) => `<circle class="yt-step" cx="${XY[p][0]}" cy="${XY[p][1]}" r="1.4"/>`).join('');
    }
    if (to === HOME) marks += `<text class="yt-out" x="${XY[0][0]}" y="${XY[0][1] - 8}" text-anchor="middle">나감</text>`;
    else if (to != null) marks += `<circle class="yt-to t${myTeam()}" cx="${XY[to][0]}" cy="${XY[to][1]}" r="6.4"/>`;
  }
  if (g.last?.kind === 'move' && g.status === 'playing' && g.last.to >= 0 && g.last.to <= 28) {
    marks = `<circle class="yt-recent" cx="${XY[g.last.to][0]}" cy="${XY[g.last.to][1]}" r="7.6"/>` + marks;
  }
  $('marks').innerHTML = marks;

  // 차례·시계
  const tp = player(g.turn);
  const ourTurn = !done && tp && tp.team === myTeam();
  $('turn').textContent = done ? resultTitle(g) : mine ? '내 차례' : busy ? '보내는 중' : tp ? `${nameOf(tp)} 차례${g.size === 4 && ourTurn ? ' · 우리 편' : ''}` : '';
  $('turn').className = 'omok-turn' + (done && g.winner === myTeam() ? ' won' : '') + (!done && !mine ? ' thinking' : '');
  $('last').textContent = lastText(g);

  // 던지기·윷
  const canThrow = mine && g.throws > 0;
  $('throw').disabled = !canThrow;
  $('throw').textContent = canThrow && g.results.length ? '한 번 더 던지기' : '윷 던지기';
  $('throw').classList.toggle('hidden', done);
  $('results').innerHTML = g.results.map((v, i) => `<button type="button" class="yt-res press${i === sel && mine && g.throws === 0 ? ' on' : ''}${v === -1 ? ' back' : ''}"
      data-i="${i}" ${mine && g.throws === 0 ? '' : 'disabled'} aria-pressed="${i === sel}">${NAME[v]}</button>`).join('');
  $('hint').textContent = done ? '' : !mine ? '' : g.throws > 0 ? (g.results.length ? '한 번 더 던져요' : '윷을 던지세요')
    : g.results.length > 1 ? '쓸 윷을 고르고 움직일 말을 누르세요' : '움직일 말을 누르세요';

  // 말 상자(안 나간 말 · 난 말)
  $('trays').innerHTML = [myTeam(), 1 - myTeam()].map((t) => {
    const off = teamPieces(t).filter((i) => g.pieces[i] === OFF);
    const home = teamPieces(t).filter((i) => g.pieces[i] === HOME).length;
    const can = t === myTeam() && off.some(movable);
    return `<div class="glass yt-tray t${t}">
      <b>${t === myTeam() ? (g.size === 4 ? '우리 편' : '내 말') : (g.size === 4 ? '상대 편' : '상대 말')}</b>
      <span class="yt-tray-dots" aria-label="안 나간 말 ${off.length}개">${off.map(() => '<i></i>').join('')}</span>
      <span class="muted">난 말 <b class="num">${home}</b> / 4</span>
      ${t === myTeam() && !done ? `<button type="button" class="btn btn-line btn-small press yt-new" data-piece="${off[0] ?? ''}" ${can ? '' : 'disabled'}>새 말</button>` : ''}
    </div>`;
  }).join('');

  // 사람
  $('players').innerHTML = [...g.players].sort((a, b) => a.seat - b.seat).map((p) => `
    <div class="rk-opp glass${!done && g.turn === p.seat ? ' is-turn' : ''}${p.left ? ' is-left' : ''}">
      <span class="yt-chip t${p.team}" aria-label="${TEAM_NAME[p.team]} 편"></span>
      <div class="rk-opp-av">${avatarSVG(p.avatar, 44, { label: nameOf(p) })}</div>
      <div class="rk-opp-main"><b>${esc(nameOf(p))}</b><span class="muted">${p.left ? '나감' : g.size === 4 ? (p.team === myTeam() ? '우리 편' : '상대 편') : TEAM_NAME[p.team]}</span></div>
      ${!done && g.turn === p.seat ? '<div class="rk-opp-bar"><i></i></div>' : ''}
    </div>`).join('');

  $('resign').classList.toggle('hidden', done || !!me()?.left);
  $('resign').disabled = busy;
  $('again2').classList.toggle('hidden', !(done || me()?.left));
  $('again2').disabled = busy || !info?.open || used();
  $('again').disabled = busy || !info?.open || used();
  renderClock();
}

function lastText(g) {
  const l = g.last;
  if (!l || g.status !== 'playing') return '';
  const p = player(l.seat);
  const who = p ? nameOf(p) : '';
  const auto = l.auto ? ' (시간 초과로 대신)' : '';
  if (l.kind === 'throw') return `방금: ${who} ${NAME[l.value]}${l.value >= 4 ? ' · 한 번 더' : ''}${auto}`;
  if (l.kind === 'move') {
    const what = l.to === HOME ? (l.n > 1 ? `말 ${l.n}개 나감` : '말 나감') : l.n > 1 ? `업은 말 ${l.n}개 이동` : '말 이동';
    return `방금: ${who} ${NAME[l.value]}로 ${what}${l.caught ? ` · ${l.caught}개 잡음` : ''}${auto}`;
  }
  if (l.kind === 'leave') return `방금: ${who} 나감`;
  return '';
}

function resultTitle(g) {
  const won = g.winner === myTeam();
  if (me()?.left && !won) return '나간 판이에요';
  if (g.size === 4) return won ? '우리 편 승리!' : '상대 편 승리';
  if (won) return '승리!';
  const w = g.players.find((p) => p.team === g.winner);
  return w ? `${nameOf(w)} 승리` : '끝';
}

function resultSub(g) {
  const won = g.winner === myTeam();
  if (g.reward) return `+${g.reward.silver ?? 0}은화`;
  if (g.end_reason === 'left') return won ? '상대가 나가서 끝난 판은 보상이 없어요' : '';
  if (won && (info?.rewarded ?? 0) >= (info?.reward_daily ?? 1)) return '오늘 보상은 다 받았어요';
  return '';
}

/* ---------- 윷가락 ---------- */
// sticks[i] = 1이면 배(평평한 쪽)가 위. 첫 윷가락 배에 빽도 표시(빨간 점)
function sticksSVG(st, tossing = false) {
  return (st ?? [1, 0, 1, 0]).map((up, i) => `
    <svg class="yt-stick${up ? ' up' : ''}${tossing ? ' toss' : ''}" style="--i:${i}" viewBox="0 0 20 72" aria-hidden="true">
      <rect x="2" y="2" width="16" height="68" rx="8" class="yt-stick-b"/>
      ${up ? (i === 0 ? '<circle cx="10" cy="36" r="3.2" class="yt-stick-mark"/>' : '')
           : '<path d="M6 16 L14 24 M14 16 L6 24 M6 48 L14 56 M14 48 L6 56" class="yt-stick-x"/>'}
    </svg>`).join('');
}

function showThrow(l) {
  const box = $('sticks');
  box.innerHTML = sticksSVG(l.sticks, !reduced);
  const label = `${NAME[l.value]}${l.value >= 4 ? '! 한 번 더' : l.value === -1 ? '! 한 칸 뒤로' : ''}`;
  $('got').textContent = '';
  setTimeout(() => {
    $('got').textContent = label;
    $('got').className = 'yt-got pop' + (l.value >= 4 ? ' big' : l.value === -1 ? ' back' : '');
  }, reduced ? 0 : 650);
}

/* ---------- 시계 ---------- */
let clockTimer = 0;
function renderClock() {
  clearTimeout(clockTimer);
  if (game?.status !== 'playing') { $('clock').textContent = ''; return; }
  const left = Math.max(0, deadline - performance.now());
  const sec = Math.min(game.turn_sec, Math.ceil(left / 1000));
  $('clock').textContent = `${sec}초`;
  $('clock').classList.toggle('warn', sec <= 5);
  const frac = Math.min(1, left / (game.turn_sec * 1000));
  document.querySelectorAll('.om-players .rk-opp-bar > i').forEach((el) => { el.style.transform = `scaleX(${frac})`; });
  if (left > 0) clockTimer = setTimeout(renderClock, 250);
}

/* ---------- 결과 ---------- */
const BITS = [['12%', '#2457E6', 0], ['28%', '#F59E0B', .5], ['46%', '#22C582', .2], ['64%', '#B79CFF', .8], ['82%', '#FF7A45', .35]];

function showResult(g) {
  const win = g.winner === myTeam() && !me()?.left;
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

/* ---------- 규칙 탭 그림 ---------- */
function miniBoard({ pieces = [], to = [], path = [], label = '' } = {}) {
  const lines = LINES.map(([a, b]) => `<line class="yt-line" x1="${XY[a][0]}" y1="${XY[a][1]}" x2="${XY[b][0]}" y2="${XY[b][1]}"/>`).join('');
  let spots = '';
  for (let i = 0; i <= 28; i++) spots += `<circle class="yt-spot${BIG.has(i) ? ' big' : ''}" cx="${XY[i][0]}" cy="${XY[i][1]}" r="${BIG.has(i) ? 5.6 : 3.8}"/>`;
  return `<svg class="yt-board" viewBox="-9 -9 118 118" aria-hidden="true">${lines}${spots}
    ${path.map((p) => `<circle class="yt-step" cx="${XY[p][0]}" cy="${XY[p][1]}" r="1.8"/>`).join('')}
    ${to.map(([p, t]) => `<circle class="yt-to t${t}" cx="${XY[p][0]}" cy="${XY[p][1]}" r="6.4"/>`).join('')}
    ${pieces.map(([p, t, n]) => `<g class="yt-piece t${t}" style="transform: translate(${XY[p][0]}px, ${XY[p][1]}px)"><circle class="yt-piece-c" r="4.4"/>${n > 1 ? `<text class="yt-piece-n" y="1.7" text-anchor="middle">${n}</text>` : ''}</g>`).join('')}
    ${label}</svg>`;
}
const MINI = {
  goal: () => miniBoard({ pieces: [[0, 0, 1]], path: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], label: '<path class="yt-start" d="M106 97 L106 88 M103.5 90.5 L106 87.5 L108.5 90.5"/>' }),
  sticks: () => `<div class="yt-sticks">${sticksSVG([1, 1, 1, 0])}</div><b class="yt-mini-cap">걸</b>`,
  back: () => `<div class="yt-sticks">${sticksSVG([1, 0, 0, 0])}</div><b class="yt-mini-cap back">빽도</b>`,
  short: () => miniBoard({ pieces: [[5, 0, 1]], path: [20, 21, 22], to: [[23, 0]] }),
  catch: () => miniBoard({ pieces: [[3, 0, 2], [6, 1, 1]], path: [4, 5], to: [[6, 0]] }),
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
    $('help-reward').textContent = `${info.silver ?? 0}은화`;
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
    if (!store.get('yt-help-seen')) {
      store.set('yt-help-seen', '1');
      setTab('rules');
    } else {
      setTab(tab);
    }
  }
  if (!g) {
    if (!(game && (game.status === 'done' || me()?.left))) {
      game = null;
      gameId = null;
      onGameRefresh(null);
    }
  } else {
    if (g.id !== gameId) {
      gameId = g.id;
      sel = null;
      hover = null;
      seenLast = '';
      $('sticks').innerHTML = sticksSVG(null);
      $('got').textContent = '';
      onGameRefresh(gameId, () => refresh(), 'yt-');
    }
    const prev = game?.id === g.id ? game.status : null;
    if (g.status === 'playing') deadline = performance.now() + (g.left_ms ?? 0);
    // 같은 판 버전이 그대로면 고른 윷은 그대로
    if (game?.id === g.id && game.version !== g.version) { sel = null; hover = null; }
    game = g;
    // 새 던지기·잡기 연출
    const key = g.last ? `${g.version}:${JSON.stringify(g.last)}` : '';
    if (g.last && key !== seenLast) {
      const firstSeen = !seenLast;
      seenLast = key;
      if (g.last.kind === 'throw' && !firstSeen) showThrow(g.last);
      else if (g.last.kind === 'throw') { $('sticks').innerHTML = sticksSVG(g.last.sticks); $('got').textContent = NAME[g.last.value]; }
      if (g.last.kind === 'move' && g.last.caught && !firstSeen) {
        const mineCaught = (g.last.seat === g.me) || (player(g.last.seat)?.team === myTeam());
        toast(mineCaught ? `잡았어요! 한 번 더` : '말을 잡혔어요', mineCaught ? 'ok' : 'error');
        if (avatarEl) react(avatarEl, mineCaught ? 'jump' : 'tilt');
      }
    }
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
    apply(await ytState(login.token, gameId));
  } catch (err) {
    console.error(err);
    if (!info) toast('불러오지 못했어요', 'error');
    schedule();
  }
}

const FAIL = {
  BAD_MOVE: '그 말은 움직일 수 없어요',
  BAD_PIECE: '우리 편 말이 아니에요',
  BAD_VALUE: '쓸 수 있는 윷이 아니에요',
  THROW_FIRST: '먼저 윷을 던지세요',
  NO_THROW: '지금은 던질 수 없어요',
  NOT_TURN: '내 차례가 아니에요',
};
const failToast = (res) => { if (FAIL[res.error]) toast(FAIL[res.error], 'error'); };

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
    sendGameRefresh(gameId ?? gid, 'yt-');
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
$('throw').addEventListener('click', () => {
  if (!myTurn() || game.throws <= 0) return;
  if (!reduced) $('sticks').innerHTML = sticksSVG(game.last?.kind === 'throw' ? game.last.sticks : null, true);
  send(() => ytPlay(login.token, game.id, 'throw'), failToast);
});

$('results').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b || b.disabled) return;
  sel = Number(b.dataset.i);
  render();
});

function movePiece(i) {
  if (!movable(i)) {
    if (canPick() && (i >> 2) === myTeam()) toast(FAIL.BAD_MOVE, 'error');
    return;
  }
  const v = curVal();
  hover = null;
  send(() => ytPlay(login.token, game.id, 'move', i, v), failToast);
}

$('board').addEventListener('click', (e) => {
  const p = e.target.closest('[data-piece]');
  if (p) movePiece(Number(p.dataset.piece));
});
$('board').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const p = e.target.closest('[data-piece]');
  if (p) { e.preventDefault(); movePiece(Number(p.dataset.piece)); }
});
$('board').addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const p = e.target.closest('[data-piece]');
  const h = p ? Number(p.dataset.piece) : null;
  if (h !== hover) { hover = h; renderTable(); }
});
$('board').addEventListener('pointerleave', () => { if (hover != null) { hover = null; if (game) renderTable(); } });
$('trays').addEventListener('click', (e) => {
  const b = e.target.closest('.yt-new');
  if (b && b.dataset.piece !== '') movePiece(Number(b.dataset.piece));
});
$('trays').addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const b = e.target.closest('.yt-new');
  const h = b && b.dataset.piece !== '' ? Number(b.dataset.piece) : null;
  if (h !== hover && (h == null || movable(h))) { hover = h; renderTable(); }
});

function findGame(size) {
  $('result').classList.add('hidden');
  game = null;
  gameId = null;
  onGameRefresh(null);
  send(() => ytJoin(login.token, size), (res) => {
    if (res.error === 'LIMIT') info = { ...info, today: res.today, daily: res.daily };
    else if (res.error === 'CLOSED') info = { ...info, open: false };
    else toast('판을 찾지 못했어요', 'error');
    renderInfo();
  });
}

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
$('cancel').addEventListener('click', () => { if (gameId) send(() => ytLeave(login.token, gameId)); });
$('resign').addEventListener('click', () => {
  if (!gameId || game?.status !== 'playing') return;
  if (!confirm(game.size === 2 ? '기권할까요? 상대가 이긴 것으로 끝나요.' : '기권할까요? 우리 편 친구가 혼자 이어서 해요(둘 다 나가면 상대 편이 이겨요).')) return;
  send(() => ytLeave(login.token, gameId));
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
  const wait = activeGame ? (document.hidden ? 5000 : 2000) : document.hidden ? 0 : 20000 + Math.random() * 3000;
  if (wait) pollTimer = setTimeout(refresh, wait);
  if (game?.status === 'playing') dueTimer = setTimeout(refresh, Math.max(0, deadline - performance.now()) + 2300);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && login) refresh();
  else schedule();
});

/* ---------- 시작 ---------- */
$('sticks').innerHTML = sticksSVG(null);
if (!login) {
  setTab('game');
} else {
  await refresh();
  try { onClassRefresh(login.class_id, () => refresh()); } catch {}
}
