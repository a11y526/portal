// 오델로 규칙: 8×8(64칸, 칸 = 행*8 + 열, 0 빈 칸 · 1 흑 · 2 백). 서버 _ot_flips·_ot_has_move와 똑같아야 함.
// 시작 배치: 정중앙 네 칸 (3,3)·(4,4) 백, (3,4)·(4,3) 흑. 흑이 먼저 둔다.
// 새로 놓는 돌과 내 돌 사이에 가로·세로·대각선으로 끼인 상대 돌을 모두 뒤집는다(하나 이상 뒤집히는 칸에만 둘 수 있음).
export const N = 8;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export function initialBoard() {
  const b = Array(N * N).fill(0);
  b[27] = 2; b[28] = 1;
  b[35] = 1; b[36] = 2;
  return b;
}

// cell(0~63)에 color(1 흑 | 2 백)를 놓았을 때 뒤집히는 칸 번호 목록. 빈 배열이면 둘 수 없는 칸
export function flips(board, cell, color) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= N * N || board[cell] !== 0) return [];
  const opp = 3 - color;
  const r0 = Math.floor(cell / N), c0 = cell % N;
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] === opp) {
      line.push(r * N + c);
      r += dr;
      c += dc;
    }
    if (line.length && r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] === color) {
      out.push(...line);
    }
  }
  return out;
}

// color가 지금 둘 수 있는 칸 번호 목록
export function validMoves(board, color) {
  const out = [];
  for (let i = 0; i < N * N; i++) {
    if (flips(board, i, color).length) out.push(i);
  }
  return out;
}

// 흑·백 돌 개수
export function counts(board) {
  let black = 0, white = 0;
  for (const v of board) {
    if (v === 1) black++;
    else if (v === 2) white++;
  }
  return { black, white };
}
