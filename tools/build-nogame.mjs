// 게임 없는 사본 만들기: node tools/build-nogame.mjs <내보낼 폴더>
// 다른 선생님용 저장소(a11y526/science-portal)에 올릴 파일을 만든다. 내보낼 폴더의 .git은 남기고 나머지는 새로 쓴다.
// - 게임 화면·엔진·그림과 이 사이트에만 쓰는 파일은 빼고(DROP)
// - HTML <!-- nogame:start --> … <!-- nogame:end -->, JS /* nogame:start */ … /* nogame:end */ 사이와 '// nogame'으로 끝나는 줄을 지우고
// - SQL은 게임 표·함수·설정 이름이 든 문장을 통째로 뺀다(classes.omok_open 열은 남김: 반 목록이 읽음)
// - 수업자료·시뮬레이션(lessons/, sims/)은 넘기지 않는다(2026-11-11 사용자 결정: 학습 자료는 따로 사이트에서 나눈다).
//   내보낼 폴더에 이미 있는 lessons/·sims/는 손대지 않고 그대로 둔다. 다시 넘기려면 아래 KEEP을 비운다
// 끝나면 남은 게임 이름·없는 import·문법 오류를 검사해서 하나라도 있으면 실패한다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSql, codeOf } from './sql-split.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || '');
if (!process.argv[2] || OUT === ROOT) throw new Error('내보낼 폴더를 주세요: node tools/build-nogame.mjs ../science-portal');
const REPO = 'science-portal';

const DROP = [
  /^games\.html$/, /^game-report\.html$/, /^omok(-online|-rank)?\.html$/, /^othello\.html$/, /^quoridor\.html$/, /^rummikub\.html$/, /^yut\.html$/, /^rpg-moon\.html$/,
  /^assets\/js\/(omok|omok-rank-view|othello|quoridor|rummikub|yut|rpg-moon|rpg-moon-data)\.js$/,
  /^assets\/js\/pages\/(games|omok|omok-online|omok-rank|othello|quoridor|rummikub|yut)\.js$/,
  /^assets\/img\/rpg\//, /^sims\/712_moon_rpg\.html$/,
  // 이 사이트에만 쓰는 것: 작업 기록·설계 문서·시안·진도 가져오기·패치·편집기 내려받기·이 도구
  /^CLAUDE\.md$/, /^시작하기\.md$/, /^PRODUCT\.md$/, /^docs\//, /^dist\//, /^tools\//,
  /^supabase\/05_progress_import\.sql$/, /^supabase\/08_share\.sql$/, /^assets\/js\/pages\/teacher-share\.js$/, /^supabase\/patch[_-]/,
  // 웹 설치 화면·중계는 원래 사이트(a11y526.github.io/portal/install/)에서만 돈다
  /^install\/(index\.html|install\.js|config\.js)$/, /^supabase\/functions\/setup-relay\//,
];
// 넘기지 않고, 내보낼 폴더에 있는 것을 그대로 두는 폴더
const KEEP = ['lessons', 'sims'];
const GAME_SQL = /\b(public\.)?(_?omok_(?!open)\w*|get_omok\w*|start_omok|submit_omok|_?om_\w+|_?ot_\w+|_?rk_\w+|_?qd_\w+|_?yt_\w+|_?moon_rpg\w*|get_moon_rpg_class)\b|'(omok|omok_pvp|rummikub|quoridor|othello|yut|moon_rpg|game_xp_off)'/;
// 사본에 남으면 안 되는 이름(화면·스크립트). CSS는 퀴즈 화면이 오목 칸 모양(.omok-*)을 같이 써서 검사에서 뺀다
const LEFTOVER = /games\.html|omok\.html|omok-online|omok-rank|othello|quoridor|rummikub|yut\.|yut\.html|rpg-moon|moon_rpg|moonRpg|MoonRpg|getOmok|setOmokOpen|OmokRules|오목|오델로|루미큐브|쿼리도|윷놀이|달 자원 RPG/;

// 커밋된 파일만 쓴다(HEAD). 다른 창에서 고치는 중인 것이 다른 선생님 사이트·서버로 가지 않게
const files = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
  .filter((f) => !DROP.some((re) => re.test(f)) && !KEEP.includes(f.split('/')[0]));
// 설치·자동 업데이트 파일은 이 스크립트와 같이 고치므로 폴더의 지금 파일을 쓴다(아직 커밋 전이어도)
const LOCAL = ['CLAUDE_INSTALL.md', 'supabase/06_auto_update.sql', 'install/설치.bat', 'install/install.ps1', 'install/sync-upstream.yml', 'install/README.md'];
for (const f of LOCAL) {
  if (!existsSync(join(ROOT, f))) throw new Error(`${f}가 없어요`);
  if (!files.includes(f)) files.push(f);
}
const fromHead = (f) => LOCAL.includes(f) ? readFileSync(join(ROOT, f)) : execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

function stripMarked(text, path) {
  const html = /\.html?$/.test(path);
  const [a, b] = html ? ['<!-- nogame:start -->', '<!-- nogame:end -->'] : ['/* nogame:start */', '/* nogame:end */'];
  const out = [];
  let skip = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === a) { if (skip) throw new Error(`${path}: 표시 시작이 겹침`); skip = true; continue; }
    if (t === b) { if (!skip) throw new Error(`${path}: 표시 끝만 있음`); skip = false; continue; }
    if (skip) continue;
    if (!html && /\/\/ nogame\s*$/.test(line)) continue;
    out.push(line);
  }
  if (skip) throw new Error(`${path}: 표시 끝이 없음`);
  return out.join('\n');
}

function stripSql(text) {
  return splitSql(text).filter((s) => !GAME_SQL.test(codeOf(s))).join('');
}

// 설치 안내: 저장소 이름을 바꾼다
function fixInstallDoc(text) {
  return text
    .replaceAll('a11y526/portal', `a11y526/${REPO}`)
    .replaceAll('<계정>/portal', `<계정>/${REPO}`)
    .replaceAll('github.io/portal/', `github.io/${REPO}/`)
    .replace('(이름은 그대로 `portal`)', `(이름은 그대로 \`${REPO}\`)`);
}

// 내보낼 폴더 비우기(.git은 남김)
mkdirSync(OUT, { recursive: true });
for (const e of readdirSync(OUT)) if (e !== '.git' && !KEEP.includes(e)) rmSync(join(OUT, e), { recursive: true, force: true });

let marked = 0;
for (const f of files) {
  const src = join(ROOT, f), dst = join(OUT, f === 'install/sync-upstream.yml' ? '.github/workflows/sync-upstream.yml' : f === 'install/README.md' ? 'README.md' : f);
  mkdirSync(dirname(dst), { recursive: true });
  if (/\.(html?|js|mjs)$/.test(f)) {
    const t = fromHead(f).toString('utf8');
    let s = stripMarked(t, f);
    if (f === 'assets/js/site.js') s = s.replace(/export const SUPABASE_URL = .*/, "export const SUPABASE_URL = 'YOUR-PROJECT-URL';")
      .replace(/export const SUPABASE_ANON_KEY = .*/, "export const SUPABASE_ANON_KEY = 'YOUR-PUBLISHABLE-KEY';")
      .replace(/export const CLASSES = .*/, 'export const CLASSES = [1, 2, 3, 4, 5, 6];');
    if (s !== t) marked++;
    writeFileSync(dst, s);
  } else if (/^supabase\/0[1-4]_\w+\.sql$/.test(f)) {
    writeFileSync(dst, stripSql(fromHead(f).toString('utf8')));
  } else if (f === 'CLAUDE_INSTALL.md') {
    writeFileSync(dst, fixInstallDoc(fromHead(f).toString('utf8')));
  } else {
    writeFileSync(dst, fromHead(f));
  }
}

// ---------- 검사
const problems = [];
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === '.git' ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const all = walk(OUT);
const exportsOf = new Map();
for (const p of all.filter((p) => p.endsWith('.js'))) {
  const t = readFileSync(p, 'utf8');
  exportsOf.set(p, new Set([...t.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
    .concat([...t.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)))));
}
for (const p of all) {
  const rel = relative(OUT, p);
  if (!/\.(html?|js)$/.test(p)) continue;
  const t = readFileSync(p, 'utf8');
  // 학습지용 시뮬레이션·수업자료 HTML은 내용(달·태양 등)을 다루므로 이름 검사에서 뺀다
  if (!/^(lessons|sims)\//.test(rel) && rel !== 'editor.html') {
    t.split('\n').forEach((line, i) => { if (LEFTOVER.test(line)) problems.push(`${rel}:${i + 1} 게임 이름이 남음: ${line.trim().slice(0, 90)}`); });
  }
  // 상대 경로 링크(HTML)·import(JS)가 가리키는 파일이 있는지. 수업자료·시뮬레이션은 자기 규칙대로 주소를 써서 뺀다
  if (/^(lessons|sims)\//.test(rel)) continue;
  const linkRe = p.endsWith('.js') ? /from\s+'(\.[^']+)'/g : /(?:href|src)="([^"#?:]+\.(?:html|js))"/g;
  for (const m of t.matchAll(linkRe)) {
    const ref = m[1];
    if (/^(https?:|\/\/)/.test(ref) || ref.includes('${')) continue;
    if (!existsSync(resolve(dirname(p), ref))) problems.push(`${rel}: 없는 파일을 가리킴 ${ref}`);
  }
  if (p.endsWith('.js')) {
    for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
      const target = resolve(dirname(p), m[2]);
      const ex = exportsOf.get(target);
      if (!ex) continue;
      for (const name of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        if (!ex.has(name)) problems.push(`${rel}: ${m[2]}에 없는 이름을 가져옴 ${name}`);
      }
    }
    try { execFileSync(process.execPath, ['--input-type=module', '--check'], { input: t, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { problems.push(`${rel}: 문법 오류 ${String(e.stderr).trim().split('\n').slice(0, 3).join(' ')}`); }
  }
}
for (const f of ['01_schema', '02_policies', '03_functions', '04_seed']) {
  const t = readFileSync(join(OUT, 'supabase', f + '.sql'), 'utf8');
  if (GAME_SQL.test(codeOf(t))) problems.push(`supabase/${f}.sql: 게임 SQL이 남음`);
}

console.log(`파일 ${files.length}개 → ${OUT} (게임 표시를 지운 파일 ${marked}개)`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('검사 통과');
