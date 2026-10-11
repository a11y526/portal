// 수업 모드 (프로젝터): 수업자료 HTML이 화면 가득, G키로 모둠활동 덮개(모둠·패들렛·순위 발표)를 열고 닫는다
// live.html?c=<반>&l=<차시>
// 수업자료 iframe은 한 번 만들면 없애거나 다시 불러오지 않는다(보던 쪽과 시뮬레이션 상태가 남게)
import { CLASSES, GRADE } from '../config.js';
import { toast, esc } from '../ui.js';
import {
  getLesson, listClasses, listBoards, getBoard, setTodayBoard, sendClassRefresh,
  getBoardGroupMembers, listSubmissions, onSubmissionsChange,
  openQuiz, closeQuiz, getQuizStats, gradeQuiz, getLatestQuiz, onQuizAnswersChange,
} from '../db.js';
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
   수업자료 HTML은 고치지 않는다. 같은 출처일 때만 지금 쪽의 빈칸을 읽는다
   ========================================================= */
// 수업자료의 '답 보기'와 같은 선택자
const ANS = '.bl, .choice span.right, .ans, .ineq-row .sym';
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const circled = (n) => CIRCLED[n - 1] ?? `(${n})`;
const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();
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

  // 지금 쪽의 빈칸 → { slideNo, items: [{ type, kind, prompt, options, answers }] }. 읽을 수 없으면 null
  readQuiz() {
    let doc, win;
    try { doc = this.el?.contentDocument; win = this.el?.contentWindow; } catch { return null; }
    if (!doc || !win) return null;
    const slides = [...doc.querySelectorAll('.slide')];
    const idx = slides.findIndex((x) => x.classList.contains('active'));
    if (idx < 0) return null;
    const slide = slides[idx];
    const found = [...slide.querySelectorAll(ANS)].filter((el) => !el.parentElement.closest(ANS));
    const no = new Map(found.map((el, i) => [el, i + 1]));

    // 빈칸이 들어 있는 줄·칸: 글자 흐름(inline)이 아닌 가장 가까운 상자
    const block = (el) => {
      let n = el.parentElement;
      while (n && n !== slide && win.getComputedStyle(n).display.startsWith('inline')) n = n.parentElement;
      return n || slide;
    };
    // 상자 글자만 (답·번호·답 보기 버튼은 빼고, 빈칸은 ①②…로)
    const textOf = (box, { drop = '' } = {}) => {
      const c = box.cloneNode(true);
      const orig = [...box.querySelectorAll('.bl')];
      [...c.querySelectorAll('.bl')].forEach((b, i) => b.replaceWith(` ( ${no.has(orig[i]) ? circled(no.get(orig[i])) : ' '} ) `));
      c.querySelectorAll(`.qnum, .reveal, .foot, svg, script, style, .ex${drop ? ', ' + drop : ''}`).forEach((x) => x.remove());
      c.querySelectorAll('br, small, td, th, div, li').forEach((x) => x.after(' '));
      return squash(c.textContent);
    };
    const title = squash(slide.querySelector('h1')?.textContent);

    const items = found.map((el) => {
      if (el.matches('.bl')) {
        const box = block(el);
        let prompt = textOf(box, { drop: '.choice, .ans' });
        if (box.tagName === 'TD') {
          const head = [...box.parentElement.children].filter((x) => x !== box && !x.querySelector('.bl')).map((x) => textOf(x, { drop: 'small' })).join(' ');
          if (head) prompt = `${head} — ${prompt}`;
        }
        return { type: 'blank', kind: 'auto', prompt, options: [], answers: [squash(el.textContent)] };
      }
      if (el.matches('.choice span.right')) {
        const choice = el.closest('.choice');
        return {
          type: 'choice', kind: 'auto',
          prompt: textOf(block(choice), { drop: '.choice, .ans' }) || title,
          options: [...choice.children].map((x) => squash(x.textContent)).filter(Boolean),
          answers: [squash(el.textContent)],
        };
      }
      if (el.matches('.ineq-row .sym')) {
        const cells = [...el.closest('.ineq-row').children];
        return {
          type: 'sym', kind: 'auto',
          prompt: `${squash(cells[0]?.textContent)}  (   )  ${squash(cells[2]?.textContent)}`,
          options: ['<', '=', '>'],
          answers: [squash(el.textContent)],
        };
      }
      // 문장 답 (.ans-box, .hint-line, .items): 교사 체크. 정답 칸에는 예시 답안
      const answer = el.matches('.items') ? [...el.children].map((x) => squash(x.textContent)).join(', ') : squash(el.textContent);
      const parent = el.parentElement;
      const prompt = parent && parent !== slide ? textOf(parent, { drop: `${ANS}, .choice` }) : '';
      return { type: 'text', kind: 'teacher', prompt: prompt || title, options: [], answers: answer ? [answer] : [] };
    });
    items.forEach((it) => { it.prompt = it.prompt.slice(0, 300); });
    return { slideNo: idx + 1, items };
  },

  focus() {
    if (!this.el) return;
    this.el.focus();
    try { this.el.contentWindow.focus(); } catch {}
  },
};

/* ---------- 키 ----------
   G: 덮개 열기/닫기 · F: live.html 전체를 전체 화면
   덮개가 열려 있으면 1·2·3 탭, T 타이머 시작·일시정지
   한글 자판에서도 먹게 e.code로 본다 */
const isEditable = (t) => !!t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

function handleKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  // 질문 확인 판: Enter 열기, Esc 취소. 판이 떠 있는 동안 다른 키는 수업자료로 가지 않는다
  if (quiz.panelOpen) {
    if (e.key === 'Escape') { quiz.hidePanel(); return true; }
    if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON') { if (!e.repeat) quiz.open(); return true; }
    if (isEditable(e.target)) return false;
    return e.code === 'KeyQ' || e.code === 'KeyG' || e.code === 'KeyF';
  }
  if (isEditable(e.target)) return false;
  if (e.code === 'KeyQ' && !coverOpen) { if (!e.repeat) quiz.onQ(); return true; }
  switch (e.code) {
    case 'KeyG': if (!e.repeat) toggleCover(); return true;
    case 'KeyF': if (!e.repeat) toggleFullscreen(); return true;
  }
  if (!coverOpen) return false;
  switch (e.code) {
    case 'Digit1': case 'Numpad1': setTab('groups'); return true;
    case 'Digit2': case 'Numpad2': setTab('padlet'); return true;
    case 'Digit3': case 'Numpad3': setTab('reveal'); return true;
    case 'KeyT': if (!e.repeat) timer.toggle(); return true;
  }
  return false;
}

const swallow = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };

// 수업자료 안: G·F만 가로채고 나머지는 수업자료가 처리. 덮개가 열려 있으면 모두 막는다(쪽이 넘어가지 않게)
function onLessonKey(e) {
  if (handleKey(e) || coverOpen || quiz.panelOpen) swallow(e);
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
   빈칸 질문 (Q)
   Q: 지금 쪽의 빈칸 → 확인 판 → 열기. 열려 있으면 Q로 마감.
   띠에는 제출 수, 마감 뒤에는 문항별 정답률만 (학생 답·이름은 프로젝터에 보이지 않는다)
   ========================================================= */
const QUIZ_POLL_MS = 5000;
const TYPE_NAME = { blank: '단어', choice: '고르기', sym: '부등호', text: '문장' };

const quiz = {
  cur: null,          // { id, slide_no, status, items }
  stats: null,
  draft: null,        // 확인 판에 띄운 { slideNo, items }
  panelOpen: false,
  busy: false,
  poll: null,
  hideTimer: null,

  onQ() {
    if (this.busy) return;
    if (!board) return toast(`이 반의 ${code}차시 보드가 없어요`, 'error');
    if (this.cur?.status === 'open') return this.close();
    const read = lessonFrame.readQuiz();
    if (!read) return toast('수업자료의 빈칸을 읽을 수 없어요', 'error');
    if (!read.items.length) return toast(`${read.slideNo}쪽에는 빈칸이 없어요`);
    this.showPanel(read);
  },

  showPanel(read) {
    this.draft = read;
    this.panelOpen = true;
    const auto = read.items.filter((it) => it.kind === 'auto').length;
    const teacher = read.items.length - auto;
    $('qz-h').textContent = `${read.slideNo}쪽 빈칸 ${read.items.length}개` +
      (teacher ? ` · 자동 ${auto} · 교사 체크 ${teacher}` : '');
    $('qz-list').innerHTML = read.items.map((it, i) => `
      <li class="qz-item" data-i="${i}">
        <div class="qz-meta">
          <b class="qz-no">${circled(i + 1)}</b>
          <span class="qz-kind ${it.kind === 'auto' ? 'is-auto' : 'is-teacher'}">${it.kind === 'auto' ? '자동' : '교사 체크'}</span>
          <span class="muted">${TYPE_NAME[it.type]}</span>
        </div>
        <label class="qz-field"><span>문제</span>
          <input class="input" type="text" maxlength="300" data-f="prompt" value="${esc(it.prompt)}"></label>
        ${it.type === 'blank' ? `
          <div class="qz-ans"><span>정답</span><b>${esc(it.answers[0] ?? '')}</b></div>
          <label class="qz-field"><span>허용 답</span>
            <input class="input" type="text" maxlength="200" data-f="extra" placeholder="쉼표로 나눠 쓰기" autocomplete="off"></label>`
        : it.type === 'text' ? `
          <div class="qz-ans"><span>예시 답안</span><b>${esc(it.answers[0] ?? '')}</b></div>`
        : `
          <div class="qz-ans"><span>선택지</span>${it.options.map((o) => `<b class="qz-opt${it.answers.includes(o) ? ' on' : ''}">${esc(o)}</b>`).join('')}</div>`}
      </li>`).join('');
    $('qz-panel').classList.remove('hidden');
    $('qz-panel').focus({ preventScroll: true });
  },

  hidePanel() {
    this.panelOpen = false;
    this.draft = null;
    $('qz-panel').classList.add('hidden');
    lessonFrame.focus();
  },

  // 확인 판에서 고친 문제 글·허용 답을 담는다
  itemsFromPanel() {
    return this.draft.items.map((it, i) => {
      const row = $('qz-list').querySelector(`[data-i="${i}"]`);
      const prompt = squash(row.querySelector('[data-f="prompt"]').value) || it.prompt;
      const extra = (row.querySelector('[data-f="extra"]')?.value || '').split(/[,，]/).map(squash).filter(Boolean);
      return { type: it.type, prompt, options: it.options, answers: [...new Set([...it.answers, ...extra])] };
    });
  },

  async open() {
    if (!this.panelOpen || this.busy) return;
    this.busy = true;
    $('qz-open').disabled = true;
    try {
      const items = this.itemsFromPanel();
      const slideNo = this.draft.slideNo;
      const res = await openQuiz(board.id, slideNo, items);
      this.cur = { id: res.id, slide_no: slideNo, status: 'open', items: res.items };
      this.stats = null;
      this.hidePanel();
      sendClassRefresh(classId);
      this.render();
      this.refresh();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      this.busy = false;
      $('qz-open').disabled = false;
    }
  },

  async close() {
    if (!this.cur || this.busy) return;
    this.busy = true;
    try {
      await closeQuiz(this.cur.id);
      this.cur.status = 'closed';
      sendClassRefresh(classId);
      this.render();
      await this.refresh();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      this.busy = false;
    }
  },

  async grade(btn) {
    if (!this.cur || this.busy) return;
    this.busy = true;
    btn.disabled = true;
    btn.textContent = '주는 중';
    try {
      const res = await gradeQuiz(this.cur.id);
      this.cur.status = 'graded';
      sendClassRefresh(classId);
      toast(res.already ? '이미 XP를 준 질문이에요' : `${res.paid}명에게 XP를 줬어요`, 'ok');
      await this.refresh();
    } catch (err) {
      toast(errMsg(err), 'error');
      btn.disabled = false;
      btn.textContent = 'XP 주기';
    } finally {
      this.busy = false;
    }
  },

  async refresh() {
    if (!this.cur) return;
    try {
      this.stats = await getQuizStats(this.cur.id);
      // 검사 화면(휴대폰)에서 XP를 줬을 수도 있다
      if (this.stats?.status) this.cur.status = this.stats.status;
      this.render();
    } catch (err) {
      console.error(err);
    }
  },

  render() {
    const band = $('qz-band');
    const q = this.cur;
    clearInterval(this.poll);
    clearTimeout(this.hideTimer);
    if (!q) { band.classList.add('hidden'); return; }
    const st = this.stats;
    const head = `<span class="qz-band-h">빈칸 ${q.slide_no}쪽</span>`;
    let html;
    if (q.status === 'open') {
      html = `${head}<span class="qz-count">제출 <b class="num">${st?.submitted ?? 0}</b> / <span class="num">${st?.total ?? '–'}</span></span><kbd>Q 마감</kbd>`;
    } else if (q.status === 'closed') {
      const rates = (st?.items ?? []).filter((it) => it.kind === 'auto')
        .map((it) => `<span class="qz-rate"><b>${circled(it.no)}</b><span class="num">${it.rate ?? 0}%</span></span>`).join('');
      const left = st?.pending_teacher ?? 0;
      html = `${head}<span class="qz-rates">${rates}</span>` +
        (left ? `<span class="qz-left">교사 체크 ${left}문항 남음</span>`
              : (st ? '<button type="button" class="btn btn-primary btn-small press" id="qz-grade">XP 주기</button>' : ''));
    } else {
      html = `${head}<span class="qz-count">XP 지급 · <b class="num">${st?.paid ?? 0}</b>명</span>`;
      this.hideTimer = setTimeout(() => { band.classList.add('hidden'); }, 8000);
    }
    band.innerHTML = html;
    band.classList.remove('hidden');
    band.classList.toggle('is-closed', q.status !== 'open');
    if (q.status !== 'graded') this.poll = setInterval(() => { if (!document.hidden) this.refresh(); }, QUIZ_POLL_MS);
  },

  async start() {
    try {
      const last = await getLatestQuiz(board.id);
      if (last && last.status !== 'graded') {
        this.cur = last;
        await this.refresh();
      }
    } catch (err) {
      console.error(err);
    }
    let t;
    onQuizAnswersChange((p) => {
      const row = p.new?.quiz_id ? p.new : p.old;
      if (!this.cur || (row?.quiz_id && row.quiz_id !== this.cur.id)) return;
      clearTimeout(t);
      t = setTimeout(() => this.refresh(), 300);
    });
  },
};

$('qz-open').addEventListener('click', () => quiz.open());
$('qz-cancel').addEventListener('click', () => quiz.hidePanel());
$('qz-band').addEventListener('click', (e) => {
  const btn = e.target.closest('#qz-grade');
  if (btn) quiz.grade(btn);
});

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
  await loadGroups();
  quiz.start();
  onSubmissionsChange((p) => {
    const row = p.new?.board_id ? p.new : p.old;
    if (!row?.board_id || row.board_id === board.id) scheduleGroups();
  });
  setInterval(() => { if (!document.hidden) loadGroups(); }, REFRESH_MS);
});

setTab('groups');
