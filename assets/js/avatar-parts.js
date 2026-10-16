// 캐릭터 부품 정의 (모두 이 프로젝트에서 새로 그린 도형)
// 좌표는 120×120 칸 기준. 얼굴 중심 x=60, 눈 높이 y=55, 입 y=67, 어깨 y≈88.
// k(그리기 도구): k.L / k.M / k.D = 망점 밝음·중간·어두움, k.ink = 검정, k.paper = 흰색,
//                 k.sw = 선 굵기, k.detail = 큰 크기에서만 그리는 잔선 여부,
//                 k.accent / k.gold = 강조색·금색 (희귀·전설 부품에만)
// 가격·등급·판매 여부는 Supabase avatar_items 표에서 관리한다.

export const SLOTS = ['face', 'hair', 'eyes', 'mouth', 'outfit', 'acc', 'bg'];

export const SLOT_NAMES = {
  face: '얼굴', hair: '머리', eyes: '눈', mouth: '입', outfit: '옷', acc: '소품', bg: '배경',
};

// 네 꼭짓점 반짝이 (x, y 중심, r 반지름)
const spark = (x, y, r, fill) =>
  `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${fill}"/>`;

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
    acc_crown: {
      name: '왕관',
      draw: (k) =>
        shape(k, 'M43.5 23 L41 7.5 L51 15 L60 3.5 L69 15 L79 7.5 L76.5 23 Z', k.gold) +
        shape(k, 'M43 22 H77 V27.5 H43 Z', k.gold) +
        [[41, 7.5], [60, 3.5], [79, 7.5]].map(([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="2.4" fill="${k.paper}" stroke="${k.ink}" stroke-width="${(k.sw * 0.7).toFixed(2)}"/>`).join('') +
        `<circle cx="60" cy="24.7" r="1.8" fill="${k.paper}"/>` +
        (k.detail ? line(k, 'M47 19 L46 13', 0.5) : ''),
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
    acc_cap: {
      name: '야구 모자',
      draw: (k) =>
        shape(k, 'M34 42 C33 25 45 16.5 60 16.5 C75 16.5 87 25 86 42 Z', k.M) +
        shape(k, 'M33 42 H87 Q92 42 91 46 Q60 50 29 46 Q28 42 33 42 Z', k.D) +
        `<circle cx="60" cy="17" r="2.2" fill="${k.ink}"/>` +
        (k.detail ? line(k, 'M60 18 C55 25 53 33 53 42 M60 18 C65 25 67 33 67 42', 0.5) : ''),
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
    acc_flask: {
      name: '빛나는 플라스크',
      layer: 'body',
      draw: (k) =>
        `<g style="${FLAT}" transform="translate(-5 -12)">` +
        `<path d="M82 94 V101 L75 115 Q74 118 77 118 H95 Q98 118 97 115 L90 101 V94 Z" fill="${k.paper}"/>` +
        `<path d="M79.2 108 H92.8 L96.2 115.2 Q97 117 95 117 H77 Q75 117 75.8 115.2 Z" fill="${k.accent}"/>` +
        shape(k, 'M82 94 V101 L75 115 Q74 118 77 118 H95 Q98 118 97 115 L90 101 V94', 'none') +
        line(k, 'M80.5 94 H91.5', 1) +
        `<circle cx="83" cy="112.5" r="1.4" fill="${k.paper}"/><circle cx="88.5" cy="110.5" r="1" fill="${k.paper}"/>` +
        spark(101, 96, k.detail ? 4 : 5, k.accent) + (k.detail ? spark(72, 99, 2.8, k.accent) : '') +
        `</g>`,
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
      draw: (k) =>
        `<circle cx="60" cy="60" r="58" fill="${k.M}" opacity=".7"/>` +
        `<circle cx="60" cy="60" r="57" fill="none" stroke="${k.gold}" stroke-width="${(k.sw * 0.9).toFixed(2)}"/>` +
        [[20, 30, 6], [98, 22, 7.5], [107, 62, 4.5], [13, 70, 4.5], [38, 10, 3.5], [82, 9, 3.5]]
          .map(([x, y, r]) => spark(x, y, k.detail ? r : r * 1.3, k.gold)).join('') +
        (k.detail ? [[28, 16], [94, 40], [24, 52], [104, 84], [16, 88]].map(([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="1.1" fill="${k.paper}"/>`).join('') : ''),
    },
  },
};

// 저장된 값이 없거나 모르는 부품일 때 쓰는 기본값
export const DEFAULTS = {
  face: 'face_round', hair: 'hair_short', eyes: 'eyes_round', mouth: 'mouth_smile',
  outfit: 'outfit_tee', acc: 'acc_none', bg: 'bg_circle',
};
