// 공통 UI: 저사양 감지, 배경 오브, 유리 하이라이트, 아이콘 그리기, 토스트, 카운트업

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 저사양 감지 ---------- */
// 처음 2초 프레임이 30fps 미만이었던 기기는 localStorage 'lite'='1'로 기억해 다음부터 처음부터 가볍게
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

export let isLite = (() => {
  const blurOK = CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  const lite =
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    !blurOK ||
    matchMedia('(prefers-reduced-transparency: reduce)').matches ||
    store.get('lite') === '1';
  if (lite) root.classList.add('lite');
  return !!lite;
})();

function goLite() {
  isLite = true;
  root.classList.add('lite');
  store.set('lite', '1');
}

// 페이지가 뜬 뒤 처음 2초 동안 requestAnimationFrame 간격을 재서 평균 30fps 미만이면 .lite
function measureFrames() {
  if (isLite || document.hidden) return;
  let start = null;
  let frames = 0;
  const tick = (now) => {
    if (document.hidden) return; // 화면이 숨겨지면 잴 수 없으니 그만
    if (start === null) start = now;
    else frames++;
    const elapsed = now - start;
    if (elapsed < 2000) { requestAnimationFrame(tick); return; }
    if ((frames * 1000) / elapsed < 30) goLite();
  };
  requestAnimationFrame(tick);
}

const calm = () => isLite || reduceMotion;

/* ---------- 배경 오브 ---------- */
const DEFAULT_ORBS = [
  { color: 'blue',   size: 540, left: '-160px', top: '-180px' },
  { color: 'violet', size: 470, right: '-140px', top: '160px' },
  { color: 'mint',   size: 430, left: '28%', bottom: '-230px' },
];

function mountBackground(orbs = DEFAULT_ORBS) {
  if (document.querySelector('.bg')) return document.querySelector('.bg');
  const bg = document.createElement('div');
  bg.className = 'bg';
  bg.setAttribute('aria-hidden', 'true');
  for (const o of orbs) {
    const wrap = document.createElement('div');
    wrap.className = 'orb-wrap';
    Object.assign(wrap.style, {
      width: o.size + 'px', height: o.size + 'px',
      left: o.left ?? '', right: o.right ?? '', top: o.top ?? '', bottom: o.bottom ?? '',
    });
    const orb = document.createElement('div');
    orb.className = 'orb ' + o.color;
    wrap.append(orb);
    bg.append(wrap);
  }
  document.body.prepend(bg);
  return bg;
}

/* ---------- 유리 하이라이트 ----------
   배경 시차는 쓰지 않는다: 배경이 움직이면 위의 유리 카드가 매번 다시 흐려진다(6단계) */
function bindPointer() {
  if (calm()) return;
  let queued = false, liveEl = null, mx = 0, my = 0;
  const flush = () => {
    queued = false;
    if (isLite || !liveEl) return; // 재 보니 느린 기기면 하이라이트를 멈춘다
    liveEl.style.setProperty('--mx', mx + '%');
    liveEl.style.setProperty('--my', my + '%');
  };

  addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('.glass-live');
    liveEl = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    mx = Math.round(((e.clientX - r.left) / r.width) * 100);
    my = Math.round(((e.clientY - r.top) / r.height) * 100);
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  }, { passive: true });
}

/* ---------- 아이콘 선 그리기 ---------- */
export function prepareDraw(scope = document) {
  scope.querySelectorAll('.draw').forEach((svg) => {
    svg.querySelectorAll('path, circle, line, polyline').forEach((p) => {
      if (typeof p.getTotalLength !== 'function') return;
      const len = Math.ceil(p.getTotalLength()) + 1;
      p.style.setProperty('--draw-len', len);
    });
  });
}

/* ---------- 토스트 ---------- */
let toastBox;
export function toast(message, kind = 'info') {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    document.body.append(toastBox);
  }
  const t = document.createElement('div');
  t.className = `toast glass-strong toast-${kind}`;
  t.textContent = message;
  toastBox.append(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 600);
  }, 2600);
}

/* ---------- 숫자 카운트업 ---------- */
export function countUp(el, to, duration = 1400) {
  const from = Number(el.dataset.value ?? el.textContent.replace(/[^\d-]/g, '')) || 0;
  el.dataset.value = to;
  if (reduceMotion || from === to) { el.textContent = to.toLocaleString('ko-KR'); return; }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString('ko-KR');
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- HTML 이스케이프 ---------- */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 시작 ---------- */
// measure: 처음 2초 프레임 재기 (교사 화면은 끔. 프로젝터 PC가 수업자료를 불러오는 동안 느려져도 가볍게 바뀌지 않게)
export function initUI({ orbs, measure = !location.pathname.includes('/teacher/') } = {}) {
  mountBackground(orbs);
  bindPointer();
  prepareDraw();
  if (measure) measureFrames();
}
