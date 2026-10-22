// 퀴즈 쇼 진행 (프로젝터): 대기실 → 문제(3초 미리 보기 → 답 받기) → 정답·분포 → 중간 순위 → … → 시상대
// teacher/quizshow.html?c=<반>            : 이 반의 열린 판, 없으면 세트 고르기
//                    ?c=<반>&set=<세트>&mode=solo|team : 판을 새로 만들고 ?c=&g=로 바꾼다
//                    &embed=1              : 수업 모드 덮개 [퀴즈 쇼] 탭 안(뒤로 가기 숨김)
// Space·Enter·→ : 다음. 학생 번호는 보이지 않는다(닉네임만)
import { CLASSES } from '../config.js';
import { toast, esc } from '../ui.js';
import { qsCreate, qsHost, qsNext, qsCancel, currentQsGame, listQsSets, sendQuizShow } from '../db.js';
import { TYPES, POINTS, shapeSVG, optionHTML, imageURL, sliderValue, problemOf } from '../quizshow.js';
import { avatarSVG } from '../avatar.js';
import { teacherGate, errMsg } from '../gate.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const classId = Number(params.get('c'));
const embed = params.get('embed') === '1';
if (embed) document.documentElement.classList.add('embed');

const FAST_MS = 1000;   // 문제 중
const SLOW_MS = 3000;   // 대기실·정답·순위

let gameId = params.get('g');
let st = null;          // qs_host 결과
let lastKey = '';       // 다시 그릴지: 상태|문제|버전
let lastStatus = '';
let deadline = 0;       // 지금 단계가 끝나는 시각(performance.now)
let span = 1;
let busy = false;
let pollTimer = null;
let clockTimer = null;
let pickMode = 'solo';
let celebrated = null;

const nick = (p) => p?.nickname || '닉네임 미정';
const ERR = {
  NO_SET: '퀴즈를 찾지 못했어요',
  NO_QUESTIONS: '낼 수 있는 문제가 없어요',
  NO_GROUPS: '이 반 오늘 보드에 모둠 편성이 없어요. 모둠 편성을 먼저 하거나 개인전으로 시작하세요',
};

$('top-class').textContent = CLASSES.includes(classId) ? `${classId}반` : '';

/* ---------- 판 열기 ---------- */
function setUrl() {
  const u = new URL(location.href);
  u.searchParams.delete('set');
  u.searchParams.delete('mode');
  if (gameId) u.searchParams.set('g', gameId); else u.searchParams.delete('g');
  history.replaceState(null, '', u);
}

async function start() {
  if (!CLASSES.includes(classId)) {
    $('stage').innerHTML = '<div class="empty"><strong>반이 없어요</strong></div>';
    return;
  }
  const setId = params.get('set');
  if (setId) {
    const r = await qsCreate(setId, classId, params.get('mode') === 'team' ? 'team' : 'solo');
    if (!r?.ok) {
      toast(ERR[r?.error] ?? '열지 못했어요', 'error');
      gameId = null;
    } else {
      gameId = r.id;
      sendQuizShow(classId);
    }
    setUrl();
  }
  if (!gameId) {
    const g = await currentQsGame(classId);
    gameId = g?.id ?? null;
    setUrl();
  }
  if (gameId) poll();
  else showPicker();
}

/* ---------- 세트 고르기 (열린 판이 없을 때) ---------- */
async function showPicker() {
  clearTimeout(pollTimer);
  st = null;
  lastKey = '';
  $('top-title').textContent = '퀴즈 쇼';
  $('top-q').textContent = '';
  $('cancel').classList.add('hidden');
  $('next').classList.add('hidden');
  $('hint').textContent = '';
  const sets = await listQsSets();
  $('stage').innerHTML = `
    <section class="qsh-pick">
      <h1 class="qsh-h">어떤 퀴즈를 할까요?</h1>
      <div class="qse-seg" role="radiogroup" aria-label="방식">
        <button type="button" class="qse-seg-b${pickMode === 'solo' ? ' on' : ''}" data-mode="solo" role="radio" aria-checked="${pickMode === 'solo'}">개인전</button>
        <button type="button" class="qse-seg-b${pickMode === 'team' ? ' on' : ''}" data-mode="team" role="radio" aria-checked="${pickMode === 'team'}">모둠 대항</button>
      </div>
      <div class="qsh-sets">
        ${sets.length ? sets.map((s) => {
          const n = (s.questions ?? []).filter((x) => !problemOf(x)).length;
          return `<button type="button" class="qsh-set glass-strong lift press" data-set="${s.id}" ${n ? '' : 'disabled'}>
            <b>${esc(s.title || '제목 없음')}</b><span class="muted num">${n}문제</span></button>`;
        }).join('') : '<div class="empty"><strong>만든 퀴즈가 없어요</strong><a class="btn btn-primary" href="quizshow-edit.html" target="_blank" rel="noopener">퀴즈 만들기 ↗</a></div>'}
      </div>
    </section>`;
  $('stage').onclick = async (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) {
      pickMode = m.dataset.mode;
      $('stage').querySelectorAll('[data-mode]').forEach((b) => { b.classList.toggle('on', b === m); b.setAttribute('aria-checked', String(b === m)); });
      return;
    }
    const b = e.target.closest('[data-set]');
    if (!b || busy) return;
    busy = true;
    b.disabled = true;
    try {
      const r = await qsCreate(b.dataset.set, classId, pickMode);
      if (!r?.ok) { toast(ERR[r?.error] ?? '열지 못했어요', 'error'); return; }
      gameId = r.id;
      setUrl();
      $('stage').onclick = null;
      sendQuizShow(classId);
      poll();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      busy = false;
      b.disabled = false;
    }
  };
}

/* ---------- 다시 읽기 ---------- */
async function poll() {
  clearTimeout(pollTimer);
  if (!gameId) return;
  try {
    const r = await qsHost(gameId);
    if (r?.ok) apply(r);
  } catch (err) {
    console.warn(err);
  }
  const fast = st && (st.phase === 'ready' || st.phase === 'ask');
  pollTimer = setTimeout(poll, document.hidden ? SLOW_MS * 2 : fast ? FAST_MS : SLOW_MS);
}

function apply(r) {
  const prev = st;
  // 늦게 도착한 예전 응답은 버린다(다음을 누른 직후 앞서 보낸 다시 읽기가 늦게 오는 경우)
  if (prev && prev.id === r.id && r.version < prev.version) return;
  st = r;
  // 상태가 바뀌면(학생이 모두 내서 마감 등) 학생 기기도 바로 다시 읽게
  if (prev && (prev.status !== r.status || prev.q !== r.q)) sendQuizShow(classId);
  if (r.phase === 'ready') { deadline = performance.now() + r.start_ms; span = 3000; }
  else if (r.phase === 'ask' && r.left_ms != null) { deadline = performance.now() + r.left_ms; span = (r.question?.time ?? 20) * 1000; }
  const key = `${r.status}|${r.phase}|${r.q}`;
  if (key !== lastKey) {
    lastKey = key;
    render();
  } else {
    paintLive();
  }
  lastStatus = r.status;
}

/* ---------- 그리기 ---------- */
function render() {
  const g = st;
  $('top-title').textContent = g.title || '퀴즈 쇼';
  $('top-q').textContent = g.status === 'lobby' || g.status === 'done' ? `${g.total}문제${g.mode === 'team' ? ' · 모둠 대항' : ''}` : `${g.q + 1} / ${g.total}`;
  $('cancel').classList.toggle('hidden', g.status === 'done');
  document.body.dataset.phase = g.phase;
  const html = {
    lobby: lobbyHTML,
    ready: questionHTML,
    ask: questionHTML,
    reveal: revealHTML,
    board: boardHTML,
    done: doneHTML,
  }[g.phase]?.() ?? '';
  $('stage').innerHTML = html;
  paintLive();
  paintNext();
  if (g.phase === 'done' && celebrated !== g.id && !g.cancelled) {
    celebrated = g.id;
    setTimeout(() => window.confetti?.({ particleCount: 160, spread: 90, origin: { y: 0.45 } }), 400);
  }
}

function paintNext() {
  const g = st;
  const last = g.q + 1 >= g.total;
  const label = {
    lobby: '시작',
    ready: '마감',
    ask: g.question?.type === 'slide' ? (last ? '결과 발표' : '다음 문제') : '마감',
    reveal: '순위 보기',
    board: last ? '결과 발표' : '다음 문제',
  }[g.phase];
  $('next').classList.toggle('hidden', !label || g.status === 'done');
  $('next-t').textContent = label ?? '';
  $('next').disabled = busy || (g.phase === 'lobby' && !g.joined);
  $('hint').textContent = g.phase === 'lobby' ? (g.joined ? '' : '학생이 들어오면 시작할 수 있어요') : '';
}

// 매초 바뀌는 것: 남은 시간, 낸 사람 수, 대기실 인원
function paintLive() {
  const g = st;
  const ans = $('stage').querySelector('[data-live="answered"]');
  if (ans) ans.textContent = `${g.answered} / ${g.joined}`;
  if (g.phase === 'lobby') {
    const box = $('stage').querySelector('.qsh-lobby-list');
    const n = $('stage').querySelector('[data-live="joined"]');
    if (n) n.textContent = g.joined;
    if (box) {
      const html = lobbyListHTML();
      if (box._html !== html) { box._html = html; box.innerHTML = html; }
    }
    paintNext();
  }
}

function tickClock() {
  if (!st) return;
  const el = $('stage').querySelector('[data-live="clock"]');
  const bar = $('stage').querySelector('[data-live="bar"]');
  if (!el && !bar) return;
  const left = Math.max(0, deadline - performance.now());
  if (el) el.textContent = String(Math.ceil(left / 1000));
  if (bar) bar.style.transform = `scaleX(${Math.min(1, left / span)})`;
}
clockTimer = setInterval(tickClock, 100);

const avatar = (p, size) => avatarSVG(p.avatar, size, { label: nick(p) });

function lobbyListHTML() {
  const list = st.lobby ?? [];
  if (st.mode === 'team') {
    const teams = new Map();
    list.forEach((p) => { const k = p.team ?? 0; if (!teams.has(k)) teams.set(k, []); teams.get(k).push(p); });
    return [...teams.entries()].sort((a, b) => (a[0] || 99) - (b[0] || 99)).map(([t, ps]) => `
      <div class="qsh-team-col">
        <b>${t ? `${t}모둠` : '모둠 없음'}</b>
        ${ps.map((p) => `<span class="qsh-p">${avatar(p, 40)}<span>${esc(nick(p))}</span></span>`).join('')}
      </div>`).join('');
  }
  return list.map((p) => `<span class="qsh-p rise">${avatar(p, 48)}<span>${esc(nick(p))}</span></span>`).join('');
}

function lobbyHTML() {
  return `
    <section class="qsh-lobby">
      <div class="qsh-join glass-strong">
        <span>학생은 반 페이지에서</span>
        <b>퀴즈 쇼 → 들어가기</b>
      </div>
      <div class="qsh-count"><b class="num" data-live="joined">${st.joined}</b><span>명 들어옴</span></div>
      <div class="qsh-lobby-list${st.mode === 'team' ? ' is-team' : ''}">${lobbyListHTML()}</div>
    </section>`;
}

function mediaHTML(q, { pins = null, key = null } = {}) {
  if (!q.image) return '';
  let over = '';
  if (pins) over += pins.map((p) => `<span class="qsh-pin${p.ok ? ' ok' : ''}" style="left:${Number(p.x)}%;top:${Number(p.y)}%"></span>`).join('');
  if (key) over += `<span class="qse-pin-zone" style="left:${key.x}%;top:${key.y}%;width:${key.r * 2}%"></span>`;
  return `<div class="qsh-media"><div class="qsh-img">${'<img src="' + esc(imageURL(q.image)) + '" alt="">'}${over}</div></div>`;
}

function headHTML(q) {
  const pts = q.type !== 'slide' && q.points !== 'standard' ? `<span class="qsh-pts">${POINTS[q.points]}</span>` : '';
  return `<div class="qsh-q"><span class="qsh-type">${esc(TYPES[q.type]?.name ?? '')}</span>${pts}<h1>${esc(q.text ?? '')}</h1></div>`;
}

function questionHTML() {
  const q = st.question;
  if (q.type === 'slide') {
    return `
      <section class="qsh-slide">
        <h1>${esc(q.text ?? '')}</h1>
        ${mediaHTML(q)}
        ${q.body ? `<p>${esc(q.body).replace(/\n/g, '<br>')}</p>` : ''}
      </section>`;
  }
  const ready = st.phase === 'ready';
  let body = '';
  if (q.type === 'quiz' || q.type === 'tf') {
    body = `<div class="qsh-opts n${q.options.length}">${q.options.map((o, i) => optionHTML(o, i)).join('')}</div>`;
    if (q.multi) body = `<p class="qsh-multi">정답을 모두 고르세요</p>` + body;
  } else if (q.type === 'puzzle') {
    body = `<div class="qsh-puzzle">${q.options.map((o, n) => `<div class="qsh-pz qs-c${n % 6}">${esc(o.text)}</div>`).join('')}</div><p class="qsh-multi">맞는 순서로 놓으세요</p>`;
  } else {
    const say = q.type === 'slider' ? `${sliderValue(q.slider.min, q.slider.unit)} ~ ${sliderValue(q.slider.max, q.slider.unit)} 사이에서 고르세요`
      : q.type === 'pin' ? '그림에서 위치를 누르세요' : '답을 써서 내세요';
    body = `<p class="qsh-say">${say}</p>`;
  }
  return `
    <section class="qsh-ask${ready ? ' is-ready' : ''}">
      ${headHTML(q)}
      <div class="qsh-mid">
        <div class="qsh-clock"><b class="num" data-live="clock">${ready ? 3 : q.time}</b><small>${ready ? '곧 시작' : '초'}</small></div>
        ${mediaHTML(q) || '<div></div>'}
        <div class="qsh-clock"><b class="num" data-live="answered">${st.answered} / ${st.joined}</b><small>냈어요</small></div>
      </div>
      <div class="qsh-bar"><i data-live="bar"></i></div>
      ${ready ? '' : body}
    </section>`;
}

function revealHTML() {
  const q = st.question;
  const k = st.key ?? {};
  const d = st.dist;
  const n = st.answered;
  let body = '';
  if (q.type === 'quiz' || q.type === 'tf') {
    const max = Math.max(1, ...(d ?? []));
    body = `
      <div class="qsh-bars">${q.options.map((o, i) => {
        const ok = (k.correct ?? []).includes(i);
        const c = d?.[i] ?? 0;
        return `<div class="qsh-bar-col qs-c${i % 6}${ok ? ' ok' : ' no'}">
          <span class="num">${c}</span>
          <i style="transform:scaleY(${(c / max) * 0.92 + 0.08})"></i>
          <span class="qsh-bar-shape">${shapeSVG(i, 26)}${ok ? '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-label="정답"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</span>
        </div>`;
      }).join('')}</div>
      <div class="qsh-opts n${q.options.length}">${q.options.map((o, i) => optionHTML(o, i, { cls: (k.correct ?? []).includes(i) ? 'is-ok' : 'is-no' })).join('')}</div>`;
  } else if (q.type === 'type') {
    body = `
      <div class="qsh-key"><span>정답</span><b>${esc((k.answers ?? []).join(' / '))}</b></div>
      <div class="qsh-words">${(d ?? []).map((w) => `<span class="qsh-word${w.ok ? ' ok' : ''}">${esc(w.text)} <b class="num">${w.n}</b></span>`).join('') || '<span class="muted">낸 답이 없어요</span>'}</div>`;
  } else if (q.type === 'slider') {
    const s = q.slider;
    const range = Math.max(1e-9, s.max - s.min);
    const max = Math.max(1, ...(d ?? []).map((x) => x.n));
    const left = ((k.answer - (k.tol ?? 0) - s.min) / range) * 100;
    const width = (((k.tol ?? 0) * 2) / range) * 100;
    body = `
      <div class="qsh-key"><span>정답</span><b>${sliderValue(k.answer, s.unit)}${k.tol ? ` <small>(±${esc(String(k.tol))})</small>` : ''}</b></div>
      <div class="qsh-hist">
        <span class="qsh-hist-zone" style="left:${Math.max(0, left)}%;width:${Math.max(0.8, width)}%"></span>
        ${(d ?? []).map((x) => `<i class="${x.ok ? 'ok' : ''}" style="left:${((x.value - s.min) / range) * 100}%;height:${(x.n / max) * 100}%" title="${esc(String(x.value))}: ${x.n}"></i>`).join('')}
      </div>
      <div class="qsh-hist-axis num"><span>${sliderValue(s.min, s.unit)}</span><span>${sliderValue(s.max, s.unit)}</span></div>`;
  } else if (q.type === 'puzzle') {
    body = `
      <div class="qsh-puzzle is-key">${(k.order ?? []).map((t, i) => `<div class="qsh-pz qs-c${i % 6}"><b class="num">${i + 1}</b> ${esc(t)}</div>`).join('')}</div>
      <p class="qsh-say num">${d?.ok ?? 0}명 정답</p>`;
  } else if (q.type === 'pin') {
    return `
      <section class="qsh-ask is-reveal">
        ${headHTML(q)}
        ${mediaHTML(q, { pins: d ?? [], key: k })}
        <p class="qsh-say num">${st.n_ok ?? 0} / ${n}명 정답</p>
      </section>`;
  }
  return `
    <section class="qsh-ask is-reveal">
      ${headHTML(q)}
      ${q.image && q.type !== 'pin' ? mediaHTML(q) : ''}
      ${body}
      <p class="qsh-sum num">${st.n_ok ?? 0} / ${n}명 정답</p>
    </section>`;
}

const delta = (r) => {
  if (r.prev_rank == null || r.prev_rank === r.rank || st.q === 0) return '';
  const d = r.prev_rank - r.rank;
  return d > 0 ? `<span class="qsh-up num">▲${d}</span>` : '';
};

function boardHTML() {
  const list = st.ranking ?? [];
  const teams = st.mode === 'team' ? (st.teams ?? []) : null;
  return `
    <section class="qsh-board">
      <h1 class="qsh-h">${teams ? '모둠 순위' : '순위'}</h1>
      ${teams ? `<ol class="qsh-rank">${teams.map((t) => `
        <li class="rise"><b class="qsh-rk num">${t.rank}</b><span class="qsh-rn">${t.team}모둠 <small class="muted num">${t.n}명</small></span>${delta(t)}<b class="qsh-rs num">${t.score.toLocaleString('ko-KR')}</b></li>`).join('')}</ol>` : ''}
      ${teams ? '<h2 class="qsh-h2">개인 순위</h2>' : ''}
      <ol class="qsh-rank${teams ? ' is-small' : ''}">${list.slice(0, teams ? 5 : 10).map((r, i) => `
        <li class="rise" style="--d:${i * 0.05}s"><b class="qsh-rk num">${r.rank}</b>${avatar(r, 44)}<span class="qsh-rn">${esc(nick(r))}${r.streak >= 2 ? `<small class="qsh-streak num">${r.streak}연속</small>` : ''}</span>${delta(r)}<b class="qsh-rs num">${r.score.toLocaleString('ko-KR')}</b></li>`).join('')}</ol>
      ${list.length ? '' : '<div class="empty"><strong>아직 점수가 없어요</strong></div>'}
    </section>`;
}

function doneHTML() {
  if (st.cancelled) return '<section class="qsh-pick"><h1 class="qsh-h">그만둔 퀴즈예요</h1><button type="button" class="btn btn-primary" data-new>다른 퀴즈 열기</button></section>';
  const teams = st.mode === 'team' ? (st.teams ?? []) : null;
  const top = teams
    ? teams.slice(0, 3).map((t) => ({ rank: t.rank, name: `${t.team}모둠`, score: t.score, avs: t.members.slice(0, 6) }))
    : (st.ranking ?? []).slice(0, 3).map((r) => ({ rank: r.rank, name: nick(r), score: r.score, avs: [r] }));
  const order = [1, 0, 2].map((i) => top[i]).filter(Boolean);
  const rest = teams ? teams.slice(3) : (st.ranking ?? []).slice(3, 10);
  return `
    <section class="qsh-done">
      <h1 class="qsh-h">${teams ? '모둠 대항 결과' : '최종 순위'}</h1>
      <div class="qsh-podium">${order.map((t) => `
        <div class="qsh-pod r${Math.min(t.rank, 3)}">
          <div class="qsh-pod-avs">${t.avs.map((p) => avatarSVG(p.avatar, teams ? 64 : 120, { label: nick(p), live: t.rank === 1 })).join('')}</div>
          <b class="qsh-pod-name">${esc(t.name)}</b>
          <span class="qsh-pod-score num">${t.score.toLocaleString('ko-KR')}</span>
          <div class="qsh-pod-block"><b class="num">${t.rank}</b></div>
        </div>`).join('')}</div>
      ${rest.length ? `<ol class="qsh-rank is-small">${rest.map((r) => `<li><b class="qsh-rk num">${r.rank}</b><span class="qsh-rn">${teams ? `${r.team}모둠` : esc(nick(r))}</span><b class="qsh-rs num">${r.score.toLocaleString('ko-KR')}</b></li>`).join('')}</ol>` : ''}
      <div class="row-actions"><button type="button" class="btn btn-line" data-new>다른 퀴즈 열기</button></div>
    </section>`;
}

/* ---------- 조작 ---------- */
async function next() {
  if (!st || busy || st.status === 'done' || $('next').classList.contains('hidden') || $('next').disabled) return;
  busy = true;
  $('next').disabled = true;
  try {
    const r = await qsNext(st.id, st.version);
    if (r?.ok) apply(r);
    sendQuizShow(classId);
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally {
    busy = false;
    if (st) paintNext();
    poll();
  }
}
$('next').addEventListener('click', next);

$('cancel').addEventListener('click', async () => {
  if (!st || !confirm('퀴즈를 그만둘까요? 점수와 보상 없이 끝나요.')) return;
  try {
    await qsCancel(st.id);
    sendQuizShow(classId);
    gameId = null;
    setUrl();
    showPicker();
  } catch (err) {
    toast(errMsg(err), 'error');
  }
});

$('stage').addEventListener('click', (e) => {
  if (e.target.closest('[data-new]')) {
    gameId = null;
    setUrl();
    showPicker();
  }
});

addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.target.closest?.('input, textarea, select')) return;
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight' || e.code === 'NumpadEnter') {
    if (!st || st.status === 'done') return;
    e.preventDefault();
    if (!e.repeat) next();
  }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden && gameId) poll(); });

teacherGate($('app'), start);
