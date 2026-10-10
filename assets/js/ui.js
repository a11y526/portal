// 공통 UI: 저사양 감지, 배경 오브 + 시차, 유리 하이라이트, 아이콘 그리기, 토스트, 카운트업

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 저사양 감지 ---------- */
export const isLite = (() => {
  const blurOK = CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  const lite =
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    !blurOK ||
    matchMedia('(prefers-reduced-transparency: reduce)').matches;
  if (lite) root.classList.add('lite');
  return !!lite;
})();

const calm = isLite || reduceMotion;

/* ---------- 배경 오브 ---------- */
const DEFAULT_ORBS = [
  { color: 'blue',   size: 540, left: '-160px', top: '-180px', depth: 28 },
  { color: 'violet', size: 470, right: '-140px', top: '160px', depth: -22 },
  { color: 'mint',   size: 430, left: '28%', bottom: '-230px', depth: 16 },
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
    wrap.style.setProperty('--depth', o.depth + 'px');
    const orb = document.createElement('div');
    orb.className = 'orb ' + o.color;
    wrap.append(orb);
    bg.append(wrap);
  }
  document.body.prepend(bg);
  return bg;
}

/* ---------- 시차 + 유리 하이라이트 ---------- */
function bindPointer(bg) {
  if (calm) return;
  let px = 0, py = 0, queued = false, liveEl = null, mx = 0, my = 0;
  const flush = () => {
    queued = false;
    bg.style.setProperty('--px', px.toFixed(3));
    bg.style.setProperty('--py', py.toFixed(3));
    if (liveEl) {
      liveEl.style.setProperty('--mx', mx + '%');
      liveEl.style.setProperty('--my', my + '%');
    }
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(flush); } };

  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      px = (e.clientX / innerWidth) * 2 - 1;
      py = (e.clientY / innerHeight) * 2 - 1;
    }
    const el = e.target.closest?.('.glass-live');
    liveEl = el;
    if (el) {
      const r = el.getBoundingClientRect();
      mx = Math.round(((e.clientX - r.left) / r.width) * 100);
      my = Math.round(((e.clientY - r.top) / r.height) * 100);
    }
    queue();
  }, { passive: true });

  // 휴대폰·태블릿 기울기 (권한이 필요 없는 기기에서만)
  if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null) return;
      px = Math.max(-1, Math.min(1, e.gamma / 30));
      py = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
      queue();
    }, { passive: true });
  }
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
export function initUI({ orbs } = {}) {
  const bg = mountBackground(orbs);
  bindPointer(bg);
  prepareDraw();
}
