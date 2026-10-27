// 휴대폰 리모컨: 프로젝터의 수업 모드(live.html)에 명령을 보내고 상태를 받는다.
// 비공개 채널 'remote'(교사만, 02_policies). 수업 모드가 여러 개면 가장 최근에 연 것 하나에만 보낸다
import { onRemote, sendRemote, getAwayStats } from '../db.js';
import { teacherGate } from '../gate.js';
import { initUI, esc } from '../ui.js';

initUI();

const $ = (id) => document.getElementById(id);
const HELLO_MS = 5000;   // 리모컨이 있다고 알리는 간격 (수업 모드는 15초 안에 hello가 없으면 상태를 안 보냄)
const STALE_MS = 10000;  // 이만큼 상태가 안 오면 '수업 모드가 열려 있지 않아요'
const TABS = { groups: '모둠', board: '게시판', reveal: '순위 발표', quizshow: '퀴즈 쇼' };

const lives = new Map(); // lid → { s: 상태, t: 받은 시각 }
let live = null;         // 지금 명령을 보내는 수업 모드
let subscribed = false;

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function pickLive() {
  const now = Date.now();
  let best = null;
  for (const [lid, v] of lives) {
    if (now - v.t > STALE_MS) { lives.delete(lid); continue; }
    if (!best || v.s.at > best.s.at) best = v;
  }
  live = best;
}

/* ---------- 보내기 ---------- */
function send(act) {
  if (!live) return;
  sendRemote('cmd', { to: live.s.lid, act });
}

const hello = () => { if (subscribed) sendRemote('hello'); };

// 켜고 끄는 버튼은 0.6초 안에 다시 눌러도 한 번만 (쪽 넘기기는 빠르게 여러 번 가능)
const QUICK = new Set(['prev', 'next', 'answer']);
let lastAct = '';
let lastAt = 0;
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  const now = Date.now();
  if (!QUICK.has(act) && act === lastAct && now - lastAt < 600) return;
  if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
  lastAct = act;
  lastAt = now;
  send(act);
});

/* ---------- 그리기 ---------- */
let drawn = '';
function render() {
  pickLive();
  const conn = $('conn');
  conn.textContent = !subscribed ? '연결 확인 중' : live ? '연결됨' : '찾는 중';
  conn.classList.toggle('is-on', subscribed && !!live);
  $('off').classList.toggle('hidden', !subscribed || !!live);
  $('ctl').classList.toggle('hidden', !live);
  if (!live) { $('title').textContent = ''; drawn = ''; return; }

  const s = live.s;
  const key = JSON.stringify({ ...s, timer_ms: 0, draw_ms: 0 });
  if (key !== drawn) {
    drawn = key;
    paint(s);
  }
  tick();
}

function paint(s) {
  $('title').textContent = s.title || `${s.cls}반 ${s.code}차시`;
  $('st-slide').textContent = s.slide ? `${s.slide}${s.slides ? ` / ${s.slides}` : ''}쪽` : '-';

  const firstOpen = !!s.first;
  const coverOpen = !!s.cover;

  // 첫 답 창
  $('first').classList.toggle('hidden', !firstOpen);
  if (firstOpen) {
    const f = s.first;
    $('first-name').textContent = f.name;
    $('first-meta').textContent = [f.meta, f.review ? '인정함' : ''].filter(Boolean).join(' · ');
    $('first-badge').textContent = f.review ? '인정함' : f.paid ? '지급함' : '첫 답';
    const dis = f.busy ? ' disabled' : '';
    const btn = (act, label, cls = 'btn-line') => `<button type="button" class="btn ${cls} press rm-grow" data-act="${act}"${dis}>${label}</button>`;
    $('first-btns').innerHTML = f.review
      ? btn('wsf-close', '닫기', 'btn-primary')
      : [
        f.paid ? btn('wsf-skip', '다음', 'btn-primary') : btn('wsf-ok', '인정 <kbd>Enter</kbd>', 'btn-primary') + btn('wsf-skip', '넘기기 <kbd>N</kbd>'),
        f.skipped ? btn('back', '이전 <kbd>B</kbd>') : '',
        btn('wsf-close', '닫기 <kbd>Esc</kbd>'),
      ].join('');
  }

  // 수업자료 (덮개가 닫혀 있을 때)
  $('lesson').classList.toggle('hidden', coverOpen);
  const canPage = !coverOpen && !firstOpen && s.same;
  $('prev').disabled = !canPage;
  $('next').disabled = !canPage;
  $('answer').disabled = !canPage;
  $('other-origin').classList.toggle('hidden', s.same !== false);

  // 학습지
  const sh = s.sheet;
  $('st-sheet-box').classList.toggle('hidden', !sh);
  $('sheet').classList.toggle('hidden', !sh || coverOpen);
  if (sh) {
    $('st-sheet').textContent = `${sh.done} / ${sh.total}`;
    const upto = sh.upto >= 9999 ? '모두 열림' : sh.upto > 0 ? `${sh.upto}쪽까지 열림` : '';
    $('sheet-line').textContent = [sh.group ? '모둠 학습지' : '', upto, sh.here ? '' : '이 쪽에는 낼 칸이 없어요'].filter(Boolean).join(' · ');
    const dis = firstOpen ? ' disabled' : '';
    const parts = [];
    if (sh.here) {
      const label = sh.open ? '잠그기' : sh.was_open ? '다시 열기' : '제출 시작';
      parts.push(`<button type="button" class="btn ${sh.open ? 'btn-line' : 'btn-primary'} press rm-grow" data-act="sheet"${sh.busy || firstOpen ? ' disabled' : ''}>${label} <kbd>S</kbd></button>`);
    }
    if (sh.drawing) parts.push(`<span class="rm-draw num" id="draw">추첨까지 --:-- · 낸 학생 ${sh.entered}</span>`);
    else if (sh.waiting > 0) parts.push(`<button type="button" class="btn btn-line press rm-grow" data-act="view"${dis}>제출한 것 보기 <b class="num">${sh.waiting}</b> <kbd>V</kbd></button>`);
    if (!sh.waiting && !sh.accepted && sh.skipped > 0) parts.push(`<button type="button" class="btn btn-line press" data-act="back"${dis}>넘긴 답 되돌리기 <b class="num">${sh.skipped}</b> <kbd>B</kbd></button>`);
    if (sh.accepted) parts.push('<span class="chip">이 쪽 인정함</span>');
    $('sheet-btns').innerHTML = parts.join('');
  }

  // 덮개
  $('cover').classList.toggle('hidden', !coverOpen);
  $('cover-btn').innerHTML = `${coverOpen ? '수업자료로 돌아가기' : '모둠활동 열기'} <kbd>G</kbd>`;
  $('cover-btn').classList.toggle('btn-primary', coverOpen);
  $('cover-btn').classList.toggle('btn-line', !coverOpen);
  $('cover-btn').disabled = firstOpen;
  document.querySelectorAll('#tabs [data-act]').forEach((b) => {
    const on = coverOpen && b.dataset.act === s.tab;
    b.classList.toggle('btn-primary', on);
    b.classList.toggle('btn-line', !on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = !s.board && b.dataset.act !== 'quizshow';
  });
  const next = $('embed-next');
  const showNext = coverOpen && (s.tab === 'quizshow' || (s.tab === 'reveal' && !!s.reveal));
  next.classList.toggle('hidden', !showNext);
  if (s.tab === 'reveal' && s.reveal === 'ready') {
    next.textContent = '순위 발표 시작';
    next.dataset.confirm = '순위를 발표할까요? 통과한 모둠에 포인트가 지급돼요';
  } else {
    next.textContent = s.tab === 'reveal' ? '다음 공개' : '다음';
    delete next.dataset.confirm;
  }

  $('full-btn').innerHTML = `${s.full ? '전체 화면 끝내기' : '전체 화면'} <kbd>F</kbd>`;

}

// 남은 시간은 받은 값에서 이 기기 시계로 줄여 간다
function tick() {
  if (!live) return;
  const s = live.s;
  const gone = Date.now() - live.t;
  const ms = s.timer.running ? s.timer_ms - gone : s.timer_ms;
  const time = mmss(ms);
  $('t-time').textContent = time;
  $('st-timer').textContent = time;
  const going = s.timer.running && ms > 0;
  $('timer').classList.toggle('is-done', s.timer.running && ms <= 0);
  const go = `${going ? '일시정지' : '시작'} <kbd>T</kbd>`;
  if ($('t-go').innerHTML !== go) $('t-go').innerHTML = go;
  $('t-minus').disabled = going;
  $('t-plus').disabled = going;
  const draw = $('draw');
  if (draw) draw.textContent = `추첨까지 ${mmss(s.draw_ms - gone)} · 낸 학생 ${s.sheet?.entered ?? 0}`;
}

/* ---------- 딴 화면 (5초마다, 이 보드 기록 전체) ---------- */
const AWAY_MS = 5000;
const dur = (sec) => sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
let awayBusy = false;
async function loadAway() {
  const id = live?.s.board_id;
  if (!id || awayBusy) { if (!id) $('away').classList.add('hidden'); return; }
  awayBusy = true;
  try {
    const st = await getAwayStats(id);
    const list = st?.list ?? [];
    $('away').classList.remove('hidden');
    $('away-now').textContent = st.now ? `${st.now}명` : '';
    $('away-line').textContent = !st.watching ? '수업 모드가 기록하지 않는 중' : list.length ? `오늘 벗어난 학생 ${list.length}명` : '아직 없어요';
    const now = Date.now();
    $('away-list').innerHTML = list.map((r) => {
      const name = `${r.number}번 · ${r.nickname || '닉네임 미정'}`;
      const meta = r.away_now
        ? `지금 ${dur(Math.max(0, Math.round((now - Date.parse(r.since)) / 1000)))} · ${r.times}번`
        : `${r.times}번 · ${dur(r.secs)}`;
      return `<li class="${r.away_now ? 'is-now' : ''}"><span class="rm-away-n">${esc(name)}</span><small class="num">${esc(meta)}</small></li>`;
    }).join('');
  } catch (err) {
    console.warn('딴 화면', err);
  } finally {
    awayBusy = false;
  }
}

/* ---------- 시작 ---------- */
teacherGate($('app'), async () => {
  await onRemote({
    state: (p) => {
      if (!p.lid) return;
      lives.set(p.lid, { s: p, t: Date.now() });
      render();
    },
  }, (status) => {
    subscribed = status === 'SUBSCRIBED';
    if (subscribed) hello();
    render();
  });
  setInterval(hello, HELLO_MS);
  setInterval(render, 250);
  setInterval(() => { if (!document.hidden) loadAway(); }, AWAY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) hello(); });
  render();
});
