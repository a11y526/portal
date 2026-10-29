// 캐릭터 부품 정의 (모두 이 프로젝트에서 새로 그린 도형)
// 좌표는 120×120 칸 기준. 얼굴 중심 x=60, 눈 높이 y=55, 입 y=67, 어깨 y≈88.
// k(그리기 도구): k.L / k.M / k.D = 망점 밝음·중간·어두움, k.ink = 검정, k.paper = 흰색,
//                 k.sw = 선 굵기, k.detail = 큰 크기에서만 그리는 잔선 여부,
//                 k.accent / k.gold = 강조색·금색, k.sky·k.goldL·k.mint(L)·k.violet(L)·k.coral(L) = 하늘·연금·민트·보라·주황
//                 (색은 희귀·전설 부품에만)
// 움직임: class="fx-spin" 등은 내 캐릭터·1~3위(.av-live)에서만 돈다(design.css). px 중심을 쓸 땐 style에 transform-box:view-box
// 가격·등급·판매 여부는 Supabase avatar_items 표에서 관리한다.

export const SLOTS = ['face', 'hair', 'hat', 'eyes', 'mouth', 'outfit', 'acc', 'pet', 'aura', 'bg'];

export const SLOT_NAMES = {
  face: '얼굴', hair: '머리', hat: '모자', eyes: '눈', mouth: '입', outfit: '옷', acc: '소품',
  pet: '펫', aura: '오라', bg: '배경',
};

// 네 꼭짓점 반짝이 (x, y 중심, r 반지름, cls = 움직임 클래스, delay = 시작 늦춤 초)
const spark = (x, y, r, fill, cls = '', delay = 0) =>
  `<path ${cls ? `class="${cls}" style="--d:${delay}s" ` : ''}d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${fill}"/>`;

const line = (k, d, w = 1) =>
  `<path d="${d}" fill="none" stroke="${k.ink}" stroke-width="${(k.sw * w).toFixed(2)}"/>`;
const shape = (k, d, fill, w = 1) =>
  `<path d="${d}" fill="${fill}" stroke="${k.ink}" stroke-width="${(k.sw * w).toFixed(2)}"/>`;

// 원 여러 개를 하나의 덩어리처럼: 굵은 선을 먼저 깔고 그 위에 같은 원을 채우면 바깥 윤곽만 남는다
const blob = (k, circles, fill) =>
  `<g fill="${k.ink}" stroke="${k.ink}" stroke-width="${(k.sw * 2).toFixed(2)}">` +
  circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('') +
  `</g><g fill="${fill}">` +
  circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('') +
  `</g>`;

// <g>에 transform을 줄 때: design.css의 .av g { transform-box: fill-box } 를 되돌려 회전 중심이 어긋나지 않게
const FLAT = 'transform-box:view-box;transform-origin:0 0';

// 동물 모자: 머리를 덮는 둥근 모자 + 이마 띠. behind = 모자 뒤(귀), front = 모자 위(눈·볏)
const HAT = 'M33 45 C32 25 44 14.5 60 14.5 C76 14.5 88 25 87 45 Z';
const animalHat = (k, fill, behind = '', front = '') =>
  behind + shape(k, HAT, fill) +
  shape(k, 'M31 43 C45 38.5 75 38.5 89 43 L89.5 48 C75 43.5 45 43.5 30.5 48 Z', k.paper, 0.9) + front;
const ink = (k, w) => `stroke="${k.ink}" stroke-width="${(k.sw * w).toFixed(2)}"`;
const sw = (k, w = 1) => ink(k, w);

// 다섯 꼭짓점 별 (R 바깥, r 안쪽 반지름)
const star5 = (x, y, R, r) => 'M' + Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r : R;
  return `${(x + d * Math.cos(a)).toFixed(2)} ${(y + d * Math.sin(a)).toFixed(2)}`;
}).join(' L') + ' Z';

// 정육각형 (분자 구조 배경)
const hex = (x, y, r) => 'M' + Array.from({ length: 6 }, (_, i) => {
  const a = Math.PI / 6 + (i * Math.PI) / 3;
  return `${(x + r * Math.cos(a)).toFixed(2)} ${(y + r * Math.sin(a)).toFixed(2)}`;
}).join(' L') + ' Z';

// 배경 원 (모든 배경의 바탕)
const BG_BASE = (k) => `<circle cx="60" cy="60" r="58" fill="${k.L}" opacity=".5"/>`;

// 티셔츠 몸통 윤곽 (여러 옷이 같이 씀)
const TEE = 'M18 124 C18 102 30 91.5 47 88 C51 94.5 69 94.5 73 88 C90 91.5 102 102 102 124 Z';

export const PARTS = {
  /* ---------- 얼굴형: d = 윤곽, ears = 귀 위치 ---------- */
  face: {
    face_round: {
      name: '둥근',
      d: 'M60 29.5 C74 29.5 85 40.5 85 54 C85 67.5 74 78.5 60 78.5 C46 78.5 35 67.5 35 54 C35 40.5 46 29.5 60 29.5 Z',
      ears: [[35.5, 57], [84.5, 57]],
    },
    face_slim: {
      name: '갸름한',
      d: 'M60 29 C75 29 84 39 84 51 C84 65 72 80.5 60 80.5 C48 80.5 36 65 36 51 C36 39 45 29 60 29 Z',
      ears: [[36.5, 56], [83.5, 56]],
    },
    face_square: {
      name: '네모',
      d: 'M50 29.5 H70 C80 29.5 85 35 85 45 V63 C85 72 79 78 70 78 H50 C41 78 35 72 35 63 V45 C35 35 40 29.5 50 29.5 Z',
      ears: [[35.5, 57], [84.5, 57]],
    },
  },

  /* ---------- 머리: back = 얼굴 뒤, front = 얼굴 위, ears:false = 귀를 덮음 ---------- */
  hair: {
    hair_short: {
      name: '짧은',
      front: (k) =>
        shape(k, 'M34.5 57 C31 37 42 21.5 60 21.5 C78 21.5 89 37 85.5 57 C84 50 82.5 45.5 79 42.5 C75 44 70 44 66.5 41 C63 43.5 57 44 53 40.5 C49 43.5 43 44 39.5 42.5 C37 46 35.5 51 34.5 57 Z', k.D) +
        (k.detail ? line(k, 'M61 25 C57 29 54.5 33 53.5 37.5 M72 27.5 C70 31.5 68.5 35 67 38.5', 0.6) : ''),
    },
    hair_curly: {
      name: '곱슬',
      ears: false,
      front: (k) => blob(k, [
        [36, 49, 6.5], [36, 39.5, 7.5], [42, 30, 8.5], [52, 24, 9], [64, 23, 9], [75, 27, 8.5],
        [82, 36.5, 8], [84.5, 47, 7], [84.5, 56, 5.5], [35.5, 57, 5.5],
        [45, 37.5, 7], [54.5, 35.5, 7.5], [64.5, 35.5, 7.5], [73.5, 38.5, 7], [39.5, 45, 5], [80, 45, 5],
      ], k.D),
    },
    hair_bob: {
      name: '단발',
      ears: false,
      back: (k) =>
        shape(k, 'M31 58 C29 33 42 20 60 20 C78 20 91 33 89 58 L89.5 77 C89.5 81.5 86 83 82 81.5 C73 79 47 79 38 81.5 C34 83 30.5 81.5 30.5 77 Z', k.D),
      front: (k) =>
        shape(k, 'M35 53 C33.5 34 44 24.5 60 24.5 C76 24.5 86.5 34 85 53 C83.5 48 82 45.5 80 44 C70 46 50 46 40 44 C38 45.5 36.5 48 35 53 Z', k.D) +
        (k.detail ? line(k, 'M50 27.5 C48 32 47 38 47 44.5 M70 27.5 C72 32 73 38 73 44.5', 0.6) : ''),
    },
    hair_tied: {
      name: '묶음',
      back: (k) =>
        shape(k, 'M71 28 C85 17 101 27 99.5 45 C98.5 57 93.5 67.5 86 74 C89 64 90 54 86.5 46.5 C83.5 40 78 35 72 33 Z', k.D),
      front: (k) =>
        shape(k, 'M34.5 56 C31.5 36 43 22 60 22 C77 22 88.5 36 85.5 56 C84.5 49 82 43.5 77 39.5 C70.5 34.5 59 34 52 38.5 C47.5 35 41 37.5 38 42 C36 46 35 51 34.5 56 Z', k.D) +
        `<rect x="73" y="25.5" width="8" height="6" rx="2.5" transform="rotate(38 77 28.5)" fill="${k.paper}" stroke="${k.ink}" stroke-width="${k.sw.toFixed(2)}"/>`,
    },
    /* 상점 */
    hair_spiky: {
      name: '삐죽 머리',
      front: (k) =>
        shape(k, 'M34.5 56 C33 45 34 38 37 33 L30.5 27.5 L41.5 26.5 L39.5 16.5 L50 22 L54 11 L60.5 20 L68 11 L70.5 22 L80.5 16.5 L78.5 26.5 L89.5 27.5 L83 33 C86 38 87 45 85.5 56 C84 49 82.5 45 79 42 C74 44 69 43.5 66 40 C62 43 56 43 53 40 C49 43.5 43 44 40 42 C37.5 45.5 35.5 50 34.5 56 Z', k.D) +
        (k.detail ? line(k, 'M58 24 C56 29 55 33 54.5 37 M69 25.5 C68 30 67.5 34 66.5 37.5', 0.6) : ''),
    },
    hair_long: {
      name: '긴 생머리',
      ears: false,
      back: (k) =>
        shape(k, 'M31 58 C29 33 42 20 60 20 C78 20 91 33 89 58 L92.5 100 C93 104.5 88.5 106.5 84.5 104.5 L80.5 75 C72 70 48 70 39.5 75 L35.5 104.5 C31.5 106.5 27 104.5 27.5 100 Z', k.D) +
        (k.detail ? line(k, 'M33 66 L31.5 98 M87 66 L88.5 98', 0.6) : ''),
      front: (k) =>
        shape(k, 'M35 54 C33.5 34 44 24.5 60 24.5 C76 24.5 86.5 34 85 54 C83 47 80 42 75 39 C69 37 63.5 33.5 60 29 C56.5 33.5 51 37 45 39 C40 42 37 47 35 54 Z', k.D),
    },
    hair_einstein: {
      name: '아인슈타인 머리',
      ears: false,
      front: (k) => blob(k, [
        [30.5, 52, 7], [28, 42, 8], [32.5, 32, 8], [41.5, 23.5, 8], [52, 18.5, 7.5], [63, 17.5, 8],
        [74, 21, 8], [84, 28.5, 8], [90.5, 39.5, 8], [91.5, 50.5, 7], [88.5, 59.5, 5], [31.5, 60, 5],
        [44, 31, 5], [56, 27.5, 5], [67, 28, 5], [77, 32, 5],
      ], k.L) +
        (k.detail ? line(k, 'M24 36 L19 33 M23 47 L18 47 M96 34 L101 31 M97 46 L102 46 M49 11 L47 6 M66 10 L68 5', 0.7) : ''),
    },
    hair_buzz: {
      name: '까까머리',
      front: (k) =>
        shape(k, 'M35 52 C34 37 45 27 60 27 C75 27 86 37 85 52 C82 44 75 38.5 60 38.5 C45 38.5 38 44 35 52 Z', k.M),
    },
    hair_side: {
      name: '옆가르마',
      front: (k) =>
        shape(k, 'M34.5 57 C31 37 42 21.5 60 21.5 C78 21.5 89 37 85.5 57 C84 49 82 43 77 39.5 C68 41 52 39 45 35 C40 41 37 48 34.5 57 Z', k.D) +
        (k.detail ? line(k, 'M45 35 C47 29 50 25.5 54 23.5 M58 37.5 C63 33 70 30.5 78 31', 0.6) : ''),
    },
    hair_bun: {
      name: '똥머리',
      back: (k) =>
        `<circle cx="60" cy="17" r="10.5" fill="${k.D}" stroke="${k.ink}" stroke-width="${k.sw.toFixed(2)}"/>` +
        (k.detail ? line(k, 'M53 14 Q60 9 67 14 M54.5 20 Q60 15.5 65.5 20', 0.5) : ''),
      front: (k) =>
        shape(k, 'M35 53 C33.5 33 44 24 60 24 C76 24 86.5 33 85 53 C82 44 75 39 60 39 C45 39 38 44 35 53 Z', k.D) +
        `<rect x="54" y="23" width="12" height="4.5" rx="2.2" fill="${k.paper}" stroke="${k.ink}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>` +
        (k.detail ? line(k, 'M50 29.5 C47.5 32 46.5 35.5 46.5 39 M60 28 V38.5 M70 29.5 C72.5 32 73.5 35.5 73.5 39', 0.5) : ''),
    },
    hair_twin: {
      name: '양갈래',
      back: (k) =>
        shape(k, 'M37 38 C22 36 17 52 21 68 C23 76 30 79 32 72 C28 62 30 50 38 45 Z', k.D) +
        shape(k, 'M83 38 C98 36 103 52 99 68 C97 76 90 79 88 72 C92 62 90 50 82 45 Z', k.D),
      front: (k) =>
        shape(k, 'M34.5 54 C32 35 43 22.5 60 22.5 C77 22.5 88 35 85.5 54 C83.5 47 81 43 77 41 C72 43.5 66 43 62 40 C58 43 51 43.5 47 41 C42 42.5 38 47 34.5 54 Z', k.D) +
        [36, 84].map((x) =>
          `<circle cx="${x}" cy="41" r="3.4" fill="${k.paper}" stroke="${k.ink}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>`).join(''),
    },
    /* 2026-10-29 추가 */
    hair_flame: {
      name: '플라즈마 불꽃 머리',
      front: (k) =>
        `<g class="fx-flame">` +
        shape(k, 'M34 55 C30 41 33 29 39 23 L35 13 L46 18 L51 6 L59 15 L65 4 L71 16 L82 10 L79 22 C86 28 89 40 86 55 C83 46 79 41 74 39 C68 42 63 41 60 37 C56 41 50 42 45 39 C40 41 37 46 34 55 Z', k.D) +
        shape(k, 'M43 32 L42 20 L51 25 L56 13 L62 22 L67 12 L72 24 L78 19 L76 32 C70 35 50 35 43 32 Z', k.coralL, 0.75) +
        (k.detail ? `<path d="M50 30 L55 18 L60 26 L65 17 L69 30 Z" fill="${k.gold}"/>` : '') +
        `</g>` +
        spark(33, 18, k.detail ? 3.5 : 4.5, k.gold, 'fx-twinkle', 0.1) +
        spark(86, 16, k.detail ? 3.5 : 4.5, k.coralL, 'fx-twinkle', 0.5),
    },

    hair_zero_g: {
      name: '무중력 우주 머리',
      ears: false,
      back: (k) =>
        `<g class="fx-float">` +
        shape(k, 'M30 56 C22 42 20 24 29 14 C34 22 37 28 38 34 C42 18 52 12 60 12 C68 12 78 18 82 34 C83 28 86 22 91 14 C100 24 98 42 90 56 L95 76 C88 78 83 72 81 64 L39 64 C37 72 32 78 25 76 Z', k.D) +
        `</g>`,
      front: (k) =>
        shape(k, 'M34.5 54 C33 34 44 23 60 23 C76 23 87 34 85.5 54 C83 46 79 41 74 39 C68 42 52 42 46 39 C41 41 37 46 34.5 54 Z', k.D) +
        `<circle class="fx-twinkle" style="--d:.1s" cx="27" cy="24" r="2.2" fill="${k.sky}" ${sw(k, 0.5)}/>` +
        `<circle class="fx-twinkle" style="--d:.6s" cx="93" cy="24" r="2.2" fill="${k.sky}" ${sw(k, 0.5)}/>` +
        spark(60, 16, k.detail ? 4 : 5, k.accent, 'fx-twinkle', 0.3),
    },

    hair_neon: {
      name: '사이버 네온 브릿지',
      front: (k) =>
        shape(k, 'M34 56 C31 36 42 21 60 21 C78 21 89 36 86 56 C84 48 81 42 76 39 L71 45 L67 38 L56 46 L53 38 C45 40 38 46 34 56 Z', k.D) +
        `<g class="fx-twinkle">` +
        shape(k, 'M46 27 L55 25 L51 35 L58 34 L48 45 L50 36 L44 37 Z', k.mintL, 0.7) +
        shape(k, 'M66 25 L74 28 L69 36 L75 37 L65 45 L67 37 L63 36 Z', k.sky, 0.7) +
        `</g>`,
    },

    hair_cloud: {
      name: '구름 솜사탕 머리',
      ears: false,
      front: (k) =>
        blob(k, [
          [35, 50, 7], [34, 39, 8.5], [41, 29, 9.5], [52, 23, 10], [65, 23, 10],
          [77, 28, 9.5], [85, 38, 8.5], [85, 50, 7], [46, 36, 7.5], [58, 34, 8], [71, 36, 7.5]
        ], k.L) +
        `<g class="fx-float" style="--d:0s"><circle cx="28" cy="27" r="3.4" fill="${k.violetL}" ${sw(k, 0.7)}/></g>` +
        `<g class="fx-float" style="--d:.5s"><circle cx="91" cy="26" r="3.4" fill="${k.goldL}" ${sw(k, 0.7)}/></g>` +
        `<g class="fx-float" style="--d:1s"><circle cx="60" cy="12" r="3" fill="${k.sky}" ${sw(k, 0.7)}/></g>`,
    },

    hair_volt: {
      name: '번개 삐죽 머리',
      front: (k) =>
        shape(k, 'M34 55 C32 43 34 35 38 30 L28 24 L41 23 L38 12 L51 19 L57 7 L63 18 L73 8 L73 20 L86 14 L81 25 L92 27 L82 33 C86 39 87 46 86 55 C83 47 79 42 74 40 L68 44 L63 39 L55 44 L50 39 C43 41 37 46 34 55 Z', k.M) +
        shape(k, 'M45 27 L55 15 L54 24 L64 14 L62 24 L74 17 L68 29 Z', k.gold, 0.7) +
        `<g class="fx-twinkle" style="--d:.1s">` + shape(k, 'M23 36 L30 32 L28 38 L34 36 L25 43 L27 37 Z', k.gold, 0.65) + `</g>` +
        `<g class="fx-twinkle" style="--d:.6s">` + shape(k, 'M96 35 L89 31 L91 37 L85 35 L94 42 L92 36 Z', k.gold, 0.65) + `</g>`,
    },
  },

  /* ---------- 눈 (왼눈 x=50, 오른눈 x=70) ---------- */
  eyes: {
    eyes_round: {
      name: '동그란',
      draw: (k) => [50, 70].map((x) =>
        `<ellipse cx="${x}" cy="55" rx="4.8" ry="5.8" fill="${k.ink}"/>` +
        (k.detail
          ? `<circle cx="${x - 1.6}" cy="52.9" r="1.7" fill="${k.paper}"/><circle cx="${x + 1.7}" cy="57.3" r=".8" fill="${k.paper}"/>`
          : '')).join(''),
    },
    eyes_smile: {
      name: '웃는',
      draw: (k) => line(k, 'M45 57 Q50 50.5 55 57 M65 57 Q70 50.5 75 57', 1.15),
    },
    eyes_sleepy: {
      name: '졸린',
      draw: (k) => [50, 70].map((x) =>
        `<path d="M${x - 5} 54.5 H${x + 5} A5 4.6 0 0 1 ${x - 5} 54.5 Z" fill="${k.ink}"/>` +
        line(k, `M${x - 6} 54.5 H${x + 6}`, 1) +
        (k.detail ? `<circle cx="${x + 1.8}" cy="56.6" r=".9" fill="${k.paper}"/>` : '')).join(''),
    },
    /* 상점 */
    eyes_sparkle: {
      name: '반짝 눈',
      draw: (k) => [50, 70].map((x) =>
        `<ellipse cx="${x}" cy="55" rx="6" ry="7" fill="${k.ink}"/>` +
        spark(x - 1.4, 53, k.detail ? 3.6 : 3, k.paper) +
        (k.detail ? `<circle cx="${x + 2.4}" cy="58.2" r="1.1" fill="${k.paper}"/>` : '')).join('') +
        spark(97, 42, k.detail ? 6 : 7.5, k.accent) + (k.detail ? spark(104, 53, 3.2, k.accent) : ''),
    },
    eyes_dot: {
      name: '점 눈',
      draw: (k) => [50, 70].map((x) => `<circle cx="${x}" cy="55" r="${k.detail ? 2.8 : 3.4}" fill="${k.ink}"/>`).join(''),
    },
    eyes_wink: {
      name: '윙크',
      draw: (k) =>
        `<ellipse cx="50" cy="55" rx="4.8" ry="5.8" fill="${k.ink}"/>` +
        (k.detail ? `<circle cx="48.4" cy="52.9" r="1.7" fill="${k.paper}"/>` : '') +
        line(k, 'M64.5 56.5 Q70 50.5 75.5 56.5', 1.15),
    },
    eyes_heart: {
      name: '하트 눈',
      draw: (k) => [50, 70].map((x) =>
        `<path d="M${x} 61 C${x - 8.5} 55.5 ${x - 6.5} 47 ${x} 51.5 C${x + 6.5} 47 ${x + 8.5} 55.5 ${x} 61 Z" fill="${k.ink}"/>` +
        (k.detail ? `<circle cx="${x - 2.8}" cy="53.4" r="1.3" fill="${k.paper}"/>` : '')).join(''),
    },
    eyes_star: {
      name: '별 눈',
      draw: (k) => [50, 70].map((x) =>
        `<path d="${star5(x, 55.5, 7, 3.2)}" fill="${k.accent}" stroke="${k.ink}" stroke-width="${(k.sw * 0.7).toFixed(2)}"/>` +
        (k.detail ? `<circle cx="${x - 1.4}" cy="54" r="1.1" fill="${k.paper}"/>` : '')).join(''),
    },
    /* 2026-10-29 추가 */
    eyes_cyber: {
      name: '사이보그 스캐너 눈',
      draw: (k) => [50, 70].map((x) =>
        `<ellipse cx="${x}" cy="55" rx="5.8" ry="6.6" fill="${k.ink}"/>` +
        `<g class="fx-spin" style="transform-box:view-box;transform-origin:${x}px 55px">` +
        `<circle cx="${x}" cy="55" r="3.6" fill="none" stroke="${k.sky}" stroke-width="${(k.sw * 0.75).toFixed(2)}" stroke-dasharray="3.5 2"/>` +
        `</g>` +
        `<circle cx="${x}" cy="55" r="1.4" fill="${k.paper}"/>`
      ).join(''),
    },

    eyes_fire: {
      name: '타오르는 열정 눈',
      draw: (k) => [50, 70].map((x, i) =>
        `<ellipse cx="${x}" cy="55" rx="5.6" ry="6.5" fill="${k.ink}"/>` +
        `<g class="fx-flame" style="--d:${i * 0.25}s">` +
        `<path d="M${x} 49.5 C${x + 3.5} 52 ${x + 3.5} 58 ${x} 59.5 C${x - 3.5} 58 ${x - 3.5} 52 ${x} 49.5 Z" fill="${k.coralL}"/>` +
        `<path d="M${x} 52 C${x + 2} 54 ${x + 2} 57.5 ${x} 58.8 C${x - 2} 57.5 ${x - 2} 54 ${x} 52 Z" fill="${k.gold}"/>` +
        `</g>`
      ).join(''),
    },

    eyes_galaxy: {
      name: '은하수 오드아이',
      draw: (k) =>
        [[50, k.sky, 'fx-spin'], [70, k.goldL, 'fx-spin-rev']].map(([x, col, cls]) =>
          `<ellipse cx="${x}" cy="55" rx="6" ry="7" fill="${k.ink}"/>` +
          `<g class="${cls}" style="transform-box:view-box;transform-origin:${x}px 55px">` +
          `<path d="${star5(x, 55, 5, 2.2)}" fill="${col}"/>` +
          `</g>` +
          (k.detail ? `<circle cx="${x + 2.2}" cy="58" r="1.1" fill="${k.paper}"/>` : '')
        ).join('') +
        spark(39, 49, k.detail ? 3.2 : 4, k.sky, 'fx-twinkle', 0.1) +
        spark(81, 49, k.detail ? 3.2 : 4, k.gold, 'fx-twinkle', 0.5),
    },

    eyes_pulse: {
      name: '네온 하트비트 눈',
      draw: (k) => [50, 70].map((x, i) =>
        `<ellipse cx="${x}" cy="55" rx="5.8" ry="6.6" fill="${k.ink}"/>` +
        `<g class="fx-pulse" style="transform-box:view-box;transform-origin:${x}px 55px;--d:${i * 0.2}s">` +
        `<path d="M${x} 59.5 C${x - 6} 55.5 ${x - 4.5} 49.5 ${x} 52.8 C${x + 4.5} 49.5 ${x + 6} 55.5 ${x} 59.5 Z" fill="${i === 0 ? k.coralL : k.violetL}"/>` +
        `</g>`
      ).join(''),
    },

    eyes_swirl: {
      name: '빙글빙글 최면 눈',
      draw: (k) => [50, 70].map((x) =>
        `<circle cx="${x}" cy="55" r="6" fill="${k.paper}" ${sw(k, 0.9)}/>` +
        `<g class="fx-spin" style="transform-box:view-box;transform-origin:${x}px 55px">` +
        `<path d="M${x} 55 m0 -4.2 a4.2 4.2 0 1 1 -3.8 2.4 a2.6 2.6 0 1 0 3.8 -0.6" fill="none" stroke="${k.accent}" stroke-width="${(k.sw * 0.85).toFixed(2)}"/>` +
        `</g>`
      ).join(''),
    },
  },

  /* ---------- 입 (중심 x=60, y≈67) ---------- */
  mouth: {
    mouth_smile: {
      name: '미소',
      draw: (k) => line(k, 'M54.5 66 Q60 71.5 65.5 66', 1),
    },
    mouth_grin: {
      name: '활짝',
      draw: (k) =>
        `<path d="M53 64.5 H67 C67 70.5 64 74 60 74 C56 74 53 70.5 53 64.5 Z" fill="${k.ink}" stroke="${k.ink}" stroke-width="${(k.sw * 0.6).toFixed(2)}"/>` +
        `<path d="M56 71.2 C58.5 69.4 61.5 69.4 64 71.2 C63 73.2 61.6 74 60 74 C58.4 74 57 73.2 56 71.2 Z" fill="${k.L}"/>`,
    },
    mouth_flat: {
      name: '일자',
      draw: (k) => line(k, 'M55 67.5 H65', 1),
    },
    /* 상점 */
    mouth_tongue: {
      name: '혀 내밀기',
      draw: (k) =>
        shape(k, 'M56.5 67.2 V70.5 C56.5 73.5 58 75.2 60 75.2 C62 75.2 63.5 73.5 63.5 70.5 V67.2 Z', k.M, 0.8) +
        (k.detail ? line(k, 'M60 68.5 V72', 0.5) : '') +
        line(k, 'M53.5 65.5 Q60 70.5 66.5 65.5', 1),
    },
    mouth_o: {
      name: '오',
      draw: (k) =>
        `<ellipse cx="60" cy="68" rx="3.2" ry="4" fill="${k.ink}"/>` +
        (k.detail ? `<ellipse cx="60" cy="69.7" rx="1.8" ry="1.5" fill="${k.L}"/>` : ''),
    },
    mouth_cat: {
      name: '고양이 입',
      draw: (k) => line(k, 'M53 65.8 Q56.5 70.2 60 66.4 Q63.5 70.2 67 65.8', 1),
    },
    mouth_smirk: {
      name: '씩 웃기',
      draw: (k) => line(k, 'M54 68.2 Q60.5 70 66 64.6', 1) + (k.detail ? line(k, 'M66.4 63.2 Q68 64.6 66.8 66.4', 0.5) : ''),
    },
    mouth_teeth: {
      name: '앞니',
      draw: (k) =>
        `<rect x="57.2" y="67.2" width="5.6" height="4" rx=".9" fill="${k.paper}" stroke="${k.ink}" stroke-width="${(k.sw * 0.6).toFixed(2)}"/>` +
        line(k, 'M60 67.6 V71', 0.45) +
        line(k, 'M53.5 65.5 Q60 70.2 66.5 65.5', 1),
    },
    /* 2026-10-29 추가 */
    mouth_bubble: {
      name: '풍선껌',
      draw: (k) =>
        line(k, 'M55 67 Q60 70 64 67', 0.9) +
        `<g class="fx-pulse" style="transform-box:view-box;transform-origin:66px 68px">` +
        `<circle cx="67.5" cy="68.5" r="6.5" fill="${k.violetL}" fill-opacity=".75" ${sw(k, 0.85)}/>` +
        (k.detail ? `<circle cx="65.2" cy="66.2" r="1.6" fill="${k.paper}"/>` : '') +
        `</g>`,
    },

    mouth_meat: {
      name: '만화 고기 먹방',
      draw: (k) =>
        line(k, 'M54 66.5 Q60 71 66 66.5', 1) +
        `<g class="fx-wobble" style="transform-box:view-box;transform-origin:64px 68px">` +
        `<path d="M72 68.5 H78.5" stroke="${k.paper}" stroke-width="${(k.sw * 2.2).toFixed(2)}"/>` +
        `<path d="M72 68.5 H78.5" stroke="${k.ink}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>` +
        `<circle cx="79.5" cy="67" r="2" fill="${k.paper}" ${sw(k, 0.65)}/>` +
        `<circle cx="79.5" cy="70" r="2" fill="${k.paper}" ${sw(k, 0.65)}/>` +
        `<ellipse cx="68.5" cy="68.5" rx="6" ry="4.2" fill="${k.M}" ${sw(k, 0.85)}/>` +
        `</g>`,
    },

    mouth_beam: {
      name: '무지개 빔 발사',
      draw: (k) =>
        `<ellipse cx="60" cy="68.5" rx="4.2" ry="5" fill="${k.ink}"/>` +
        `<circle cx="60" cy="68.5" r="2.4" fill="${k.sky}"/>` +
        `<g class="fx-wave" style="transform-box:view-box;transform-origin:60px 68.5px">` +
        `<ellipse cx="60" cy="72" rx="7.5" ry="3.2" fill="none" stroke="${k.accent}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>` +
        `<ellipse cx="60" cy="75.5" rx="10.5" ry="4" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 0.75).toFixed(2)}"/>` +
        `</g>` +
        spark(50, 72, k.detail ? 3 : 3.8, k.mintL, 'fx-twinkle', 0.2) +
        spark(70, 72, k.detail ? 3 : 3.8, k.gold, 'fx-twinkle', 0.6),
    },

    mouth_fang: {
      name: '뱀파이어 송곳니',
      draw: (k) =>
        line(k, 'M52.5 66 Q60 70.5 67.5 66', 1) +
        shape(k, 'M54.2 66.8 L56 71.8 L57.8 67.3 Z M62.2 67.3 L64 71.8 L65.8 66.8 Z', k.paper, 0.7) +
        spark(66.5, 72.5, k.detail ? 3.2 : 4, k.gold, 'fx-twinkle', 0.2),
    },

    mouth_whistle: {
      name: '휘파람 음표',
      draw: (k) =>
        `<circle cx="61" cy="68" r="2.6" fill="${k.ink}"/>` +
        `<g class="fx-float" style="--d:0s">` +
        `<circle cx="71" cy="66" r="2.1" fill="${k.accent}" ${sw(k, 0.5)}/>` +
        `<path d="M72.8 66 V59.5 L76 61" fill="none" stroke="${k.accent}" stroke-width="${(k.sw * 0.85).toFixed(2)}"/>` +
        `</g>` +
        (k.detail ? `<g class="fx-float" style="--d:.6s"><circle cx="78" cy="62" r="1.8" fill="${k.gold}" ${sw(k, 0.45)}/><path d="M79.5 62 V56.5" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 0.75).toFixed(2)}"/></g>` : ''),
    },
  },

  /* ---------- 옷: behind = 목 뒤(후드), draw = 몸통, sleeve = 손 흔들 때 소매 채우기 ---------- */
  outfit: {
    outfit_tee: {
      name: '티셔츠',
      sleeve: 'M',
      draw: (k) =>
        shape(k, 'M18 124 C18 102 30 91.5 47 88 C51 94.5 69 94.5 73 88 C90 91.5 102 102 102 124 Z', k.M) +
        shape(k, 'M47 88 C51 94.5 69 94.5 73 88 L70.8 87.4 C67.5 91.6 52.5 91.6 49.2 87.4 Z', k.paper, 0.7) +
        (k.detail ? line(k, 'M33 101 C34 106 34.5 112 34 120 M87 101 C86 106 85.5 112 86 120', 0.6) : ''),
    },
    outfit_hood: {
      name: '후드',
      sleeve: 'D',
      behind: (k) =>
        shape(k, 'M38.5 92 C35 80 45.5 74.5 60 74.5 C74.5 74.5 85 80 81.5 92 C76 88.5 70 87 60 87 C50 87 44 88.5 38.5 92 Z', k.M),
      draw: (k) =>
        shape(k, 'M17 124 C17 102 29 92 45 88.5 C50 95 70 95 75 88.5 C91 92 103 102 103 124 Z', k.D) +
        shape(k, 'M45 88.5 C50 95 70 95 75 88.5 L72.5 87.6 C68.5 92.5 51.5 92.5 47.5 87.6 Z', k.M, 0.7) +
        `<path d="M54 94 L53 107 M66 94 L67 107" stroke="${k.ink}" stroke-width="${(k.sw * 2.4).toFixed(2)}" fill="none"/>` +
        `<path d="M54 94 L53 107 M66 94 L67 107" stroke="${k.paper}" stroke-width="${(k.sw * 1.1).toFixed(2)}" fill="none"/>`,
    },
    /* 상점 */
    outfit_labcoat: {
      name: '실험복',
      sleeve: 'L',
      draw: (k) =>
        shape(k, 'M18 124 C18 102 30 91.5 47 88 L60 113 L73 88 C90 91.5 102 102 102 124 Z', k.L) +
        shape(k, 'M47 88 C51 94.5 69 94.5 73 88 L60 113 Z', k.M, 0.7) +
        line(k, 'M47 88 L50.5 101 L56 104.5 M73 88 L69.5 101 L64 104.5 M60 113 V124', 0.8) +
        (k.detail
          ? line(k, 'M77 106 H88 V113 H77 Z', 0.6) + `<path d="M80 101.5 V108" stroke="${k.ink}" stroke-width="${(k.sw * 1.4).toFixed(2)}"/>`
          : ''),
    },
    outfit_space: {
      name: '우주복',
      sleeve: 'L',
      draw: (k) =>
        shape(k, 'M16 124 C16 101 29 91 45 87.5 H75 C91 91 104 101 104 124 Z', k.L) +
        shape(k, 'M41.5 90.5 C41.5 84 78.5 84 78.5 90.5 C78.5 96.5 41.5 96.5 41.5 90.5 Z', k.M) +
        `<rect x="50" y="101" width="20" height="13" rx="3" fill="${k.paper}" stroke="${k.ink}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>` +
        `<circle cx="55.5" cy="107.5" r="2.4" fill="${k.accent}"/>` +
        `<rect x="60" y="105.8" width="6.5" height="3.4" rx="1.2" fill="${k.ink}"/>` +
        (k.detail ? line(k, 'M30 104 C31.5 110 31.5 116 30.5 122 M90 104 C88.5 110 88.5 116 89.5 122', 0.6) : ''),
    },
    outfit_stripe: {
      name: '줄무늬 티',
      sleeve: 'L',
      draw: (k) =>
        `<clipPath id="${k.id}-os"><path d="${TEE}"/></clipPath>` +
        `<path d="${TEE}" fill="${k.L}"/>` +
        `<g clip-path="url(#${k.id}-os)" fill="${k.D}">` +
        [97, 106, 115].map((y) => `<rect x="10" y="${y}" width="100" height="4.5"/>`).join('') + `</g>` +
        `<path d="${TEE}" fill="none" stroke="${k.ink}" stroke-width="${k.sw.toFixed(2)}"/>` +
        shape(k, 'M47 88 C51 94.5 69 94.5 73 88 L70.8 87.4 C67.5 91.6 52.5 91.6 49.2 87.4 Z', k.paper, 0.7),
    },
    outfit_jersey: {
      name: '체육복',
      sleeve: 'D',
      draw: (k) =>
        shape(k, 'M17 124 C17 102 29 92 45 88.5 C50 95 70 95 75 88.5 C91 92 103 102 103 124 Z', k.D) +
        shape(k, 'M45 88.5 C50 95 70 95 75 88.5 L73 84.5 C68 90.5 52 90.5 47 84.5 Z', k.L, 0.8) +
        `<path d="M60 93 V124 M29 101 L23.5 124 M91 101 L96.5 124" stroke="${k.ink}" stroke-width="${(k.sw * 2.4).toFixed(2)}" fill="none"/>` +
        `<path d="M60 93 V124 M29 101 L23.5 124 M91 101 L96.5 124" stroke="${k.paper}" stroke-width="${(k.sw * 1.1).toFixed(2)}" fill="none"/>` +
        `<rect x="57.6" y="93" width="4.8" height="6" rx="1.2" fill="${k.paper}" stroke="${k.ink}" stroke-width="${(k.sw * 0.6).toFixed(2)}"/>`,
    },
    outfit_vest: {
      name: '니트 조끼',
      sleeve: 'L',
      draw: (k) =>
        shape(k, TEE, k.L) +
        shape(k, 'M30 124 C31 106 36 96 47 89 L60 108 L73 89 C84 96 89 106 90 124 Z', k.M) +
        shape(k, 'M47 88 L51.5 97.5 L58 92.5 Z M73 88 L68.5 97.5 L62 92.5 Z', k.paper, 0.7) +
        (k.detail ? line(k, 'M37 117 V124 M43 117 V124 M49 117 V124 M55 117 V124 M65 117 V124 M71 117 V124 M77 117 V124 M83 117 V124', 0.45) : ''),
    },
    outfit_shirt: {
      name: '셔츠와 넥타이',
      sleeve: 'L',
      draw: (k) =>
        shape(k, TEE, k.L) +
        shape(k, 'M57.6 94 H62.4 L64 99 L62.2 114 L60 117 L57.8 114 L56 99 Z', k.D, 0.8) +
        shape(k, 'M47 88 L51 98.5 L60 92.5 L69 98.5 L73 88 C68 92 52 92 47 88 Z', k.paper, 0.8) +
        shape(k, 'M57 91.5 H63 L62.4 95.5 H57.6 Z', k.D, 0.8) +
        (k.detail ? line(k, 'M77 104 H87 V111 H77', 0.55) : ''),
    },
    outfit_tux: {
      name: '턱시도',
      sleeve: 'D',
      draw: (k) =>
        shape(k, TEE, k.D) +
        shape(k, 'M48 88.5 C52 93 68 93 72 88.5 L60 118 Z', k.paper, 0.8) +
        line(k, 'M48 88.5 L53.5 104 L60 118 M72 88.5 L66.5 104 L60 118', 0.8) +
        `<path d="M52 92 L59 95.5 L52 99 Z M68 92 L61 95.5 L68 99 Z" fill="${k.accent}" stroke="${k.ink}" stroke-width="${(k.sw * 0.7).toFixed(2)}"/>` +
        `<circle cx="60" cy="95.5" r="2.2" fill="${k.accent}" stroke="${k.ink}" stroke-width="${(k.sw * 0.6).toFixed(2)}"/>` +
        `<circle cx="60" cy="104.5" r="1.3" fill="${k.ink}"/><circle cx="60" cy="110.5" r="1.3" fill="${k.ink}"/>`,
    },
    /* 2026-10-29 추가 */
    outfit_core: {
      name: '핵융합 코어 슈트',
      draw: (k) =>
        shape(k, 'M16 124 C16 100 28 90 45 87.5 H75 C92 90 104 100 104 124 Z', k.D) +
        shape(k, 'M30 93 L46 88 L52 104 L34 110 Z M90 93 L74 88 L68 104 L86 110 Z', k.M, 0.85) +
        `<circle class="fx-pulse" cx="60" cy="105" r="8.5" fill="${k.accent}" ${sw(k, 0.9)}/>` +
        `<g class="fx-spin" style="transform-box:view-box;transform-origin:60px 105px">` +
        `<circle cx="60" cy="105" r="6" fill="none" stroke="${k.paper}" stroke-width="${(k.sw * 0.75).toFixed(2)}" stroke-dasharray="3 2.5"/>` +
        `</g>` +
        `<circle cx="60" cy="105" r="3" fill="${k.paper}"/>`,
    },

    outfit_wizard: {
      name: '대마법사 망토',
      behind: (k) =>
        shape(k, 'M34 92 L29 74 L46 80 L60 73 L74 80 L91 74 L86 92 Z', k.D),
      draw: (k) =>
        shape(k, TEE, k.D) +
        shape(k, 'M45 88 L60 124 L75 88 C68 93 52 93 45 88 Z', k.M, 0.8) +
        `<path d="${star5(60, 98, 6.5, 2.8)}" fill="${k.gold}" ${sw(k, 0.7)}/>` +
        spark(48, 106, k.detail ? 3.2 : 4, k.violetL, 'fx-twinkle', 0.2) +
        spark(72, 106, k.detail ? 3.2 : 4, k.violetL, 'fx-twinkle', 0.7),
    },

    outfit_gamer: {
      name: '네온 게이밍 후드',
      behind: (k) =>
        shape(k, 'M38 92 C35 80 45 74.5 60 74.5 C75 74.5 85 80 82 92 Z', k.D),
      draw: (k) =>
        shape(k, 'M17 124 C17 102 29 92 45 88.5 C50 95 70 95 75 88.5 C91 92 103 102 103 124 Z', k.D) +
        `<path d="M30 98 L25 122 M90 98 L95 122" stroke="${k.mintL}" stroke-width="${(k.sw * 1.4).toFixed(2)}" fill="none"/>` +
        `<g class="fx-twinkle">` +
        shape(k, 'M62 96 L54 106 H60 L57 116 L67 104 H61 Z', k.mintL, 0.75) +
        `</g>`,
    },

    outfit_chem: {
      name: '화학 마스터 앞치마',
      draw: (k) =>
        shape(k, TEE, k.L) +
        shape(k, 'M38 90 H82 L85 124 H35 Z', k.M, 0.85) +
        [[52, k.accent], [60, k.mintL], [68, k.coralL]].map(([x, c]) =>
          `<rect x="${x - 2.6}" y="102" width="5.2" height="12" rx="2.5" fill="${c}" ${sw(k, 0.65)}/>`
        ).join('') +
        shape(k, 'M47 108 H73 V120 H47 Z', k.D, 0.8) +
        `<circle class="fx-rise" style="--d:0s" cx="53" cy="99" r="1.8" fill="${k.sky}"/>` +
        `<circle class="fx-rise" style="--d:.8s" cx="67" cy="98" r="2" fill="${k.coralL}"/>`,
    },

    outfit_champ: {
      name: '챔피언 황금 망토',
      behind: (k) =>
        shape(k, 'M22 95 C26 80 42 76 60 76 C78 76 94 80 98 95 L106 124 H14 Z', k.coral),
      draw: (k) =>
        shape(k, TEE, k.D) +
        shape(k, 'M24 96 C28 89 37 87 46 88 L42 98 Z M96 96 C92 89 83 87 74 88 L78 98 Z', k.gold, 0.85) +
        `<path d="M46 89 Q60 102 74 89" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 1.3).toFixed(2)}"/>` +
        `<circle class="fx-pulse" cx="60" cy="103" r="6" fill="${k.gold}" ${sw(k, 0.8)}/>` +
        spark(60, 103, 3.5, k.paper, 'fx-twinkle', 0.2),
    },
  },

  /* ---------- 소품: layer 'body' = 몸통 위, 없으면 머리 위(머리카락보다 앞) ---------- */
  acc: {
    acc_none: { name: '없음' },
    /* 상점 */
    acc_glasses: {
      name: '보안경',
      draw: (k) =>
        [50, 70].map((x) =>
          `<circle cx="${x}" cy="55" r="7.6" fill="${k.paper}" fill-opacity=".25" stroke="${k.ink}" stroke-width="${k.sw.toFixed(2)}"/>`).join('') +
        line(k, 'M57.6 54 Q60 51.8 62.4 54 M42.4 53.5 L35.5 51.5 M77.6 53.5 L84.5 51.5', 1) +
        (k.detail ? line(k, 'M45 51 Q47 49 49.5 48.8 M65 51 Q67 49 69.5 48.8', 0.5) : ''),
    },
    acc_headphones: {
      name: '헤드폰',
      draw: (k) =>
        shape(k, 'M30.5 56 C26.5 27 41 12.5 60 12.5 C79 12.5 93.5 27 89.5 56 L85.5 56 C87.5 31 76 17.5 60 17.5 C44 17.5 32.5 31 34.5 56 Z', k.D) +
        [[26.5, 47], [82.5, 47]].map(([x, y]) =>
          `<rect x="${x}" y="${y}" width="11" height="19" rx="5" fill="${k.M}" stroke="${k.ink}" stroke-width="${k.sw.toFixed(2)}"/>`).join(''),
    },
    acc_goggles: {
      name: '실험 고글',
      draw: (k) =>
        `<path d="M33 53 H29.5 M87 53 H90.5" stroke="${k.ink}" stroke-width="${(k.sw * 2.6).toFixed(2)}"/>` +
        shape(k, 'M38 46.5 H82 Q86.5 46.5 86.5 51.5 V58 Q86.5 64.5 80 64.5 H67.5 Q63 64.5 60 60.5 Q57 64.5 52.5 64.5 H40 Q33.5 64.5 33.5 58 V51.5 Q33.5 46.5 38 46.5 Z', k.M) +
        [49, 71].map((x) =>
          `<ellipse cx="${x}" cy="55.5" rx="8.3" ry="5.6" fill="${k.paper}" fill-opacity=".55" stroke="${k.ink}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>`).join('') +
        (k.detail ? line(k, 'M43.5 53 Q45.5 51.2 48 51 M65.5 53 Q67.5 51.2 70 51', 0.5) : ''),
    },
    acc_atom: {
      name: '원자 배지',
      layer: 'body',
      draw: (k) =>
        `<circle cx="83" cy="106" r="9" fill="${k.paper}" stroke="${k.ink}" stroke-width="${k.sw.toFixed(2)}"/>` +
        [0, 60, 120].map((r) =>
          `<ellipse cx="83" cy="106" rx="6.6" ry="2.5" transform="rotate(${r} 83 106)" fill="none" stroke="${k.ink}" stroke-width="${(k.sw * 0.55).toFixed(2)}"/>`).join('') +
        `<circle cx="83" cy="106" r="1.7" fill="${k.ink}"/>`,
    },
    acc_bandaid: {
      name: '반창고',
      draw: (k) =>
        `<g style="${FLAT}" transform="rotate(-28 77 64)">` +
        `<rect x="69.5" y="61.2" width="15" height="5.6" rx="2.8" fill="${k.paper}" stroke="${k.ink}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>` +
        `<rect x="74.5" y="61.2" width="5" height="5.6" fill="${k.L}" stroke="${k.ink}" stroke-width="${(k.sw * 0.5).toFixed(2)}"/></g>`,
    },
    acc_pencil: {
      name: '귀에 연필',
      draw: (k) =>
        `<g style="${FLAT}" transform="translate(3 -11) rotate(-25 88 47)">` +
        `<rect x="74" y="44.5" width="4.5" height="5" rx="1" fill="${k.D}" stroke="${k.ink}" stroke-width="${(k.sw * 0.7).toFixed(2)}"/>` +
        `<rect x="78.5" y="44.5" width="17.5" height="5" fill="${k.L}" stroke="${k.ink}" stroke-width="${(k.sw * 0.7).toFixed(2)}"/>` +
        `<path d="M96 44.5 L101.5 47 L96 49.5 Z" fill="${k.paper}" stroke="${k.ink}" stroke-width="${(k.sw * 0.7).toFixed(2)}"/>` +
        `<path d="M99.6 46.1 L101.5 47 L99.6 47.9 Z" fill="${k.ink}"/></g>`,
    },
    acc_bow: {
      name: '리본 핀',
      draw: (k) =>
        `<g style="${FLAT}" transform="rotate(-20 40 31)">` +
        shape(k, 'M40 31 L29.5 24.5 Q26.5 31 29.5 37.5 Z M40 31 L50.5 24.5 Q53.5 31 50.5 37.5 Z', k.M, 0.9) +
        `<circle cx="40" cy="31" r="3.2" fill="${k.D}" stroke="${k.ink}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/></g>`,
    },
    acc_scarf: {
      name: '목도리',
      layer: 'body',
      draw: (k) =>
        shape(k, 'M63 95 L70.5 94 L73 115 L64.5 116 Z', k.M, 0.9) +
        shape(k, 'M45 85 C51 90.5 69 90.5 75 85 L77.5 92 C70 98.5 50 98.5 42.5 92 Z', k.M, 0.9) +
        (k.detail ? line(k, 'M64.3 103 H71.5 M64.8 109 H72.2 M66 116 V119 M69 115.6 V118.6 M72 115.2 V118.2', 0.5) : ''),
    },
    acc_beaker: {
      name: '비커',
      layer: 'body',
      draw: (k) =>
        `<g style="${FLAT}" transform="translate(-4 -10)">` +
        `<path d="M79 98 V115 Q79 118 82 118 H90 Q93 118 93 115 V98 Z" fill="${k.paper}"/>` +
        `<path d="M79.9 107 H92.1 V115 Q92.1 117.1 90 117.1 H82 Q79.9 117.1 79.9 115 Z" fill="${k.M}"/>` +
        shape(k, 'M79 98 V115 Q79 118 82 118 H90 Q93 118 93 115 V98', 'none') +
        line(k, 'M77.5 98 H94.5', 1) +
        (k.detail ? line(k, 'M87 101.5 H90.5 M88.5 104.5 H90.5', 0.5) : '') +
        `</g>`,
    },
    acc_magnifier: {
      name: '돋보기',
      layer: 'body',
      draw: (k) =>
        `<g style="${FLAT}" transform="translate(-4 -8)">` +
        `<path d="M78.5 107 L71 117.5" stroke="${k.ink}" stroke-width="${(k.sw * 2.8).toFixed(2)}"/>` +
        `<circle cx="84" cy="101" r="8" fill="${k.paper}" fill-opacity=".45" stroke="${k.ink}" stroke-width="${(k.sw * 1.2).toFixed(2)}"/>` +
        (k.detail ? line(k, 'M79.5 99 Q80.5 96 83.5 95.2', 0.5) : '') +
        `</g>`,
    },
    acc_holo: {
      name: '홀로그램 측정기',
      draw: (k) =>
        shape(k, 'M31 50 H38 V60 H31 Z', k.D, 0.8) +
        `<rect x="37" y="47.5" width="22" height="15" rx="4" fill="${k.sky}" fill-opacity=".42" stroke="${k.accent}" stroke-width="${(k.sw * 0.95).toFixed(2)}"/>` +
        `<g class="fx-scan">` +
        `<line x1="40" y1="55" x2="56" y2="55" stroke="${k.paper}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>` +
        `</g>`,
    },

    acc_cyber_shades: {
      name: '사이버 네온 선글라스',
      draw: (k) =>
        shape(k, 'M35 49 H85 L82 61 L63 59 L60 55 L57 59 L38 61 Z', k.D) +
        `<path class="fx-twinkle" d="M40 51.5 H56 L53 58 H42 Z" fill="${k.mintL}"/>` +
        `<path class="fx-twinkle" style="--d:.4s" d="M64 51.5 H79 L76 58 H66 Z" fill="${k.goldL}"/>`,
    },

    acc_tesla: {
      name: '번개 마법봉',
      layer: 'body',
      draw: (k) =>
        `<g style="${FLAT}" transform="translate(-4 -8)">` +
        shape(k, 'M84 100 H89 V120 H84 Z', k.D, 0.8) +
        line(k, 'M82 103 H91 M82 107 H91', 0.85) +
        `<circle class="fx-pulse" cx="86.5" cy="95.5" r="5.8" fill="${k.sky}" ${sw(k, 0.85)}/>` +
        `<circle cx="86.5" cy="95.5" r="2.5" fill="${k.paper}"/>` +
        spark(95, 89, k.detail ? 3.8 : 4.5, k.gold, 'fx-twinkle', 0.1) +
        spark(77, 91, k.detail ? 3.2 : 4, k.accent, 'fx-twinkle', 0.5) +
        `</g>`,
    },

    acc_wings: {
      name: '사이버 발키리 날개',
      layer: 'body',
      draw: (k) =>
        `<g class="fx-flame">` +
        shape(k, 'M26 96 L5 82 L9 93 L3 98 L12 104 L8 110 L24 108 Z', k.paper, 0.85) +
        shape(k, 'M94 96 L115 82 L111 93 L117 98 L108 104 L112 110 L96 108 Z', k.paper, 0.85) +
        `<path d="M22 98 L10 88 M21 103 L11 100 M98 98 L110 88 M99 103 L109 100" stroke="${k.accent}" stroke-width="${(k.sw * 1.1).toFixed(2)}"/>` +
        `</g>`,
    },

    acc_flask: {
      name: '빛나는 플라스크',
      layer: 'body',
      draw: (k) =>
        `<g style="${FLAT}" transform="translate(-5 -11)">` +
        shape(k, 'M83 93 H89 V99 C94 101 96 106 96 111 C96 116 92 119 86 119 C80 119 76 116 76 111 C76 106 78 101 83 99 Z', k.paper, 0.9) +
        `<path d="M77.5 109 H94.5 C95 114 91.5 117.5 86 117.5 C80.5 117.5 77 114 77.5 109 Z" fill="${k.violet}"/>` +
        spark(86, 113, 3, k.goldL, 'fx-twinkle', 0.2) +
        `<circle class="fx-rise" cx="84" cy="104" r="1.8" fill="${k.gold}"/>` +
        spark(97, 96, k.detail ? 3.8 : 4.6, k.violetL, 'fx-twinkle', 0.6) +
        `</g>`,
    },
  },
  /* ---------- 모자·머리 장식: 머리카락·소품 위 (id가 acc_로 시작하는 것은 예전 소품 칸에서 옮겨 옴) ---------- */
  hat: {
    hat_none: { name: '없음' },
    /* 상점 */
    acc_cap: {
      name: '야구 모자',
      draw: (k) =>
        shape(k, 'M34 42 C33 25 45 16.5 60 16.5 C75 16.5 87 25 86 42 Z', k.M) +
        shape(k, 'M33 42 H87 Q92 42 91 46 Q60 50 29 46 Q28 42 33 42 Z', k.D) +
        `<circle cx="60" cy="17" r="2.2" fill="${k.ink}"/>` +
        (k.detail ? line(k, 'M60 18 C55 25 53 33 53 42 M60 18 C65 25 67 33 67 42', 0.5) : ''),
    },
    acc_hat_chick: {
      name: '병아리 모자',
      draw: (k) => animalHat(k, k.L, '',
        line(k, 'M57 15 Q57.5 7.5 60.5 14.5 Q63 8.5 64 15', 0.9) +
        [50, 70].map((x) => `<circle cx="${x}" cy="27" r="2.3" fill="${k.ink}"/>`).join('') +
        `<path d="M55.5 31 H64.5 L60 36.5 Z" fill="${k.M}" ${ink(k, 0.8)}/>`),
    },
    acc_hat_frog: {
      name: '개구리 모자',
      draw: (k) => animalHat(k, k.M, '',
        [45, 75].map((x) =>
          `<circle cx="${x}" cy="17" r="8.5" fill="${k.L}" ${ink(k, 1)}/>` +
          `<circle cx="${x}" cy="17.5" r="4" fill="${k.ink}"/>` +
          (k.detail ? `<circle cx="${x - 1.4}" cy="16" r="1.4" fill="${k.paper}"/>` : '')).join('') +
        line(k, 'M41 34 Q60 41 79 34', 0.9)),
    },
    acc_hat_cat: {
      name: '고양이 모자',
      draw: (k) => animalHat(k, k.D,
        shape(k, 'M35 33 L36 9 L52 19 Z M85 33 L84 9 L68 19 Z', k.D) +
        `<path d="M38.5 26 L39 15 L46.5 20 Z M81.5 26 L81 15 L73.5 20 Z" fill="${k.L}"/>`,
        (k.detail ? line(k, 'M41 33 L35 32 M41 36 L35.5 37 M79 33 L85 32 M79 36 L84.5 37', 0.5) : '')),
    },
    acc_hat_bear: {
      name: '곰 모자',
      draw: (k) => animalHat(k, k.M,
        [37, 83].map((x) =>
          `<circle cx="${x}" cy="20" r="8.5" fill="${k.M}" ${ink(k, 1)}/><circle cx="${x}" cy="20" r="4.2" fill="${k.L}"/>`).join(''),
        `<ellipse cx="60" cy="31" rx="7" ry="5" fill="${k.L}" ${ink(k, 0.7)}/>` +
        `<ellipse cx="60" cy="29.5" rx="2.6" ry="1.8" fill="${k.ink}"/>`),
    },
    acc_hat_rabbit: {
      name: '토끼 모자',
      draw: (k) => animalHat(k, k.L,
        `<ellipse cx="49" cy="5" rx="5.5" ry="14" transform="rotate(-12 49 5)" fill="${k.L}" ${ink(k, 1)}/>` +
        `<ellipse cx="71" cy="5" rx="5.5" ry="14" transform="rotate(12 71 5)" fill="${k.L}" ${ink(k, 1)}/>` +
        `<ellipse cx="49" cy="6" rx="2.4" ry="9.5" transform="rotate(-12 49 6)" fill="${k.M}"/>` +
        `<ellipse cx="71" cy="6" rx="2.4" ry="9.5" transform="rotate(12 71 6)" fill="${k.M}"/>`),
    },
    acc_hat_dino: {
      name: '공룡 모자',
      draw: (k) => animalHat(k, k.M,
        [[38, 26, -48], [46, 18, -27], [60, 14.5, 0], [74, 18, 27], [82, 26, 48]].map(([x, y, r]) =>
          `<path d="M${x - 5} ${y + 2} L${x} ${y - 9} L${x + 5} ${y + 2} Z" transform="rotate(${r} ${x} ${y})" fill="${k.accent}" ${ink(k, 0.8)}/>`).join(''),
        [48, 72].map((x) => `<circle cx="${x}" cy="29" r="3" fill="${k.paper}" ${ink(k, 0.7)}/><circle cx="${x}" cy="29.3" r="1.4" fill="${k.ink}"/>`).join('')),
    },
    acc_halo: {
      name: '전자 고리',
      draw: (k) =>
        `<ellipse cx="60" cy="13" rx="21" ry="5.5" fill="none" stroke="${k.ink}" stroke-width="${(k.sw * 2.6).toFixed(2)}"/>` +
        `<ellipse cx="60" cy="13" rx="21" ry="5.5" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 1.3).toFixed(2)}"/>` +
        [[39.5, 13], [74, 17.4]].map(([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="3" fill="${k.gold}" stroke="${k.ink}" stroke-width="${(k.sw * 0.7).toFixed(2)}"/>`).join('') +
        spark(86, 5, k.detail ? 3.5 : 4.5, k.gold),
    },
    acc_crown: {
      name: '왕관',
      draw: (k) =>
        `<g class="fx-spin-slow" style="transform-box:view-box;transform-origin:60px 18px">` +
        `<circle cx="60" cy="18" r="16" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 0.7).toFixed(2)}" stroke-dasharray="3 4"/>` +
        `</g>` +
        shape(k, 'M38 26 L34 9 L46 18 L53 5 L60 16 L67 5 L74 18 L86 9 L82 26 Z', k.gold) +
        shape(k, 'M37 24 H83 V30 H37 Z', k.gold) +
        `<polygon points="60,10 64,18 60,23 56,18" fill="${k.accent}" ${sw(k, 0.65)}/>` +
        `<circle cx="46" cy="27" r="2.2" fill="${k.coralL}" ${sw(k, 0.5)}/>` +
        `<circle cx="74" cy="27" r="2.2" fill="${k.coralL}" ${sw(k, 0.5)}/>` +
        spark(60, 2, k.detail ? 4.5 : 5.5, k.gold, 'fx-twinkle', 0.1),
    },
    hat_astro: {
      name: '우주 비행사 헬멧',
      draw: (k) =>
        `<line x1="60" y1="12" x2="60" y2="4" ${sw(k, 1.1)}/>` +
        `<circle class="fx-pulse" cx="60" cy="3.5" r="3.2" fill="${k.gold}" ${sw(k, 0.7)}/>` +
        (k.detail ? `<circle class="fx-wave" cx="60" cy="3.5" r="6.5" fill="none" stroke="${k.accent}" stroke-width="${(k.sw * 0.6).toFixed(2)}"/>` : '') +
        shape(k, 'M28 50 C26 24 40 11 60 11 C80 11 94 24 92 50 C88 45 83 42 76 41 C66 39 54 39 44 41 C37 42 32 45 28 50 Z', k.L) +
        `<path d="M35 43 C35 25 45 17 60 17 C75 17 85 25 85 43 C74 39 46 39 35 43 Z" fill="${k.accent}" fill-opacity=".32" ${sw(k, 0.85)}/>` +
        (k.detail ? line(k, 'M43 26 Q50 21 58 21', 0.7) : '') +
        spark(73, 26, k.detail ? 3.2 : 4, k.paper, 'fx-twinkle', 0.2),
    },

    hat_wizard: {
      name: '별빛 마법사 모자',
      draw: (k) =>
        shape(k, 'M34 39 L47 11 C51 4 59 3 67 6 L83 13 L73 19 L84 39 Z', k.D) +
        shape(k, 'M33 34 C48 30 72 30 87 34 L88 40 C72 36 48 36 32 40 Z', k.violet, 0.85) +
        shape(k, 'M22 41 C42 34 78 34 98 41 C78 46 42 46 22 41 Z', k.D) +
        `<g class="fx-wobble">` +
        `<line x1="82" y1="13" x2="87" y2="21" ${sw(k, 0.7)}/>` +
        `<path d="${star5(88, 24, 5.5, 2.5)}" fill="${k.gold}" ${sw(k, 0.65)}/>` +
        `</g>` +
        spark(54, 22, k.detail ? 3.5 : 4.5, k.goldL, 'fx-twinkle', 0.3),
    },

    hat_alchem: {
      name: '연금술사 고글 모자',
      draw: (k) =>
        shape(k, 'M32 43 C31 24 43 14 60 14 C77 14 89 24 88 43 Z', k.M) +
        shape(k, 'M30 41 C46 37 74 37 90 41 L90 46 C74 42 46 42 30 46 Z', k.D, 0.9) +
        `<g class="fx-spin" style="transform-box:view-box;transform-origin:60px 28px">` +
        `<circle cx="60" cy="28" r="5.5" fill="${k.gold}" ${sw(k, 0.75)}/>` +
        `<circle cx="60" cy="28" r="2" fill="${k.paper}"/>` +
        `</g>` +
        `<circle cx="46" cy="29" r="7" fill="${k.mintL}" ${sw(k, 0.9)}/>` +
        `<circle cx="74" cy="29" r="7" fill="${k.goldL}" ${sw(k, 0.9)}/>` +
        (k.detail ? line(k, 'M43 26 Q45 24 48 24 M71 26 Q73 24 76 24', 0.55) : ''),
    },
  },
  /* ---------- 짝꿍 펫: 오른쪽 위 (101, 32) 둘레에 그림. avatar.js가 1.5배로 키움 ---------- */
  pet: {
    pet_none: { name: '없음' },
    pet_drone: {
      name: '미니 과학 드론',
      draw: (k) =>
        `<g class="fx-float">` +
        `<line x1="93" y1="26" x2="109" y2="26" ${sw(k, 0.9)}/>` +
        `<line x1="91" y1="23" x2="97" y2="23" stroke="${k.accent}" stroke-width="${(k.sw * 1.1).toFixed(2)}"/>` +
        `<line x1="105" y1="23" x2="111" y2="23" stroke="${k.accent}" stroke-width="${(k.sw * 1.1).toFixed(2)}"/>` +
        `<circle cx="101" cy="32" r="7.5" fill="${k.L}" ${sw(k, 0.9)}/>` +
        `<circle cx="101" cy="32" r="4" fill="${k.ink}"/>` +
        `<circle class="fx-twinkle" cx="101" cy="32" r="2" fill="${k.sky}"/>` +
        `</g>`,
    },

    pet_slime: {
      name: '플라즈마 슬라임',
      draw: (k) =>
        `<g class="fx-pulse" style="transform-box:view-box;transform-origin:101px 36px">` +
        shape(k, 'M92 38 C92 29 96 25 101 25 C106 25 110 29 110 38 C110 42 106 43 101 43 C96 43 92 42 92 38 Z', k.mintL, 0.85) +
        `<circle cx="98" cy="35" r="1.5" fill="${k.ink}"/><circle cx="104" cy="35" r="1.5" fill="${k.ink}"/>` +
        (k.detail ? `<circle cx="96.5" cy="31" r="1.6" fill="${k.paper}"/>` : '') +
        `</g>`,
    },

    pet_star: {
      name: '아기 별 정령',
      draw: (k) =>
        `<g class="fx-float">` +
        `<path d="${star5(101, 32, 10, 4.8)}" fill="${k.goldL}" ${sw(k, 0.85)}/>` +
        `<circle cx="98.5" cy="32" r="1.4" fill="${k.ink}"/><circle cx="103.5" cy="32" r="1.4" fill="${k.ink}"/>` +
        spark(91, 41, 3, k.gold, 'fx-twinkle', 0.3) +
        `</g>`,
    },

    pet_atom: {
      name: '꼬마 원자 요정',
      draw: (k) =>
        `<g class="fx-float">` +
        `<g class="fx-spin" style="transform-box:view-box;transform-origin:101px 32px">` +
        `<ellipse cx="101" cy="32" rx="11" ry="4.2" transform="rotate(30 101 32)" fill="none" stroke="${k.ink}" stroke-width="${(k.sw * 0.7).toFixed(2)}"/>` +
        `<circle cx="110" cy="37" r="2.2" fill="${k.gold}" ${sw(k, 0.5)}/>` +
        `</g>` +
        `<circle cx="101" cy="32" r="5.8" fill="${k.sky}" ${sw(k, 0.85)}/>` +
        `<circle cx="99" cy="31.5" r="1.2" fill="${k.ink}"/><circle cx="103" cy="31.5" r="1.2" fill="${k.ink}"/>` +
        `</g>`,
    },

    pet_dragon: {
      name: '아기 드래곤',
      draw: (k) =>
        `<g class="fx-float">` +
        shape(k, 'M105 28 L113 22 L111 30 L115 33 L106 34 Z', k.gold, 0.75) +
        `<circle cx="100" cy="32" r="7" fill="${k.M}" ${sw(k, 0.85)}/>` +
        shape(k, 'M96 26 L94 20 L99 25 Z M102 25 L104 19 L105 26 Z', k.gold, 0.7) +
        `<circle cx="98" cy="31" r="1.5" fill="${k.ink}"/>` +
        `<circle class="fx-pulse" cx="90" cy="33" r="3" fill="${k.coralL}"/>` +
        `</g>`,
    },
  },
  /* ---------- 오라: 배경 위, 몸 뒤 ---------- */
  aura: {
    aura_none: { name: '없음' },
    aura_thunder: {
      name: '초전도 번개 스파크',
      draw: (k) =>
        `<g class="fx-twinkle" style="--d:0s">` +
        shape(k, 'M16 48 L25 40 L22 49 L29 47 L17 59 L20 50 Z', k.gold, 0.75) +
        shape(k, 'M102 52 L93 44 L96 53 L89 51 L101 63 L98 54 Z', k.sky, 0.75) +
        `</g>` +
        `<g class="fx-twinkle" style="--d:.5s">` +
        shape(k, 'M22 82 L30 75 L27 83 L33 82 L23 92 L25 84 Z', k.sky, 0.75) +
        shape(k, 'M98 22 L90 16 L93 23 L87 22 L97 31 L95 24 Z', k.gold, 0.75) +
        `</g>` +
        spark(24, 22, k.detail ? 4.5 : 5.5, k.gold, 'fx-twinkle', 0.25),
    },

    aura_orbit: {
      name: '회전하는 전자 궤도',
      draw: (k) =>
        `<g class="fx-spin" style="transform-box:view-box;transform-origin:60px 62px">` +
        `<ellipse cx="60" cy="62" rx="52" ry="18" transform="rotate(-22 60 62)" fill="none" stroke="${k.accent}" stroke-width="${(k.sw * 0.9).toFixed(2)}" stroke-dasharray="6 4"/>` +
        `<circle cx="12" cy="80" r="3.8" fill="${k.sky}" ${sw(k, 0.7)}/>` +
        `<circle cx="108" cy="44" r="3.8" fill="${k.gold}" ${sw(k, 0.7)}/>` +
        `</g>`,
    },

    aura_fire: {
      name: '타오르는 불꽃 오라',
      draw: (k) =>
        `<g class="fx-flame">` +
        shape(k, 'M16 92 C10 78 15 64 22 58 C19 67 22 72 26 76 C24 83 20 88 16 92 Z', k.coralL, 0.75) +
        shape(k, 'M104 92 C110 78 105 64 98 58 C101 67 98 72 94 76 C96 83 100 88 104 92 Z', k.coralL, 0.75) +
        shape(k, 'M22 44 C17 34 21 24 27 20 C25 27 27 32 30 35 Z', k.gold, 0.7) +
        shape(k, 'M98 44 C103 34 99 24 93 20 C95 27 93 32 90 35 Z', k.gold, 0.7) +
        `</g>`,
    },

    aura_music: {
      name: '네온 비트 파동',
      draw: (k) =>
        `<g class="fx-float" style="--d:0s">` +
        `<circle cx="18" cy="54" r="3.2" fill="${k.mintL}" ${sw(k, 0.65)}/>` +
        `<path d="M21 54 V43 L27 45" fill="none" stroke="${k.ink}" stroke-width="${(k.sw * 0.9).toFixed(2)}"/>` +
        `</g>` +
        `<g class="fx-float" style="--d:.6s">` +
        `<circle cx="100" cy="64" r="3.2" fill="${k.violetL}" ${sw(k, 0.65)}/>` +
        `<path d="M103 64 V53 L109 55" fill="none" stroke="${k.ink}" stroke-width="${(k.sw * 0.9).toFixed(2)}"/>` +
        `</g>` +
        spark(22, 78, k.detail ? 4 : 5, k.sky, 'fx-twinkle', 0.3) +
        spark(96, 36, k.detail ? 4 : 5, k.gold, 'fx-twinkle', 0.8),
    },

    aura_starlight: {
      name: '은하수 별빛 세례',
      draw: (k) =>
        `<g class="fx-spin-slow" style="transform-box:view-box;transform-origin:60px 60px">` +
        `<circle cx="60" cy="60" r="52" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 0.8).toFixed(2)}" stroke-dasharray="2 8"/>` +
        `</g>` +
        [[16, 36, 5.5, k.gold, 0.1], [104, 38, 5.5, k.sky, 0.4], [18, 78, 4.5, k.violetL, 0.7], [102, 78, 5, k.gold, 1.0]]
          .map(([x, y, r, c, d]) => spark(x, y, k.detail ? r : r * 1.2, c, 'fx-twinkle', d)).join(''),
    },
  },

  /* ---------- 배경 ---------- */
  bg: {
    bg_circle: {
      name: '연한 원',
      draw: (k) => `<circle cx="60" cy="60" r="58" fill="${k.L}" opacity=".5"/>`,
    },
    /* 상점 */
    bg_stars: {
      name: '별 무늬',
      draw: (k) =>
        `<circle cx="60" cy="60" r="58" fill="${k.L}" opacity=".5"/>` +
        [[22, 32, 6], [97, 26, 7], [104, 64, 4.5], [15, 66, 4.5], [38, 12, 4], [84, 8, 3.5]]
          .map(([x, y, r]) => spark(x, y, k.detail ? r : r * 1.3, k.ink)).join(''),
    },
    bg_elements: {
      name: '원소 기호',
      draw: (k) =>
        `<circle cx="60" cy="60" r="58" fill="${k.L}" opacity=".5"/>` +
        [[9, 26, 'H'], [94, 15, 'He'], [99, 52, 'C'], [6, 60, 'O']].map(([x, y, t]) =>
          `<rect x="${x}" y="${y}" width="16" height="16" rx="3" fill="${k.paper}" stroke="${k.accent}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>` +
          `<text x="${x + 8}" y="${y + 11.6}" text-anchor="middle" font-family="'Noto Sans KR', sans-serif" font-weight="900" font-size="${t.length > 1 ? 7.5 : 9}" fill="${k.accent}">${t}</text>`).join(''),
    },
    bg_dots: {
      name: '물방울',
      draw: (k) =>
        BG_BASE(k) +
        [[18, 30], [31, 15], [101, 30], [89, 14], [108, 50], [12, 49], [20, 84], [100, 85], [7, 67], [113, 68], [45, 7], [75, 7]]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${k.detail ? 2 : 2.8}" fill="${k.ink}"/>`).join(''),
    },
    bg_check: {
      name: '체크',
      draw: (k) =>
        BG_BASE(k) +
        `<clipPath id="${k.id}-bgc"><circle cx="60" cy="60" r="58"/></clipPath>` +
        `<g clip-path="url(#${k.id}-bgc)" stroke="${k.ink}" stroke-width="${(k.sw * 0.5).toFixed(2)}" opacity=".3">` +
        Array.from({ length: 10 }, (_, i) => { const v = 6 + i * 12; return `<path d="M${v} 0 V120 M0 ${v} H120"/>`; }).join('') +
        `</g>`,
    },
    bg_hex: {
      name: '분자 구조',
      draw: (k) =>
        BG_BASE(k) +
        `<g fill="none" stroke="${k.ink}" stroke-width="${(k.sw * 0.8).toFixed(2)}">` +
        [[20, 32, 9], [100, 34, 8], [15, 76, 7], [106, 74, 7]].map(([x, y, r]) =>
          `<path d="${hex(x, y, r)}"/>` + (k.detail ? `<circle cx="${x}" cy="${y}" r="${(r * 0.5).toFixed(1)}"/>` : '')).join('') +
        `<path d="M27.8 27.5 L35 22 M92.2 29.5 L86 24 M15 69 V60 M106 67 V58"/></g>`,
    },
    bg_planet: {
      name: '행성',
      draw: (k) =>
        BG_BASE(k) +
        `<circle cx="22" cy="28" r="10" fill="${k.M}" stroke="${k.ink}" stroke-width="${k.sw.toFixed(2)}"/>` +
        `<ellipse cx="22" cy="28" rx="17" ry="4.5" transform="rotate(-20 22 28)" fill="none" stroke="${k.accent}" stroke-width="${(k.sw * 1.1).toFixed(2)}"/>` +
        `<circle cx="101" cy="20" r="4.5" fill="${k.L}" stroke="${k.ink}" stroke-width="${(k.sw * 0.8).toFixed(2)}"/>` +
        spark(106, 52, k.detail ? 4 : 5, k.ink) + spark(11, 62, k.detail ? 3.5 : 4.5, k.ink),
    },
    bg_dna: {
      name: 'DNA',
      draw: (k) => {
        const helix = (cx) => {
          const pts = (ph) => Array.from({ length: 29 }, (_, i) => {
            const y = 28 + i * 2.5;
            return `${(cx + 7 * Math.sin((y - 28) / 9 + ph)).toFixed(2)} ${y}`;
          });
          const rungs = Array.from({ length: 9 }, (_, i) => {
            const y = 31 + i * 8, t = (y - 28) / 9;
            return `M${(cx + 7 * Math.sin(t)).toFixed(2)} ${y} H${(cx + 7 * Math.sin(t + Math.PI)).toFixed(2)}`;
          }).join(' ');
          return `<path d="${rungs}" stroke="${k.ink}" stroke-width="${(k.sw * 0.5).toFixed(2)}" fill="none"/>` +
            [0, Math.PI].map((ph) =>
              `<path d="M${pts(ph).join(' L')}" fill="none" stroke="${k.accent}" stroke-width="${(k.sw * 1).toFixed(2)}"/>`).join('');
        };
        return BG_BASE(k) + helix(13) + helix(107);
      },
    },
    bg_galaxy: {
      name: '은하',
      // 밤하늘(어두운 망점) + 소용돌이 팔 두 개(밝은 망점, 가운데 파란 줄) + 금색 은하 중심. 비스듬히 눕혀 원반처럼
      draw: (k) => {
        const arm = (ph) => {
          const at = (t, off) => {
            const th = ph + t * 4.2, r = 6 + t * 74 + off * (2 + t * 12);
            return `${(r * Math.cos(th)).toFixed(2)} ${(r * Math.sin(th)).toFixed(2)}`;
          };
          const ts = Array.from({ length: 31 }, (_, i) => i / 30);
          const back = [...ts].reverse();
          return {
            band: 'M' + ts.map((t) => at(t, -1)).join(' L') + ' L' + back.map((t) => at(t, 1)).join(' L') + ' Z',
            core: 'M' + ts.map((t) => at(t, 0)).join(' L'),
          };
        };
        const arms = [arm(0), arm(Math.PI)];
        const stars = [[14, 40, 1.4], [30, 14, 1.1], [104, 74, 1.3], [96, 104, 1.1], [18, 94, 1.2], [52, 8, 1], [110, 50, 1]];
        return `<clipPath id="${k.id}-gx"><circle cx="60" cy="60" r="58"/></clipPath>` +
          `<circle cx="60" cy="60" r="58" fill="${k.D}"/>` +
          `<g clip-path="url(#${k.id}-gx)">` +
          `<g style="${FLAT}" transform="translate(60 33) rotate(-16) scale(1 .5)">` +
          `<ellipse cx="0" cy="0" rx="62" ry="50" fill="${k.M}" opacity=".5"/>` +
          arms.map((a) => `<path d="${a.band}" fill="${k.L}"/>`).join('') +
          arms.map((a) => `<path d="${a.core}" fill="none" stroke="${k.accent}" stroke-width="${(k.sw * 0.9).toFixed(2)}" opacity=".85"/>`).join('') +
          `<ellipse cx="0" cy="0" rx="34" ry="30" fill="${k.gold}" opacity=".35"/>` +
          `<ellipse cx="0" cy="0" rx="24" ry="20" fill="${k.gold}"/>` +
          `<ellipse cx="0" cy="0" rx="14" ry="11" fill="${k.paper}"/>` +
          `</g>` +
          (k.detail ? stars.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${k.paper}"/>`).join('') : '') +
          spark(16, 26, k.detail ? 4.5 : 6, k.gold) + spark(108, 88, k.detail ? 3.5 : 4.5, k.paper) +
          `</g>` +
          `<circle cx="60" cy="60" r="57" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 0.9).toFixed(2)}"/>`;
      },
    },
    /* 2026-10-29 추가 */
    bg_blackhole: {
      name: '블랙홀 사건의 지평선',
      draw: (k) =>
        `<circle cx="60" cy="60" r="58" fill="${k.D}" opacity=".75"/>` +
        `<g class="fx-spin-slow" style="transform-box:view-box;transform-origin:60px 60px">` +
        `<circle cx="60" cy="60" r="53" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 1.1).toFixed(2)}" stroke-dasharray="18 10"/>` +
        `<circle cx="60" cy="60" r="46" fill="none" stroke="${k.accent}" stroke-width="${(k.sw * 0.9).toFixed(2)}" stroke-dasharray="12 14"/>` +
        `</g>` +
        spark(20, 26, k.detail ? 5 : 6, k.gold, 'fx-twinkle', 0.2) +
        spark(100, 28, k.detail ? 4.5 : 5.5, k.sky, 'fx-twinkle', 0.7),
    },

    bg_meteor: {
      name: '별똥별 유성우',
      draw: (k) =>
        `<circle cx="60" cy="60" r="58" fill="${k.M}" opacity=".6"/>` +
        [[26, 22, k.gold, 0], [98, 26, k.sky, 0.7], [18, 66, k.sky, 1.3], [104, 64, k.gold, 1.9]].map(([x, y, c, d]) =>
          `<g class="fx-meteor" style="--d:${d}s">` +
          `<line x1="${x}" y1="${y}" x2="${x + 12}" y2="${y - 12}" stroke="${c}" stroke-width="${(k.sw * 1.2).toFixed(2)}"/>` +
          `<circle cx="${x}" cy="${y}" r="2.6" fill="${c}" ${sw(k, 0.5)}/>` +
          `</g>`
        ).join(''),
    },

    bg_circuit: {
      name: '사이버 매트릭스 회로',
      draw: (k) =>
        BG_BASE(k) +
        `<g fill="none" stroke="${k.ink}" stroke-width="${(k.sw * 0.75).toFixed(2)}">` +
        `<path d="M12 36 H26 L34 28 M108 36 H94 L86 28 M10 68 H24 L30 76 M110 68 H96 L90 76"/>` +
        `</g>` +
        [[34, 28, k.mintL, 0.1], [86, 28, k.sky, 0.4], [30, 76, k.sky, 0.7], [90, 76, k.mintL, 1.0]].map(([x, y, c, d]) =>
          `<circle class="fx-twinkle" style="--d:${d}s" cx="${x}" cy="${y}" r="3.2" fill="${c}" ${sw(k, 0.65)}/>`
        ).join(''),
    },

    bg_bubbles: {
      name: '보글보글 플라스크',
      draw: (k) =>
        BG_BASE(k) +
        [[18, 34, 5, k.mintL, 0], [100, 30, 6, k.sky, 0.5], [14, 70, 4.5, k.sky, 1.0], [104, 68, 5.5, k.mintL, 1.5], [30, 16, 3.5, k.paper, 0.8], [90, 16, 4, k.paper, 1.2]]
          .map(([x, y, r, c, d]) =>
            `<circle class="fx-rise" style="--d:${d}s" cx="${x}" cy="${y}" r="${r}" fill="${c}" fill-opacity=".75" ${sw(k, 0.65)}/>`
          ).join(''),
    },

    bg_sunburst: {
      name: '황금 태양광',
      draw: (k) =>
        `<clipPath id="${k.id}-sun"><circle cx="60" cy="60" r="58"/></clipPath>` +
        `<circle cx="60" cy="60" r="58" fill="${k.L}" opacity=".65"/>` +
        `<g clip-path="url(#${k.id}-sun)">` +
        `<g class="fx-spin-slow" style="transform-box:view-box;transform-origin:60px 60px" fill="${k.gold}" opacity=".28">` +
        Array.from({ length: 12 }, (_, i) => {
          const a1 = (i * 30 * Math.PI) / 180, a2 = ((i * 30 + 12) * Math.PI) / 180;
          return `<path d="M60 60 L${(60 + 70 * Math.cos(a1)).toFixed(1)} ${(60 + 70 * Math.sin(a1)).toFixed(1)} L${(60 + 70 * Math.cos(a2)).toFixed(1)} ${(60 + 70 * Math.sin(a2)).toFixed(1)} Z"/>`;
        }).join('') +
        `</g></g>` +
        `<circle cx="60" cy="60" r="57" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 1.1).toFixed(2)}"/>`,
    },
  },
};

// 저장된 값이 없거나 모르는 부품일 때 쓰는 기본값
export const DEFAULTS = {
  face: 'face_round', hair: 'hair_short', eyes: 'eyes_round', mouth: 'mouth_smile',
  outfit: 'outfit_tee', acc: 'acc_none', hat: 'hat_none', pet: 'pet_none', aura: 'aura_none', bg: 'bg_circle',
};
