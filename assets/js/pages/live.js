// 수업 모드 (프로젝터): 수업자료 HTML이 화면 가득, G키로 모둠활동 덮개(모둠·게시판·순위 발표·퀴즈 쇼)를 열고 닫는다
// live.html?c=<반>&l=<차시>
// 수업자료 iframe은 한 번 만들면 없애거나 다시 불러오지 않는다(보던 쪽과 시뮬레이션 상태가 남게)
import { CLASSES, GRADE } from '../config.js';
import { toast, esc, groupName } from '../ui.js';
import {
  getLesson, listClasses, listBoards, getBoard, setTodayBoard, sendClassRefresh, setOmokOpen,
  getBoardGroupMembers, listSubmissions, onSubmissionsChange, getWorksheetStats, setWorksheetUpto, resetWorksheetUpto,
  getWsFirst, acceptWsFirst, skipWsFirst, unskipWsFirst, onWsFirstsChange, openWsPage, closeWsPage, unacceptWsFirst, sendWsOpen, setQuizOpen, listQuizGames,
  listPosts, teacherDeletePost, onPostsChange, cleanupPostPhotos, recordLessonTaught, setBoardSlideMax, setLessonSlideCount, updateBoard,
  onRemote, sendRemote, watchBoard, getAwayStats,
} from '../db.js';
import { boardHTML } from '../posts.js';
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

  // 휴대폰 리모컨: 수업자료에 키를 누른 것처럼 보낸다(쪽 넘기기)
  press(key) {
    pressKey(this.el, { key });
  },

  // 지금 보이는 쪽 번호(1부터). 수업자료가 .slide 중 .active 하나를 보여 주는 구조일 때만. 모르면 null
  slideCount() {
    try {
      return this.el.contentWindow.document.querySelectorAll('.slide').length || null;
    } catch {
      return null;
    }
  },

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
   덮개가 열려 있으면 1·2·3·4 탭, T 타이머 시작·일시정지
   S: 지금 쪽 학습지 [제출 시작] / 열려 있으면 [잠그기] / 잠갔으면 [다시 열기] · V: [제출한 것 보기]
   첫 답 창이 떠 있으면 Enter 인정(지급한 쪽이면 다음), N 넘기기, B 이전(방금 넘긴 답 되돌리기), Esc 닫기.
   창이 닫혀 있어도 B는 그 쪽에서 마지막으로 넘긴 답을 되돌려 창을 띄운다.
   띠의 [n번 인정]으로 인정한 답을 다시 띄우면 Enter·Esc 닫기, [인정 취소]는 눌러서만
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
      case 'Enter': case 'NumpadEnter':
        if (!e.repeat) { if (wsFirst.review) wsFirst.close(); else wsFirst.decide(!wsFirst.item.paid); }
        return true;
      case 'KeyN': if (!e.repeat && !wsFirst.review) wsFirst.decide(false); return true;
      case 'KeyB': if (!e.repeat && !wsFirst.review) wsFirst.back(); return true;
      case 'Escape': wsFirst.close(); return true;
    }
    return false;
  }
  if (!coverOpen) {
    switch (e.code) {
      case 'KeyS': if (!e.repeat) sheetBand.togglePage(); return true;
      case 'KeyV': if (!e.repeat) wsFirst.view(); return true;
      case 'KeyB': if (!e.repeat) wsFirst.back(); return true;
    }
    return false;
  }
  switch (e.code) {
    case 'Digit1': case 'Numpad1': setTab('groups'); return true;
    case 'Digit2': case 'Numpad2': setTab('board'); return true;
    case 'Digit3': case 'Numpad3': setTab('reveal'); return true;
    case 'Digit4': case 'Numpad4': setTab('quizshow'); return true;
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

// 같은 출처 iframe 안 문서에 keydown을 보낸다(휴대폰 리모컨). 막히면 아무것도 안 함
function pressKey(iframe, init) {
  try {
    const win = iframe.contentWindow;
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  } catch {}
}

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
  if (next === 'board') postBoard.show();
  if (next === 'reveal') mountReveal();
  if (next === 'quizshow') mountQuizShow();
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
  if (frame && tab !== 'board') {
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
    let [rows, subs, games] = await Promise.all([getBoardGroupMembers(board.id), listSubmissions(board.id), listQuizGames(board.id).catch(() => [])]);
    // 선생님 모둠(0)은 프로젝터에 보이지 않고 편성 다시 하기도 막지 않는다
    subs = subs.filter((s) => s.group_no !== 0);
    hasSubs = subs.length > 0;
    quiz.games = games.filter((g) => g.group_no !== 0);
    const latest = new Map(); // 모둠별 마지막 제출 (제출 시각 순으로 오므로 뒤가 마지막)
    subs.forEach((s) => latest.set(s.group_no, s.status));
    const max = rows.reduce((m, r) => Math.max(m, r.group_no), 0);
    groups = Array.from({ length: max }, (_, i) => ({
      no: i + 1,
      members: rows.filter((r) => r.group_no === i + 1).sort((a, b) => a.number - b.number),
      state: displayState(latest.get(i + 1)),
    }));
    renderGroupsPane();
    postBoard.paint();
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
  const canRegroup = !hasSubs && !quiz.games.length && board?.status !== 'revealed';
  $('lg-foot').classList.toggle('hidden', none);
  $('regroup').classList.toggle('hidden', !canRegroup);
  $('regroup').textContent = regrouping ? '모둠 카드 보기' : '편성 다시 하기';
  $('quiz-toggle').classList.toggle('hidden', editing);
  if (!editing) renderCards();
  quiz.paint();
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
          <b>${g.no}모둠<span class="lg-quiz hidden"></span></b>
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

/* =========================================================
   퀴즈 배틀: [모둠] 탭 아래 [열기/닫기]. 연 보드에서만 학생이 모둠끼리 한 판.
   닫으면 하던 판은 그 점수로 끝나고 1등에게 지급. 모둠 카드에 'n/전체' 또는 '퀴즈 끝'
   ========================================================= */
const QUIZ_POLL_MS = 5000;
const quiz = {
  games: [],
  busy: false,

  paint() {
    const open = !!board?.quiz_open;
    const btn = $('quiz-toggle');
    btn.textContent = open ? '퀴즈 배틀 닫기' : '퀴즈 배틀 열기';
    btn.classList.toggle('btn-primary', !open);
    btn.classList.toggle('btn-line', open);
    btn.disabled = this.busy || !board;
    const done = this.games.filter((x) => x.status === 'done').length;
    const playing = this.games.filter((x) => x.status === 'playing').length;
    $('quiz-note').textContent = open || this.games.length
      ? [open ? '퀴즈 배틀 열림' : '퀴즈 배틀 닫힘', playing ? `푸는 중 ${playing}` : '', done ? `끝 ${done}` : ''].filter(Boolean).join(' · ') : '';
    $('lg-grid').querySelectorAll('.lg-card').forEach((card) => {
      const g = this.games.find((x) => x.group_no === Number(card.dataset.g));
      const tag = card.querySelector('.lg-quiz');
      if (!tag) return;
      tag.classList.toggle('hidden', !g || g.status === 'lobby');
      tag.classList.toggle('is-done', g?.status === 'done');
      if (g) tag.textContent = g.status === 'done' ? '퀴즈 끝' : g.status === 'playing' ? `퀴즈 ${Math.min(g.q + 1, g.total)}/${g.total}` : '';
    });
  },

  async toggle() {
    if (!board || this.busy) return;
    const open = !board.quiz_open;
    if (!open && this.games.some((x) => x.status === 'playing') && !confirm('푸는 중인 모둠은 지금 점수로 끝나요. 닫을까요?')) return;
    this.busy = true;
    this.paint();
    try {
      await setQuizOpen(board.id, open);
      board.quiz_open = open;
      sendClassRefresh(classId);
      toast(open ? '퀴즈 배틀을 열었어요' : '퀴즈 배틀을 닫았어요', 'ok');
    } catch (err) {
      console.error(err);
      toast(errMsg(err), 'error');
    } finally {
      this.busy = false;
      loadGroups();
    }
  },

  async refresh() {
    if (!board || !coverOpen || tab !== 'groups' || !(board.quiz_open || this.games.some((x) => x.status === 'playing'))) return;
    try {
      this.games = await listQuizGames(board.id);
      this.paint();
    } catch (err) { console.error(err); }
  },
};
$('quiz-toggle').addEventListener('click', () => quiz.toggle());

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
  postBoard.paint(); // 발표 뒤에는 모든 칸
}

/* =========================================================
   [게시판] 탭: 모둠 칸 게시판(패들렛 대체)
   발표 전에는 칸마다 글 수만 보이고, [보기]를 누른 칸만 글이 보인다(발표 뒤에는 모두)
   ========================================================= */
const postBoard = {
  rows: [],
  open: new Set(), // 발표 전에 교사가 펼친 칸
  loaded: false,
  timer: null,
  async load() {
    if (!board) return;
    try {
      this.rows = await listPosts(board.id);
      this.loaded = true;
      this.paint();
    } catch (err) { console.error(err); }
  },
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 400);
  },
  show() {
    if (!board) return showMsg('board-msg', noBoardHTML());
    if (!this.loaded) this.load();
    else this.paint();
  },
  paint() {
    if (!board || tab !== 'board') return;
    const revealed = board.status === 'revealed';
    const nos = groups.length ? groups.map((g) => g.no) : [...new Set(this.rows.map((r) => r.group_no))].sort((a, b) => a - b);
    const box = $('live-board');
    if (!nos.length) {
      box.classList.add('hidden');
      showMsg('board-msg', '<div class="empty cover-empty"><strong>아직 모둠이 정해지지 않았어요</strong></div>');
      return;
    }
    showMsg('board-msg', '');
    box.classList.remove('hidden');
    const cols = nos.map((no) => {
      const list = this.rows.filter((r) => r.group_no === no).map((r) => ({
        id: r.id, title: r.title, body: r.body, link: r.link, photo: r.photo, at: r.created_at,
        nickname: r.student?.nickname, avatar: r.student?.avatar, teacher: r.student?.number === 0,
      }));
      return { no, count: list.length, posts: revealed || this.open.has(no) ? list : null };
    });
    const html = boardHTML(cols, {
      remove: true,
      hiddenText: (g) => `글 ${g.count}개`,
      colExtra: (g) => revealed ? `<span class="muted num">${g.count}개</span>`
        : `<button type="button" class="btn btn-line btn-small" data-col-toggle="${g.no}">${this.open.has(g.no) ? '가리기' : '보기'}</button>`,
    });
    if (html !== box.dataset.html) {
      box.innerHTML = html;
      box.dataset.html = html;
    }
  },
};

$('live-board').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-col-toggle]');
  if (t) {
    const no = Number(t.dataset.colToggle);
    if (postBoard.open.has(no)) postBoard.open.delete(no); else postBoard.open.add(no);
    postBoard.paint();
    return;
  }
  const del = e.target.closest('[data-post-del]');
  if (!del) return;
  const row = postBoard.rows.find((r) => r.id === del.dataset.postDel);
  if (!row || !confirm(`${row.group_no}모둠 글을 지울까요?`)) return;
  del.disabled = true;
  try {
    await teacherDeletePost(row);
    sendClassRefresh(classId);
  } catch (err) { toast(errMsg(err), 'error'); }
  postBoard.load();
});

/* =========================================================
   [순위 발표] 탭: 처음 열 때 만든다
   ========================================================= */
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
   [퀴즈 쇼] 탭: 처음 열 때 만든다(보드와 상관없음). 덮개를 닫아도 iframe은 그대로라 진행이 이어진다.
   Space·Enter는 퀴즈 쇼 화면이 받는다(다음)
   ========================================================= */
let quizShowMounted = false;
function mountQuizShow() {
  if (quizShowMounted) return;
  quizShowMounted = true;
  const f = document.createElement('iframe');
  f.className = 'cover-frame';
  f.title = '퀴즈 쇼';
  f.src = `quizshow.html?c=${classId}&embed=1`;
  hookEmbed(f);
  f.addEventListener('load', focusPane);
  $('quizshow-embed').replaceChildren(f);
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
  drawEnd: {},   // 추첨 시간이 끝나는 시각(이 기기 시계) {수업자료 쪽: ms}

  async refresh() {
    if (!board) return;
    try {
      this.st = await getWorksheetStats(board.id);
      const now = Date.now();
      this.drawEnd = Object.fromEntries(Object.entries(this.st?.draw ?? {}).map(([k, ms]) => [k, now + ms]));
      this.render();
    } catch (err) {
      console.error(err);
    }
  },

  // 지금 쪽에 칸이 있는 학습지 쪽이 있으면 [제출 시작] / [잠그기](열려 있을 때) / [다시 열기](잠갔을 때).
  // 낸 학생이 있으면 [제출한 것 보기 n], 인정한 학생이 있으면 'n번 인정' [인정 취소]
  render() {
    const st = this.st;
    const band = $('ws-band');
    band.classList.toggle('hidden', !st?.has_sheet);
    if (!st?.has_sheet) return;
    const upto = sheetUpto.sent >= ALL_PAGES ? '모두 열림' : sheetUpto.sent > 0 ? `${sheetUpto.sent}쪽까지` : '';
    const here = (st.pages ?? []).filter((p) => p.slide === this.slide);
    const opened = new Set(st.opened ?? []);
    const paused = new Set(st.paused ?? []);
    const open = here.length > 0 && here.every((p) => opened.has(p.page));
    const wasOpen = here.some((p) => paused.has(p.page));
    const dis = this.opening ? ' disabled' : '';
    const start = !here.length ? ''
      : open ? `<span class="ws-band-on">쓰는 중</span><button type="button" class="btn btn-line btn-small press" data-act="toggle"${dis}>잠그기<kbd>S</kbd></button>`
      : `<button type="button" class="btn btn-primary btn-small press" data-act="toggle"${dis}>${wasOpen ? '다시 열기' : '제출 시작'}<kbd>S</kbd></button>`;
    const acc = st.accepted?.[this.slide];
    const undo = acc != null
      ? `<button type="button" class="btn btn-line btn-small press" data-act="review">인정한 답 보기</button><button type="button" class="btn btn-line btn-small press" data-act="undo"${this.undoing ? ' disabled' : ''}>인정 취소</button>` : '';
    const waiting = st.waiting?.[this.slide] ?? 0;
    // 추첨 시간 동안은 남은 시간과 낸 학생 수만 (누가 먼저 냈는지는 보이지 않게)
    const left = Math.ceil(((this.drawEnd[this.slide] ?? 0) - Date.now()) / 1000);
    const view = left > 0
      ? `<span class="ws-band-h num">추첨까지 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · 낸 학생 ${st.entered?.[this.slide] ?? 0}</span>`
      : waiting > 0
      ? `<button type="button" class="btn btn-line btn-small press" data-act="view">제출한 것 보기 <b class="num">${waiting}</b><kbd>V</kbd></button>` : '';
    // 다 넘겨서 창이 닫힌 뒤에도 실수로 넘긴 답을 되돌릴 수 있게
    const skipped = st.skipped?.[this.slide] ?? 0;
    const back = !waiting && acc == null && skipped > 0
      ? `<button type="button" class="btn btn-line btn-small press" data-act="back">넘긴 답 되돌리기 <b class="num">${skipped}</b><kbd>B</kbd></button>` : '';
    // 모둠 학습지: 켜면 모둠 대표가 쓰고 낸 것이 모둠원 모두에게 기록된다
    const grp = `<button type="button" class="btn ${st.group ? 'btn-primary' : 'btn-line'} btn-small press" data-act="group" aria-pressed="${!!st.group}"${this.grouping ? ' disabled' : ''}>모둠 학습지 ${st.group ? '켬' : '끔'}</button>`;
    const html = `<span class="ws-band-h">학습지 완료</span><b class="num">${st.done}</b><span class="num">/ ${st.total}</span>${upto ? `<span class="ws-band-h num">· ${upto}</span>` : ''}${grp}${start}${view}${back}${undo}`;
    if (html !== this.html) band.innerHTML = this.html = html;
    band.classList.toggle('is-all', st.total > 0 && st.done >= st.total);
    band.classList.toggle('has-act', !!(start || view || back || undo));
  },

  // [모둠 학습지 켬/끔]: 과학실처럼 모둠마다 기기 하나로 쓸 때 켠다. 학생 기기는 반 새로고침 신호로 바로 바뀜
  async toggleGroup() {
    if (!board || this.grouping || !this.st) return;
    const on = !this.st.group;
    if (!on && !confirm('모둠 학습지를 끌까요? 이미 함께 기록된 답은 그대로 두고, 이제부터는 각자 기록해요')) return;
    this.grouping = true;
    this.render();
    try {
      board = await updateBoard(board.id, { ws_group: on });
      sendClassRefresh(classId);
      toast(on ? '모둠 학습지 켬' : '모둠 학습지 끔', 'ok');
    } catch (err) {
      console.error(err);
      toast(errMsg(err), 'error');
    } finally {
      this.grouping = false;
      this.refresh();
    }
  },

  setSlide(slide) {
    if (slide === this.slide) return;
    this.slide = slide;
    if (this.st) this.render();
  },

  // S: 지금 수업자료 쪽에 해당하는 학습지 쪽을 연다(쓰기·제출). 열려 있으면 잠근다
  async togglePage() {
    const slide = lessonFrame.currentSlide();
    if (!board || this.opening || !slide) return;
    const here = (this.st?.pages ?? []).filter((p) => p.slide === slide);
    const opened = new Set(this.st?.opened ?? []);
    const close = here.length > 0 && here.every((p) => opened.has(p.page));
    this.opening = true;
    this.render();
    try {
      if (close) {
        await closeWsPage(board.id, slide);
        sendWsOpen(classId);
        toast(`${slide}쪽 잠금`, 'ok');
        return;
      }
      await sheetUpto.push(slide);
      const pages = await openWsPage(board.id, slide);
      if (!pages?.length) {
        toast('이 쪽에는 낼 학습지 칸이 없어요');
      } else {
        sendWsOpen(classId);
        toast(`${slide}쪽 열림`, 'ok');
      }
    } catch (err) {
      console.error(err);
      toast(errMsg(err), 'error');
    } finally {
      this.opening = false;
      this.refresh();
    }
  },

  // [인정 취소]: 지금 쪽에서 인정한 학생의 XP·코인을 거두고, 닫혔던 줄을 다시 V로 볼 수 있게
  async undoAccept() {
    const slide = this.slide;
    const no = this.st?.accepted?.[slide];
    if (!board || this.undoing || no == null) return;
    if (!confirm('인정을 취소할까요? 준 XP·코인을 거둬요')) return false;
    this.undoing = true;
    this.render();
    try {
      const r = await unacceptWsFirst(board.id, slide);
      if (r?.ok) {
        toast(`인정 취소 (−${r.xp} XP · −${r.coins}코인)`, 'ok');
        sendClassRefresh(classId);
        return true;
      } else {
        toast('취소할 인정이 없어요', 'error');
      }
    } catch (err) {
      console.error(err);
      toast(errMsg(err), 'error');
    } finally {
      this.undoing = false;
      this.refresh();
    }
  },

  start() {
    this.refresh();
    setInterval(() => { if (!document.hidden) this.refresh(); }, SHEET_POLL_MS);
    // 추첨까지 남은 시간: 1초마다 다시 그리고, 끝나면 바로 다시 읽기
    setInterval(() => {
      const ends = Object.entries(this.drawEnd);
      if (!ends.length) return;
      const now = Date.now();
      if (ends.some(([, t]) => t <= now)) {
        this.drawEnd = Object.fromEntries(ends.filter(([, t]) => t > now));
        this.refresh();
      }
      this.render();
    }, 1000);
  },
};
$('ws-band').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b?.dataset.act === 'toggle') sheetBand.togglePage();
  if (b?.dataset.act === 'group') sheetBand.toggleGroup();
  if (b?.dataset.act === 'undo') sheetBand.undoAccept();
  if (b?.dataset.act === 'review') wsFirst.view(true);
  if (b?.dataset.act === 'view') wsFirst.view();
  if (b?.dataset.act === 'back') wsFirst.back();
  lessonFrame.focus();
});

/* =========================================================
   쪽별 첫 답: 학습지 쪽 칸을 모두 채워 낸 학생을 추첨 순서로 한 명씩 띄운다.
   [제출 시작] 뒤 추첨 시간(settings.ws_first.draw초) 안에 낸 학생은 이번 달 인정 덜 받은 순 → 무작위, 늦게 낸 학생은 뒤에 낸 순서로.
   추첨 시간이 끝나기 전에는 V를 눌러도 뜨지 않는다(서버도 막음).
   [제출한 것 보기](V)를 눌러야 뜨고, 지금 보이는 수업자료 쪽의 줄만 보여 준다.
   [인정] 1 XP·1코인 → 창을 닫고 그 쪽은 끝(남은 사람은 서버가 닫음) · [넘기기] 다음 사람 · [이전] 방금 넘긴 사람 다시.
   다 넘기면 창이 닫힌다. Esc로 닫으면 남은 것은 그 쪽에서 V로 다시 보기
   덮개가 열려 있는 동안은 숨겨 두었다가 닫으면 다시 보인다
   ========================================================= */
const wsFirst = {
  item: null,
  viewing: false,
  review: false, // 인정한 답 다시 보기(띠의 [n번 인정 보기])
  slide: null,   // 보고 있는 수업자료 쪽
  busy: false,
  loading: false,
  again: false,

  isOpen() { return this.viewing && !!this.item && !coverOpen; },

  async view(review = false) {
    const slide = lessonFrame.currentSlide();
    if (!board || this.viewing || !slide) return;
    this.slide = slide;
    this.review = review;
    this.viewing = true;
    this.drawMs = 0;
    await this.refresh();
    if (!this.item) {
      this.viewing = false;
      this.review = false;
      toast(review ? '이 쪽에 인정한 답이 없어요'
        : this.drawMs > 0 ? `추첨까지 ${Math.ceil(this.drawMs / 1000)}초 남았어요` : '이 쪽에 낸 학생이 없어요');
    }
  },

  close() {
    this.viewing = false;
    this.review = false;
    this.item = null;
    this.paint();
  },

  // [이전](B): 그 쪽에서 마지막으로 넘긴 답을 다시 대기로 돌려 창에 띄운다(추첨 순서가 앞이라 맨 앞에 옴)
  async back() {
    const slide = this.viewing ? this.slide : lessonFrame.currentSlide();
    if (!board || this.busy || this.review || !slide) return;
    this.busy = true;
    let ok = false;
    try {
      const r = await unskipWsFirst(board.id, slide);
      if (r?.ok) ok = true;
      else toast(r?.error === 'TAKEN' ? '이 쪽은 이미 인정했어요. 인정 취소 먼저' : '넘긴 답이 없어요');
    } catch (err) {
      console.error(err);
      toast(errMsg(err), 'error');
    } finally {
      this.busy = false;
    }
    if (ok) {
      this.slide = slide;
      this.viewing = true;
      await this.refresh();
    }
    sheetBand.refresh();
  },

  async refresh() {
    if (!board || !this.viewing) return;
    if (this.loading || this.busy) { this.again = true; return; }
    this.loading = true;
    try {
      const res = await getWsFirst(board.id, this.slide, this.review);
      this.drawMs = res?.draw_ms ?? 0;
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
    if (!item) { this.viewing = false; this.review = false; }
    if (item && !same) this.render(item);
    else if (item) this.renderFoot(item);
    this.paint();
  },

  render(it) {
    // 프로젝터라 번호는 보이지 않게 승인된 닉네임만 (3절 6)
    const name = it.nickname || '닉네임 미정';
    $('wsf-av').innerHTML = avatarSVG(it.avatar, 72, { label: `${name} 캐릭터` });
    $('wsf-name').textContent = it.group_no ? `${groupName(it.group_no)} · ${name}` : name;
    $('wsf-meta').textContent = [it.slide ? `수업자료 ${it.slide}쪽` : '', it.late ? `늦게 냄 · ${it.pos}번째` : `추첨 ${it.pos}번째`, this.review ? '인정함' : ''].filter(Boolean).join(' · ');
    const box = $('wsf-page');
    closeSims(box);
    if (it.sheet_page) renderPage(box, it.sheet_page, it.answers, { locked: true });
    else box.innerHTML = '<div class="empty"><strong>학습지가 바뀌어 이 쪽을 보여 줄 수 없어요</strong></div>';
    box.closest('.wsf-body').scrollTop = 0;
    this.renderFoot(it);
  },

  renderFoot(it) {
    const ok = $('wsf-ok');
    const skip = $('wsf-skip');
    $('wsf-back').classList.toggle('hidden', this.review || !it.skipped);
    if (this.review) {
      $('wsf-badge').textContent = '인정함';
      $('wsf-badge').classList.add('is-paid');
      $('wsf-note').textContent = '';
      ok.classList.remove('hidden', 'btn-primary');
      ok.classList.add('btn-line');
      ok.querySelector('span').textContent = '인정 취소';
      ok.querySelector('kbd').classList.add('hidden');
      skip.classList.remove('btn-line');
      skip.classList.add('btn-primary');
      skip.querySelector('span').textContent = '닫기';
      skip.querySelector('kbd').textContent = 'Esc';
      return;
    }
    ok.classList.remove('btn-line');
    ok.classList.add('btn-primary');
    ok.querySelector('span').textContent = '인정';
    ok.querySelector('kbd').classList.remove('hidden');
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
    if (this.review) {
      // 다시 보기: [인정 취소]는 확인 창 뒤 취소하고 닫기, [닫기]는 그냥 닫기
      if (accept && !(await sheetBand.undoAccept())) return;
      this.close();
      return;
    }
    this.busy = true;
    $('wsf-ok').disabled = $('wsf-skip').disabled = $('wsf-back').disabled = true;
    let done = false; // 인정하면 창을 닫는다
    try {
      if (accept) {
        const r = await acceptWsFirst(it.id);
        if (r?.ok) {
          const who = it.group_no ? `${groupName(it.group_no)}${r.members > 1 ? ` ${r.members}명` : ''}` : it.nickname || '닉네임 미정';
          toast(`${who} +${r.xp} XP · +${r.coins}코인`, 'ok');
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
      $('wsf-ok').disabled = $('wsf-skip').disabled = $('wsf-back').disabled = false;
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
$('wsf-back').addEventListener('click', () => wsFirst.back());

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

// 진도 관리: 수업자료 쪽 수를 차시에 적고, 이 보드에서 실제로 간 가장 뒤 쪽을 보드에 적는다(W 전부 열기와 상관없음)
const progressMark = {
  max: 0,
  counted: false,
  start(lesson) {
    this.max = board?.slide_max ?? 0;
    setInterval(() => {
      const n = lessonFrame.slideCount();
      if (n && !this.counted) {
        this.counted = true;
        if (lesson?.slide_count !== n) setLessonSlideCount(code, n).catch((err) => console.warn('쪽 수', err));
      }
      const slide = lessonFrame.currentSlide();
      if (board && slide > this.max) {
        const before = this.max;
        this.max = slide;
        setBoardSlideMax(board.id, slide).catch((err) => { this.max = before; console.warn('진도', err); });
      }
    }, UPTO_POLL_MS);
  },
};

/* =========================================================
   딴 화면: 1분마다 '수업 중'(watch_board, 학생 기기는 이때만 적음),
   5초마다 지금 벗어난 학생 수를 왼쪽 아래에 숫자만. 누가 벗어났는지는 휴대폰 리모컨에서만 보인다
   ========================================================= */
const AWAY_WATCH_MS = 60000;
const AWAY_POLL_MS = 5000;
const away = {
  now: 0,

  start() {
    const watch = () => watchBoard(board.id, true).catch((err) => console.warn('딴 화면', err));
    watch();
    setInterval(watch, AWAY_WATCH_MS);
    setInterval(() => this.refresh(), AWAY_POLL_MS);
  },

  async refresh() {
    try {
      const st = await getAwayStats(board.id);
      this.now = st?.now ?? 0;
    } catch (err) {
      console.warn('딴 화면', err);
      return;
    }
    const chip = $('away-chip');
    chip.classList.toggle('hidden', !this.now);
    $('away-n').textContent = this.now;
  },
};

/* =========================================================
   휴대폰 리모컨(teacher/remote.html): 비공개 채널 'remote'(교사만, 02_policies)로 명령을 받고 상태를 보낸다.
   리모컨은 가장 최근에 연 수업 모드(at가 가장 큰 것) 하나에만 명령을 보낸다(to = lid).
   명령은 아래 이름만 받고, 키를 누른 것과 같은 조건에서만 동작한다.
   상태는 리모컨이 15초 안에 hello를 보냈을 때만, 바뀌면 바로·아니면 4초마다
   ========================================================= */
const REMOTE_SEEN_MS = 15000;
const REMOTE_BEAT_MS = 4000;
const remote = {
  lid: Math.random().toString(36).slice(2, 10),
  at: Date.now(),
  seen: 0,
  last: '',
  beat: 0,

  start() {
    onRemote({
      hello: () => { this.seen = Date.now(); this.send(true); },
      cmd: (p) => {
        if (p.to !== this.lid) return;
        this.seen = Date.now();
        this.run(String(p.act ?? ''));
      },
    }).catch((err) => console.warn('리모컨', err));
    setInterval(() => this.send(false), 500);
  },

  run(act) {
    const first = wsFirst.isOpen();
    switch (act) {
      case 'prev': case 'next':
        if (!coverOpen && !first) lessonFrame.press(act === 'next' ? 'ArrowRight' : 'ArrowLeft');
        return;
      case 'answer': // 수업자료 A키(답 하나씩 보기)
        if (!coverOpen && !first) lessonFrame.press('a');
        return;
      case 'cover': toggleCover(); return;
      case 'full': toggleFullscreen(); return;
      case 'groups': case 'board': case 'reveal': case 'quizshow':
        if (coverOpen) setTab(act);
        else { tab = act; toggleCover(true); }
        return;
      case 'timer': timer.toggle(); return;
      case 'timer-reset': timer.reset(); return;
      case 'timer-minus': timer.step(-1); return;
      case 'timer-plus': timer.step(1); return;
      case 'sheet': if (!coverOpen && !first) sheetBand.togglePage(); return;
      case 'view': if (!coverOpen && !first) wsFirst.view(); return;
      case 'back': if (!coverOpen && !(first && wsFirst.review)) wsFirst.back(); return;
      case 'open-all': sheetUpto.openAll(); return;
      case 'rewind': sheetUpto.rewind(); return;
      case 'wsf-ok': if (first && !wsFirst.review && !wsFirst.item.paid) wsFirst.decide(true); return;
      case 'wsf-skip': if (first && !wsFirst.review) wsFirst.decide(false); return;
      case 'wsf-close': if (first) wsFirst.close(); return;
      case 'embed-next': if (coverOpen) this.embedNext(); return;
    }
  },

  // 덮개 [순위 발표]·[퀴즈 쇼] 화면의 '다음'(스페이스와 같음). 발표 준비 화면이면 [순위 발표] 버튼
  embedNext() {
    const f = document.querySelector(`[data-pane="${tab}"] .cover-embed iframe`);
    if (!f) return;
    if (tab === 'reveal') {
      const st = this.revealState();
      if (st === 'ready') { try { f.contentWindow.document.getElementById('start').click(); } catch {} }
      else if (st === 'stage') pressKey(f, { key: ' ', code: 'Space' });
    } else if (tab === 'quizshow') {
      pressKey(f, { key: ' ', code: 'Space' });
    }
  },

  // 순위 발표 화면: 'ready'(발표 전 [순위 발표] 버튼) | 'stage'(공개 중) | null
  revealState() {
    try {
      const d = $('reveal-embed').querySelector('iframe')?.contentWindow.document;
      if (!d) return null;
      if (!d.getElementById('stage').classList.contains('hidden')) return 'stage';
      const start = d.getElementById('start');
      return start && !start.classList.contains('hidden') && !start.disabled ? 'ready' : null;
    } catch {
      return null;
    }
  },

  state() {
    const slide = lessonFrame.currentSlide();
    const st = sheetBand.st;
    let sheet = null;
    let drawMs = 0;
    if (st?.has_sheet) {
      const here = (st.pages ?? []).filter((p) => p.slide === slide);
      const opened = new Set(st.opened ?? []);
      const paused = new Set(st.paused ?? []);
      drawMs = Math.max(0, (sheetBand.drawEnd[slide] ?? 0) - Date.now());
      sheet = {
        done: st.done, total: st.total, upto: sheetUpto.sent, group: !!st.group,
        here: here.length > 0,
        open: here.length > 0 && here.every((p) => opened.has(p.page)),
        was_open: here.some((p) => paused.has(p.page)),
        busy: !!sheetBand.opening,
        drawing: drawMs > 0,
        entered: st.entered?.[slide] ?? 0,
        waiting: st.waiting?.[slide] ?? 0,
        skipped: st.skipped?.[slide] ?? 0,
        accepted: st.accepted?.[slide] != null,
      };
    }
    let first = null;
    if (wsFirst.isOpen()) {
      const it = wsFirst.item;
      const name = it.nickname || '닉네임 미정';
      first = {
        name: it.group_no ? `${groupName(it.group_no)} · ${name}` : name,
        meta: it.late ? `늦게 냄 · ${it.pos}번째` : `추첨 ${it.pos}번째`,
        paid: !!it.paid, review: wsFirst.review, skipped: !!it.skipped, busy: !!wsFirst.busy,
      };
    }
    return {
      stable: {
        cls: classId, code, title: $('cover-title').textContent, board: !!board, board_id: board?.id ?? null, away: away.now,
        slide, slides: lessonFrame.slideCount(), same: lessonFrame.sameOrigin,
        cover: coverOpen, tab, full: !!document.fullscreenElement,
        reveal: coverOpen && tab === 'reveal' ? this.revealState() : null,
        timer: { running: timer.running, end: timer.end, left: timer.left, minutes: timer.minutes },
        sheet, first,
      },
      timerMs: timer.remaining(),
      drawMs,
    };
  },

  send(force) {
    if (Date.now() - this.seen > REMOTE_SEEN_MS) return;
    const { stable, timerMs, drawMs } = this.state();
    const key = JSON.stringify(stable);
    const now = Date.now();
    if (!force && key === this.last && now - this.beat < REMOTE_BEAT_MS) return;
    this.last = key;
    this.beat = now;
    sendRemote('state', { ...stable, timer_ms: timerMs, draw_ms: drawMs, lid: this.lid, at: this.at });
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

  // 진도 관리: 오늘 이 반 수업 줄에 이 차시를 적고 다음 차시를 넘긴다(오늘 이 반 수업이 없으면 그대로)
  recordLessonTaught(classId, code).catch((err) => console.warn('진도 기록', err));

  if (lesson?.lesson_src) lessonFrame.mount(lesson.lesson_src);
  else fail(`${code}차시 수업자료 주소가 없어요`);
  progressMark.start(lesson);
  remote.start();

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
  away.start();
  await loadGroups();
  sheetBand.start();
  wsFirst.start();
  onSubmissionsChange((p) => {
    const row = p.new?.board_id ? p.new : p.old;
    if (!row?.board_id || row.board_id === board.id) scheduleGroups();
  });
  // 게시판: 지운 글은 board_id가 안 올 수 있어서 모두 다시 읽는다
  onPostsChange((p) => {
    const row = p.new?.board_id ? p.new : p.old;
    if (!row?.board_id || row.board_id === board.id) postBoard.schedule();
  });
  setInterval(() => { if (!document.hidden && coverOpen && tab === 'board') postBoard.load(); }, 5000);
  cleanupPostPhotos().catch((err) => console.error(err)); // 끝난 차시 사진 지우기
  setInterval(() => { if (!document.hidden) loadGroups(); }, REFRESH_MS);
  setInterval(() => { if (!document.hidden) quiz.refresh(); }, QUIZ_POLL_MS);
});

setTab('groups');
