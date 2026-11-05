// 리퀴드 글래스: .lg 요소의 가장자리에서 뒤 화면이 볼록 렌즈처럼 휘어 보이게.
// 크롬(Chromium)만 backdrop-filter에 SVG 필터를 쓸 수 있어서 크롬에서만, 그 밖에는 CSS 흐림만.
// 요소 크기마다 변위 지도를 한 번 그려 두고(크기가 바뀔 때만 다시), .lite가 되면 모두 끈다.
const NS = 'http://www.w3.org/2000/svg';
const can = () => !!navigator.userAgentData && !document.documentElement.classList.contains('lite')
  && !matchMedia('(prefers-reduced-transparency: reduce)').matches;
let defs = null;
let seq = 0;
const watched = new Set();

function mapURL(w, h, r, bezel) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x + 0.5, py = y + 0.5;
    const cx = Math.min(Math.max(px, r), w - r), cy = Math.min(Math.max(py, r), h - r);
    const vx = px - cx, vy = py - cy, len = Math.hypot(vx, vy);
    let dist, nx = 0, ny = 0;
    if (len > 0) { dist = r - len; nx = vx / len; ny = vy / len; }
    else {
      const m = Math.min(px, w - px, py, h - py);
      dist = m;
      if (m === px) nx = -1; else if (m === w - px) nx = 1; else if (m === py) ny = -1; else ny = 1;
    }
    let mag = 0;
    if (dist >= 0 && dist < bezel) { const t = 1 - dist / bezel; mag = t * t * (3 - 2 * t); }
    const i = (y * w + x) * 4;
    d[i] = 128 - nx * mag * 127; d[i + 1] = 128 - ny * mag * 127; d[i + 2] = 128; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function apply(el) {
  if (!can()) return off(el);
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (!w || !h || w * h > 400000) return off(el);
  const key = `${w}x${h}`;
  if (el.dataset.lgKey === key) return;
  if (!defs) {
    defs = document.createElementNS(NS, 'svg');
    defs.setAttribute('width', '0'); defs.setAttribute('height', '0');
    defs.setAttribute('aria-hidden', 'true');
    defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    document.body.appendChild(defs);
  }
  const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, h / 2, w / 2);
  const bezel = Math.min(Math.max(r * 0.8, 10), 22);
  const id = `lgf${++seq}`;
  const f = document.createElementNS(NS, 'filter');
  for (const [k, v] of Object.entries({ id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: h, 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
  f.innerHTML = `<feImage href="${mapURL(w, h, r, bezel)}" x="0" y="0" width="${w}" height="${h}" result="map"/>`
    + '<feGaussianBlur in="SourceGraphic" stdDeviation="4" result="soft"/>'
    + `<feDisplacementMap in="soft" in2="map" scale="${Math.round(bezel * 2.2)}" xChannelSelector="R" yChannelSelector="G"/>`;
  if (el.dataset.lgId) defs.querySelector('#' + el.dataset.lgId)?.remove();
  defs.appendChild(f);
  el.dataset.lgId = id;
  el.dataset.lgKey = key;
  el.style.setProperty('--lg-f', `url(#${id})`);
  el.classList.add('lg-refract');
}

function off(el) {
  el.classList.remove('lg-refract');
  el.style.removeProperty('--lg-f');
  if (el.dataset.lgId) defs?.querySelector('#' + el.dataset.lgId)?.remove();
  delete el.dataset.lgId; delete el.dataset.lgKey;
}

const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((list) => list.forEach((e) => apply(e.target))) : null;

// 요소들에 굴절을 붙인다(크기가 바뀌면 다시 그림)
export function liquid(...els) {
  for (const el of els.flat()) {
    if (!el || watched.has(el)) continue;
    watched.add(el);
    ro?.observe(el);
    apply(el);
  }
}

// 처음 2초 프레임 측정 등으로 .lite가 붙으면 끈다
new MutationObserver(() => watched.forEach((el) => (can() ? (delete el.dataset.lgKey, apply(el)) : off(el))))
  .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
