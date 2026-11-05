// 관리 첫 화면(아무 항목도 안 열었을 때) 가운데 3D 장면: 나선 은하 속 원자.
// 라이브러리 없이 Canvas 2D로 3D 투영. 교사 PC 전용(학생 화면에는 없음).
// 누르면 전자가 들뜬 상태로 바깥 궤도로 튀었다가 빛(파동)을 내며 돌아온다.
// 움직임 줄이기면 멈춘 한 장면만, 화면이 숨겨지면 requestAnimationFrame이 저절로 멈춘다.
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');

let box = null, cv = null, ctx = null, W = 0, H = 0, raf = 0, ro = null, clock = 0;
let stars = [], galaxy = [], nucleons = [], orbits = [], pulses = [];
let mx = 0, my = 0, tmx = 0, tmy = 0, excite = 0, last = 0, time = 0;

function build() {
  stars = Array.from({ length: 650 }, () => {
    const u = rnd(-1, 1), a = rnd(0, TAU), r = rnd(2400, 3600), s = Math.sqrt(1 - u * u);
    return { x: r * s * Math.cos(a), y: r * u, z: r * s * Math.sin(a), b: rnd(.25, 1), tw: rnd(0, TAU) };
  });
  // 팔 3개짜리 나선 은하. 안쪽은 따뜻한 색, 바깥은 파랑·보라
  galaxy = Array.from({ length: 3200 }, () => {
    const arm = Math.floor(rnd(0, 3));
    const r = 340 + Math.pow(Math.random(), 0.8) * 1050;
    const a = arm * TAU / 3 + r * 0.0052 + gauss() * 0.42;
    const k = (r - 340) / 1050;
    const c = k < 0.25 ? [255, 196, 138] : k < 0.6 ? [140, 180, 255] : (Math.random() < .5 ? [183, 156, 255] : [111, 227, 200]);
    return { r, a, y: gauss() * 46 * (1 - k * 0.6), c, s: rnd(.6, 1.6), w: 0.16 * Math.pow(340 / r, 0.9) };
  });
  // 원자핵: 양성자(주황)·중성자(파랑) 14개를 공 모양으로 뭉침
  nucleons = Array.from({ length: 14 }, (_, i) => {
    const u = rnd(-1, 1), a = rnd(0, TAU), r = i === 0 ? 0 : rnd(18, 40), s = Math.sqrt(1 - u * u);
    return { x: r * s * Math.cos(a), y: r * u, z: r * s * Math.sin(a), p: i % 2 === 0, ph: rnd(0, TAU) };
  });
  // 전자 궤도 3개, 기울기가 서로 다른 평면
  orbits = [
    { R: 250, tx: 1.15, ty: 0.2, sp: 1.05, ph: 0 },
    { R: 300, tx: -0.55, ty: 1.1, sp: 0.82, ph: 2.1 },
    { R: 350, tx: 0.3, ty: -1.0, sp: 0.66, ph: 4.2 },
  ].map((o) => {
    // 평면의 두 축 u, v (기본 xz 평면을 x축·y축으로 돌림)
    const rot = (p) => rotY(rotX(p, o.tx), o.ty);
    return { ...o, u: rot([1, 0, 0]), v: rot([0, 0, 1]) };
  });
}

function rotX([x, y, z], a) { const c = Math.cos(a), s = Math.sin(a); return [x, y * c - z * s, y * s + z * c]; }
function rotY([x, y, z], a) { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, y, -x * s + z * c]; }

function size() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = box.clientWidth; H = box.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!raf) frame(performance.now(), true);
}

function frame(now, once) {
  raf = 0;
  if (!W || !H) return;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
  last = now;
  time += dt;
  mx += (tmx - mx) * 0.04; my += (tmy - my) * 0.04;
  excite *= Math.pow(0.35, dt);
  draw();
  if (!once && !REDUCE.matches) raf = requestAnimationFrame(frame);
}

function draw() {
  const D = 1900, f = Math.min(W, H) * 1.45, cx = W / 2, cy = H / 2;
  const yaw = time * 0.06 + mx * 0.5, pitch = 0.42 + my * 0.28;
  const cam = (p) => rotX(rotY(p, yaw), pitch);
  const proj = ([x, y, z]) => { const q = z + D; if (q < 120) return null; const s = f / q; return [cx + x * s, cy + y * s, s, z]; };

  ctx.globalCompositeOperation = 'source-over';
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
  bg.addColorStop(0, '#121A3A'); bg.addColorStop(0.55, '#0A0F24'); bg.addColorStop(1, '#05070F');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';

  // 멀리 있는 별: 천천히 반짝임
  for (const st of stars) {
    const p = proj(cam([st.x, st.y, st.z]));
    if (!p) continue;
    const a = st.b * (0.55 + 0.45 * Math.sin(time * 1.3 + st.tw));
    ctx.fillStyle = `rgba(220,230,255,${a * 0.8})`;
    const s = 1.6 * p[2] * 1.6;
    ctx.fillRect(p[0], p[1], s, s);
  }

  // 은하: 은하 평면을 조금 기울이고, 안쪽이 더 빨리 돈다
  for (const g of galaxy) {
    const a = g.a + time * g.w;
    const w = rotX([g.r * Math.cos(a), g.y, g.r * Math.sin(a)], 0.22);
    const p = proj(cam(w));
    if (!p) continue;
    const depth = Math.max(0.15, Math.min(1, 1.25 - (p[3] + 1400) / 2800));
    const s = g.s * p[2] * 2.8;
    ctx.fillStyle = `rgba(${g.c[0]},${g.c[1]},${g.c[2]},${0.85 * depth})`;
    ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
  }

  // 원자핵 주변 빛
  const glowR = f / D * (190 + excite * 160);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  glow.addColorStop(0, `rgba(255,190,140,${0.45 + excite * 0.4})`); glow.addColorStop(0.4, 'rgba(120,150,255,.16)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

  // 궤도 선 + 전자(꼬리)
  const items = [];
  orbits.forEach((o, i) => {
    const R = o.R * (1 + excite * (0.25 + i * 0.08));
    const pos = (t) => {
      const c = Math.cos(t), s = Math.sin(t);
      return [R * (c * o.u[0] + s * o.v[0]), R * (c * o.u[1] + s * o.v[1]), R * (c * o.u[2] + s * o.v[2])];
    };
    ctx.strokeStyle = `rgba(130,170,255,${0.22 + excite * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= 96; k++) {
      const p = proj(cam(pos(k / 96 * TAU)));
      if (!p) continue;
      k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
    }
    ctx.stroke();
    const ph = o.ph + time * o.sp * (1 + excite * 1.5);
    for (let k = 18; k >= 1; k--) {
      const p = proj(cam(pos(ph - k * 0.045)));
      if (!p) continue;
      const r = (1 - k / 19) * 5 * p[2];
      ctx.fillStyle = `rgba(110,200,255,${(1 - k / 19) * 0.35})`;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
    }
    const p = proj(cam(pos(ph)));
    if (p) items.push({ z: p[3], draw: () => sphere(p[0], p[1], 11 * p[2], [150, 225, 255], [40, 110, 255], true) });
  });

  // 원자핵 알갱이(살짝 떨림), 깊이 순서로 그림
  for (const n of nucleons) {
    const j = 1.6 * Math.sin(time * 6 + n.ph);
    const p = proj(cam([n.x + j, n.y - j, n.z + j]));
    if (!p) continue;
    const r = 22 * p[2];
    items.push({ z: p[3], draw: () => n.p ? sphere(p[0], p[1], r, [255, 205, 160], [220, 90, 40]) : sphere(p[0], p[1], r, [200, 215, 255], [70, 95, 200]) });
  }
  ctx.globalCompositeOperation = 'source-over';
  items.sort((a, b) => b.z - a.z).forEach((it) => it.draw());

  // 누르면 퍼지는 빛 파동(전자가 돌아오며 내는 빛)
  ctx.globalCompositeOperation = 'lighter';
  pulses = pulses.filter((pl) => time - pl.t < 2.2);
  for (const pl of pulses) {
    const k = (time - pl.t) / 2.2;
    const r = (60 + k * 900) * f / D;
    ctx.strokeStyle = `rgba(140,200,255,${(1 - k) * 0.6})`;
    ctx.lineWidth = 2 + (1 - k) * 3;
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * (0.42 + my * 0.1), 0, 0, TAU); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function sphere(x, y, r, hi, lo, halo) {
  if (halo) {
    const h = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
    h.addColorStop(0, `rgba(${hi.join(',')},.55)`); h.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, TAU); ctx.fill();
  }
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#fff'); g.addColorStop(0.25, `rgb(${hi.join(',')})`); g.addColorStop(1, `rgb(${lo.join(',')})`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

function tick() {
  const t = box?.querySelector('.hero-time');
  if (!t) return;
  const d = new Date();
  t.querySelector('b').textContent = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  t.querySelector('span').textContent = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
}

function onMove(e) {
  const r = box.getBoundingClientRect();
  tmx = (e.clientX - r.left) / r.width * 2 - 1;
  tmy = (e.clientY - r.top) / r.height * 2 - 1;
}
function onDown() {
  excite = 1;
  pulses.push({ t: time });
  if (REDUCE.matches) frame(performance.now(), true);
}

export function startHero(el) {
  if (box === el && (raf || REDUCE.matches)) return;
  box = el;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    el.prepend(cv);
    ctx = cv.getContext('2d');
    build();
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', () => { tmx = 0; tmy = 0; });
    el.addEventListener('pointerdown', onDown);
    ro = new ResizeObserver(size);
  }
  ro.observe(el);
  size();
  tick();
  clearInterval(clock);
  clock = setInterval(tick, 10000);
  last = 0;
  cancelAnimationFrame(raf);
  if (REDUCE.matches) frame(performance.now(), true);
  else raf = requestAnimationFrame(frame);
}

export function stopHero() {
  cancelAnimationFrame(raf);
  raf = 0;
  clearInterval(clock);
  if (ro && box) ro.unobserve(box);
}
