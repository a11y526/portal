// 퀴즈 배틀: 그날 모둠끼리 오늘 차시 학습지의 빈칸·고르기·부등호를 한 문제씩 함께 푼다.
// 선생님이 수업 모드에서 열었을 때만. 모둠마다 한 판, 끝나면 모둠 안 1등(동점이면 모두)이 XP·금화.
// 진행은 모두 서버 시각(qb_state의 남은 ms)으로. 판 채널(qb-<판>) Broadcast 신호 + 2초마다 qb_state. 신호 내용은 믿지 않는다.
import { initUI, toast, esc, groupName } from '../ui.js';
import { sb, qbState, qbJoin, qbStart, qbLeave, qbAnswer, onGameRefresh, sendGameRefresh, onClassRefresh } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { avatarSVG, react, bindReactions } from '../avatar.js';
import { sanitize } from '../worksheet.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const PLAY_MS = 2000;     // 대기실·문제 중 다시 읽기
const IDLE_MS = 6000;     // 판이 없거나 끝났을 때
const WAIT_MS = 10000;    // 답을 보내고 기다리는 최대 시간
const TYPE = { blank: '단어 빈칸', choice: '고르기', sym: '부등호' };
const ERR = {
  CLOSED: '선생님이 퀴즈 배틀을 닫았어요',
  NO_GROUP: '오늘 모둠 명단에 없어요',
  NO_ITEMS: '오늘 차시에 낼 문제가 없어요',
  NOT_PLAYER: '먼저 들어가기를 눌러 주세요',
  TIMEOUT: '응답이 없어요. 다시 내 주세요',
};

let login = readLogin();
let st = null;          // qb_state 결과
let busy = false;       // 들어가기·시작·나가기·답 보내는 중
let deadline = 0;       // 지금 단계가 끝나는 시각(performance.now 기준)
let span = 1;           // 지금 단계 길이(ms, 타이머 막대용)
let shownQ = null;      // 화면에 그린 문제 '판|번호|단계'
let reacted = null;     // 캐릭터 반응을 한 문제
let draft = '';         // 빈칸에 쓰는 중인 답
let netDown = false;

if (login) {
  $('back').href = `class.html?c=${login.class_id}`;
  $('result-back').href = `class.html?c=${login.class_id}`;
}

const nameOf = (p) => (p.me ? '나' : p.nickname || '닉네임 미정');
const withTimeout = (p, ms) => {
  let t;
  return Promise.race([p.finally(() => clearTimeout(t)), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('TIMEOUT')), ms); })]);
};
function setHTML(el, html) {
  if (el._html === html) return false;
  el._html = html;
  el.innerHTML = html;
  return true;
}

/* ---------- 화면 고르기 ---------- */
function showMsg(text, btn) {
  $('v-msg').classList.remove('hidden');
  $('v-lobby').classList.add('hidden');
  $('v-table').classList.add('hidden');
  $('msg-t').textContent = text;
  $('msg-btn').textContent = btn === 'login' ? '로그인' : '반 페이지로';
  $('msg-btn').href = btn === 'login' || !login ? 'index.html' : `class.html?c=${login.class_id}`;
}

function render() {
  if (!login) return showMsg('로그인하면 할 수 있어요', 'login');
  if (!st) return;
  const g = st.game;
  if (!g || g.status === 'lobby') {
    if (st.group_no == null) return showMsg(st.board_id ? '오늘 모둠 명단에 없어요' : '오늘 수업이 아직 없어요');
    if (!st.open) return showMsg('지금은 퀴즈 배틀이 닫혀 있어요');
    if (!st.count) return showMsg('오늘 차시에 낼 문제가 없어요');
    $('v-msg').classList.add('hidden');
    $('v-lobby').classList.remove('hidden');
    $('v-table').classList.add('hidden');
    return renderLobby();
  }
  $('v-msg').classList.add('hidden');
  $('v-lobby').classList.add('hidden');
  $('v-table').classList.remove('hidden');
  renderTable();
}

/* ---------- 대기실 ---------- */
function renderLobby() {
  const list = st.members ?? [];
  const joined = list.filter((m) => m.joined);
  const ready = joined.filter((m) => m.online);
  const meIn = list.some((m) => m.me && m.joined);
  if (!$('hero-av')._done) { $('hero-av').innerHTML = avatarSVG(st.avatar, 112, { label: '내 캐릭터', live: true }); $('hero-av')._done = true; }
  $('group-chip').textContent = `${groupName(st.group_no)} · ${st.lesson_code}차시 (${st.count}문제)`;
  $('rw-xp').textContent = st.xp;
  $('rw-co').textContent = st.coins;
  setHTML($('seats'), list.map((m) => {
    const on = m.joined && m.online;
    return `<div class="qb-seat ${on ? 'is-in' : 'is-wait'}">
      <div class="qb-seat-av">${avatarSVG(m.avatar, 72, { label: nameOf(m) })}</div>
      <span class="qb-seat-name">${esc(nameOf(m))}</span>
      <span class="tag ${on ? 'tag-done' : 'tag-off'}">${on ? '준비 완료' : '기다리는 중'}</span>
    </div>`;
  }).join(''));
  $('lobby-h').textContent = `우리 모둠 ${ready.length} / ${list.length}명 모였어요`;
  $('lobby-s').textContent = `${st.lesson_code}차시 학습지 빈칸·고르기·부등호 ${st.count}문제`;
  $('join').classList.toggle('hidden', meIn);
  $('start').classList.toggle('hidden', !meIn);
  $('leave').classList.toggle('hidden', !meIn);
  $('start').textContent = ready.length >= list.length ? '모두 모였어요 · 시작' : `지금 시작 (${ready.length}명)`;
  $('join').disabled = $('start').disabled = $('leave').disabled = busy;
}

/* ---------- 문제 ---------- */
// 학습지 쪽 html에서 지금 칸이 든 문장(가장 가까운 문항 상자·표 줄)만 잘라 칸을 표시한다
// 앞에서 푼 칸은 초록 정답, 지금 칸은 파랑 ?(공개 뒤 초록 정답), 뒤에 나올 칸은 회색 '다음 빈칸', 문제가 아닌 칸은 회색 …
const CTX = '.w-q, .w-item, .w-qline, .w-ineq, li, p, .w-box';
function contextHTML(it, phase) {
  const tpl = document.createElement('template');
  tpl.innerHTML = it.html || '';
  const wrap = document.createElement('div');
  wrap.append(tpl.content);
  sanitize(wrap, { prefix: false });
  wrap.querySelectorAll('.w-sim, img').forEach((e) => e.remove());
  const target = wrap.querySelector(`[data-ws="${CSS.escape(it.key)}"]`);
  let box = wrap;
  if (target) {
    const row = target.closest('tr');
    if (row) {
      // 표: 머리 줄과 이 줄만
      const table = row.closest('table');
      const first = table.rows[0];
      const head = table.querySelector('thead tr') ?? (first !== row && first?.querySelector('th') ? first : null);
      const t = document.createElement('table');
      t.className = 'qb-ctx-table';
      if (head) t.append(head.cloneNode(true));
      t.append(row.cloneNode(true));
      box = document.createElement('div');
      box.append(t);
    } else {
      const near = target.parentElement?.closest(CTX);
      if (near && wrap.contains(near)) box = near;
    }
  }
  const later = new Set(it.later ?? []);
  const revealed = phase === 'reveal';
  box.querySelectorAll('[data-ws]').forEach((m) => {
    const k = m.dataset.ws;
    const s = document.createElement('span');
    if (k === it.key) {
      s.className = `qb-slot-target${revealed ? ' is-reveal' : ''}`;
      s.textContent = revealed ? (it.answer ?? []).join(' / ') : '?';
    } else if (it.solved && k in it.solved) {
      s.className = 'qb-slot-solved';
      s.textContent = it.solved[k];
    } else {
      s.className = 'qb-slot-later';
      s.textContent = later.has(k) ? '다음 빈칸' : '…';
    }
    m.replaceWith(s);
  });
  const html = (box === wrap ? wrap.innerHTML : box.outerHTML).trim();
  if (html && target) return html;
  // 칸을 찾지 못하면(학습지를 다시 올림) 칸만
  return `<span class="qb-slot-target${revealed ? ' is-reveal' : ''}">${revealed ? esc((it.answer ?? []).join(' / ')) : '?'}</span>`;
}

function renderPlayers(g) {
  const reveal = g.phase === 'reveal';
  setHTML($('players'), g.players.map((p) => {
    const tag = g.status === 'done' ? ''
      : reveal ? (p.ok === true ? '<span class="tag tag-done">정답</span>' : p.answered ? '<span class="tag tag-warn">오답</span>' : '<span class="tag tag-off">안 냄</span>')
      : g.phase === 'ask' ? (p.answered ? '<span class="tag tag-done">냈음</span>' : '<span class="tag tag-off">푸는 중</span>')
      : '';
    const gain = reveal && p.ok === true ? '<span class="qb-p-gain">+10점</span>' : '';
    return `<div class="glass qb-p${p.me ? ' is-me' : ''}${p.online ? '' : ' is-off'}${p.answered || reveal ? ' is-done' : ''}">
      ${gain}
      <div class="qb-p-av">${avatarSVG(p.avatar, 48, { label: nameOf(p) })}</div>
      <div class="qb-p-main">
        <div class="qb-p-top"><b>${esc(nameOf(p))}</b>${tag}</div>
        <span class="qb-p-pts num">${p.correct * 10}점</span>
      </div>
    </div>`;
  }).join(''));
  const key = `${g.id}|${g.q}`;
  if (reveal && reacted !== key) {
    reacted = key;
    $('players').querySelectorAll('svg.av').forEach((svg, i) => react(svg, g.players[i]?.ok ? 'jump' : 'returned', { delay: i * 90 }));
  }
}

function renderTable() {
  const g = st.game;
  renderPlayers(g);
  if (g.status === 'done') return renderResult(g);
  $('v-result').classList.add('hidden');
  document.querySelector('.qb-card').classList.remove('is-over');
  $('bar').classList.remove('hidden');
  const it = g.item;
  if (!it) return;
  const mine = it.mine?.answer ?? null;
  $('q-num').textContent = `문제 ${it.no} / ${it.total}`;
  setHTML($('q-dots'), it.total <= 40
    ? Array.from({ length: it.total }, (_, i) => `<i class="${i < it.no - 1 ? 'done' : i === it.no - 1 ? 'now' : ''}"></i>`).join('') : '');
  $('q-type').textContent = TYPE[it.type] ?? '';
  $('q-title').textContent = [it.slide ? `수업자료 ${it.slide}쪽` : '', it.title].filter(Boolean).join(' · ');

  const key = `${g.id}|${g.q}|${g.phase}`;
  const fresh = key !== shownQ;
  if (fresh) {
    if (!shownQ || !shownQ.startsWith(`${g.id}|${g.q}|`)) draft = '';
    shownQ = key;
  }

  if (g.phase === 'ready') {
    setHTML($('q-body'), '<div class="qb-ready"><b class="num" id="q-count"></b></div>');
    setHTML($('q-ans'), '');
    $('q-status').textContent = '';
    return;
  }
  setHTML($('q-body'), contextHTML(it, g.phase));

  const answered = mine != null;
  const lockAll = g.phase !== 'ask' || answered || busy;
  if (it.type === 'blank') {
    const reveal = g.phase === 'reveal';
    const cls = reveal && answered ? (it.mine.ok ? ' is-right' : ' is-wrong') : '';
    const val = answered ? mine : draft;
    const html = `<form class="qb-blank-form" id="blank-form" autocomplete="off">
        <input type="text" class="qb-blank-in${cls}" id="blank-in" maxlength="100" aria-label="빈칸 답"${lockAll ? ' disabled' : ''}>
        <button type="submit" class="btn btn-primary btn-big press" id="blank-go"${lockAll ? ' disabled' : ''}>${answered ? '냈음' : busy ? '보내는 중' : '내기'}</button>
      </form>`;
    if (setHTML($('q-ans'), html)) {
      $('blank-in').value = val;
      if (!lockAll) $('blank-in').focus();
    }
  } else {
    setHTML($('q-ans'), `<div class="qb-choices">${(it.options ?? []).map((o) => {
      const right = g.phase === 'reveal' && (it.answer ?? []).includes(o);
      const wrong = g.phase === 'reveal' && mine === o && !right;
      const cls = right ? ' is-right' : wrong ? ' is-wrong' : mine === o ? ' is-picked' : '';
      return `<button type="button" class="qb-opt press${cls}" data-v="${esc(o)}" aria-pressed="${mine === o}"${lockAll ? ' disabled' : ''}>${esc(o)}</button>`;
    }).join('')}</div>`);
  }

  const n = g.players.filter((p) => p.answered).length;
  if (g.phase === 'ask') $('q-status').textContent = answered ? `${n} / ${g.players.length}명 냈어요` : '';
  else if (g.phase === 'reveal') {
    const me = it.mine;
    $('q-status').textContent = `정답 ${(it.answer ?? []).join(' / ')}${me ? (me.ok ? ' · 맞혔어요' : ' · 틀렸어요') : ' · 못 냈어요'}`;
  }
}

/* ---------- 결과 ---------- */
const BITS = [['12%', '#2457E6', 0], ['28%', '#F59E0B', .5], ['46%', '#22C582', .2], ['64%', '#B79CFF', .8], ['82%', '#FF7A45', .35]];
function renderResult(g) {
  $('v-result').classList.remove('hidden');
  document.querySelector('.qb-card').classList.add('is-over');
  $('bar').classList.add('hidden');
  $('q-num').textContent = '끝';
  $('q-clock').textContent = '';
  $('q-type').textContent = '';
  $('bar').style.setProperty('--left', 0);
  const list = [...g.players].sort((a, b) => b.correct - a.correct);
  const top = list[0]?.correct ?? 0;
  let rank = 0;
  let prev = null;
  const rows = list.map((p, i) => {
    if (p.correct !== prev) { rank = i + 1; prev = p.correct; }
    return { p, rank };
  });
  const meRow = rows.find((r) => r.p.me);
  const win = top > 0 && meRow?.p.correct === top;
  $('result-card').classList.toggle('is-win', win);
  $('result-h').textContent = win ? '우리 모둠 1등!' : meRow ? `우리 모둠 ${meRow.rank}등` : '끝났어요';
  $('result-s').textContent = g.gain ? `+${g.gain.xp} XP · +${g.gain.coins}금화` : '';
  $('result-s').classList.toggle('hidden', !g.gain);
  setHTML($('result-fx'), win ? BITS.map(([l, c, d]) => `<span class="confetti-bit" style="left:${l};background:${c};--d:${d}s"></span>`).join('') : '');
  setHTML($('result-scores'), rows.map(({ p, rank: r }) => `
    <div class="rk-score${p.correct === top && top > 0 ? ' win' : ''}">
      <span>${r}등 · ${esc(nameOf(p))}</span>
      <b class="num">${p.correct * 10}점 (${p.correct} / ${g.total} 맞힘)</b>
    </div>`).join(''));
}

/* ---------- 시계: 서버가 알려 준 남은 시간으로 ---------- */
function setClock(g) {
  const now = performance.now();
  const ms = g?.phase === 'ready' ? g.start_ms : g?.phase === 'ask' ? g.left_ms : g?.phase === 'reveal' ? g.next_ms : null;
  if (ms == null) { deadline = 0; return; }
  deadline = now + Math.max(0, ms);
  span = g.phase === 'ask' ? (g.item?.dur ?? 15) * 1000 : g.phase === 'ready' ? 3000 : Math.max(ms, 1);
}

function tick() {
  requestAnimationFrame(tick);
  const g = st?.game;
  if (!g || g.status !== 'playing' || !deadline) return;
  const left = Math.max(0, deadline - performance.now());
  const s = Math.ceil(left / 1000);
  if (g.phase === 'ready') {
    const c = $('q-count');
    if (c && c.textContent !== String(s)) c.textContent = s || '';
    $('q-clock').textContent = '';
  } else if (g.phase === 'ask') {
    const t = `${s}초`;
    if ($('q-clock').textContent !== t) $('q-clock').textContent = t;
    $('q-clock').classList.toggle('warn', s <= 5);
  } else {
    if ($('q-clock').textContent !== '채점') $('q-clock').textContent = '채점';
    $('q-clock').classList.remove('warn');
  }
  $('bar').style.setProperty('--left', g.phase === 'ask' ? (left / span).toFixed(3) : g.phase === 'reveal' ? 0 : 1);
}
requestAnimationFrame(tick);

/* ---------- 서버 ---------- */
let loading = false;
let again = false;
let timer = null;

function apply(res) {
  if (!res) return;
  if (res.ok === false) {
    if (res.error === 'NO_SESSION') { clearLogin(); login = null; st = null; render(); return; }
    return;
  }
  const prevId = st?.game?.id;
  st = res;
  if (st.game?.id && st.game.id !== prevId) onGameRefresh(st.game.id, () => load(), 'qb-');
  setClock(st.game);
  render();
  schedule();
}

async function load() {
  if (!login) { render(); return; }
  if (loading) { again = true; return; }
  loading = true;
  try {
    apply(await qbState(login.token));
    setNet(false);
  } catch (err) {
    console.error(err);
    setNet(true);
    schedule();
  } finally {
    loading = false;
    if (again) { again = false; load(); }
  }
}

// 다음 읽기: 단계가 끝나는 순간(조금 뒤) 또는 정해진 간격 중 빠른 쪽
function schedule() {
  clearTimeout(timer);
  const g = st?.game;
  const active = !!g && g.status !== 'done' || (!g && st?.open);
  let ms = active ? PLAY_MS : IDLE_MS;
  if (g?.status === 'playing' && deadline) ms = Math.min(ms, Math.max(150, deadline - performance.now() + 250));
  if (netDown) ms = Math.max(ms, 3000);
  timer = setTimeout(() => { if (!document.hidden) load(); else schedule(); }, ms);
}

function setNet(on) {
  if (on === netDown) return;
  netDown = on;
  $('net').classList.toggle('hidden', !on);
}

// 버튼 하나에 요청 하나
async function act(fn, label) {
  if (busy || !login) return;
  busy = true;
  render();
  let res;
  try {
    res = await withTimeout(fn(), WAIT_MS);
  } catch (err) {
    console.error(err);
    busy = false;
    toast(ERR[err.message] || `${label} 못 했어요. 다시 눌러 주세요`, 'error');
    render();
    return;
  }
  busy = false;
  if (res?.ok === false && res.error !== 'NO_SESSION') {
    if (!['STALE', 'ALREADY', 'OVER'].includes(res.error)) toast(ERR[res.error] || `${label} 못 했어요`, 'error');
    await load();
    return;
  }
  apply(res);
  if (st?.game?.id) sendGameRefresh(st.game.id, 'qb-');
}

$('join').addEventListener('click', () => act(() => qbJoin(login.token), '들어가지'));
$('start').addEventListener('click', () => act(() => qbStart(login.token), '시작하지'));
$('leave').addEventListener('click', () => act(() => qbLeave(login.token), '나가지'));

function send(answer) {
  const g = st?.game;
  if (!g || g.phase !== 'ask' || g.item?.mine || !String(answer).trim()) return;
  act(() => qbAnswer(login.token, g.id, g.q, answer), '내지');
}

$('q-ans').addEventListener('click', (e) => {
  const b = e.target.closest('.qb-opt');
  if (b && !b.disabled) send(b.dataset.v);
});
$('q-ans').addEventListener('input', (e) => { if (e.target.id === 'blank-in') draft = e.target.value; });
$('q-ans').addEventListener('submit', (e) => {
  e.preventDefault();
  send($('blank-in')?.value ?? '');
});

// 선생님이 열거나 닫으면 반 채널로 신호가 온다
if (login && sb) onClassRefresh(login.class_id, () => { if (!document.hidden) setTimeout(load, Math.random() * 1500); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
addEventListener('online', load);
addEventListener('offline', () => setNet(true));

render();
load();
