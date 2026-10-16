// 수업 모드 (프로젝터): 수업자료 HTML이 화면 가득, G키로 모둠활동 덮개(모둠·패들렛·순위 발표)를 열고 닫는다
// live.html?c=<반>&l=<차시>
// 수업자료 iframe은 한 번 만들면 없애거나 다시 불러오지 않는다(보던 쪽과 시뮬레이션 상태가 남게)
import { CLASSES, GRADE } from '../config.js';
import { toast, esc } from '../ui.js';
import {
  getLesson, listClasses, listBoards, getBoard, setTodayBoard, sendClassRefresh, setOmokOpen,
  getBoardGroupMembers, listSubmissions, onSubmissionsChange, getWorksheetStats, setWorksheetUpto, resetWorksheetUpto,
  getWsFirst, acceptWsFirst, skipWsFirst, onWsFirstsChange, openWsPage, sendWsOpen,
} from '../db.js';
import { renderPage, closeSims } from '../worksheet.js';
import { avatarSVG, react, setWaiting } from '../avatar.js';
import { teacherGate, errMsg } from '../gate.js';

// 배경 오브는 만들지 않는다 (수업자료가 화면을 덮고 있어 보이지 않는데 계속 그려지므로)

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const classId = Number(params.get('c'));
const code = (params.get('l') || '').trim();
const REFRESH_MS = 15000;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let board = null;
let coverOpen = false;
let tab = 'groups';

/* =========================================================
   수업자료 iframe — 수업자료에 접근하는 코드는 여기에만 둔다
   수업자료 HTML은 고치지 않는다. 같은 출처일 때만 키를 먼저 받는다
   ========================================================= */
const lessonFrame = {
  el: null,
  sameOrigin: false,

  // 처음 한 번만 만든다
  mount(src) {
    if (this.el) return;
    const url = new URL(src, location.href);
    this.sameOrigin = url.origin === location.origin;
    const f = document.createElement('iframe');
    f.className = 'live-frame';
    f.title = `${code}차시 수업자료`;
    f.allow = 'autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture';
    f.src = url.href;
    f.addEventListener('load', () => {
      // 같은 출처면 키를 capture 단계에서 먼저 받는다. 막히면 구석 버튼으로
      if (!this.hookKeys()) showCorner();
      if (!coverOpen) this.focus();
    });
    $('lesson-slot').replaceChildren(f);
    this.el = f;
    if (!this.sameOrigin) showCorner();
  },

  hookKeys() {
    try {
      const win = this.el.contentWindow;
      if (win._liveHooked) return true;
      win.addEventListener('keydown', onLessonKey, true);
      win._liveHooked = true;
      return true;
    } catch {
      return false;
    }
  },

  focus() {
    if (!this.el) return;
    this.el.focus();
    try { this.el.contentWindow.focus(); } catch {}
  },

  // 지금 보이는 쪽 번호(1부터). 수업자료가 .slide 중 .active 하나를 보여 주는 구조일 때만. 모르면 null
  currentSlide() {
    try {
      const slides = [...this.el.contentWindow.document.querySelectorAll('.slide')];
      const i = slides.findIndex((s) => s.classList.contains('active'));
      return i >= 0 ? i + 1 : null;
    } catch {
      return null;
    }
  },
};

/* ---------- 키 ----------
   G: 덮개 열기/닫기 · F: live.html 전체를 전체 화면 · W: 학습지 남은 쪽 전부 열기 · Shift+W: 지금 쪽 뒤로 다시 잠그기
   덮개가 열려 있으면 1·2·3 탭, T 타이머 시작·일시정지
   S: 지금 쪽 학습지 [제출 시작] · V: [제출한 것 보기]
   첫 답 창이 떠 있으면 Enter 인정(지급한 쪽이면 다음), N 넘기기, Esc 닫기
   한글 자판에서도 먹게 e.code로 본다 */
const isEditable = (t) => !!t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

function handleKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  if (isEditable(e.target)) return false;
  switch (e.code) {
    case 'KeyG': if (!e.repeat) toggleCover(); return true;
    case 'KeyF': if (!e.repeat) toggleFullscreen(); return true;
    case 'KeyW': if (!e.repeat) { if (e.shiftKey) sheetUpto.rewind(); else sheetUpto.openAll(); } return true;
  }
  if (wsFirst.isOpen()) {
    switch (e.code) {
      case 'Enter': case 'NumpadEnter': if (!e.repeat) wsFirst.decide(!wsFirst.item.paid); return true;
      case 'KeyN': if (!e.repeat) wsFirst.decide(false); return true;
      case 'Escape': wsFirst.close(); return true;
    }
    return false;
  }
  if (!coverOpen) {
    switch (e.code) {
      case 'KeyS': if (!e.repeat) sheetBand.openPage(); return true;
      case 'KeyV': if (!e.repeat) wsFirst.view(); return true;
    }
    return false;
  }
  switch (e.code) {
    case 'Digit1': case 'Numpad1': setTab('groups'); return true;
    case 'Digit2': case 'Numpad2': setTab('padlet'); return true;
    case 'Digit3': case 'Numpad3': setTab('reveal'); return true;
    case 'KeyT': if (!e.repeat) timer.toggle(); return true;
  }
  return false;
}

const swallow = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };

// 수업자료 안: G·F만 가로채고 나머지는 수업자료가 처리. 덮개나 첫 답 창이 열려 있으면 모두 막는다(쪽이 넘어가지 않게)
function onLessonKey(e) {
  if (handleKey(e) || coverOpen || wsFirst.isOpen()) swallow(e);
}

// 바깥 문서와 덮개 안 화면(모둠 편성·순위 발표): 우리 키만 가로채고 나머지(스페이스로 다음 등)는 그 화면이 처리
function onKey(e) {
  if (handleKey(e)) swallow(e);
}
addEventListener('keydown', onKey, true);

function hookEmbed(iframe) {
  iframe.addEventListener('load', () => {
    try { iframe.contentWindow.addEventListener('keydown', onKey, true); } catch {}
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

/* ---------- 다른 출처 수업자료: 구석 버튼 ---------- */
let cornerTimer;
function showCorner() {
  $('corner').classList.remove('hidden');
}
function pokeCorner() {
  $('corner').classList.add('is-shown');
  clearTimeout(cornerTimer);
  cornerTimer = setTimeout(() => $('corner').classList.remove('is-shown'), 2500);
}
$('corner').addEventListener('pointermove', pokeCorner);
addEventListener('pointermove', pokeCorner, { passive: true });
$('corner-btn').addEventListener('click', () => toggleCover(true));

/* ---------- 덮개 ---------- */
function toggleCover(force) {
  const open = typeof force === 'boolean' ? force : !coverOpen;
  if (open === coverOpen) return;
  coverOpen = open;
  const cover = $('cover');
  cover.classList.toggle('is-open', open);
  cover.setAttribute('aria-hidden', String(!open));
  $('corner').classList.toggle('is-cover', open);
  if (open) {
    setTab(tab);
    if (tab === 'groups') loadGroups();
  } else {
    lessonFrame.focus();
  }
  wsFirst.paint();
}
$('cover-close').addEventListener('click', () => toggleCover(false));

function setTab(next) {
  tab = next;
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === next;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== next));
  if (next === 'groups') fitGroups();
  if (next === 'padlet') mountPadlet();
  if (next === 'reveal') mountReveal();
  focusPane();
}
document.querySelector('.cover-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) setTab(b.dataset.tab);
});

// 열린 탭이 키를 받게 (순위 발표는 스페이스로 다음)
function focusPane() {
  if (!coverOpen) return;
  const frame = document.querySelector(`[data-pane="${tab}"] .cover-embed:not(.hidden) iframe`);
  if (frame && tab !== 'padlet') {
    frame.focus();
    try { frame.contentWindow.focus(); } catch {}
  } else {
    $('cover').focus({ preventScroll: true });
  }
}

/* ---------- 보드가 없을 때 ---------- */
const noBoardHTML = () => `
  <div class="empty cover-empty">
    <strong>이 반의 ${esc(code)}차시 보드가 없어요</strong>
    <a class="btn btn-primary" href="index.html#boards" target="_blank" rel="noopener">보드 만들기 ↗</a>
  </div>`;

function showMsg(id, html) {
  const el = $(id);
  el.innerHTML = html;
  el.classList.toggle('hidden', !html);
}

/* =========================================================
   [모둠] 탭
   상태는 '진행 중 / 검사 대기 / 다시'만. '통과'는 발표 전까지 '검사 대기'와 똑같이 보인다
   ========================================================= */
const SHOWN = { idle: '진행 중', pending: '검사 대기', returned: '다시' };
let groups = [];          // [{ no, members: [{ number, nickname, avatar }], state }]
let membersKey;
let shownStates = new Map();
let hasSubs = false;
let groupsFrame = null;
let regrouping = false;

// 발표 전에는 통과를 검사 대기로
function displayState(status) {
  if (!status) return 'idle';
  if (status === 'passed') return board?.status === 'revealed' ? 'passed' : 'pending';
  return status;
}

let loadingGroups = false;
let loadAgain = false;
async function loadGroups() {
  if (!board) return;
  if (loadingGroups) { loadAgain = true; return; }
  loadingGroups = true;
  try {
    const [rows, subs] = await Promise.all([getBoardGroupMembers(board.id), listSubmissions(board.id)]);
    hasSubs = subs.length > 0;
    const latest = new Map(); // 모둠별 마지막 제출 (제출 시각 순으로 오므로 뒤가 마지막)
    subs.forEach((s) => latest.set(s.group_no, s.status));
    const max = rows.reduce((m, r) => Math.max(m, r.group_no), 0);
    groups = Array.from({ length: max }, (_, i) => ({
      no: i + 1,
      members: rows.filter((r) => r.group_no === i + 1).sort((a, b) => a.number - b.number),
      state: displayState(latest.get(i + 1)),
    }));
    renderGroupsPane();
  } catch (err) {
    console.error(err);
    if (!groups.length) toast(errMsg(err), 'error');
  } finally {
    loadingGroups = false;
    if (loadAgain) { loadAgain = false; loadGroups(); }
  }
}

function renderGroupsPane() {
  const none = !groups.length;
  // 편성이 없거나 '편성 다시 하기' 중이면 모둠 편성 화면을 그 자리에서
  const editing = none || regrouping;
  if (editing) mountGroupsEditor();
  $('groups-embed').classList.toggle('hidden', !editing);
  $('lg-grid').classList.toggle('hidden', editing);
  const canRegroup = !hasSubs && board?.status !== 'revealed';
  $('lg-foot').classList.toggle('hidden', none || !canRegroup);
  $('regroup').textContent = regrouping ? '모둠 카드 보기' : '편성 다시 하기';
  if (!editing) renderCards();
}

function mountGroupsEditor() {
  if (groupsFrame) return;
  groupsFrame = document.createElement('iframe');
  groupsFrame.className = 'cover-frame';
  groupsFrame.title = '모둠 편성';
  groupsFrame.src = `groups.html?c=${classId}&embed=1`;
  hookEmbed(groupsFrame);
  $('groups-embed').replaceChildren(groupsFrame);
}

$('regroup').addEventListener('click', () => {
  regrouping = !regrouping;
  if (regrouping && groupsFrame) groupsFrame.contentWindow.location.reload(); // 저장된 편성을 다시 읽게
  renderGroupsPane();
  focusPane();
});

// 모둠 편성 화면에서 확정하면 모둠 카드로
addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.classId !== classId) return;
  if (e.data.type === 'groups-saved') {
    regrouping = false;
    membersKey = undefined;
    loadGroups();
  }
  if (e.data.type === 'revealed' || e.data.type === 'unrevealed') refreshBoard();
});

function memberHTML(m) {
  return `
    <figure class="lg-mate">
      ${avatarSVG(m.avatar, 96, { label: m.nickname || `${m.number}번` })}
      <figcaption class="num">${m.number}</figcaption>
    </figure>`;
}

function renderCards() {
  const grid = $('lg-grid');
  const key = JSON.stringify(groups.map((g) => g.members.map((m) => [m.number, m.avatar])));
  if (key !== membersKey) {
    membersKey = key;
    shownStates = new Map();
    const n = groups.length;
    const cols = n <= 4 ? n : n <= 8 ? Math.ceil(n / 2) : Math.ceil(n / 3);
    grid.style.setProperty('--cols', cols);
    grid.style.setProperty('--rows', Math.ceil(n / cols));
    grid.innerHTML = groups.map((g, i) => `
      <article class="lg-card glass-strong rise" style="--d:${(i * 0.05).toFixed(2)}s" data-g="${g.no}">
        <header>
          <b>${g.no}모둠</b>
          <span class="lg-state"></span>
        </header>
        <div class="lg-mates">${g.members.map(memberHTML).join('')}</div>
      </article>`).join('');
    fitGroups();
  }
  groups.forEach((g) => {
    const card = grid.querySelector(`[data-g="${g.no}"]`);
    if (!card) return;
    const prev = shownStates.get(g.no);
    if (prev === g.state) return;
    const label = card.querySelector('.lg-state');
    const rank = g.state === 'passed' ? board?.result?.ranking?.find((r) => r.group_no === g.no)?.rank : null;
    const apply = () => {
      card.className = card.className.replace(/\bis-\w+/g, '').trim() + ` is-${g.state}`;
      label.textContent = g.state === 'passed' ? (rank ? `통과 · ${rank}위` : '통과') : SHOWN[g.state];
    };
    const svgs = [...card.querySelectorAll('svg.av')];
    svgs.forEach((s) => setWaiting(s, g.state === 'pending'));
    if (prev !== undefined) {
      card.classList.remove('morph');
      void card.offsetWidth;
      card.classList.add('morph');
      setTimeout(apply, 250); // 가장 얇을 때 바꾼다
      if (g.state === 'returned') svgs.forEach((s, i) => react(s, 'returned', { delay: i * 80 }));
    } else {
      apply();
    }
    shownStates.set(g.no, g.state);
  });
}

// 모둠 카드 안 캐릭터 크기: 카드에 다 들어가는 가장 큰 크기 (48px 이상)
function fitGroups() {
  const cards = [...$('lg-grid').querySelectorAll('.lg-card')];
  if (!cards.length || !cards[0].clientWidth) return;
  const box = cards[0].querySelector('.lg-mates');
  const W = box.clientWidth;
  const H = box.clientHeight;
  const most = Math.max(1, ...groups.map((g) => g.members.length));
  let best = 48;
  for (let per = 1; per <= most; per++) {
    const rows = Math.ceil(most / per);
    const size = Math.min((W - (per - 1) * 8) / per, (H - rows * 26) / rows - 4);
    if (size > best) best = size;
  }
  $('lg-grid').style.setProperty('--av', `${Math.floor(Math.min(best, 160))}px`);
}
addEventListener('resize', fitGroups);

/* ---------- 갱신: Realtime + 15초 ---------- */
let refreshTimer;
const scheduleGroups = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadGroups, 300);
};

async function refreshBoard() {
  if (!board) return;
  try {
    board = await getBoard(board.id) ?? board;
  } catch (err) { console.error(err); }
  membersKey = undefined; // 발표 뒤 '통과 · n위'로
  loadGroups();
}

/* =========================================================
   [패들렛] [순위 발표] 탭: 처음 열 때 만든다
   ========================================================= */
let padletMounted = false;
function mountPadlet() {
  if (padletMounted) return;
  if (!board) return showMsg('padlet-msg', noBoardHTML());
  if (!/^https?:\/\//i.test(board.padlet_src || '')) {
    return showMsg('padlet-msg', '<div class="empty cover-empty"><strong>패들렛이 연결되지 않은 보드예요</strong></div>');
  }
  padletMounted = true;
  const f = document.createElement('iframe');
  f.className = 'cover-frame';
  f.title = '패들렛';
  f.src = board.padlet_src;
  f.allow = 'camera;microphone;geolocation;display-capture;clipboard-write';
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  $('padlet-embed').replaceChildren(f);
}

let revealMounted = false;
function mountReveal() {
  if (revealMounted) return;
  if (!board) return showMsg('reveal-msg', noBoardHTML());
  revealMounted = true;
  const f = document.createElement('iframe');
  f.className = 'cover-frame';
  f.title = '순위 발표';
  f.src = `reveal.html?c=${classId}&embed=1`;
  hookEmbed(f);
  f.addEventListener('load', focusPane);
  $('reveal-embed').replaceChildren(f);
}

/* =========================================================
   타이머: 분 정하기(반마다 기억) → 시작/일시정지/초기화. 끝 시각을 기기에 저장해 새로고침해도 이어진다
   ========================================================= */
const timer = {
  key: null,
  minutes: 10,
  running: false,
  end: 0,      // 돌고 있을 때 끝나는 시각(ms)
  left: 0,     // 멈춰 있을 때 남은 시간(ms)
  tick: null,

  init(storageKey) {
    this.key = storageKey;
    this.minutes = Math.min(99, Math.max(1, Number(store.get(`timer-min-${classId}`)) || 10));
    this.left = this.minutes * 60000;
    try {
      const saved = JSON.parse(store.get(this.key) || 'null');
      if (saved && typeof saved === 'object') {
        this.minutes = saved.minutes || this.minutes;
        this.running = !!saved.running;
        this.end = Number(saved.end) || 0;
        this.left = Number(saved.left) || this.minutes * 60000;
      }
    } catch {}
    this.loop();
  },
  save() {
    store.set(this.key, JSON.stringify({ minutes: this.minutes, running: this.running, end: this.end, left: this.left }));
  },
  remaining() {
    return Math.max(0, this.running ? this.end - Date.now() : this.left);
  },
  toggle() {
    if (this.running && this.remaining() <= 0) { // 다 된 타이머는 처음부터 다시
      this.left = this.minutes * 60000;
      this.running = false;
    }
    if (this.running) {
      this.left = this.remaining();
      this.running = false;
    } else {
      if (this.remaining() <= 0) this.left = this.minutes * 60000;
      this.end = Date.now() + this.left;
      this.running = true;
    }
    this.save();
    this.loop();
  },
  reset() {
    this.running = false;
    this.left = this.minutes * 60000;
    this.save();
    this.loop();
  },
  step(d) {
    if (this.running && this.remaining() > 0) return;
    this.minutes = Math.min(99, Math.max(1, this.minutes + d));
    store.set(`timer-min-${classId}`, String(this.minutes));
    this.reset();
  },
  loop() {
    clearInterval(this.tick);
    this.draw();
    if (this.running) this.tick = setInterval(() => this.draw(), 250);
  },
  draw() {
    const ms = this.remaining();
    const s = Math.ceil(ms / 1000);
    $('timer-num').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    const done = this.running && ms <= 0;
    const box = $('timer');
    if (done && !box.classList.contains('is-done')) {
      box.classList.add('is-done');
      clearInterval(this.tick);
    }
    if (!done) box.classList.remove('is-done');
    box.classList.toggle('is-running', this.running && !done);
    $('timer-go').textContent = this.running && !done ? '일시정지' : '시작';
    $('timer-minus').disabled = this.running && !done;
    $('timer-plus').disabled = this.running && !done;
  },
};
$('timer-go').addEventListener('click', () => timer.toggle());
$('timer-reset').addEventListener('click', () => timer.reset());
$('timer-minus').addEventListener('click', () => timer.step(-1));
$('timer-plus').addEventListener('click', () => timer.step(1));

/* =========================================================
   학습지 띠: 오른쪽 아래 "학습지 완료 18 / 28" (5초마다). 학생 답·이름은 보이지 않는다
   이 차시에 학습지가 없으면 띄우지 않는다
   ========================================================= */
const SHEET_POLL_MS = 5000;
const sheetBand = {
  st: null,
  slide: null,   // 지금 보이는 수업자료 쪽 (1초마다 sheetUpto가 알려 줌)
  opening: false,
  html: '',

  async refresh() {
    if (!board) return;
    try {
      this.st = await getWorksheetStats(board.id);
      this.render();
    } catch (err) {
      console.error(err);
    }
  },

  // 지금 쪽에 칸이 있는 학습지 쪽이 있으면 [제출 시작] 또는 '제출 받는 중'. 낸 학생이 있으면 [제출한 것 보기 n]
  render() {
    const st = this.st;
    const band = $('ws-band');
    band.classList.toggle('hidden', !st?.has_sheet);
    if (!st?.has_sheet) return;
    const upto = sheetUpto.sent >= ALL_PAGES ? '모두 열림' : sheetUpto.sent > 0 ? `${sheetUpto.sent}쪽까지` : '';
    const here = (st.pages ?? []).filter((p) => p.slide === this.slide);
    const opened = new Set(st.opened ?? []);
    const open = here.length > 0 && here.every((p) => opened.has(p.page));
    const start = !here.length ? ''
      : open ? '<span class="ws-band-on">제출 받는 중</span>'
      : `<button type="button" class="btn btn-primary btn-small press" data-act="open"${this.opening ? ' disabled' : ''}>제출 시작<kbd>S</kbd></button>`;
    const view = st.waiting > 0
      ? `<button type="button" class="btn btn-line btn-small press" data-act="view">제출한 것 보기 <b class="num">${st.waiting}</b><kbd>V</kbd></button>` : '';
    const html = `<span class="ws-band-h">학습지 완료</span><b class="num">${st.done}</b><span class="num">/ ${st.total}</span>${upto ? `<span class="ws-band-h num">· ${upto}</span>` : ''}${start}${view}`;
    if (html !== this.html) band.innerHTML = this.html = html;
    band.classList.toggle('is-all', st.total > 0 && st.done >= st.total);
    band.classList.toggle('has-act', !!(start || view));
  },

  setSlide(slide) {
    if (slide === this.slide) return;
    this.slide = slide;
    if (this.st) this.render();
  },

  // [제출 시작]: 지금 수업자료 쪽에 해당하는 학습지 쪽의 제출을 연다
  async openPage() {
    const slide = lessonFrame.currentSlide();
    if (!board || this.opening || !slide) return;
    this.opening = true;
    this.render();
    try {
      await sheetUpto.push(slide);
      const pages = await openWsPage(board.id, slide);
      if (!pages?.length) {
        toast('이 쪽에는 낼 학습지 칸이 없어요');
      } else {
        sendWsOpen(classId);
        toast(`${slide}쪽 제출 시작`, 'ok');
      }
    } catch (err) {
      console.error(err);
      toast(errMsg(err), 'error');
    } finally {
      this.opening = false;
      this.refresh();
    }
  },

  start() {
    this.refresh();
    setInterval(() => { if (!document.hidden) this.refresh(); }, SHEET_POLL_MS);
  },
};
$('ws-band').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b?.dataset.act === 'open') sheetBand.openPage();
  if (b?.dataset.act === 'view') wsFirst.view();
  lessonFrame.focus();
});

/* =========================================================
   쪽별 첫 답: 학습지 쪽 칸을 모두 채워 낸 학생을 먼저 낸 순서로(쪽마다 5명까지) 한 명씩 띄운다.
   [제출한 것 보기](V)를 눌러야 뜬다. [인정] 1 XP·1코인(쪽마다 한 명)하고 창을 닫는다 · [넘기기] 다음 사람.
   지급한 쪽은 [다음]만. 다 보면 창이 닫힌다(인정·Esc로 닫으면 남은 것은 다음에 V로 다시 보기).
   덮개가 열려 있는 동안은 숨겨 두었다가 닫으면 다시 보인다
   ========================================================= */
const wsFirst = {
  item: null,
  viewing: false,
  busy: false,
  loading: false,
  again: false,

  isOpen() { return this.viewing && !!this.item && !coverOpen; },

  async view() {
    if (!board || this.viewing) return;
    this.viewing = true;
    await this.refresh();
    if (!this.item) { this.viewing = false; toast('아직 낸 학생이 없어요'); }
  },

  close() {
    this.viewing = false;
    this.item = null;
    this.paint();
  },

  async refresh() {
    if (!board || !this.viewing) return;
    if (this.loading || this.busy) { this.again = true; return; }
    this.loading = true;
    try {
      const res = await getWsFirst(board.id);
      this.show(res?.item ?? null);
    } catch (err) {
      console.error(err);
    } finally {
      this.loading = false;
      if (this.again) { this.again = false; this.refresh(); }
    }
  },

  show(item) {
    const same = item && this.item && item.id === this.item.id;
    this.item = item;
    if (!item) this.viewing = false;
    if (item && !same) this.render(item);
    else if (item) this.renderFoot(item);
    this.paint();
  },

  render(it) {
    const name = `${it.number}번${it.nickname ? ` ${it.nickname}` : ''}`;
    $('wsf-av').innerHTML = avatarSVG(it.avatar, 72, { label: `${it.number}번 캐릭터` });
    $('wsf-name').textContent = name;
    $('wsf-meta').textContent = [it.slide ? `수업자료 ${it.slide}쪽` : '', `${it.pos}번째로 냄`].filter(Boolean).join(' · ');
    const box = $('wsf-page');
    closeSims(box);
    if (it.sheet_page) renderPage(box, it.sheet_page, it.answers, { locked: true });
    else box.innerHTML = '<div class="empty"><strong>학습지가 바뀌어 이 쪽을 보여 줄 수 없어요</strong></div>';
    box.closest('.wsf-body').scrollTop = 0;
    this.renderFoot(it);
  },

  renderFoot(it) {
    const left = Math.max(0, (it.wait ?? 1) - 1);
    $('wsf-badge').textContent = it.paid ? '지급함' : '첫 답';
    $('wsf-badge').classList.toggle('is-paid', !!it.paid);
    $('wsf-note').textContent = [it.paid ? '이 쪽은 이미 지급했어요' : '', left ? `다음 ${left}명` : ''].filter(Boolean).join(' · ');
    $('wsf-ok').classList.toggle('hidden', !!it.paid);
    $('wsf-skip').querySelector('span').textContent = it.paid ? '다음' : '넘기기';
    $('wsf-skip').querySelector('kbd').textContent = it.paid ? 'Enter' : 'N';
    $('wsf-skip').classList.toggle('btn-primary', !!it.paid);
    $('wsf-skip').classList.toggle('btn-line', !it.paid);
  },

  paint() {
    const open = this.isOpen();
    const box = $('wsf');
    if (!open && !box.classList.contains('hidden')) closeSims(box);
    box.classList.toggle('hidden', !open);
    if (!open && !coverOpen) lessonFrame.focus();
  },

  async decide(accept) {
    const it = this.item;
    if (!it || this.busy) return;
    this.busy = true;
    $('wsf-ok').disabled = $('wsf-skip').disabled = true;
    let done = false; // 인정하면 창을 닫는다
    try {
      if (accept) {
        const r = await acceptWsFirst(it.id);
        if (r?.ok) {
          toast(`${it.number}번 +${r.xp} XP · +${r.coins}코인`, 'ok');
          sendClassRefresh(classId);
          done = true;
        } else {
          toast(r?.error === 'TAKEN' ? '이 쪽은 이미 다른 학생에게 지급했어요' : '이미 넘긴 답이에요', 'error');
        }
      } else {
        await skipWsFirst(it.id);
      }
      this.item = null;
    } catch (err) {
      console.error(err);
      toast(errMsg(err), 'error');
    } finally {
      this.busy = false;
      $('wsf-ok').disabled = $('wsf-skip').disabled = false;
    }
    if (done) this.close();
    else if (!this.item) this.refresh();
    sheetBand.refresh();
  },

  start() {
    onWsFirstsChange((p) => {
      const row = p.new?.board_id ? p.new : p.old;
      if (row?.board_id && row.board_id !== board.id) return;
      sheetBand.refresh();
      this.refresh();
    });
  },
};
$('wsf-ok').addEventListener('click', () => wsFirst.decide(true));
$('wsf-skip').addEventListener('click', () => wsFirst.decide(false));

/* =========================================================
   학습지 진도: 수업자료에서 지금까지 간 가장 뒤 쪽을 서버에 올린다.
   학생은 그 쪽까지의 학습지만 보고 낸다. 앞 쪽으로 돌아가도 열린 쪽은 닫히지 않는다
   ========================================================= */
const UPTO_POLL_MS = 1000;
const ALL_PAGES = 9999;
const sheetUpto = {
  sent: 0,
  busy: false,

  async push(slide) {
    if (!board || this.busy || !(slide > this.sent)) return;
    this.busy = true;
    try {
      this.sent = await setWorksheetUpto(board.id, slide) ?? slide;
      sendClassRefresh(classId);
      sheetBand.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      this.busy = false;
    }
  },
  openAll() {
    if (!board) return;
    if (this.sent >= ALL_PAGES) { toast('학습지가 이미 모두 열려 있어요'); return; }
    this.push(ALL_PAGES).then(() => { if (this.sent >= ALL_PAGES) toast('학습지를 모두 열었어요'); });
  },
  // 지금 보이는 쪽까지만 남기고 뒤 쪽은 다시 잠근다 (미리 넘겨 봤을 때)
  async rewind() {
    const slide = lessonFrame.currentSlide();
    if (!board || this.busy || !slide) return;
    this.busy = true;
    try {
      this.sent = await resetWorksheetUpto(board.id, slide) ?? slide;
      sendClassRefresh(classId);
      sheetBand.refresh();
      toast(`학습지를 ${this.sent}쪽까지로 되돌렸어요`);
    } catch (err) {
      console.error(err);
      toast(errMsg(err), 'error');
    } finally {
      this.busy = false;
    }
  },
  start() {
    this.sent = board?.ws_upto ?? 0;
    const tick = () => {
      const slide = lessonFrame.currentSlide();
      sheetBand.setSlide(slide);
      this.push(slide);
    };
    tick();
    setInterval(tick, UPTO_POLL_MS);
  },
};

/* =========================================================
   시작
   ========================================================= */
function fail(message) {
  $('lesson-slot').innerHTML = `
    <div class="empty live-empty">
      <strong>${esc(message)}</strong>
      <a class="btn btn-primary" href="index.html#lessons">수업 시작으로</a>
    </div>`;
}

let started = false;
teacherGate($('app'), async () => {
  if (started) return;
  started = true;
  if (!CLASSES.includes(classId) || !code) return fail('반과 차시가 없는 주소예요');

  const [lesson, classes, boards] = await Promise.all([getLesson(code), listClasses(), listBoards()]);
  board = boards.find((b) => b.class_id === classId && b.lesson_code === code) ?? null; // 가장 최근 것

  const title = [`${GRADE}학년 ${classId}반`, `${code}차시`, lesson?.title || board?.title].filter(Boolean).join(' · ');
  $('cover-title').textContent = title;
  document.title = `${classId}반 ${code}차시 수업`;

  // 수업 중에는 이 반 오목을 끈다 (보드가 없어도)
  if (classes.find((x) => x.id === classId)?.omok_open) {
    setOmokOpen(classId, false).then(() => sendClassRefresh(classId)).catch((err) => toast(errMsg(err), 'error'));
  }

  if (lesson?.lesson_src) lessonFrame.mount(lesson.lesson_src);
  else fail(`${code}차시 수업자료 주소가 없어요`);

  timer.init(`timer-${board?.id ?? `c${classId}-${code}`}`);

  if (!board) {
    showMsg('groups-msg', noBoardHTML());
    $('lg-grid').classList.add('hidden');
    return;
  }
  // 이 반의 오늘 보드를 이 차시로 (관리 화면을 거치지 않고 열었을 때도)
  const c = classes.find((x) => x.id === classId);
  if (c && c.today_board_id !== board.id) {
    await setTodayBoard(classId, board.id).catch((err) => toast(errMsg(err), 'error'));
    sendClassRefresh(classId);
  }
  sheetUpto.start();
  await loadGroups();
  sheetBand.start();
  wsFirst.start();
  onSubmissionsChange((p) => {
    const row = p.new?.board_id ? p.new : p.old;
    if (!row?.board_id || row.board_id === board.id) scheduleGroups();
  });
  setInterval(() => { if (!document.hidden) loadGroups(); }, REFRESH_MS);
});

setTab('groups');
