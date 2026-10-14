// 오목 엔진: 15×15, 자유룰(다섯 개 이상 이으면 승리), AI는 백·보통 난이도.
// 서버(03_functions.sql의 _omok_ai)가 같은 규칙으로 기보를 다시 두어 승리를 확인하므로,
// AI를 고치면 서버 함수도 똑같이 고쳐야 한다. 같은 판에는 늘 같은 수로 답한다(무작위 없음).
export const N = 15;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const at = (b, r, c) => (inside(r, c) ? b[r][c] : undefined);

export const emptyBoard = () => Array.from({ length: N }, () => Array(N).fill(null));

function run(b, r, c, dr, dc, p) {
  let n = 1, y = r + dr, x = c + dc;
  while (at(b, y, x) === p) { n++; y += dr; x += dc; }
  y = r - dr; x = c - dc;
  while (at(b, y, x) === p) { n++; y -= dr; x -= dc; }
  return n;
}

// (r, c)에 p가 놓였을 때 다섯 개 이상인지
export function isWin(b, r, c, p) {
  return DIRS.some(([dr, dc]) => run(b, r, c, dr, dc, p) >= 5);
}

// 이긴 줄의 칸들
export function winLine(b, r, c, p) {
  for (const [dr, dc] of DIRS) {
    const line = [[r, c]];
    let y = r + dr, x = c + dc;
    while (at(b, y, x) === p) { line.push([y, x]); y += dr; x += dc; }
    y = r - dr; x = c - dc;
    while (at(b, y, x) === p) { line.unshift([y, x]); y -= dr; x -= dc; }
    if (line.length >= 5) return line;
  }
  return [];
}

export const isFull = (b) => b.every((row) => row.every((v) => v !== null));

// 빈 칸 (r, c)의 p 쪽 모양 점수
function pattern(b, r, c, p) {
  let s = 0;
  for (const [dr, dc] of DIRS) {
    let n = 1, open = 0, y = r + dr, x = c + dc;
    while (at(b, y, x) === p) { n++; y += dr; x += dc; }
    if (at(b, y, x) === null) open++;
    y = r - dr; x = c - dc;
    while (at(b, y, x) === p) { n++; y -= dr; x -= dc; }
    if (at(b, y, x) === null) open++;
    if (n >= 5) s += 100000;
    else if (open === 0) s += n;
    else if (n === 4) s += open === 2 ? 50000 : 12000;
    else if (n === 3) s += open === 2 ? 5000 : 600;
    else if (n === 2) s += open === 2 ? 200 : 40;
    else s += open === 2 ? 20 : 5;
  }
  return s;
}

function near(b, r, c) {
  for (let y = Math.max(r - 2, 0); y <= Math.min(r + 2, N - 1); y++)
    for (let x = Math.max(c - 2, 0); x <= Math.min(c + 2, N - 1); x++)
      if (b[y][x] !== null) return true;
  return false;
}

// AI(백)의 다음 수 [행, 열] 또는 null. 돌에서 두 칸 안의 빈 칸만 위→아래, 왼→오 순서로 보고
// 바로 이기는 칸이 있으면 그 칸, 없으면 점수가 가장 높은 칸(같으면 먼저 본 칸)
export function aiMove(board) {
  const b = board.map((row) => [...row]);
  if (b.every((row) => row.every((v) => v === null))) return [7, 7];
  let best = null, top = -1;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (b[r][c] !== null || !near(b, r, c)) continue;
      if (isWin(b, r, c, 'white')) return [r, c];
      const score = pattern(b, r, c, 'white') + Math.floor((11 * pattern(b, r, c, 'black')) / 10)
        + (14 - (Math.abs(r - 7) + Math.abs(c - 7)));
      if (score > top) { top = score; best = [r, c]; }
    }
  }
  return best;
}
