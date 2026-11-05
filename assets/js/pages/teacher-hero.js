// 관리 첫 화면(아무 항목도 안 열었을 때) 가운데 3D 장면: 별 점으로 만든 나선 은하가 화면 가운데 어두운 우주에서 돈다.
// 우주 바탕·가장자리 흐림은 CSS(.hero canvas의 배경과 mask). 아래에 시각과 오늘 수업(showToday).
// 라이브러리 없이 Canvas 2D로 3D 투영. 교사 PC 전용(학생 화면에는 없음).
// 마우스를 움직이면 은하가 살짝 기울고, 누르면 잠깐 빨리 돈다.
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
let pts = [], far = [];
let mx = 0, my = 0, tmx = 0, tmy = 0, spin = 0, boost = 0, last = 0;

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

function build() {
  pts = [];
  // 가운데 팽대부: 밝고 둥글게 뭉친 별(가운데로 갈수록 빽빽)
  for (let i = 0; i < 2600; i++) {
    const r = Math.pow(Math.random(), 1.8) * 260;
    const u = rnd(-1, 1), a = rnd(0, TAU), s = Math.sqrt(1 - u * u);
    pts.push({ x: r * s * Math.cos(a), y: r * u * 0.55, z: r * s * Math.sin(a), c: pick(C_CORE), s: rnd(1, 2.2), o: rnd(0.6, 1) * (1 - r / 520) });
  }
  // 나선 팔 4개(로그 나선, 큰 팔 2개 + 사이 팔 2개). 팔은 넓게, 바깥으로 갈수록 옅고 퍼짐
  for (let i = 0; i < 10000; i++) {
    const arm = i % 4, minor = arm % 2;
    const t = Math.pow(Math.random(), 0.85);
    const r = 160 + t * 1150;
    const a = arm * Math.PI / 2 + Math.log(r / 160) * 1.75 + gauss() * (0.2 + t * 0.16);
    const dr = gauss() * (30 + t * 70);
    const young = Math.random() < 0.05;
    pts.push({ x: (r + dr) * Math.cos(a), y: gauss() * (16 + 14 * (1 - t)), z: (r + dr) * Math.sin(a), c: young ? pick(C_YOUNG) : pick(C_ARM), s: young ? rnd(1.4, 2.4) : rnd(0.8, 1.8), o: rnd(0.4, 0.9) * (1 - t * 0.4) * (minor ? 0.7 : 1) });
  }
  // 원반(지수 분포): 팔 사이를 옅게 채움
  for (let i = 0; i < 3200; i++) {
    const r = Math.min(1400, 120 - Math.log(1 - Math.random() * 0.98) * 380), a = rnd(0, TAU);
    pts.push({ x: r * Math.cos(a), y: gauss() * 18, z: r * Math.sin(a), c: pick(C_ARM), s: rnd(0.6, 1.3), o: rnd(0.15, 0.4) });
  }
  // 멀리 있는 별(아주 옅게)
  far = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), s: rnd(0.6, 1.5), o: rnd(0.12, 0.35), tw: rnd(0, TAU) }));
}

function size() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = box.clientWidth; H = box.clientHeight;
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
  draw(now / 1000);
  raf = requestAnimationFrame(frame);
}

function draw(t) {
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  const D = 5200, f = Math.min(W * 0.34, H * 0.6) * D / 1150, cx = W / 2, cy = H * 0.45;
  const pitch = 0.72 + my * 0.14, yaw = mx * 0.3;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cs = Math.cos(spin), ss = Math.sin(spin);

  for (const p of far) {
    ctx.fillStyle = `rgba(255,255,255,${p.o * 1.6 * (0.6 + 0.4 * Math.sin(t * 0.8 + p.tw))})`;
    ctx.fillRect(p.x * W, p.y * H, p.s, p.s);
  }
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, f * 0.075);
  glow.addColorStop(0, 'rgba(255,236,200,.5)');
  glow.addColorStop(1, 'rgba(255,236,200,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  for (const p of pts) {
    // 은하 회전(원반 축) → 좌우 기울기(마우스) → 앞뒤 기울기
    let x = p.x * cs - p.z * ss, z = p.x * ss + p.z * cs, y = p.y;
    let x2 = x * cyw + z * syw; z = -x * syw + z * cyw; x = x2;
    const y2 = y * cp - z * sp; z = y * sp + z * cp; y = y2;
    const q = z + D;
    if (q < 200) continue;
    const k = f / q;
    const sx = cx + x * k, sy = cy + y * k;
    if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue;
    const depth = Math.min(1, Math.max(0.55, 1.6 - q / D * 0.75));
    const s = p.s * (0.55 + k * 0.75);
    ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${Math.min(1, p.o * depth * 1.15)})`;
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
  const r = box.getBoundingClientRect();
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
    el.addEventListener('pointerdown', () => { boost = 1; });
    ro = new ResizeObserver(size);
  }
  running = true;
  ro.observe(el);
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
  if (ro && box) ro.unobserve(box);
}
