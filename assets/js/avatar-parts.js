// 캐릭터 부품 정의 (모두 이 프로젝트에서 새로 그린 도형)
// 좌표는 120×120 칸 기준. 얼굴 중심 x=60, 눈 높이 y=55, 입 y=67, 어깨 y≈88.
// k(그리기 도구): k.L / k.M / k.D = 망점 밝음·중간·어두움, k.ink = 검정, k.paper = 흰색,
//                 k.sw = 선 굵기, k.detail = 큰 크기에서만 그리는 잔선 여부
// 가격·등급·판매 여부는 Supabase avatar_items 표에서 관리한다.

export const SLOTS = ['face', 'hair', 'eyes', 'mouth', 'outfit', 'acc', 'bg'];

export const SLOT_NAMES = {
  face: '얼굴', hair: '머리', eyes: '눈', mouth: '입', outfit: '옷', acc: '소품', bg: '배경',
};

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
  },

  /* ---------- 소품 (상점 품목은 4단계에서 추가) ---------- */
  acc: {
    acc_none: { name: '없음' },
  },

  /* ---------- 배경 ---------- */
  bg: {
    bg_circle: {
      name: '연한 원',
      draw: (k) => `<circle cx="60" cy="60" r="58" fill="${k.L}" opacity=".5"/>`,
    },
  },
};

// 저장된 값이 없거나 모르는 부품일 때 쓰는 기본값
export const DEFAULTS = {
  face: 'face_round', hair: 'hair_short', eyes: 'eyes_round', mouth: 'mouth_smile',
  outfit: 'outfit_tee', acc: 'acc_none', bg: 'bg_circle',
};
