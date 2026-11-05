// 윷놀이 규칙(말 길·빽도·쓸 수 있는 윷). 서버 _yt_route·_yt_dest·_yt_back·_yt_usable과 똑같아야 한다.
//
// 윷판 29밭(고정). 자리 번호:
//   둘레 0~19: 0 참먹이(오른쪽 아래, 출발·도착) → 1~4 오른쪽 위로 → 5 오른쪽 위 모서리 → 6~9 위쪽 왼쪽으로
//              → 10 왼쪽 위 모서리 → 11~14 왼쪽 아래로 → 15 왼쪽 아래 모서리 → 16~19 아래쪽 오른쪽으로 → 0
//   지름길 1: 5 → 20 → 21 → 22(방) → 23 → 24 → 15
//   지름길 2: 10 → 25 → 26 → 22(방) → 27 → 28 → 0
// 말 위치: -1 = 아직 안 나간 말, 0~28 = 판 위, 100 = 난 말(참먹이를 지나 나감)
// 모서리(5·10)나 방(22)에 딱 멈춘 말만 안쪽 길로 꺾는다. 방에서는 참먹이 쪽(27·28)으로.
// 참먹이(0)에 딱 멈추면 그 자리에 서 있고, 다음에 한 칸이라도 더 가야 난다.
// 윷 값: -1 빽도, 1 도, 2 개, 3 걸, 4 윷, 5 모. 윷·모는 한 번 더 던진다.

export const HOME = 100;
export const OFF = -1;
export const BACK = -1;

const OUTER_TO_0 = (from) => {
  const r = [];
  for (let i = from; i <= 19; i++) r.push(i);
  r.push(0);
  return r;
};

// 그 자리에서 앞으로 가는 길(밟는 자리 차례, 마지막은 참먹이 0)
export function route(pos) {
  if (pos === OFF) return OUTER_TO_0(1);
  if (pos === 5) return [20, 21, 22, 23, 24, ...OUTER_TO_0(15)];
  if (pos === 10) return [25, 26, 22, 27, 28, 0];
  if (pos === 22) return [27, 28, 0];
  if (pos === 20) return [21, 22, 23, 24, ...OUTER_TO_0(15)];
  if (pos === 21) return [22, 23, 24, ...OUTER_TO_0(15)];
  if (pos === 23) return [24, ...OUTER_TO_0(15)];
  if (pos === 24) return OUTER_TO_0(15);
  if (pos === 25) return [26, 22, 27, 28, 0];
  if (pos === 26) return [22, 27, 28, 0];
  if (pos === 27) return [28, 0];
  if (pos === 28) return [0];
  if (pos === 0) return [];
  if (pos >= 1 && pos <= 19) return OUTER_TO_0(pos + 1);
  return [];
}

// 빽도: 한 칸 뒤로. 방(22)에서는 21로, 참먹이(0)에서는 19로
const BACK_OF = { 0: 19, 5: 4, 10: 9, 15: 14, 20: 5, 21: 20, 22: 21, 23: 22, 24: 23, 25: 10, 26: 25, 27: 22, 28: 27 };
export function back(pos) {
  if (pos in BACK_OF) return BACK_OF[pos];
  if (pos >= 1 && pos <= 19) return pos - 1;
  return null;
}

// 말이 pos에서 n(−1 빽도, 1~5)만큼 가면 닿는 자리. 갈 수 없으면 null
export function dest(pos, n) {
  if (pos === HOME) return null;
  if (n === BACK) return pos === OFF ? null : back(pos);
  const r = route(pos);
  return n <= r.length ? r[n - 1] : HOME;
}

// 그 편 말 중 n으로 움직일 수 있는 말이 있는지
export function usable(pieces, team, n) {
  for (let i = team * 4; i < team * 4 + 4; i++) if (dest(pieces[i], n) != null) return true;
  return false;
}

export const NAME = { '-1': '빽도', 1: '도', 2: '개', 3: '걸', 4: '윷', 5: '모' };

// 판 그림 좌표(0~100)
export const XY = (() => {
  const p = {};
  p[0] = [100, 100];
  for (let i = 1; i <= 4; i++) p[i] = [100, 100 - i * 20];
  p[5] = [100, 0];
  for (let i = 6; i <= 9; i++) p[i] = [100 - (i - 5) * 20, 0];
  p[10] = [0, 0];
  for (let i = 11; i <= 14; i++) p[i] = [0, (i - 10) * 20];
  p[15] = [0, 100];
  for (let i = 16; i <= 19; i++) p[i] = [(i - 15) * 20, 100];
  const t = 100 / 6;
  p[20] = [100 - t, t]; p[21] = [100 - 2 * t, 2 * t]; p[22] = [50, 50]; p[23] = [2 * t, 100 - 2 * t]; p[24] = [t, 100 - t];
  p[25] = [t, t]; p[26] = [2 * t, 2 * t]; p[27] = [100 - 2 * t, 100 - 2 * t]; p[28] = [100 - t, 100 - t];
  return p;
})();
export const BIG = new Set([0, 5, 10, 15, 22]);
