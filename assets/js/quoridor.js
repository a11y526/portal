// 쿼리도 규칙. 서버 _qd_blocked·_qd_wall_fits·_qd_moves·_qd_path와 똑같아야 함.
// 칸 = 행*9 + 열(0~80, 0행이 위). 벽 = 방향*64 + 행*8 + 열(행·열 0~7).
//   가로 벽(방향 0): 행 r과 r+1 사이, 열 c·c+1을 막음. 세로 벽(방향 1): 열 c와 c+1 사이, 행 r·r+1을 막음.
// 자리 0 아래 → 위, 1 왼쪽 → 오른쪽, 2 위 → 아래, 3 오른쪽 → 왼쪽. 2명이면 자리 0·2.
export const N = 9;
export const START = [76, 36, 4, 44];
export const WALLS = { 2: 10, 4: 5 };
const DR = [-1, 0, 1, 0];   // 방향: 0 위 · 1 오른쪽 · 2 아래 · 3 왼쪽
const DC = [0, 1, 0, -1];

const has = (walls, o, r, c) => r >= 0 && r < 8 && c >= 0 && c < 8 && walls.has(o * 64 + r * 8 + c);

export function blocked(walls, cell, d) {
  const r = Math.floor(cell / N), c = cell % N;
  if (d === 0) return r === 0 || has(walls, 0, r - 1, c) || has(walls, 0, r - 1, c - 1);
  if (d === 2) return r === 8 || has(walls, 0, r, c) || has(walls, 0, r, c - 1);
  if (d === 1) return c === 8 || has(walls, 1, r, c) || has(walls, 1, r - 1, c);
  return c === 0 || has(walls, 1, r, c - 1) || has(walls, 1, r - 1, c - 1);
}

export const step = (cell, d) => cell + DR[d] * N + DC[d];

// 놓을 수 있는 자리인지(겹침·교차만. 길 막힘은 따로)
export function wallFits(walls, code) {
  if (!Number.isInteger(code) || code < 0 || code > 127 || walls.has(code)) return false;
  const o = code >> 6, r = (code >> 3) & 7, c = code & 7;
  if (o === 0) return !has(walls, 0, r, c - 1) && !has(walls, 0, r, c + 1) && !has(walls, 1, r, c);
  return !has(walls, 1, r - 1, c) && !has(walls, 1, r + 1, c) && !has(walls, 0, r, c);
}

// 갈 수 있는 칸. occ = 다른 말이 있는 칸(Set). 앞에 말이 있으면 뛰어넘고, 그 뒤가 벽·판 끝·말이면 옆으로
export function moves(walls, occ, cell) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    if (blocked(walls, cell, d)) continue;
    const n = step(cell, d);
    if (!occ.has(n)) { out.push(n); continue; }
    if (!blocked(walls, n, d) && !occ.has(step(n, d))) { out.push(step(n, d)); continue; }
    for (const s of [(d + 1) % 4, (d + 3) % 4]) {
      if (!blocked(walls, n, s) && !occ.has(step(n, s))) out.push(step(n, s));
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function isGoal(seat, cell) {
  const r = Math.floor(cell / N), c = cell % N;
  return seat === 0 ? r === 0 : seat === 1 ? c === 8 : seat === 2 ? r === 8 : c === 0;
}

// 말을 빼고 벽만 보고 도착 줄까지 길이 있는지
export function hasPath(walls, cell, seat) {
  const seen = new Set([cell]);
  const q = [cell];
  while (q.length) {
    const x = q.shift();
    if (isGoal(seat, x)) return true;
    for (let d = 0; d < 4; d++) {
      if (blocked(walls, x, d)) continue;
      const n = step(x, d);
      if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  return false;
}

// 벽을 놓을 수 있는지(겹침 + 남아 있는 모든 말의 길). pawns = [{seat, cell}]
export function wallOk(walls, code, pawns) {
  if (!wallFits(walls, code)) return false;
  const next = new Set(walls);
  next.add(code);
  return pawns.every((p) => hasPath(next, p.cell, p.seat));
}
