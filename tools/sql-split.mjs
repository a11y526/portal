// SQL을 문장 단위로 나눈다(주석·작은따옴표·달러 따옴표 안의 ;는 건너뜀). 각 문장 앞의 주석 줄은 그 문장에 붙인다.
export function splitSql(text) {
  const out = [];
  let i = 0, start = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') { const j = text.indexOf('\n', i); i = j < 0 ? n : j + 1; continue; }
    if (c === '/' && text[i + 1] === '*') { const j = text.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === "'") { i++; while (i < n) { if (text[i] === "'" && text[i + 1] === "'") { i += 2; continue; } if (text[i] === "'") { i++; break; } i++; } continue; }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) { const tag = m[0]; const j = text.indexOf(tag, i + tag.length); i = j < 0 ? n : j + tag.length; continue; }
    }
    if (c === ';') {
      let j = i + 1;
      // 같은 줄 끝까지(줄 끝 주석 포함)는 이 문장에 붙인다
      const nl = text.indexOf('\n', j);
      const rest = text.slice(j, nl < 0 ? n : nl);
      if (/^\s*(--.*)?$/.test(rest)) j = nl < 0 ? n : nl + 1;
      out.push(text.slice(start, j));
      start = j; i = j; continue;
    }
    i++;
  }
  if (start < n) out.push(text.slice(start));
  return out;
}
// 문장의 주석·문자열을 뺀 본문(이름 찾기용)
export function codeOf(stmt) {
  return stmt.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
