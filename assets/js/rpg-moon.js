// 712 「다누리 탐사대장」 달 자원 RPG — 게임 본체 로직
// 순수 Canvas + ES 모듈. 저사양(.lite) 기기를 위해 캐릭터가 움직일 때만 캔버스를 다시 그린다.

import {
  INITIAL_STATS,
  STAT_META,
  HEROES,
  NPCS,
  SPOTS,
  EVENTS,
  ENDINGS,
  FALLBACK_SOLUTIONS,
  LPC_CREDITS,
  MEETING_RECALL,
} from './rpg-moon-data.js';

const ROOT_URL = new URL('../../', import.meta.url);
const assetUrl = (rel) => new URL(rel, ROOT_URL).href;

const CW = 800;
const CH = 480;
const SKY_H = 76;
const SPEED = 210; // 초당 이동 픽셀
const INTERACT_R = 54;
const ROW = { up: 0, left: 1, down: 2, right: 3 };

const clampStat = (v) => Math.max(0, Math.min(100, Math.round(v)));

// 안전한 localStorage 접근 (sandbox="allow-scripts" 안에서는 예외 무시)
const safeStore = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const isSandboxed = () => {
  try {
    return window.origin === 'null' || !window.localStorage;
  } catch {
    return true;
  }
};

// 인라인 SVG 선 아이콘 (포탈 규칙: 이모지 금지)
const ICONS = {
  res: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 21 8.5 17.5 21 6.5 21 3 8.5 12 2"/><path d="M3 8.5h18"/><path d="M12 2l-3.5 6.5L12 21l3.5-12.5L12 2z"/></svg>`,
  trust: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/></svg>`,
  peace: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  lock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  silver: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h5M9.5 13.5h5"/></svg>`,
};

// 달 표면 배경 장식 (고정 크레이터·별 좌표)
const STARS = [
  [38, 18, 1.5], [92, 42, 1], [148, 22, 2], [210, 52, 1.2], [275, 16, 1.5],
  [334, 38, 1], [448, 20, 1.8], [512, 48, 1.2], [585, 25, 1.5], [640, 54, 1],
  [702, 18, 2], [758, 40, 1.4], [125, 60, 1], [485, 14, 1.2], [672, 32, 1.5],
];

const CRATERS = [
  { x: 95, y: 235, rx: 34, ry: 15 },
  { x: 310, y: 215, rx: 26, ry: 12 },
  { x: 515, y: 230, rx: 32, ry: 14 },
  { x: 285, y: 345, rx: 38, ry: 16 },
  { x: 535, y: 420, rx: 28, ry: 12 },
  { x: 725, y: 255, rx: 30, ry: 13 },
  { x: 110, y: 435, rx: 25, ry: 11 },
];

export function initMoonRpg() {
  const $ = (id) => document.getElementById(id);

  // 저사양 감지 (.lite)
  const isLite =
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    matchMedia('(prefers-reduced-transparency: reduce)').matches;
  if (isLite) document.documentElement.classList.add('lite');

  // 상태
  let tab = 'game';
  let screen = 'start'; // 'start' | 'map' | 'ending'
  let heroId = 'boy';
  let stats = { ...INITIAL_STATS };
  let choices = []; // [{ event, pick }]
  const doneEvents = new Set();
  let activeEvent = null;
  let pickedChoice = null;

  // 포탈 연동 상태
  let portalInfo = {
    logged: false,
    nickname: '탐사대장',
    silver: 5,
    rewarded: false,
  };
  let finishBusy = false;
  let pendingFinish = null;
  let finishSent = false; // 이번 엔딩 결과를 서버에 보냈는지(또는 보낼 필요가 없는지)
  let endingId = null;

  // 플레이어 좌표·이동
  const player = {
    x: 165,
    y: 398,
    dir: 'down',
    moving: false,
    targetX: null,
    targetY: null,
    targetSpot: null,
  };
  const keys = new Set();
  let nearSpot = null;

  // 이미지 캐시
  const sprites = {};
  let spritesReady = false;

  // 캔버스
  const canvas = $('rpg-canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let rafId = 0;
  let lastTs = 0;

  /* ---------- 배경 사진 연결 ---------- */
  $('start-bg').style.backgroundImage = `url("${assetUrl('assets/img/rpg/danuri.jpg')}")`;
  $('end-bg').style.backgroundImage = `url("${assetUrl('assets/img/rpg/moonbase.jpg')}")`;

  /* ---------- 스프라이트 불러오기 ---------- */
  function loadSprites() {
    const list = [
      ['boy', HEROES[0].sprite],
      ['girl', HEROES[1].sprite],
      ['arte', NPCS.arte.sprite],
      ['corp', NPCS.corp.sprite],
      ['south', NPCS.south.sprite],
      ['chair', NPCS.chair.sprite],
    ];
    let left = list.length;
    list.forEach(([key, rel]) => {
      const img = new Image();
      img.onload = () => {
        sprites[key] = img;
        left -= 1;
        if (left === 0) {
          spritesReady = true;
          drawHeroPreviews();
          requestRender();
        }
      };
      img.src = assetUrl(rel);
    });
  }

  // 시작 화면 캐릭터 미리보기 캔버스 (정수 2배율: 64→128)
  function drawSpriteFrame(targetCanvas, spriteKey, scale = 2) {
    if (!targetCanvas) return;
    const c = targetCanvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    const img = sprites[spriteKey];
    if (!img) return;
    c.drawImage(img, 0, ROW.down * 64, 64, 64, 0, 0, 64 * scale, 64 * scale);
  }

  function drawHeroPreviews() {
    drawSpriteFrame($('prev-boy'), 'boy', 2);
    drawSpriteFrame($('prev-girl'), 'girl', 2);
  }

  /* ---------- 탭 전환 ([게임] / [규칙]) ---------- */
  function setTab(nextTab) {
    tab = nextTab;
    document.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('v-rules').classList.toggle('hidden', tab !== 'rules');
    $('v-game').classList.toggle('hidden', tab !== 'game');
    if (tab === 'game' && screen === 'map') requestRender();
  }

  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  });
  $('rules-go').addEventListener('click', () => setTab('game'));

  /* ---------- 크레딧 모달 ---------- */
  $('credits-txt').textContent = LPC_CREDITS;
  $('btn-credits').addEventListener('click', () => {
    $('dlg-credits').classList.remove('hidden');
    $('btn-credits-close').focus();
  });
  $('btn-credits-close').addEventListener('click', () => {
    $('dlg-credits').classList.add('hidden');
  });

  /* ---------- 캐릭터 선택 ---------- */
  function selectHero(id) {
    heroId = id;
    document.querySelectorAll('[data-hero]').forEach((btn) => {
      const on = btn.dataset.hero === id;
      btn.classList.toggle('is-picked', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }
  document.querySelectorAll('[data-hero]').forEach((btn) => {
    btn.addEventListener('click', () => selectHero(btn.dataset.hero));
  });

  /* ---------- 스탯 표시 & 플로팅 숫자 ---------- */
  function renderStats(deltas = null) {
    STAT_META.forEach(({ key }) => {
      const val = stats[key];
      const bar = $(`stat-bar-${key}`);
      const num = $(`stat-val-${key}`);
      if (bar) bar.style.transform = `scaleX(${val / 100})`;
      if (num) num.textContent = String(val);

      if (deltas && deltas[key]) {
        const d = deltas[key];
        const fl = $(`stat-delta-${key}`);
        if (fl) {
          fl.textContent = d > 0 ? `+${d}` : String(d);
          fl.className = 'rpg-delta ' + (d > 0 ? 'is-up' : 'is-down');
          void fl.offsetWidth;
          fl.classList.add('is-show');
        }
      }
    });

    const preDone = [...doneEvents].filter((id) => id !== 7).length;
    $('stat-prog').textContent = `${preDone} / 6`;
    $('hq-ready-chip').classList.toggle('hidden', preDone < 3 || doneEvents.has(7));
  }

  /* ---------- 화면 전환 ---------- */
  function showScreen(next) {
    screen = next;
    $('scr-start').classList.toggle('hidden', next !== 'start');
    $('scr-map').classList.toggle('hidden', next !== 'map');
    $('scr-end').classList.toggle('hidden', next !== 'ending');
    if (next === 'map') {
      lastTs = performance.now();
      requestRender();
    }
  }

  function startNewGame() {
    stats = { ...INITIAL_STATS };
    choices = [];
    doneEvents.clear();
    activeEvent = null;
    pickedChoice = null;
    player.x = 165;
    player.y = 398;
    player.dir = 'down';
    player.moving = false;
    player.targetX = null;
    player.targetY = null;
    player.targetSpot = null;
    finishSent = false;
    endingId = null;
    $('dlg-event').classList.add('hidden');
    renderStats();
    showScreen('map');
    updatePrompt();
    saveProgress();
  }

  $('btn-start').addEventListener('click', startNewGame);
  $('btn-again').addEventListener('click', startNewGame);
  $('btn-restart')?.addEventListener('click', () => {
    if (activeEvent) return;
    if (!confirmRestart()) return;
    startNewGame();
  });
  // sandbox iframe에서는 confirm()이 막혀 있으므로 두 번 눌러 확인
  let restartArmed = 0;
  function confirmRestart() {
    const btn = $('btn-restart');
    if (Date.now() - restartArmed < 3000) { restartArmed = 0; btn.textContent = '처음부터'; return true; }
    restartArmed = Date.now();
    btn.textContent = '한 번 더 누르면 처음부터';
    setTimeout(() => { if (restartArmed && Date.now() - restartArmed >= 3000) { restartArmed = 0; btn.textContent = '처음부터'; } }, 3100);
    return false;
  }

  /* ---------- 이벤트 열림 가능 여부 ---------- */
  function isSpotUnlocked(spot) {
    if (!spot.needCount) return true;
    const preDone = [...doneEvents].filter((id) => id !== 7).length;
    return preDone >= spot.needCount;
  }

  function findNearestSpot() {
    let best = null;
    let bestDist = INTERACT_R;
    for (const sp of SPOTS) {
      const d = Math.hypot(player.x - sp.x, player.y - (sp.y + 12));
      if (d <= bestDist) {
        best = sp;
        bestDist = d;
      }
    }
    return best;
  }

  function updatePrompt() {
    nearSpot = findNearestSpot();
    const btn = $('btn-interact');
    if (!nearSpot || activeEvent) {
      btn.classList.add('hidden');
      return;
    }
    const unlocked = isSpotUnlocked(nearSpot);
    const done = doneEvents.has(nearSpot.eventId);
    btn.classList.remove('hidden');
    if (!unlocked) {
      const preDone = [...doneEvents].filter((id) => id !== 7).length;
      btn.disabled = true;
      btn.innerHTML = `${ICONS.lock}<span>${nearSpot.name} (다른 지점 ${nearSpot.needCount - preDone}곳 더 탐사 필요)</span>`;
    } else if (done) {
      btn.disabled = true;
      btn.innerHTML = `${ICONS.check}<span>${nearSpot.name} 탐사 완료</span>`;
    } else {
      btn.disabled = false;
      btn.innerHTML = `<span>${nearSpot.name} 조사하기 (Space)</span>`;
    }
  }

  $('btn-interact').addEventListener('click', () => {
    if (nearSpot) triggerSpot(nearSpot);
  });

  function triggerSpot(spot) {
    if (activeEvent) return;
    if (!isSpotUnlocked(spot)) return;

    const evId = spot.eventId;
    if (doneEvents.has(evId)) return;
    const ev = EVENTS.find((e) => e.id === evId);
    if (!ev) return;
    openEventModal(ev);
  }

  /* ---------- 이벤트 대화 모달 ---------- */
  function openEventModal(ev) {
    activeEvent = ev;
    pickedChoice = null;
    player.moving = false;
    player.targetX = null;
    player.targetY = null;
    keys.clear();
    updatePrompt();
    requestRender();

    $('ev-title').textContent = ev.title;
    $('ev-speaker').textContent = ev.speaker;
    $('ev-body').innerHTML = [...ev.body, ...meetingRecall(ev)].map((p) => `<p>${p}</p>`).join('');

    // 대화 초상화 (NPC가 있으면 NPC, 없으면 주인공)
    const portraitKey = ev.npc || heroId;
    drawSpriteFrame($('ev-portrait'), portraitKey, 2);

    const box = $('ev-choices');
    box.innerHTML = ev.choices
      .map(
        (c) => `
      <button type="button" class="rpg-choice-btn press" data-pick="${c.pick}">
        <span class="rpg-choice-num">${c.pick}</span>
        <span class="rpg-choice-txt">${c.text}</span>
      </button>`
      )
      .join('');
    box.classList.remove('hidden');

    $('ev-result-box').classList.add('hidden');
    $('dlg-event').classList.remove('hidden');

    const firstBtn = box.querySelector('button');
    if (firstBtn) firstBtn.focus();
  }

  // 마지막 회의(7번)에서 앞의 선택을 다시 꺼내는 문장 (탐사한 순서대로 최대 2줄)
  function meetingRecall(ev) {
    if (ev.id !== 7) return [];
    const lines = [];
    choices.forEach(({ event, pick }) => {
      const line = MEETING_RECALL[event]?.[pick];
      if (line && lines.length < 2) lines.push(line);
    });
    return lines;
  }

  $('ev-choices').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn || !activeEvent || pickedChoice) return;
    chooseOption(Number(btn.dataset.pick));
  });

  function chooseOption(pickNum) {
    if (!activeEvent || pickedChoice) return;
    const ch = activeEvent.choices.find((c) => c.pick === pickNum);
    if (!ch) return;
    pickedChoice = ch;
    const trustBefore = stats.trust;

    // 스탯 반영
    const deltas = ch.delta || {};
    stats.res = clampStat(stats.res + (deltas.res || 0));
    stats.trust = clampStat(stats.trust + (deltas.trust || 0));
    stats.peace = clampStat(stats.peace + (deltas.peace || 0));

    doneEvents.add(activeEvent.id);
    choices = choices.filter((x) => x.event !== activeEvent.id);
    choices.push({ event: activeEvent.id, pick: ch.pick });

    renderStats(deltas);

    // 결과 표시
    const badges = STAT_META.filter(({ key }) => deltas[key])
      .map(({ key, label }) => {
        const v = deltas[key];
        const cls = v > 0 ? 'is-up' : 'is-down';
        return `<span class="rpg-res-pill ${cls}">${label} ${v > 0 ? '+' + v : v}</span>`;
      })
      .join('');

    $('ev-choices').classList.add('hidden');
    $('ev-res-deltas').innerHTML = badges;
    // 회의 전 국제 신뢰가 낮으면 다른 결과 문장 (앞의 선택이 이어지도록)
    const lowTrust = ch.resultLowTrust && trustBefore < (ch.lowTrust ?? 40);
    $('ev-res-text').textContent = lowTrust ? ch.resultLowTrust : ch.result;
    // 갈등 주제는 학생이 먼저 생각해 보도록 고른 뒤에 보여 준다
    $('ev-conflict').textContent = `이 장면의 갈등: ${activeEvent.conflict}`;
    saveProgress();
    $('ev-next-btn').textContent = activeEvent.id === 7 ? '최종 결과 보기' : '계속 탐사하기';
    $('ev-result-box').classList.remove('hidden');
    $('ev-next-btn').focus();
  }

  $('ev-next-btn').addEventListener('click', closeEventModal);

  function closeEventModal() {
    if (!activeEvent) return;
    const finishedId = activeEvent.id;
    activeEvent = null;
    pickedChoice = null;
    $('dlg-event').classList.add('hidden');

    if (finishedId === 7) {
      finishSent = false;
      showEndingScreen();
    } else {
      updatePrompt();
      requestRender();
      saveProgress();
    }
  }

  /* ---------- 엔딩 화면 ---------- */
  function picksMap() {
    const m = {};
    choices.forEach(({ event, pick }) => { m[event] = pick; });
    return m;
  }

  // restored = 저장해 둔 엔딩을 다시 보여 주는 경우(이미 보냈으면 다시 보내지 않음)
  function showEndingScreen(restored = false) {
    const picks = picksMap();
    const ending = ENDINGS.find((e) => e.match(stats, picks)) || ENDINGS[ENDINGS.length - 1];
    endingId = ending.id;
    showScreen('ending');

    drawSpriteFrame($('end-hero-canvas'), heroId, 2);
    $('end-badge').textContent = ending.badge;
    $('end-name').textContent = ending.name;
    $('end-summary').textContent = ending.summary;
    $('end-detail').textContent = ending.detailBy7?.[picks[7]] ?? ending.detail;

    $('end-stat-res').textContent = String(stats.res);
    $('end-stat-trust').textContent = String(stats.trust);
    $('end-stat-peace').textContent = String(stats.peace);

    // 1. 내가 겪은 갈등 목록 (학습지 질문 1 재료)
    const conflicts = [];
    choices.forEach(({ event }) => {
      const ev = EVENTS.find((e) => e.id === event);
      if (ev && ev.conflict && !conflicts.includes(ev.conflict)) {
        conflicts.push(ev.conflict);
      }
    });
    $('end-conflicts').innerHTML = conflicts.map((c) => `<li>${c}</li>`).join('');

    // 2. 내가 고른 평화적 해결 방법 (학습지 질문 2 재료)
    const solutions = [];
    choices.forEach(({ event, pick }) => {
      const ev = EVENTS.find((e) => e.id === event);
      const ch = ev?.choices.find((c) => c.pick === pick);
      if (ch?.solution && !solutions.includes(ch.solution)) {
        solutions.push(ch.solution);
      }
    });

    if (solutions.length > 0) {
      $('end-sol-note').classList.add('hidden');
      $('end-solutions').innerHTML = solutions.map((s) => `<li>${s}</li>`).join('');
    } else {
      $('end-sol-note').textContent = '이번 탐사에서는 독점·경쟁 선택지를 주로 골랐어요. 평화롭게 분배하려면 아래와 같은 방법이 있어요.';
      $('end-sol-note').classList.remove('hidden');
      $('end-solutions').innerHTML = FALLBACK_SOLUTIONS.map((s) => `<li>${s}</li>`).join('');
    }

    // 결과 저장 및 보상 요청
    saveProgress();
    if (restored && finishSent) {
      $('end-reward-msg').textContent = '저장해 둔 탐사 기록이에요';
      $('btn-retry-send').classList.add('hidden');
      return;
    }
    const payload = {
      ending: ending.id,
      stats: { res: stats.res, trust: stats.trust, peace: stats.peace },
      choices: [...choices],
    };
    submitFinish(payload);
  }

  /* ---------- 진행 저장·불러오기 ----------
     학습지 칸(sandbox iframe)에서는 localStorage를 못 쓰므로 부모 창(class.js)에
     moon-rpg:save / moon-rpg:load 로 맡긴다. 단독 창에서는 직접 localStorage에 저장한다.
     화면이 숨겨지면 학습지 칸 iframe이 새로 만들어지기 때문에(closeSims → wakeSims) 꼭 필요하다. */
  const SAVE_KEY = 'rpg-moon-save';
  const inFrame = () => isSandboxed() && window.parent !== window;

  function snapshot() {
    return {
      v: 1,
      screen: screen === 'ending' ? 'ending' : 'map',
      heroId,
      stats: { ...stats },
      choices: [...choices],
      done: [...doneEvents],
      px: Math.round(player.x),
      py: Math.round(player.y),
      sent: finishSent,
      at: Date.now(),
    };
  }

  function saveProgress() {
    if (screen === 'start') return;
    const data = snapshot();
    if (inFrame()) window.parent.postMessage({ type: 'moon-rpg:save', data }, '*');
    else safeStore.set(SAVE_KEY, JSON.stringify(data));
  }

  function restoreProgress(data) {
    if (screen !== 'start') return; // 이미 새로 시작했으면 덮어쓰지 않음
    if (!data || data.v !== 1 || !Array.isArray(data.choices) || !data.stats) return;
    const validIds = new Set(EVENTS.map((e) => e.id));
    const ch = data.choices
      .filter((c) => validIds.has(c?.event) && [1, 2, 3].includes(c?.pick))
      .map((c) => ({ event: c.event, pick: c.pick }));
    if (!ch.length) return;
    selectHero(HEROES.some((h) => h.id === data.heroId) ? data.heroId : 'boy');
    stats = {
      res: clampStat(Number(data.stats.res) || 0),
      trust: clampStat(Number(data.stats.trust) || 0),
      peace: clampStat(Number(data.stats.peace) || 0),
    };
    choices = ch;
    doneEvents.clear();
    ch.forEach((c) => doneEvents.add(c.event));
    player.x = Math.max(36, Math.min(CW - 36, Number(data.px) || 165));
    player.y = Math.max(SKY_H + 34, Math.min(CH - 18, Number(data.py) || 398));
    player.dir = 'down';
    player.moving = false;
    player.targetX = null;
    player.targetY = null;
    player.targetSpot = null;
    renderStats();
    // 마지막 회의까지 골랐으면(결과 보기 전 화면을 떠났어도) 엔딩으로
    if (doneEvents.has(7)) {
      finishSent = data.screen === 'ending' && !!data.sent;
      showEndingScreen(true);
    } else {
      showScreen('map');
      updatePrompt();
    }
  }

  /* ---------- 포탈 로그인·보상 연동 ---------- */
  function updatePortalUI() {
    const nickEl = $('user-nick');
    const rwEl = $('reward-status');
    const helpRw = $('help-reward');
    if (helpRw) helpRw.textContent = `${portalInfo.silver ?? 5}은화`;

    if (!portalInfo.logged) {
      nickEl.textContent = '손님 모드 (로그인하면 은화 보상 지급)';
      rwEl.textContent = `완료 보상 +${portalInfo.silver ?? 5}은화 (로그인 필요)`;
    } else {
      nickEl.textContent = `대장: ${portalInfo.nickname}`;
      rwEl.textContent = portalInfo.rewarded
        ? '보상 지급 완료'
        : `첫 완료 보상 +${portalInfo.silver ?? 5}은화`;
    }
  }

  async function initPortalBridge() {
    if (isSandboxed() && window.parent !== window) {
      window.addEventListener('message', (e) => {
        const msg = e.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'moon-rpg:state') {
          applyPortalState(msg.data);
        } else if (msg.type === 'moon-rpg:finish-res') {
          handleFinishResponse(msg.data);
        } else if (msg.type === 'moon-rpg:load-res') {
          restoreProgress(msg.data);
        }
      });
      window.parent.postMessage({ type: 'moon-rpg:init' }, '*');
      window.parent.postMessage({ type: 'moon-rpg:load' }, '*');
      return;
    }

    // 단독 창: 기기에 저장된 진행 불러오기 (로그인 상태를 확인한 뒤에 해야 보상 전송이 맞게 됨)
    const restoreLocal = () => {
      try { restoreProgress(JSON.parse(safeStore.get(SAVE_KEY) || 'null')); } catch {}
    };

    // 단독 창에서 열었을 때 직접 db.js + login.js 호출
    try {
      const [{ readLogin }, { moonRpgState }] = await Promise.all([
        import('./login.js'),
        import('./db.js'),
      ]);
      const login = readLogin();
      if (!login?.token) {
        updatePortalUI();
        restoreLocal();
        return;
      }
      const res = await moonRpgState(login.token);
      applyPortalState(res);
      restoreLocal();

      // 이전에 못 보낸 기록이 있으면 재전송
      const saved = safeStore.get('rpg-moon-pending');
      if (saved) {
        try {
          pendingFinish = JSON.parse(saved);
          retryPendingFinish();
        } catch {}
      }
    } catch {
      updatePortalUI();
      restoreLocal();
    }
  }

  function applyPortalState(res) {
    if (res && res.ok) {
      portalInfo = {
        logged: true,
        nickname: res.nickname || '닉네임 미정',
        silver: res.silver ?? 5,
        rewarded: !!res.rewarded,
      };
    } else {
      portalInfo.logged = false;
    }
    updatePortalUI();
    requestRender();
  }

  async function submitFinish(payload) {
    pendingFinish = payload;
    safeStore.set('rpg-moon-pending', JSON.stringify(payload));
    const box = $('end-reward-msg');
    const retryBtn = $('btn-retry-send');
    retryBtn.classList.add('hidden');

    if (!portalInfo.logged && !(isSandboxed() && window.parent !== window)) {
      box.textContent = '손님 모드로 완료했어요 (로그인하면 은화 보상을 받을 수 있어요)';
      finishSent = true;
      saveProgress();
      return;
    }

    if (finishBusy) return;
    finishBusy = true;
    box.textContent = '탐사 기록 저장 중…';

    if (isSandboxed() && window.parent !== window) {
      window.parent.postMessage({ type: 'moon-rpg:finish', ...payload }, '*');
      return;
    }

    try {
      const [{ readLogin }, { moonRpgFinish }] = await Promise.all([
        import('./login.js'),
        import('./db.js'),
      ]);
      const login = readLogin();
      if (!login?.token) {
        finishBusy = false;
        box.textContent = '손님 모드로 완료했어요';
        return;
      }
      const res = await moonRpgFinish(login.token, payload.ending, payload.stats, payload.choices);
      handleFinishResponse(res);
    } catch {
      finishBusy = false;
      box.textContent = '연결이 원활하지 않아 기록을 기기에 저장했어요';
      retryBtn.classList.remove('hidden');
    }
  }

  function handleFinishResponse(res) {
    finishBusy = false;
    const box = $('end-reward-msg');
    const retryBtn = $('btn-retry-send');
    if (!res || res.ok === false) {
      if (res?.error === 'NO_SESSION') {
        box.textContent = '손님 모드로 완료했어요';
        finishSent = true;
        saveProgress();
        return;
      }
      if (res?.error === 'NOT_712') {
        box.textContent = '712 수업 시간에만 기록과 보상이 남아요';
        finishSent = true;
        saveProgress();
        return;
      }
      box.textContent = '전송하지 못했어요. 다시 보내기를 눌러 주세요';
      retryBtn.classList.remove('hidden');
      return;
    }
    safeStore.del('rpg-moon-pending');
    pendingFinish = null;
    finishSent = true;
    saveProgress();
    retryBtn.classList.add('hidden');
    portalInfo.rewarded = true;
    updatePortalUI();
    if (res.rewarded && (res.silver ?? 0) > 0) {
      box.innerHTML = `${ICONS.silver} <b>+${res.silver}은화</b> 보상을 받았어요!`;
    } else {
      box.textContent = '탐사 기록 저장 완료 · 보상은 이미 받았어요';
    }
  }

  function retryPendingFinish() {
    if (pendingFinish && !finishBusy) submitFinish(pendingFinish);
  }
  $('btn-retry-send').addEventListener('click', retryPendingFinish);
  window.addEventListener('online', retryPendingFinish);

  /* ---------- 키보드·마우스·터치 입력 ---------- */
  window.addEventListener('keydown', (e) => {
    if (tab !== 'game') return;

    // 크레딧 모달 열려 있을 때
    if (!$('dlg-credits').classList.contains('hidden')) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        $('dlg-credits').classList.add('hidden');
      }
      return;
    }

    // 이벤트 대화 모달 열려 있을 때
    if (activeEvent) {
      if (!pickedChoice) {
        if (e.key === '1' || e.key === '2' || e.key === '3') {
          e.preventDefault();
          chooseOption(Number(e.key));
        }
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        closeEventModal();
      }
      return;
    }

    if (screen !== 'map') return;

    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault();
      keys.add(k);
      player.targetX = null;
      player.targetY = null;
      player.targetSpot = null;
      lastTs = performance.now();
      requestRender();
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (nearSpot) {
        e.preventDefault();
        triggerSpot(nearSpot);
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
  });

  // 마우스·터치 탭 이동 (캔버스 클릭)
  canvas.addEventListener('pointerdown', (e) => {
    if (screen !== 'map' || activeEvent) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CW;
    const y = ((e.clientY - rect.top) / rect.height) * CH;

    // 지점/거점을 직접 눌렀는지 확인
    let clickedSpot = null;
    for (const sp of SPOTS) {
      if (Math.hypot(x - sp.x, y - sp.y) <= 46) {
        clickedSpot = sp;
        break;
      }
    }

    // 이미 가까운 지점을 다시 누르면 바로 이벤트 열기
    if (clickedSpot && clickedSpot === nearSpot) {
      triggerSpot(clickedSpot);
      return;
    }

    player.targetSpot = clickedSpot;
    player.targetX = Math.max(36, Math.min(CW - 36, clickedSpot ? clickedSpot.x : x));
    player.targetY = Math.max(SKY_H + 34, Math.min(CH - 18, clickedSpot ? clickedSpot.y + 22 : y));
    lastTs = performance.now();
    requestRender();
  });

  /* ---------- 이동 업데이트 ---------- */
  function updateMovement(dt) {
    if (screen !== 'map' || activeEvent) {
      player.moving = false;
      return;
    }

    let vx = 0;
    let vy = 0;

    if (keys.has('arrowleft') || keys.has('a')) vx -= 1;
    if (keys.has('arrowright') || keys.has('d')) vx += 1;
    if (keys.has('arrowup') || keys.has('w')) vy -= 1;
    if (keys.has('arrowdown') || keys.has('s')) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      vx /= len;
      vy /= len;
      player.x = Math.max(36, Math.min(CW - 36, player.x + vx * SPEED * dt));
      player.y = Math.max(SKY_H + 34, Math.min(CH - 18, player.y + vy * SPEED * dt));
      if (Math.abs(vx) > Math.abs(vy)) player.dir = vx < 0 ? 'left' : 'right';
      else player.dir = vy < 0 ? 'up' : 'down';
      player.moving = true;
      updatePrompt();
      return;
    }

    if (player.targetX != null && player.targetY != null) {
      const dx = player.targetX - player.x;
      const dy = player.targetY - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 5) {
        player.x = player.targetX;
        player.y = player.targetY;
        player.targetX = null;
        player.targetY = null;
        player.moving = false;
        updatePrompt();
        if (player.targetSpot) {
          const sp = player.targetSpot;
          player.targetSpot = null;
          triggerSpot(sp);
        }
      } else {
        const step = Math.min(dist, SPEED * dt);
        player.x += (dx / dist) * step;
        player.y += (dy / dist) * step;
        if (Math.abs(dx) > Math.abs(dy)) player.dir = dx < 0 ? 'left' : 'right';
        else player.dir = dy < 0 ? 'up' : 'down';
        player.moving = true;
        updatePrompt();
      }
      return;
    }

    player.moving = false;
  }

  /* ---------- 캔버스 그리기 (LPC 규격: 64×64, 정수 좌표) ---------- */
  function drawLpcChar(img, x, y, dir, moving, now, label, isHero = false) {
    if (!img) return;
    const frame = moving ? 1 + (Math.floor(now / 100) % 8) : 0;
    const dx = Math.round(x - 32);
    const dy = Math.round(y - 62);
    ctx.imageSmoothingEnabled = false;

    // 발밑 그림자
    ctx.fillStyle = 'rgba(11, 18, 32, 0.35)';
    ctx.beginPath();
    ctx.ellipse(Math.round(x), Math.round(y - 2), 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.drawImage(img, frame * 64, ROW[dir] * 64, 64, 64, dx, dy, 64, 64);

    if (label) {
      ctx.font = '700 12px "Noto Sans KR", sans-serif';
      const tw = ctx.measureText(label).width;
      const bx = Math.round(x - tw / 2 - 7);
      const by = Math.round(y + 4);
      ctx.fillStyle = isHero ? 'rgba(36, 87, 230, 0.92)' : 'rgba(15, 23, 42, 0.82)';
      ctx.beginPath();
      ctx.roundRect(bx, by, tw + 14, 19, 9);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, Math.round(x), by + 10);
    }
  }

  function drawSpotStructure(sp, unlocked, done) {
    const { x, y, kind } = sp;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));

    // 지점 바닥 원형 패드
    ctx.fillStyle = done
      ? 'rgba(34, 197, 130, 0.18)'
      : unlocked
      ? 'rgba(36, 87, 230, 0.16)'
      : 'rgba(100, 116, 139, 0.18)';
    ctx.strokeStyle = done ? '#16A36A' : unlocked ? sp.color : '#64748B';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 8, 38, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (kind === 'dome') {
      // 우리 탐사대 기지 돔
      ctx.fillStyle = '#E2E8F0';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 4, 24, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(-10, -8, 20, 8);
      // 안테나
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(0, -32);
      ctx.stroke();
      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.arc(0, -33, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'plain') {
      // 헬륨-3 평원: 꽂힌 깃발과 추출기
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-12, 8);
      ctx.lineTo(-12, -26);
      ctx.stroke();
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.moveTo(-12, -26);
      ctx.lineTo(10, -19);
      ctx.lineTo(-12, -12);
      ctx.closePath();
      ctx.fill();
      // 헬륨-3 탱크
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(6, -8, 14, 16);
    } else if (kind === 'crater') {
      // 희토류 크레이터 + 광물 결정
      ctx.fillStyle = '#64748B';
      ctx.beginPath();
      ctx.ellipse(0, 6, 26, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#C084FC';
      ctx.beginPath();
      ctx.moveTo(-8, 6);
      ctx.lineTo(-2, -16);
      ctx.lineTo(5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#A855F7';
      ctx.beginPath();
      ctx.moveTo(2, 8);
      ctx.lineTo(10, -10);
      ctx.lineTo(16, 8);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'ice') {
      // 남극 얼음 지대
      ctx.fillStyle = '#7DD3FC';
      ctx.strokeStyle = '#0284C7';
      ctx.lineWidth = 1.8;
      [[-14, 6, -6, -16, 2, 6], [-2, 8, 8, -20, 18, 8], [-22, 8, -14, -6, -6, 8]].forEach(
        ([x1, y1, x2, y2, x3, y3]) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineTo(x3, y3);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      );
    } else if (kind === 'debris') {
      // 우주 쓰레기 더미
      ctx.fillStyle = '#94A3B8';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.8;
      ctx.fillRect(-16, -4, 18, 10);
      ctx.strokeRect(-16, -4, 18, 10);
      ctx.beginPath();
      ctx.moveTo(2, 6);
      ctx.lineTo(16, -8);
      ctx.lineTo(20, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (kind === 'rover') {
      // 소규모 탐사차
      ctx.fillStyle = '#E2E8F0';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.fillRect(-28, -6, 22, 11);
      ctx.strokeRect(-28, -6, 22, 11);
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.arc(-23, 7, 4, 0, Math.PI * 2);
      ctx.arc(-11, 7, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'hq') {
      // 국제 달 협의회 본부
      ctx.fillStyle = unlocked ? '#FFFFFF' : '#CBD5E1';
      ctx.strokeStyle = unlocked ? '#2457E6' : '#64748B';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 4, 28, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = unlocked ? '#2457E6' : '#64748B';
      ctx.fillRect(-18, 0, 36, 7);
    }

    // 지점 이름표 (한글)
    const tagY = -38;
    ctx.font = '800 13px "Noto Sans KR", sans-serif';
    const badge = done ? '✓ ' : !unlocked ? '잠김 · ' : '';
    const text = `${badge}${sp.name}`;
    const tw = ctx.measureText(text).width;
    const bw = tw + 18;
    ctx.fillStyle = done
      ? 'rgba(11, 107, 71, 0.92)'
      : !unlocked
      ? 'rgba(71, 85, 105, 0.88)'
      : nearSpot === sp
      ? '#2457E6'
      : 'rgba(15, 23, 42, 0.86)';
    ctx.beginPath();
    ctx.roundRect(-bw / 2, tagY - 12, bw, 24, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, tagY);

    ctx.restore();
  }

  function renderCanvas(now) {
    ctx.clearRect(0, 0, CW, CH);

    // 1. 위쪽 검은 우주 하늘 띠
    const skyGrad = ctx.createLinearGradient(0, 0, 0, SKY_H);
    skyGrad.addColorStop(0, '#050811');
    skyGrad.addColorStop(1, '#111827');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, CW, SKY_H);

    // 별
    ctx.fillStyle = '#F8FAFC';
    STARS.forEach(([sx, sy, r]) => {
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    });

    // 푸른 지구 & 다누리 궤도선
    ctx.fillStyle = '#2563EB';
    ctx.beginPath();
    ctx.arc(92, 38, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#60A5FA';
    ctx.beginPath();
    ctx.arc(87, 34, 7, 0, Math.PI * 2);
    ctx.arc(98, 43, 5, 0, Math.PI * 2);
    ctx.fill();

    // 다누리 궤도선 아이콘
    ctx.save();
    ctx.translate(650, 36);
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(-26, -4, 16, 8);
    ctx.fillRect(10, -4, 16, 8);
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(-7, -7, 14, 14);
    ctx.font = '700 11px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#93C5FD';
    ctx.textAlign = 'center';
    ctx.fillText('다누리 궤도선', 0, 20);
    ctx.restore();

    // 2. 회색 달 표면 바닥
    const moonGrad = ctx.createLinearGradient(0, SKY_H, 0, CH);
    moonGrad.addColorStop(0, '#CBD5E1');
    moonGrad.addColorStop(0.4, '#E2E8F0');
    moonGrad.addColorStop(1, '#CBD5E1');
    ctx.fillStyle = moonGrad;
    ctx.fillRect(0, SKY_H, CW, CH - SKY_H);

    // 지평선 경계
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, SKY_H);
    ctx.lineTo(CW, SKY_H);
    ctx.stroke();

    // 크레이터
    CRATERS.forEach((c) => {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // 거점 연결 탐사 길(점선)
    ctx.save();
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.32)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    const hq = SPOTS.find((s) => s.id === 'hq');
    SPOTS.forEach((sp) => {
      if (sp.id === 'hq') return;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y + 8);
      ctx.lineTo(hq.x, hq.y + 8);
      ctx.stroke();
    });
    ctx.restore();

    // 목표 탭 위치 표시
    if (player.targetX != null && player.targetY != null) {
      ctx.strokeStyle = '#2457E6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(Math.round(player.targetX), Math.round(player.targetY), 12, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 3. 지점 구조물 그리기
    SPOTS.forEach((sp) => {
      drawSpotStructure(sp, isSpotUnlocked(sp), doneEvents.has(sp.eventId));
    });

    // 4. 캐릭터(NPC 4명 + 주인공)를 y값 오름차순으로 정렬하여 그리기 (가이드 4절 규칙)
    const actors = [];
    SPOTS.forEach((sp) => {
      if (!sp.npc) return;
      const npcMeta = NPCS[sp.npc];
      const nx = sp.x + (sp.npcOffset?.dx || 0);
      const ny = sp.y + (sp.npcOffset?.dy || 0);
      // 주인공이 가까우면 주인공 쪽을 바라봄
      let dir = 'down';
      const dist = Math.hypot(player.x - nx, player.y - ny);
      if (dist < 110) {
        const dx = player.x - nx;
        const dy = player.y - ny;
        if (Math.abs(dx) > Math.abs(dy)) dir = dx < 0 ? 'left' : 'right';
        else dir = dy < 0 ? 'up' : 'down';
      }
      actors.push({
        y: ny,
        draw: () => drawLpcChar(sprites[sp.npc], nx, ny, dir, false, now, npcMeta.name, false),
      });
    });

    actors.push({
      y: player.y,
      draw: () =>
        drawLpcChar(
          sprites[heroId],
          player.x,
          player.y,
          player.dir,
          player.moving,
          now,
          portalInfo.nickname || '탐사대장',
          true
        ),
    });

    actors.sort((a, b) => a.y - b.y);
    actors.forEach((a) => a.draw());
  }

  function tick(now) {
    rafId = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
    lastTs = now;
    updateMovement(dt);
    if (spritesReady) renderCanvas(now);
    if (player.moving) requestRender();
  }

  function requestRender() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------- 초기화 ---------- */
  loadSprites();
  selectHero('boy');
  renderStats();
  updatePortalUI();
  initPortalBridge();

  // 처음 온 기기는 규칙 탭부터 표시 (작업지시서 3-7절)
  if (!safeStore.get('rpg-moon-help-seen')) {
    safeStore.set('rpg-moon-help-seen', '1');
    setTab('rules');
  } else {
    setTab('game');
  }
}
