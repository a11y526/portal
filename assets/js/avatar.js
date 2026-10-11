// 캐릭터 그리기: 부품 조합 {face,hair,eyes,mouth,outfit,acc,bg} → SVG 하나 + 모션
// 망점 무늬 3단계(밝음·중간·어두움)는 캐릭터마다 접두어를 붙인 <pattern>으로 만든다.
// 작은 크기일수록 점 간격과 선 굵기를 키워 뭉개지지 않게 한다.

import { PARTS, SLOTS, DEFAULTS } from './avatar-parts.js';

const INK = '#15171C';
const PAPER = '#fff';
const ACCENT = '#2457E6'; // 희귀·전설 부품만
const GOLD = '#D19A00';
const SALT = Math.random().toString(36).slice(2, 6); // 무늬 id가 다른 캐릭터와 겹치지 않게
let seq = 0;

/* ---------- 저장값 정리: 빠졌거나 모르는 부품은 기본값 ---------- */
export function normalize(avatar) {
  const out = {};
  for (const slot of SLOTS) {
    const id = avatar?.[slot];
    out[slot] = PARTS[slot][id] ? id : DEFAULTS[slot];
  }
  return out;
}

// 가벼운 화면(<html class="lite">): 움직이지 않는 그림, 망점은 점 간격을 가장 넓게
const lite = () => document.documentElement.classList.contains('lite');

/* ---------- 크기에 맞춘 그리기 도구 ---------- */
function makeKit(size) {
  const id = 'av' + SALT + (++seq).toString(36);
  const cellPx = lite() ? 4.2 : Math.min(4.2, Math.max(2.4, size / 50)); // 화면에서 점 한 칸 크기(px)
  return {
    id,
    cell: (cellPx * 120) / size,
    sw: Math.max(2.4, (1.3 * 120) / size),
    detail: size >= 64,
    ink: INK,
    paper: PAPER,
    accent: ACCENT,
    gold: GOLD,
    L: `url(#${id}-l)`,
    M: `url(#${id}-m)`,
    D: `url(#${id}-d)`,
  };
}

function patterns(k) {
  const c = +k.cell.toFixed(3);
  const dot = (name, r) =>
    `<pattern id="${k.id}-${name}" patternUnits="userSpaceOnUse" width="${c}" height="${c}" patternTransform="rotate(45)">` +
    `<rect width="${c}" height="${c}" fill="${PAPER}"/>` +
    `<circle cx="${c / 2}" cy="${c / 2}" r="${(c * r).toFixed(3)}" fill="${INK}"/></pattern>`;
  return dot('l', k.detail ? 0.17 : 0.11) + dot('m', 0.3) + dot('d', 0.48); // 작을 땐 밝은 점을 줄여 얼굴이 깨끗하게
}

const sw = (k, w = 1) => `stroke="${INK}" stroke-width="${(k.sw * w).toFixed(2)}"`;

/* ---------- 얼굴: 귀 → 중간 망점 → 밝은 망점(왼쪽 위로 비켜서 오른쪽 아래에 그림자) → 볼 → 윤곽 ---------- */
function drawFace(k, f, ears) {
  let s = '';
  if (ears) {
    s += f.ears.map(([x, y]) =>
      `<ellipse cx="${x}" cy="${y}" rx="4.6" ry="6" fill="${k.L}" ${sw(k)}/>` +
      (k.detail ? `<path d="M${x + (x < 60 ? 1 : -1)} ${y - 2.5} q${x < 60 ? -2 : 2} 2.5 0 5" fill="none" ${sw(k, 0.5)}/>` : '')
    ).join('');
  }
  s += `<clipPath id="${k.id}-fc"><path d="${f.d}"/></clipPath>`;
  s += `<path d="${f.d}" fill="${k.M}"/>`;
  s += `<g clip-path="url(#${k.id}-fc)"><path d="${f.d}" fill="${k.L}" transform="translate(-4.5 -4)"/></g>`;
  if (k.detail) {
    const hatch = (cx) => [0, 1, 2].map((i) => {
      const x = cx - 3.2 + i * 2.8;
      return `M${x.toFixed(1)} 65.4 L${(x + 1.6).toFixed(1)} 62`;
    }).join(' ');
    s += `<path d="${hatch(43)} ${hatch(77)}" fill="none" ${sw(k, 0.5)}/>`;
  }
  s += `<path d="${f.d}" fill="none" ${sw(k)}/>`;
  return s;
}

/* ---------- 목 (턱 아래 그림자) ---------- */
function drawNeck(k) {
  return `<path d="M53.5 70 V84 Q53 88.5 45 90 V100 H75 V90 Q67 88.5 66.5 84 V70 Z" fill="${k.L}"/>` +
    `<path d="M53.5 70 V80.5 Q60 85 66.5 80.5 V70 Z" fill="${k.M}"/>` +
    `<path d="M53.5 72 V84 Q53 88.5 45 90 M66.5 72 V84 Q67 88.5 75 90" fill="none" ${sw(k)}/>`;
}

/* ---------- 손 흔들기용 팔 (평소엔 숨김, .av--wave 때 올라옴) ---------- */
function drawArm(k, sleeve) {
  return `<g class="av-arm">` +
    `<path d="M89 126 L91.5 99 C92 94.5 101.5 94.5 102 99 L104.5 126 Z" fill="${k[sleeve] || k.M}" ${sw(k)}/>` +
    `<ellipse cx="90.8" cy="92.5" rx="2.6" ry="3.6" transform="rotate(-25 90.8 92.5)" fill="${k.L}" ${sw(k)}/>` +
    `<circle cx="96.8" cy="90.5" r="6.6" fill="${k.L}" ${sw(k)}/>` +
    `</g>`;
}

/* ---------- 조합 ---------- */
// fresh: 방금 산 부품의 칸('hair' 등). 그 부품이 위에서 떨어지며 착용된다
// live: 숨쉬기·눈 깜빡임을 하는 캐릭터(내 캐릭터, 1~3위). 여러 명이 한꺼번에 보이는 곳은 끄고 반응 모션만
export function avatarSVG(avatar, size = 96, { label = '캐릭터', fresh = null, live = false } = {}) {
  const a = normalize(avatar);
  const k = makeKit(size);
  const P = (slot) => PARTS[slot][a[slot]];
  const face = P('face'), hair = P('hair'), eyes = P('eyes'), mouth = P('mouth');
  const outfit = P('outfit'), acc = P('acc'), bg = P('bg');
  const call = (fn) => (fn ? fn(k) : '');
  const drop = (slot, markup) => (fresh === slot && markup ? `<g class="av-item-new">${markup}</g>` : markup);

  if (live) startBlinking();
  const clip = `M-30 -40 H150 V60 H118 A58 58 0 0 1 2 60 H-30 Z`; // 위는 열고 아래는 배경 원을 따라 자름

  return `<svg class="av${live ? ' av-live' : ''}" viewBox="0 0 120 120" width="${size}" height="${size}" overflow="visible"` +
    ` stroke-linejoin="round" stroke-linecap="round" role="img" aria-label="${label}"` +
    (live ? ` style="--breathe-d:${(-Math.random() * 3).toFixed(2)}s"` : '') + `>` +
    `<defs>${patterns(k)}<clipPath id="${k.id}-clip"><path d="${clip}"/></clipPath></defs>` +
    `<g class="av-bg">${drop('bg', call(bg.draw))}</g>` +
    `<g clip-path="url(#${k.id}-clip)">` +
      `<g class="av-body">${call(outfit.behind)}${drawNeck(k)}${drop('outfit', call(outfit.draw))}${acc.layer === 'body' ? drop('acc', call(acc.draw)) : ''}</g>` +
      drawArm(k, outfit.sleeve) +
    `</g>` +
    `<g class="av-head">` +
      drop('hair', call(hair.back)) +
      drawFace(k, face, hair.ears !== false) +
      `<g class="av-eyes">${drop('eyes', call(eyes.draw))}</g>` +
      drop('mouth', call(mouth.draw)) +
      drop('hair', call(hair.front)) +
      (acc.layer !== 'body' ? drop('acc', call(acc.draw)) : '') +
    `</g>` +
    `</svg>`;
}

export function mountAvatar(host, avatar, size = 96, opts = {}) {
  host.innerHTML = avatarSVG(avatar, size, opts);
  return host.querySelector('svg.av');
}

/* ---------- 눈 깜빡임 ----------
   무한 CSS 애니메이션 대신, 1초마다 살펴서 차례가 된 캐릭터(.av-live)만 4~7초에 한 번 짧게 깜빡인다 */
let blinkTimer = null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function startBlinking() {
  if (blinkTimer || reduceMotion) return;
  blinkTimer = setInterval(() => {
    if (document.hidden || lite()) return;
    const now = performance.now();
    document.querySelectorAll('svg.av-live').forEach((svg) => {
      if (!svg._blinkAt) { svg._blinkAt = now + 1000 + Math.random() * 5000; return; }
      if (now < svg._blinkAt) return;
      svg._blinkAt = now + 4000 + Math.random() * 3000;
      replay(svg, 'av--blink', 200);
    });
  }, 1000);
}

/* ---------- 반응 모션 ---------- */
const DURATION = { jump: 900, tilt: 800, wave: 1300, levelup: 1200, drop: 600 };

function replay(svg, cls, ms) {
  svg.classList.remove(cls);
  void svg.getBoundingClientRect();
  svg.classList.add(cls);
  clearTimeout(svg['_t_' + cls]);
  svg['_t_' + cls] = setTimeout(() => svg.classList.remove(cls), ms);
}

function addFx(svg, markup, ms) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'av-fx-wrap');
  g.innerHTML = markup;
  svg.append(g);
  if (ms) setTimeout(() => g.remove(), ms);
  return g;
}

// kind: 'jump' 점프 · 'tilt' 고개 갸웃 · 'wave' 손 흔들기 · 'levelup' 회전 점프+반짝 · 'returned' 갸웃+물음표
//       'sparkle' 반짝임만 (아이템을 산 뒤)
export function react(svg, kind, { delay = 0 } = {}) {
  if (!svg || lite()) return;
  if (delay) { setTimeout(() => react(svg, kind), delay); return; }
  if (kind === 'returned') {
    replay(svg, 'av--tilt', DURATION.tilt);
    addFx(svg,
      `<g class="av-fx av-q"><path d="M86 4 h22 a8 8 0 0 1 8 8 v10 a8 8 0 0 1 -8 8 h-12 l-7 6 v-6 h-3 a8 8 0 0 1 -8 -8 v-10 a8 8 0 0 1 8 -8 z" fill="${PAPER}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` +
      `<path d="M92.5 13 q0 -5 4.5 -5 q4.5 0 4.5 4.4 q0 2.6 -3 3.9 q-1.5 .7 -1.5 2.7" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      `<circle cx="97" cy="24.2" r="1.9" fill="${INK}"/></g>`, 1900);
    return;
  }
  if (kind === 'levelup' || kind === 'sparkle') {
    if (kind === 'levelup') replay(svg, 'av--levelup', DURATION.levelup);
    const star = (x, y, r, d) =>
      `<path class="av-fx av-spark" style="--d:${d}s" d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${INK}"/>`;
    addFx(svg, star(18, 30, 7, 0.15) + star(104, 22, 9, 0.3) + star(108, 70, 6, 0.45) + star(12, 78, 8, 0.55), 1900);
    return;
  }
  if (DURATION[kind]) replay(svg, 'av--' + kind, DURATION[kind]);
}

// 검사 대기: 캐릭터 옆 모래시계
export function setWaiting(svg, on) {
  if (!svg) return;
  const cur = svg.querySelector('.av-hourglass');
  if (!on) { cur?.parentNode.remove(); return; }
  // 가벼운 화면에서도 모래시계는 보이고(상태 표시), 돌지만 않는다 (CSS)
  if (cur) return;
  addFx(svg,
    `<g class="av-fx av-hourglass">` +
    `<path d="M99 6 H111 C111 13 106.5 15 106.5 18 C106.5 21 111 23 111 30 H99 C99 23 103.5 21 103.5 18 C103.5 15 99 13 99 6 Z" fill="${PAPER}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<path d="M101.5 10 H108.5 Q105 15.5 101.5 10 Z M101 28.5 Q105 23 109 28.5 Z" fill="${INK}"/>` +
    `<path d="M96.5 6 H113.5 M96.5 30 H113.5" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/></g>`);
}

export function setDance(svg, on) {
  svg?.classList.toggle('av--dance', !!on);
}

/* ---------- 마우스를 올리거나 누르면: 손 흔들기 또는 고개 갸웃 ---------- */
export function bindReactions(scope = document) {
  const fire = (e) => {
    const svg = e.target.closest?.('svg.av');
    if (!svg || svg.closest('[data-still]')) return; // data-still 안쪽 캐릭터는 반응하지 않음
    const now = performance.now();
    if (now - (svg._last || 0) < 1500) return;
    svg._last = now;
    react(svg, Math.random() < 0.5 ? 'wave' : 'tilt');
  };
  scope.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') fire(e); });
  scope.addEventListener('pointerdown', fire);
}
