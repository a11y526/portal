// 관리 첫 화면(아무 항목도 안 열었을 때) 가운데 3D 장면: 별 점으로 만든 나선 은하가 화면 가운데 어두운 우주에서 돈다.
// 우주 바탕·가장자리 흐림은 CSS(.hero canvas의 배경과 mask). 아래에 시각과 오늘 수업(showToday).
// 라이브러리 없이 Canvas 2D로 3D 투영. 교사 PC 전용(학생 화면에는 없음).
// 마우스를 움직이면 살짝 기울고, 누르면 점이 흩어졌다 모이며 다음 모양(은하 → 토성 → DNA → 지구)으로 바뀐다.
// 움직임 줄이기면 멈춘 한 장면만, 화면이 숨겨지면 requestAnimationFrame이 저절로 멈춘다.
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');

// 어두운 우주에 맞춘 색: 가운데는 따뜻한 흰색, 팔은 흰색·옅은 파랑
const C_CORE = [[255, 240, 215], [255, 232, 196], [255, 248, 236]];
const C_ARM = [[255, 255, 255], [226, 232, 255], [170, 196, 255], [240, 240, 250]];
const C_YOUNG = [[150, 185, 255], [255, 214, 170]];

let box = null, cv = null, ctx = null, W = 0, H = 0, raf = 0, ro = null, clock = 0, running = false;
let far = [], N = 0;
let mx = 0, my = 0, tmx = 0, tmy = 0, spin = 0, boost = 0, last = 0;
// 모양: 0 은하 → 1 토성 → 2 DNA → 3 지구 → 0 … (화면을 누르면 다음 모양으로 점이 흩어졌다 모임)
// 점마다 8칸: x, y, z, r, g, b, 투명도, 크기
const K = 8, VIEW = [0.72, 0.34, 0.12, 0.42];
let shapes = [], cur = null, from = null, delay = null, shape = 0, morphAt = -1, pitchFrom = VIEW[0];
const MORPH = 1.5, STAGGER = 0.45;

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function put(A, i, x, y, z, c, o, s) { const j = i * K; A[j] = x; A[j + 1] = y; A[j + 2] = z; A[j + 3] = c[0]; A[j + 4] = c[1]; A[j + 5] = c[2]; A[j + 6] = o; A[j + 7] = s; }
function dust(A, i) {
  const r = 700 + Math.random() * 1100, u = rnd(-1, 1), a = rnd(0, TAU), q = Math.sqrt(1 - u * u);
  put(A, i, r * q * Math.cos(a), r * u * 0.6, r * q * Math.sin(a), pick(C_ARM), rnd(0.12, 0.35), rnd(0.6, 1.3));
}

function galaxy() {
  const A = new Float32Array(N * K); let i = 0;
  // 가운데 팽대부: 밝고 둥글게 뭉친 별(가운데로 갈수록 빽빽)
  for (let n = 0; n < 2600; n++, i++) {
    const r = Math.pow(Math.random(), 1.8) * 260;
    const u = rnd(-1, 1), a = rnd(0, TAU), s = Math.sqrt(1 - u * u);
    put(A, i, r * s * Math.cos(a), r * u * 0.55, r * s * Math.sin(a), pick(C_CORE), rnd(0.6, 1) * (1 - r / 520), rnd(1, 2.2));
  }
  // 나선 팔 4개(로그 나선, 큰 팔 2개 + 사이 팔 2개). 바깥으로 갈수록 옅고 퍼짐
  for (let n = 0; n < 10000; n++, i++) {
    const arm = n % 4, minor = arm % 2;
    const t = Math.pow(Math.random(), 0.85);
    const r = 160 + t * 1150;
    const a = arm * Math.PI / 2 + Math.log(r / 160) * 1.75 + gauss() * (0.2 + t * 0.16);
    const dr = gauss() * (30 + t * 70);
    const young = Math.random() < 0.05;
    put(A, i, (r + dr) * Math.cos(a), gauss() * (16 + 14 * (1 - t)), (r + dr) * Math.sin(a), young ? pick(C_YOUNG) : pick(C_ARM),
      rnd(0.4, 0.9) * (1 - t * 0.4) * (minor ? 0.7 : 1), young ? rnd(1.4, 2.4) : rnd(0.8, 1.8));
  }
  // 원반(지수 분포): 팔 사이를 옅게 채움
  for (; i < N; i++) {
    const r = Math.min(1400, 120 - Math.log(1 - Math.random() * 0.98) * 380), a = rnd(0, TAU);
    put(A, i, r * Math.cos(a), gauss() * 18, r * Math.sin(a), pick(C_ARM), rnd(0.15, 0.4), rnd(0.6, 1.3));
  }
  return A;
}

const C_SAT = [[236, 208, 158], [214, 182, 130], [248, 228, 190], [200, 166, 118]];
const C_RING = [[226, 212, 182], [196, 186, 166], [255, 242, 214]];
function saturn() {
  const A = new Float32Array(N * K); let i = 0;
  // 본체: 표면에 줄무늬 색
  for (let n = 0; n < 5200; n++, i++) {
    const u = rnd(-1, 1), a = rnd(0, TAU), q = Math.sqrt(1 - u * u), R = 360 * (0.97 + Math.random() * 0.03);
    const band = Math.floor((u + 1) * 7) % C_SAT.length;
    put(A, i, R * q * Math.cos(a), R * u * 0.92, R * q * Math.sin(a), C_SAT[band], rnd(0.55, 0.95), rnd(1, 1.9));
  }
  // 고리 3겹(가운데 틈)
  for (let n = 0; n < 8200; n++, i++) {
    const band = Math.random();
    const r = band < 0.55 ? rnd(520, 760) : band < 0.6 ? rnd(770, 800) : rnd(810, 980);
    const a = rnd(0, TAU);
    put(A, i, r * Math.cos(a), gauss() * 5, r * Math.sin(a), pick(C_RING), band < 0.6 ? rnd(0.45, 0.9) : rnd(0.25, 0.6), rnd(0.8, 1.6));
  }
  for (; i < N; i++) dust(A, i);
  return A;
}

const C_DNA1 = [[150, 190, 255], [180, 210, 255]], C_DNA2 = [[255, 196, 160], [255, 220, 190]];
function dna() {
  const A = new Float32Array(N * K); let i = 0;
  const L = 520, R = 230, TURN = 3.2;
  // 두 가닥(이중 나선)
  for (let n = 0; n < 9000; n++, i++) {
    const t = Math.random(), side = n % 2, a = t * TURN * TAU + side * Math.PI;
    const w = 22;
    put(A, i, R * Math.cos(a) + gauss() * w, -L + 2 * L * t + gauss() * w, R * Math.sin(a) + gauss() * w,
      side ? pick(C_DNA2) : pick(C_DNA1), rnd(0.55, 1), rnd(1, 2));
  }
  // 염기쌍: 두 가닥을 잇는 가로대
  const RUNG = 34;
  for (let n = 0; n < 3800; n++, i++) {
    const k = Math.floor(Math.random() * RUNG), t = (k + 0.5) / RUNG, a = t * TURN * TAU;
    const m = rnd(-1, 1);
    put(A, i, R * Math.cos(a) * m + gauss() * 6, -L + 2 * L * t + gauss() * 6, R * Math.sin(a) * m + gauss() * 6,
      m < 0 ? [235, 240, 255] : [255, 236, 220], rnd(0.3, 0.65), rnd(0.8, 1.5));
  }
  for (; i < N; i++) dust(A, i);
  return A;
}

const C_SEA = [[80, 140, 255], [110, 170, 255], [70, 120, 230]], C_LAND = [[120, 222, 160], [170, 220, 140], [230, 218, 170]];
function earth() {
  const A = new Float32Array(N * K); let i = 0;
  const R = 520, M = 10600, GA = Math.PI * (3 - Math.sqrt(5));
  // 겉면(고르게 퍼진 점) + 대륙(줄무늬 함수로 만든 덩어리)
  for (let n = 0; n < M; n++, i++) {
    const y = 1 - 2 * (n + 0.5) / M, q = Math.sqrt(1 - y * y), a = n * GA;
    const lat = Math.asin(y), lon = a % TAU;
    const v = Math.sin(lon * 2 + 0.6) * Math.cos(lat * 2.2) + 0.55 * Math.sin(lon * 5 + 1.3) * Math.sin(lat * 3.1 + 0.4) + 0.3 * Math.cos(lon * 9 - lat * 4);
    const ice = Math.abs(y) > 0.9, land = v > 0.42;
    const c = ice ? [240, 246, 255] : land ? pick(C_LAND) : pick(C_SEA);
    put(A, i, R * q * Math.cos(a), R * y, R * q * Math.sin(a), c, ice || land ? rnd(0.7, 1) : rnd(0.35, 0.65), land ? rnd(1.2, 2) : rnd(0.9, 1.6));
  }
  // 대기: 바깥에 옅은 파란 껍질
  for (let n = 0; n < 2000; n++, i++) {
    const u = rnd(-1, 1), a = rnd(0, TAU), q = Math.sqrt(1 - u * u), r = R * rnd(1.04, 1.12);
    put(A, i, r * q * Math.cos(a), r * u, r * q * Math.sin(a), [170, 205, 255], rnd(0.1, 0.3), rnd(0.6, 1.2));
  }
  for (; i < N; i++) dust(A, i);
  return A;
}

function build() {
  N = 2600 + 10000 + 3200;
  shapes = [galaxy(), saturn(), dna(), earth()];
  cur = shapes[0].slice();
  from = new Float32Array(N * K);
  delay = new Float32Array(N).map(() => Math.random() * STAGGER);
  // 멀리 있는 별(아주 옅게)
  far = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), s: rnd(0.6, 1.5), o: rnd(0.12, 0.35), tw: rnd(0, TAU) }));
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
let pitch = VIEW[0];

function nextShape() {
  from.set(cur);
  pitchFrom = pitch;
  shape = (shape + 1) % shapes.length;
  if (REDUCE.matches) { cur.set(shapes[shape]); pitch = VIEW[shape]; morphAt = -1; draw(performance.now() / 1000); return; }
  morphAt = performance.now() / 1000;
  if (!raf && running) raf = requestAnimationFrame(frame);
}

function morph(t) {
  if (morphAt < 0) return;
  const el = t - morphAt, to = shapes[shape];
  for (let i = 0; i < N; i++) {
    const e = ease(Math.min(1, Math.max(0, (el - delay[i]) / MORPH)));
    // 가운데쯤에서 바깥으로 살짝 부풀었다가 모임
    const puff = 1 + Math.sin(e * Math.PI) * 0.35;
    const j = i * K;
    for (let k = 0; k < 3; k++) cur[j + k] = (from[j + k] + (to[j + k] - from[j + k]) * e) * puff;
    for (let k = 3; k < K; k++) cur[j + k] = from[j + k] + (to[j + k] - from[j + k]) * e;
  }
  const g = ease(Math.min(1, el / (MORPH + STAGGER)));
  pitch = pitchFrom + (VIEW[shape] - pitchFrom) * g;
  if (el >= MORPH + STAGGER) { cur.set(to); pitch = VIEW[shape]; morphAt = -1; }
}

function size() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(performance.now() / 1000);
  // 숨겨져 있다가(로그인 전) 보이게 되면 여기서 다시 돌기 시작한다
  if (running && !raf && !REDUCE.matches) raf = requestAnimationFrame(frame);
}

function frame(now) {
  raf = 0;
  if (!running || !W || !H) return;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
  last = now;
  boost *= Math.pow(0.25, dt);
  spin += dt * (0.14 + boost * 1.2);
  mx += (tmx - mx) * 0.05; my += (tmy - my) * 0.05;
  morph(performance.now() / 1000);
  draw(now / 1000);
  raf = requestAnimationFrame(frame);
}

function draw(t) {
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  const D = 5200, f = Math.min(W * 0.44, H * 0.8) * D / 1150, cx = W / 2, cy = H * 0.46;
  const pt = pitch + my * 0.14, yaw = mx * 0.3;
  const cp = Math.cos(pt), sp = Math.sin(pt), cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cs = Math.cos(spin), ss = Math.sin(spin);

  for (const p of far) {
    ctx.fillStyle = `rgba(255,255,255,${p.o * 1.6 * (0.6 + 0.4 * Math.sin(t * 0.8 + p.tw))})`;
    ctx.fillRect(p.x * W, p.y * H, p.s, p.s);
  }
  if (shape === 0 && morphAt < 0) {
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, f * 0.075);
    glow.addColorStop(0, 'rgba(255,236,200,.5)');
    glow.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  const A = cur;
  for (let i = 0, j = 0; i < N; i++, j += K) {
    // 회전(세로축) → 좌우 기울기(마우스) → 앞뒤 기울기
    let x = A[j] * cs - A[j + 2] * ss, z = A[j] * ss + A[j + 2] * cs, y = A[j + 1];
    const x2 = x * cyw + z * syw; z = -x * syw + z * cyw; x = x2;
    const y2 = y * cp - z * sp; z = y * sp + z * cp; y = y2;
    const q = z + D;
    if (q < 200) continue;
    const k = f / q;
    const sx = cx + x * k, sy = cy + y * k;
    if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue;
    const depth = Math.min(1, Math.max(0.55, 1.6 - q / D * 0.75));
    const s = A[j + 7] * (0.55 + k * 0.75);
    ctx.fillStyle = `rgba(${A[j + 3] | 0},${A[j + 4] | 0},${A[j + 5] | 0},${Math.min(1, A[j + 6] * depth * 1.15)})`;
    ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
  }
}

function tick() {
  const el = box?.querySelector('.hero-time');
  if (!el) return;
  const d = new Date();
  el.querySelector('b').textContent = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  el.querySelector('.hero-wd').textContent = d.toLocaleDateString('ko-KR', { weekday: 'long' });
  el.title = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  paintToday();
}

// 오늘 수업: 교시 카드 + '지금/다음 수업' 한 줄. 교시 시간(진도 관리 설정)이 있어야 지금·다음을 안다
let today = [];
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const escH = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function showToday(rows) {
  today = Array.isArray(rows) ? rows : [];
  paintToday();
}
function paintToday() {
  const list = document.getElementById('hero-today'), next = document.getElementById('hero-next');
  if (!list || !next) return;
  const now = hm(new Date());
  const cls = (r) => (r.class_id === 20 ? 'test반' : `${r.class_id}반`);
  const at = today.find((r) => r.kind === '수업' && r.end && now < r.end);
  list.innerHTML = today.map((r) => {
    const what = r.kind === '수업' ? (r.code || '차시 미정') : r.kind;
    const live = r === at && r.start && now >= r.start;
    const tag = r === at ? (live ? ' · 지금' : ' · 다음') : '';
    return `<div class="hero-chip${r === at ? ' now' : ''}${r.kind !== '수업' ? ' off' : ''}"><small>${r.period}교시${tag}</small>${escH(cls(r))} · ${escH(what)}</div>`;
  }).join('');
  if (at) {
    const live = at.start && now >= at.start;
    next.innerHTML = `${live ? '지금 수업' : '다음 수업'} · ${at.period}교시 <b class="acc">${escH(cls(at))}</b> <b>${escH(at.code || '')} ${escH(at.title)}</b>`;
  }
  next.classList.toggle('hidden', !at);
}

function onMove(e) {
  const r = cv.getBoundingClientRect();
  tmx = (e.clientX - r.left) / r.width * 2 - 1;
  tmy = (e.clientY - r.top) / r.height * 2 - 1;
}

export function startHero(el) {
  box = el;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    el.prepend(cv);
    ctx = cv.getContext('2d');
    build();
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', () => { tmx = 0; tmy = 0; });
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { down = null; return; }
      down = null;
      boost = 0.6;
      nextShape();
    });
    ro = new ResizeObserver(size);
  }
  running = true;
  ro.observe(cv);
  tick();
  clearInterval(clock);
  clock = setInterval(tick, 10000);
  last = 0;
  if (!raf && !REDUCE.matches) raf = requestAnimationFrame(frame);
}

export function stopHero() {
  running = false;
  cancelAnimationFrame(raf);
  raf = 0;
  clearInterval(clock);
  if (ro && cv) ro.unobserve(cv);
}
