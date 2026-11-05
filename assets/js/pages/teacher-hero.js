// 관리 첫 화면(아무 항목도 안 열었을 때) 가운데 3D 장면: 별 점으로 만든 나선 은하가 화면 가운데 어두운 우주에서 돈다.
// 우주 바탕·가장자리 흐림은 CSS(.hero canvas의 배경과 mask). 아래에 시각과 오늘 수업(showToday).
// 라이브러리 없이 Canvas 2D로 3D 투영. 교사 PC 전용(학생 화면에는 없음).
// 마우스를 움직이면 살짝 기울고, 누르면 점이 흩어졌다 모이며 다음 모양(은하 → 초신성 → 말머리 성운 → 퀘이사)으로 바뀐다.
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
// 모양: 0 은하 → 1 초신성 → 2 말머리 성운(B33) → 3 퀘이사 → 0 … (화면을 누르면 다음 모양으로 점이 흩어졌다 모임)
// 점마다 8칸: x, y, z, r, g, b, 투명도, 크기
const K = 8, VIEW = [0.72, 0.2, 0, 0.5], FLAT = [0, 0, 1, 0];
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

const C_NOVA = [[120, 140, 255], [160, 175, 255], [200, 210, 255], [100, 110, 235]], C_FIL = [[255, 170, 225], [240, 150, 215], [255, 205, 240]];
function dir() { const u = rnd(-1, 1), a = rnd(0, TAU), q = Math.sqrt(1 - u * u); return [q * Math.cos(a), u, q * Math.sin(a)]; }
function supernova() {
  const A = new Float32Array(N * K); let i = 0;
  // 가운데 하얗게 빛나는 핵
  for (let n = 0; n < 1500; n++, i++) {
    const d = dir(), r = Math.abs(gauss()) * 70;
    put(A, i, d[0] * r, d[1] * r, d[2] * r, [240, 244, 255], rnd(0.7, 1), rnd(1.2, 2.4));
  }
  // 안쪽: 옅은 파란 기체
  for (let n = 0; n < 2000; n++, i++) {
    const d = dir(), r = Math.sqrt(Math.random()) * 380;
    put(A, i, d[0] * r, d[1] * r, d[2] * r, pick(C_NOVA), rnd(0.25, 0.55), rnd(0.8, 1.5));
  }
  // 퍼져 나가는 껍질: 빽빽한 파란·흰 점
  for (let n = 0; n < 6500; n++, i++) {
    const d = dir(), r = 430 + gauss() * 130;
    put(A, i, d[0] * r, d[1] * r, d[2] * r, Math.random() < 0.2 ? [235, 240, 255] : pick(C_NOVA), rnd(0.55, 1), rnd(1.1, 2.1));
  }
  // 바깥 분홍 실 무늬(껍질 위를 구불구불 걷는 줄)
  for (let f = 0; f < 46; f++) {
    let d = dir(), t = dir();
    for (let n = 0; n < 61 && i < N; n++, i++) {
      // d에 수직인 방향으로 조금씩 걸으며 방향을 비틂
      t = [t[0] + gauss() * 0.6, t[1] + gauss() * 0.6, t[2] + gauss() * 0.6];
      const dot = t[0] * d[0] + t[1] * d[1] + t[2] * d[2];
      t = [t[0] - dot * d[0], t[1] - dot * d[1], t[2] - dot * d[2]];
      const tl = Math.hypot(t[0], t[1], t[2]) || 1; t = [t[0] / tl, t[1] / tl, t[2] / tl];
      d = [d[0] + t[0] * 0.035, d[1] + t[1] * 0.035, d[2] + t[2] * 0.035];
      const dl = Math.hypot(d[0], d[1], d[2]); d = [d[0] / dl, d[1] / dl, d[2] / dl];
      const r = 600 + Math.sin(n * 0.3 + f) * 40 + gauss() * 10;
      put(A, i, d[0] * r, d[1] * r, d[2] * r, pick(C_FIL), rnd(0.7, 1), rnd(1.3, 2.3));
    }
  }
  // 바깥으로 뻗는 빛줄기
  for (let n = 0; n < 2000 && i < N; n++, i++) {
    const ray = Math.floor(n / 40), d = [Math.cos(ray * 2.4) * Math.sin(ray * 1.3 + 0.4), Math.cos(ray * 1.3 + 0.4), Math.sin(ray * 2.4) * Math.sin(ray * 1.3 + 0.4)];
    const dl = Math.hypot(d[0], d[1], d[2]), r = 150 + Math.pow(Math.random(), 0.7) * 1100;
    put(A, i, d[0] / dl * r + gauss() * 8, d[1] / dl * r + gauss() * 8, d[2] / dl * r + gauss() * 8, [190, 205, 255], rnd(0.2, 0.55) * (1 - r / 1400), rnd(0.7, 1.4));
  }
  for (; i < N; i++) dust(A, i);
  return A;
}

// B33 말머리 성운: 분홍으로 빛나는 기체 앞에 어두운 말머리 모양 먼지(점이 거의 없음). 화면을 마주 보고 돌지 않음
const C_PINK = [[255, 120, 175], [240, 105, 185], [255, 160, 205], [225, 95, 160]], C_DUSTY = [[70, 130, 120], [90, 150, 135], [60, 105, 110]];
// 사진(B33)의 말머리 윤곽을 따라 찍은 점(사진 비율 0~1, 주둥이 끝부터 시계 방향)
const HORSE = [[0.17, 0.37], [0.22, 0.31], [0.31, 0.26], [0.36, 0.19], [0.42, 0.13], [0.5, 0.16], [0.6, 0.2], [0.7, 0.23], [0.77, 0.3],
  [0.81, 0.41], [0.83, 0.55], [0.82, 0.7], [0.8, 0.85], [0.76, 1.05], [0.28, 1.05], [0.36, 0.86], [0.41, 0.71], [0.43, 0.59],
  [0.41, 0.51], [0.35, 0.47], [0.27, 0.45], [0.2, 0.42]];
function horseInside(x, y) {
  // 화면 단위 → 사진 비율. 가장자리는 살짝 구불구불
  const px = x / 1250 + 0.5 + Math.sin(y / 45) * 0.006, py = y / 1200 + 0.5 + Math.cos(x / 55) * 0.006;
  let inside = false;
  for (let a = 0, b = HORSE.length - 1; a < HORSE.length; b = a++) {
    const [xa, ya] = HORSE[a], [xb, yb] = HORSE[b];
    if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}
function horsehead() {
  const A = new Float32Array(N * K); let i = 0;
  const X = 1000, Y = 600;
  const near = (x, y, d) => horseInside(x + d, y) || horseInside(x - d, y) || horseInside(x, y + d) || horseInside(x, y - d);
  // 빛나는 기체: 큰 점을 옅게 겹쳐 구름처럼(위쪽이 더 밝고, 아래로 갈수록 보랏빛, 말머리 둘레가 더 밝음)
  while (i < 10500) {
    const x = rnd(-1.5, 1.5) * X, y = rnd(-1.2, 1.2) * Y;
    if (horseInside(x, y)) continue;
    const low = Math.min(1, Math.max(0, (y + Y) / (2 * Y))), edge = near(x, y, 90) ? 1.6 : 1;
    const c = Math.random() < low * 0.6 ? pick([[170, 120, 215], [150, 110, 200]]) : pick(C_PINK);
    put(A, i++, x, y, gauss() * 60, c, rnd(0.07, 0.17) * (1.15 - low * 0.55) * edge, rnd(5, 12));
  }
  // 말머리 가장자리: 빛을 받아 밝게
  while (i < 12300) {
    const x = rnd(-X, X), y = rnd(-Y, Y);
    if (horseInside(x, y) || !near(x, y, 26)) continue;
    put(A, i++, x, y, gauss() * 15, Math.random() < 0.35 ? [255, 225, 235] : pick(C_PINK), rnd(0.35, 0.8), rnd(1.2, 2.6));
  }
  // 말머리 안: 어두운 청록 먼지(아주 옅게)
  while (i < 13900) {
    const x = rnd(-X, X), y = rnd(-Y, Y);
    if (!horseInside(x, y)) continue;
    put(A, i++, x, y, gauss() * 40, pick(C_DUSTY), rnd(0.05, 0.12), rnd(3, 6));
  }
  // 밝은 별
  for (let n = 0; n < 170; n++, i++) put(A, i, rnd(-X, X), rnd(-Y, Y), rnd(-200, 200), pick([[255, 255, 240], [255, 240, 190], [240, 245, 255]]), rnd(0.7, 1), rnd(1.6, 3.4));
  for (; i < N; i++) put(A, i, rnd(-X, X) * 1.2, rnd(-Y, Y) * 1.2, rnd(-500, 500), [255, 150, 200], rnd(0.04, 0.1), rnd(2, 4));
  return A;
}

// 퀘이사: 가운데가 하얗게 빛나는 강착 원반(밖으로 노랑 → 주황 → 빨강), 위아래로 뻗는 제트, 붉은 실 고리
function quasar() {
  const A = new Float32Array(N * K); let i = 0;
  for (let n = 0; n < 1200; n++, i++) {
    const d = dir(), r = Math.abs(gauss()) * 45;
    put(A, i, d[0] * r, d[1] * r * 0.6, d[2] * r, [255, 252, 238], rnd(0.8, 1), rnd(1.3, 2.4));
  }
  for (let n = 0; n < 8000; n++, i++) {
    const r = 40 + Math.pow(Math.random(), 1.35) * 860, a = rnd(0, TAU) + Math.log(1 + r / 60) * 0.0;
    const c = r < 130 ? [255, 248, 225] : r < 280 ? pick([[255, 222, 130], [255, 205, 100]]) : r < 480 ? pick([[255, 150, 60], [255, 125, 50]]) : pick([[230, 70, 50], [210, 55, 50], [245, 95, 60]]);
    put(A, i, r * Math.cos(a), gauss() * (3 + r * 0.035), r * Math.sin(a), c, rnd(0.45, 1) * (1 - r / 1150), rnd(1.1, 2.4) * (r < 280 ? 1.4 : 1));
  }
  // 제트(원반에 수직으로 양쪽, 군데군데 뭉침)
  for (let n = 0; n < 1600; n++, i++) {
    const t = Math.pow(Math.random(), 0.8), side = n % 2 ? 1 : -1, knot = Math.random() < 0.25;
    const y = side * (60 + (knot ? Math.round(t * 5) / 5 : t) * (side < 0 ? 1100 : 600)), w = 4 + t * 14 + (knot ? 12 : 0);
    put(A, i, gauss() * w, y, gauss() * w, [225, 232, 255], rnd(0.4, 0.9) * (1 - t * 0.6) * (side < 0 ? 1 : 0.45), rnd(0.9, 1.8));
  }
  // 붉은 실 고리: 원반에서 솟았다 내려앉는 호
  for (let f = 0; f < 44; f++) {
    const a0 = rnd(0, TAU), r0 = rnd(250, 750), rr = rnd(150, 500), h = rnd(120, 420) * (Math.random() < 0.5 ? 1 : -1), turn = rnd(0.4, 1.3);
    for (let n = 0; n < 68 && i < N; n++, i++) {
      const sx = n / 67 * Math.PI, R = r0 + Math.sin(sx) * rr, a = a0 + sx / Math.PI * turn;
      put(A, i, R * Math.cos(a) + gauss() * 6, -Math.sin(sx) * h + gauss() * 6, R * Math.sin(a) + gauss() * 6, pick([[255, 90, 60], [230, 60, 50], [255, 135, 85]]), rnd(0.4, 0.85), rnd(1.1, 2));
    }
  }
  // 둘레 파란 안개
  for (; i < N; i++) {
    const d = dir(), r = rnd(800, 1600);
    put(A, i, d[0] * r, d[1] * r * 0.6, d[2] * r, pick([[80, 110, 190], [110, 120, 200], [70, 90, 160]]), rnd(0.08, 0.25), rnd(0.8, 1.6));
  }
  return A;
}

function build() {
  N = 2600 + 10000 + 3200;
  shapes = [galaxy(), supernova(), horsehead(), quasar()];
  cur = shapes[0].slice();
  from = new Float32Array(N * K);
  delay = new Float32Array(N).map(() => Math.random() * STAGGER);
  // 멀리 있는 별(아주 옅게)
  far = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), s: rnd(0.6, 1.5), o: rnd(0.12, 0.35), tw: rnd(0, TAU) }));
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
let pitch = VIEW[0], flat = 0, flatFrom = 0;

function nextShape() {
  from.set(cur);
  pitchFrom = pitch; flatFrom = flat;
  shape = (shape + 1) % shapes.length;
  if (REDUCE.matches) { cur.set(shapes[shape]); pitch = VIEW[shape]; flat = FLAT[shape]; morphAt = -1; draw(performance.now() / 1000); return; }
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
  flat = flatFrom + (FLAT[shape] - flatFrom) * g;
  if (el >= MORPH + STAGGER) { cur.set(to); pitch = VIEW[shape]; flat = FLAT[shape]; morphAt = -1; }
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
  // 마주 보는 모양(성운)은 돌지 않음: 돌던 각도를 0쪽으로 서서히
  const rot = spin * (1 - flat), cs = Math.cos(rot), ss = Math.sin(rot);

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
  // 초신성·성운·퀘이사: 빛무리, 점은 겹칠수록 밝게
  const amt = morphAt < 0 ? 1 : ease(Math.min(1, (t - morphAt) / (MORPH + STAGGER)));
  const nova = shape === 1 ? amt : 0, neb = shape === 2 ? amt : 0, qso = shape === 3 ? amt : 0;
  const halo = (x, y, R, stops) => { const g = ctx.createRadialGradient(x, y, 0, x, y, R); stops.forEach(([o, c]) => g.addColorStop(o, c)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
  if (nova) halo(cx, cy, f * 0.13, [[0, `rgba(120,130,255,${0.42 * nova})`], [0.6, `rgba(90,90,220,${0.16 * nova})`], [1, 'rgba(80,80,200,0)']]);
  if (neb) halo(cx, cy - H * 0.2, Math.max(W, H) * 0.7, [[0, `rgba(210,80,140,${0.16 * neb})`], [0.6, `rgba(150,60,130,${0.08 * neb})`], [1, 'rgba(90,40,110,0)']]);
  if (qso) halo(cx, cy, f * 0.16, [[0, `rgba(255,150,70,${0.35 * qso})`], [0.5, `rgba(200,50,40,${0.18 * qso})`], [1, 'rgba(120,20,30,0)']]);
  if (shape) ctx.globalCompositeOperation = 'lighter';

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
    if (s < 2.6) ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    else { ctx.beginPath(); ctx.arc(sx, sy, s / 2, 0, TAU); ctx.fill(); } // 큰 점(성운 기체)은 둥글게
  }
  if (nova > 0) {
    // 가운데 섬광 + 가로로 긴 빛
    const R = f * 0.022, core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    core.addColorStop(0, `rgba(255,255,255,${0.95 * nova})`);
    core.addColorStop(0.35, `rgba(210,215,255,${0.6 * nova})`);
    core.addColorStop(1, 'rgba(150,160,255,0)');
    ctx.fillStyle = core;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, 0.06);
    const L = f * 0.05, flare = ctx.createRadialGradient(0, 0, 0, 0, 0, L);
    flare.addColorStop(0, `rgba(255,255,255,${0.85 * nova})`);
    flare.addColorStop(1, 'rgba(190,200,255,0)');
    ctx.fillStyle = flare;
    ctx.fillRect(-L, -L, L * 2, L * 2);
    ctx.restore();
  }
  if (qso) {
    const R = f * 0.03, core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    core.addColorStop(0, `rgba(255,255,250,${qso})`);
    core.addColorStop(0.3, `rgba(255,230,160,${0.7 * qso})`);
    core.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = core;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
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
