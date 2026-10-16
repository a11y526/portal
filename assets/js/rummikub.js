// 루미큐브 규칙(화면용). 서버 _rk_set_value·_rk_check_play와 똑같아야 한다.
// 타일 번호 0~105: 0~103은 숫자 타일(숫자 = t % 13 + 1, 색 = floor(t / 13) % 4), 104·105는 조커.
// 색: 0 검정, 1 빨강, 2 파랑, 3 주황. 같은 타일이 두 장씩(0~51, 52~103).

export const JOKERS = [104, 105];
export const COLORS = ['black', 'red', 'blue', 'orange'];
export const COLOR_KO = ['검정', '빨강', '파랑', '주황'];
export const FIRST_MELD = 30;

export const isJoker = (t) => t >= 104;
export const num = (t) => (isJoker(t) ? 0 : (t % 13) + 1);
export const color = (t) => (isJoker(t) ? -1 : Math.floor(t / 13) % 4);

// 세트 해석: { kind: 'group'|'run', value(점수), order(보여 줄 순서), reps(조커가 나타내는 숫자) } 또는 null
// 그룹: 3~4장, 같은 숫자, 색이 모두 다름. 줄: 3~13장, 같은 색, 이어진 숫자(조커가 빈 곳을 채우고 남으면 위로, 13을 넘으면 아래로).
// 둘 다 되면 점수가 큰 쪽(같으면 줄).
export function readSet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return null;
  const jokers = tiles.filter(isJoker);
  const plain = tiles.filter((t) => !isJoker(t));
  if (!plain.length) return null;
  let group = null, run = null;

  const n0 = num(plain[0]);
  if (tiles.length <= 4 && plain.every((t) => num(t) === n0)
      && new Set(plain.map(color)).size === plain.length) {
    const order = [...plain].sort((a, b) => color(a) - color(b) || a - b).concat(jokers);
    group = { kind: 'group', value: n0 * tiles.length, order, reps: jokers.map(() => n0) };
  }

  const c0 = color(plain[0]);
  const nums = plain.map(num);
  if (tiles.length <= 13 && plain.every((t) => color(t) === c0) && new Set(nums).size === nums.length) {
    const lo0 = Math.min(...nums), hi0 = Math.max(...nums);
    if (hi0 - lo0 + 1 <= tiles.length) {
      let lo = lo0, hi = lo0 + tiles.length - 1;
      if (hi > 13) { hi = 13; lo = 14 - tiles.length; }
      const byNum = new Map(plain.map((t) => [num(t), t]));
      const order = [], reps = [];
      let j = 0;
      for (let n = lo; n <= hi; n++) {
        if (byNum.has(n)) order.push(byNum.get(n));
        else { order.push(jokers[j++]); reps.push(n); }
      }
      run = { kind: 'run', value: ((lo + hi) * tiles.length) / 2, order, reps };
    }
  }
  if (group && run) return group.value > run.value ? group : run;
  return group || run;
}

export const setValue = (tiles) => readSet(tiles)?.value ?? null;

// 남은 손패 점수(끝났을 때). 조커 30
export const rackPoints = (rack) => rack.reduce((s, t) => s + (isJoker(t) ? 30 : num(t)), 0);

const sameSet = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).every((t, i) => t === [...b].sort((x, y) => x - y)[i]);

// 이번 턴에 낸 판이 맞는지(서버 _rk_check_play와 같은 순서로 검사)
// before: 턴 시작 때 판, after: 지금 판, rack: 턴 시작 때 손패, melded: 첫 등록을 했는지
// 결과: { ok: true, played: [타일], meld(첫 등록 점수) } 또는 { ok: false, error, bad: [세트 번호] }
//   NONE 낸 타일 없음 · BAD_SET 맞지 않는 세트 · LOST 판의 타일이 사라짐 · NOT_MINE 내 타일이 아님
//   FIRST_TOUCH 첫 등록 전에는 판의 세트를 건드릴 수 없음 · FIRST_30 첫 등록은 내 타일로 30점 이상
export function checkPlay(before, after, rack, melded) {
  const flat = after.flat();
  if (new Set(flat).size !== flat.length) return { ok: false, error: 'LOST', bad: [] };
  const old = new Set(before.flat());
  const mine = new Set(rack);
  for (const t of old) if (!flat.includes(t)) return { ok: false, error: 'LOST', bad: [] };
  const played = flat.filter((t) => !old.has(t));
  if (played.some((t) => !mine.has(t))) return { ok: false, error: 'NOT_MINE', bad: [] };
  const bad = after.map((s, i) => (readSet(s) ? -1 : i)).filter((i) => i >= 0);
  if (bad.length) return { ok: false, error: 'BAD_SET', bad };
  if (!played.length) return { ok: false, error: 'NONE', bad: [] };
  let meld = 0;
  if (!melded) {
    // 턴 시작 때 세트가 모두 그대로 있어야 하고, 새 세트는 내 타일로만
    const left = after.map((s) => s);
    for (const s of before) {
      const i = left.findIndex((x) => x && sameSet(x, s));
      if (i < 0) return { ok: false, error: 'FIRST_TOUCH', bad: [] };
      left[i] = null;
    }
    for (const s of left) if (s) meld += setValue(s);
    if (meld < FIRST_MELD) return { ok: false, error: 'FIRST_30', bad: [], meld };
  }
  return { ok: true, played, meld };
}

// 정렬: '777'(숫자 먼저) 또는 '789'(색 먼저), 조커는 맨 뒤
export function sortRack(rack, mode) {
  return [...rack].sort((a, b) => {
    if (isJoker(a) || isJoker(b)) return (isJoker(a) - isJoker(b)) || a - b;
    return mode === '777'
      ? num(a) - num(b) || color(a) - color(b) || a - b
      : color(a) - color(b) || num(a) - num(b) || a - b;
  });
}
