// 퀴즈 쇼 (학생): 선생님이 프로젝터에서 진행하는 반 전체 퀴즈. 들어오면 바로 참가, 문제마다 한 번 답한다.
// 진행은 서버 시각(qs_state의 남은 ms)으로. 반 채널 'quizshow' 신호 + 문제 중 1.2초·그 밖 3초마다 qs_state. 신호 내용은 믿지 않는다
import { initUI, toast, esc, countUp } from '../ui.js';
import { qsState, qsJoin, qsAnswer, onQuizShow } from '../db.js';
import { readLogin, clearLogin } from '../login.js';
import { avatarSVG, react, bindReactions } from '../avatar.js';
import { TYPES, POINTS, shapeSVG, optionHTML, imageURL, sliderValue } from '../quizshow.js';

initUI();
bindReactions();

const $ = (id) => document.getElementById(id);
const FAST_MS = 1200;
const SLOW_MS = 3000;
const WAIT_MS = 10000;

let login = readLogin();
let st = null;          // qs_state 결과
let g = null;           // st.game
let shownKey = '';
let deadline = 0;
let span = 1;
let busy = false;
let joining = false;
let netDown = false;
let pollTimer = null;
let draft = null;       // 지금 문제에 고르는 중인 답 { q, value }
let celebrated = null;

if (login) $('back').href = `class.html?c=${login.class_id}`;

const nick = (p) => (p?.me ? '나' : p?.nickname || '닉네임 미정');
const withTimeout = (p, ms) => {
  let t;
  return Promise.race([p.finally(() => clearTimeout(t)), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('TIMEOUT')), ms); })]);
};

// 받은 상태 적용. 늦게 도착한 예전 응답(답을 낸 직후 앞서 보낸 다시 읽기 등)은 버린다
function take(r) {
  const ng = r.game;
  if (g && ng && ng.id === g.id && ng.version < g.version) return false;
  st = r;
  g = ng;
  return true;
}

function setNet(on) {
  if (on === netDown) return;
  netDown = on;
  $('net').classList.toggle('hidden', !on);
}

/* ---------- 읽기 ---------- */
async function load() {
  clearTimeout(pollTimer);
  if (!login) { render(); return; }
  try {
    const r = await withTimeout(qsState(login.token), WAIT_MS);
    setNet(false);
    if (!r?.ok) {
      if (r?.error === 'NO_SESSION') { clearLogin(); login = null; }
      render();
      return;
    }
    take(r);
    // 열린 판이면 바로 들어간다
    if (g && !g.joined && g.status !== 'done' && !joining) {
      joining = true;
      try {
        const j = await withTimeout(qsJoin(login.token), WAIT_MS);
        if (j?.ok) take(j);
      } finally {
        joining = false;
      }
    }
    timing();
    render();
  } catch (err) {
    console.warn(err);
    setNet(true);
  } finally {
    const fast = g && (g.phase === 'ready' || g.phase === 'ask');
    pollTimer = setTimeout(load, document.hidden ? SLOW_MS * 2 : netDown ? SLOW_MS : fast ? FAST_MS : SLOW_MS);
  }
}

function timing() {
  if (!g) return;
  if (g.phase === 'ready') { deadline = performance.now() + g.start_ms; span = 3000; }
  else if (g.phase === 'ask' && g.left_ms != null) { deadline = performance.now() + g.left_ms; span = (g.question?.time ?? 20) * 1000; }
}

/* ---------- 그리기 ---------- */
function msgHTML(title, text, btn) {
  return `<section class="glass-strong qsp-card qsp-msg rise">
    <h1>${esc(title)}</h1>${text ? `<p class="muted">${esc(text)}</p>` : ''}
    ${btn ?? ''}
  </section>`;
}

function render() {
  const stage = $('stage');
  if (!login) {
    stage.innerHTML = msgHTML('퀴즈 쇼', '로그인하면 할 수 있어요', '<a class="btn btn-primary press" href="index.html">로그인</a>');
    shownKey = 'login';
    return;
  }
  if (!g) {
    if (shownKey !== 'none') {
      stage.innerHTML = msgHTML('퀴즈 쇼', '지금 열린 퀴즈 쇼가 없어요', `<a class="btn btn-line press" href="class.html?c=${login.class_id}">반 페이지로</a>`);
      shownKey = 'none';
    }
    $('score').classList.add('hidden');
    return;
  }
  $('title').textContent = g.title || '퀴즈 쇼';
  const sc = g.me ? g.me.score : null;
  $('score').classList.toggle('hidden', sc == null || g.status === 'lobby');
  if (sc != null) $('score').textContent = `${sc.toLocaleString('ko-KR')}점`;
  const mineKey = g.mine ? JSON.stringify(g.mine.answer) + (g.mine.ok ?? '') : '';
  const key = `${g.id}|${g.status}|${g.phase}|${g.q}|${mineKey}`;
  if (key === shownKey) return;
  shownKey = key;
  if (draft && draft.q !== `${g.id}|${g.q}`) draft = null;
  stage.innerHTML = ({
    lobby: lobbyHTML,
    ready: readyHTML,
    ask: askHTML,
    reveal: revealHTML,
    board: boardHTML,
    done: doneHTML,
  }[g.phase] ?? (() => ''))();
  afterRender();
}

function lobbyHTML() {
  const me = g.me;
  return `
    <section class="glass-strong qsp-card qsp-lobby rise">
      <div class="qsp-me-av" id="me-av"></div>
      <h1>들어왔어요!</h1>
      <p class="muted">선생님이 시작하면 문제가 나와요${g.mode === 'team' ? (me?.team ? ` · ${me.team}모둠` : ' · 오늘 모둠이 없어서 개인 점수만') : ''}</p>
      <span class="chip num">${g.players}명 · ${g.total}문제</span>
    </section>`;
}

function readyHTML() {
  const q = g.question;
  return `
    <section class="qsp-card qsp-ready glass-strong">
      <span class="qsp-qno num">${g.q + 1} / ${g.total} · ${esc(TYPES[q.type]?.name ?? '')}${q.points && q.points !== 'standard' ? ` · ${POINTS[q.points]}` : ''}</span>
      <h1 class="qsp-qtext">${esc(q.text)}</h1>
      <div class="qsp-count num" data-live="clock">3</div>
    </section>`;
}

function mediaHTML(q, { pin = false, mine = null, key = null } = {}) {
  if (!q.image) return '';
  let over = '';
  if (key) over += `<span class="qse-pin-zone" style="left:${key.x}%;top:${key.y}%;width:${key.r * 2}%"></span>`;
  if (mine) over += `<span class="qse-pin-dot qsp-mine" style="left:${mine.x}%;top:${mine.y}%"></span>`;
  return `<div class="qsp-media${pin ? ' is-pin' : ''}"><div class="qsp-img" ${pin ? 'data-pin' : ''}><img src="${esc(imageURL(q.image))}" alt="">${over}</div></div>`;
}

function headHTML(q) {
  return `
    <div class="qsp-head">
      <span class="qsp-qno num">${g.q + 1} / ${g.total}${q.points && q.points !== 'standard' && q.type !== 'slide' ? ` · ${POINTS[q.points]}` : ''}</span>
      ${g.phase === 'ask' && q.type !== 'slide' ? '<span class="qsp-clock num" data-live="clock"></span>' : ''}
    </div>
    ${g.phase === 'ask' && q.type !== 'slide' ? '<div class="qsh-bar qsp-bar"><i data-live="bar"></i></div>' : ''}
    <h1 class="qsp-qtext">${esc(q.text)}</h1>`;
}

function answerSummary(q, a) {
  if (a == null) return '';
  if (q.type === 'quiz' || q.type === 'tf') return a.map((i) => esc(q.options[i]?.text || `${i + 1}번`)).join(', ');
  if (q.type === 'type') return esc(a);
  if (q.type === 'slider') return sliderValue(a, q.slider.unit);
  if (q.type === 'puzzle') return a.map((i) => esc(q.options.find((o) => o.i === i)?.text ?? '')).join(' → ');
  if (q.type === 'pin') return '그림에 핀을 꽂았어요';
  return '';
}

function askHTML() {
  const q = g.question;
  if (q.type === 'slide') {
    return `
      <section class="glass-strong qsp-card qsp-slide">
        ${headHTML(q)}
        ${mediaHTML(q)}
        ${q.body ? `<p>${esc(q.body).replace(/\n/g, '<br>')}</p>` : ''}
        <p class="muted">선생님 설명을 들어요</p>
      </section>`;
  }
  if (g.mine) {
    return `
      <section class="glass-strong qsp-card qsp-sent rise">
        ${headHTML(q)}
        <div class="qsp-sent-box">
          <div class="qsp-me-av" id="me-av"></div>
          <b>냈어요!</b>
          <span class="muted">${answerSummary(q, g.mine.answer)}</span>
          <span class="muted">다른 친구를 기다려요</span>
        </div>
      </section>`;
  }
  const dq = `${g.id}|${g.q}`;
  if (!draft || draft.q !== dq) draft = { q: dq, value: initialDraft(q) };
  return `
    <section class="glass-strong qsp-card qsp-ask">
      ${headHTML(q)}
      ${mediaHTML(q, { pin: q.type === 'pin', mine: q.type === 'pin' ? draft.value : null })}
      <div class="qsp-ans" id="ans">${answerUI(q)}</div>
    </section>`;
}

function initialDraft(q) {
  if (q.type === 'quiz' || q.type === 'tf') return [];
  if (q.type === 'slider') {
    const s = q.slider;
    const step = Number(s.step) || 1;
    return Math.round(((s.min + s.max) / 2 - s.min) / step) * step + s.min;
  }
  if (q.type === 'puzzle') return q.options.map((o) => o.i);
  if (q.type === 'type') return '';
  return null;
}

function answerUI(q) {
  const v = draft.value;
  const send = (label = '내기', ready = true) => `<button type="button" class="btn btn-primary btn-big press qsp-send" data-send ${ready && !busy ? '' : 'disabled'}>${busy ? '보내는 중…' : label}</button>`;
  if (q.type === 'quiz' || q.type === 'tf') {
    const multi = q.type === 'quiz' && q.multi;
    return `
      ${multi ? '<p class="qsp-multi">정답을 모두 고르세요</p>' : ''}
      <div class="qsp-opts n${q.options.length}">${q.options.map((o, i) => optionHTML(o, i, {
        tag: 'button', cls: `press${v.includes(i) ? ' is-on' : ''}`,
        attrs: `type="button" data-opt="${i}" aria-pressed="${v.includes(i)}" ${busy ? 'disabled' : ''}`,
      })).join('')}</div>
      ${multi ? send('내기', v.length > 0) : ''}`;
  }
  if (q.type === 'type') {
    return `
      <input class="input qsp-type-in" id="type-in" maxlength="100" autocomplete="off" spellcheck="false" placeholder="답을 쓰세요" value="${esc(v)}" ${busy ? 'disabled' : ''}>
      ${send('내기', !!String(v).trim())}`;
  }
  if (q.type === 'slider') {
    const s = q.slider;
    return `
      <div class="qsp-slider">
        <b class="qsp-slider-v num" id="sl-v">${sliderValue(v, s.unit)}</b>
        <input type="range" id="sl" min="${s.min}" max="${s.max}" step="${s.step || 1}" value="${v}" aria-label="값" ${busy ? 'disabled' : ''}>
        <div class="qsh-hist-axis num"><span>${sliderValue(s.min, s.unit)}</span><span>${sliderValue(s.max, s.unit)}</span></div>
      </div>
      ${send()}`;
  }
  if (q.type === 'puzzle') {
    return `
      <p class="qsp-multi">맞는 순서로 놓으세요(위가 처음)</p>
      <ol class="qsp-puzzle">${v.map((i, n) => {
        const o = q.options.find((x) => x.i === i);
        const c = q.options.indexOf(o);
        return `<li class="qsp-pz qs-c${c % 6}">
          <span class="qsp-pz-no num">${n + 1}</span><span class="qsp-pz-t">${esc(o?.text ?? '')}</span>
          <button type="button" class="qse-mini" data-pz="${n}" data-dir="-1" ${n && !busy ? '' : 'disabled'} aria-label="위로"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></button>
          <button type="button" class="qse-mini" data-pz="${n}" data-dir="1" ${n < v.length - 1 && !busy ? '' : 'disabled'} aria-label="아래로"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
        </li>`;
      }).join('')}</ol>
      ${send()}`;
  }
  if (q.type === 'pin') return `<p class="qsp-multi">그림에서 위치를 누르세요</p>${send('내기', !!v)}`;
  return '';
}

function revealHTML() {
  const q = g.question;
  const m = g.mine;
  const k = g.key ?? {};
  let keyText = '';
  if (q.type === 'quiz' || q.type === 'tf') keyText = (k.correct ?? []).map((i) => esc(q.options[i]?.text || `${i + 1}번`)).join(', ');
  else if (q.type === 'type') keyText = esc((k.answers ?? []).join(' / '));
  else if (q.type === 'slider') keyText = `${sliderValue(k.answer, q.slider.unit)}${k.tol ? ` (±${esc(String(k.tol))})` : ''}`;
  else if (q.type === 'puzzle') keyText = (k.order ?? []).map(esc).join(' → ');
  if (q.type === 'slide') return askHTML();
  const ok = m?.ok === true;
  const cls = !m ? 'is-none' : ok ? 'is-ok' : 'is-no';
  const scored = q.points !== 'none';
  return `
    <section class="qsp-card qsp-result ${cls} pop">
      <div class="qsp-me-av" id="me-av"></div>
      <b class="qsp-result-h">${!m ? '못 냈어요' : ok ? '정답!' : '아쉬워요'}</b>
      ${ok && scored ? `<span class="qsp-gain num">+${m.points.toLocaleString('ko-KR')}</span>` : ''}
      ${ok && g.me?.streak >= 2 && scored ? `<span class="qsp-streak num">${g.me.streak}연속 정답</span>` : ''}
      ${q.type === 'pin' ? mediaHTML(q, { mine: m?.answer, key: k }) : `<span class="qsp-key">정답 <b>${keyText}</b></span>`}
      ${m && !ok && q.type !== 'pin' ? `<span class="qsp-my muted">내 답: ${answerSummary(q, m.answer)}</span>` : ''}
    </section>`;
}

function rankLine() {
  const me = g.me;
  if (!me) return '';
  const team = g.mode === 'team' && me.team ? `<span class="chip num">${me.team}모둠 ${me.team_rank ?? '-'}위 · ${(me.team_score ?? 0).toLocaleString('ko-KR')}점</span>` : '';
  return `<div class="qsp-rankline"><b class="num">${me.rank ? `${me.rank}위` : '-'}</b><span class="num">${me.score.toLocaleString('ko-KR')}점 · ${me.correct}문제 맞힘</span>${team}</div>`;
}

function topHTML(list) {
  return `<ol class="qsp-top5">${(list ?? []).map((r) => `
    <li class="${r.me ? 'is-me' : ''}"><b class="num">${r.rank}</b>${avatarSVG(r.avatar, 36, { label: nick(r) })}<span>${esc(nick(r))}</span><b class="num">${Number(r.score).toLocaleString('ko-KR')}</b></li>`).join('')}</ol>`;
}

function boardHTML() {
  return `
    <section class="glass-strong qsp-card qsp-board rise">
      <h1>지금 순위</h1>
      ${rankLine()}
      ${topHTML(g.top)}
    </section>`;
}

function doneHTML() {
  const gain = g.gain;
  return `
    <section class="glass-strong qsp-card qsp-done pop">
      <div class="qsp-me-av" id="me-av"></div>
      <h1>끝!</h1>
      ${rankLine()}
      ${gain ? `<span class="qsp-reward num">+${gain.xp} XP · +${gain.coins}코인</span>` : ''}
      ${topHTML(g.top)}
      <a class="btn btn-line press" href="class.html?c=${login.class_id}">반 페이지로</a>
    </section>`;
}

function afterRender() {
  const av = $('me-av');
  if (av) {
    av.innerHTML = avatarSVG(st?.avatar, 120, { label: '나', live: true });
    const svg = av.querySelector('svg');
    if (g.phase === 'reveal' && svg) react(svg, g.mine?.ok ? 'jump' : 'tilt');
  }
  if (g.phase === 'reveal' && g.mine?.ok) burst(0.25);
  if (g.phase === 'done' && celebrated !== g.id && g.me?.rank && g.me.rank <= 3) { celebrated = g.id; burst(1); }
  const gainEl = $('stage').querySelector('.qsp-gain');
  if (gainEl && g.mine?.points) countUp(gainEl, g.mine.points, 700);
  tick();
}

function burst(scale) {
  const C = window.confetti;
  if (!C || matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('lite')) return;
  C({ particleCount: Math.round(90 * scale) + 20, spread: 70, origin: { y: 0.4 }, disableForReducedMotion: true });
}

function tick() {
  const el = $('stage').querySelector('[data-live="clock"]');
  const bar = $('stage').querySelector('[data-live="bar"]');
  if (!el && !bar) return;
  const left = Math.max(0, deadline - performance.now());
  if (el) el.textContent = String(Math.ceil(left / 1000));
  if (bar) bar.style.transform = `scaleX(${Math.min(1, left / span)})`;
  // 준비 시간이 끝나면 바로 다시 읽어 문제를 연다
  if (g?.phase === 'ready' && left <= 0 && !tick.kicked) { tick.kicked = true; setTimeout(() => { tick.kicked = false; load(); }, 120); }
}
setInterval(tick, 100);

/* ---------- 답하기 ---------- */
$('stage').addEventListener('click', (e) => {
  if (!g || g.phase !== 'ask' || g.mine || busy) return;
  const q = g.question;
  const opt = e.target.closest('[data-opt]');
  if (opt) {
    const i = Number(opt.dataset.opt);
    if (q.type === 'quiz' && q.multi) {
      const s = new Set(draft.value);
      if (s.has(i)) s.delete(i); else s.add(i);
      draft.value = [...s].sort((a, b) => a - b);
      redrawAns();
    } else {
      draft.value = [i];
      send();
    }
    return;
  }
  const pz = e.target.closest('[data-pz]');
  if (pz) {
    const n = Number(pz.dataset.pz);
    const m = n + Number(pz.dataset.dir);
    const v = draft.value;
    [v[n], v[m]] = [v[m], v[n]];
    redrawAns();
    return;
  }
  const pin = e.target.closest('[data-pin]');
  if (pin) {
    const r = pin.getBoundingClientRect();
    draft.value = { x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 };
    pin.querySelector('.qsp-mine')?.remove();
    pin.insertAdjacentHTML('beforeend', `<span class="qse-pin-dot qsp-mine" style="left:${draft.value.x}%;top:${draft.value.y}%"></span>`);
    redrawAns();
    return;
  }
  if (e.target.closest('[data-send]')) send();
});
$('stage').addEventListener('input', (e) => {
  if (!draft) return;
  if (e.target.id === 'type-in') {
    draft.value = e.target.value;
    const b = $('stage').querySelector('[data-send]');
    if (b) b.disabled = busy || !e.target.value.trim();
  } else if (e.target.id === 'sl') {
    draft.value = Number(e.target.value);
    $('sl-v').textContent = sliderValue(draft.value, g.question.slider.unit);
  }
});
$('stage').addEventListener('keydown', (e) => {
  if (e.target.id === 'type-in' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (draft.value.trim()) send(); }
});

function redrawAns() {
  const box = $('ans');
  if (box) box.innerHTML = answerUI(g.question);
}

const ERR = { STALE: '이미 마감됐어요', ALREADY: '이미 냈어요', EMPTY: '답을 골라 주세요', NOT_PLAYER: '다시 들어가는 중이에요', TIMEOUT: '응답이 없어요. 다시 내 주세요' };

async function send() {
  if (busy || !g || g.phase !== 'ask' || !draft) return;
  busy = true;
  redrawAns();
  try {
    const r = await withTimeout(qsAnswer(login.token, g.id, g.q, draft.value), WAIT_MS);
    setNet(false);
    if (r?.ok) {
      take(r);
      timing();
    } else {
      toast(ERR[r?.error] ?? '내지 못했어요', r?.error === 'STALE' || r?.error === 'ALREADY' ? 'info' : 'error');
    }
  } catch (err) {
    toast(ERR[err?.message] ?? '인터넷 연결을 확인해 주세요', 'error');
  } finally {
    busy = false;
    shownKey = '';
    render();
    if (!g?.mine) load();
  }
}

/* ---------- 시작 ---------- */
if (login) {
  onQuizShow(login.class_id, () => load());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  addEventListener('online', () => load());
}
load();
