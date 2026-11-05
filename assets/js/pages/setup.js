// 설치 도우미: 다른 선생님이 복사(Fork)한 사이트를 자기 Supabase 서버로 처음 설정한다.
// 이 화면은 site.js·config.js·db.js를 쓰지 않는다(복사한 직후의 site.js는 원래 사이트 서버를 가리키므로).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';

const $ = (id) => document.getElementById(id);
const ORIGINAL_URL = 'https://sxejmhkevefwnpwldczt.supabase.co';
const SQL_FILES = ['01_schema.sql', '02_policies.sql', '03_functions.sql', '04_seed.sql'];
const CLASS_RE = /unnest\(array\[[0-9, ]+\]\)/g;
const DRAFT = 'setup-draft';

let sb = null;      // 입력한 주소·키로 만든 클라이언트
let conn = null;    // 연결을 확인한 { url, key }

function msg(n, text, kind = '') {
  const el = $('m' + n);
  el.textContent = text;
  el.className = 'msg' + (kind ? ' ' + kind : '');
}
function state(n, text, kind = '') {
  const el = $('st' + n);
  el.textContent = text;
  el.className = 'state' + (kind ? ' ' + kind : '');
  $('s' + n).classList.toggle('done', kind === 'ok');
}
async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---- 기기에 적어 두기(주소·키·반만. 코드·비밀번호는 저장하지 않음)
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch { return {}; }
}
function saveDraft() {
  try {
    localStorage.setItem(DRAFT, JSON.stringify({ url: $('in-url').value.trim(), key: $('in-key').value.trim(), classes: pickedClasses() }));
  } catch { /* 저장 못 해도 화면은 그대로 */ }
}

// ---- 1. 서버 연결
function cleanUrl(s) {
  return s.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}
function checkInputs(url, key) {
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) return 'Project URL은 https://(영문 20자).supabase.co 모양이어야 해요.';
  if (url === ORIGINAL_URL) return '이 주소는 원래 사이트의 서버예요. 내 Supabase 프로젝트의 주소를 넣어 주세요.';
  if (key.startsWith('sb_secret_')) return 'secret 키예요. 이 키는 넣으면 안 돼요. Publishable key를 넣어 주세요.';
  if (key.startsWith('eyJ')) {
    try {
      const role = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role;
      if (role !== 'anon') return 'service_role 키예요. 이 키는 넣으면 안 돼요. anon public 키를 넣어 주세요.';
    } catch { return '키 모양이 맞지 않아요.'; }
  } else if (!key.startsWith('sb_publishable_')) {
    return 'Publishable key는 sb_publishable_로 시작해요.';
  }
  return '';
}
async function status() {
  const { data, error } = await sb.rpc('setup_status');
  if (!error) return data;
  if (error.code === 'PGRST202' || /setup_status/.test(error.message || '')) return { installed: false };
  throw error;
}
async function connect() {
  const url = cleanUrl($('in-url').value);
  const key = $('in-key').value.trim();
  $('in-url').value = url;
  conn = null;
  const bad = checkInputs(url, key);
  if (bad) { state(1, '확인 필요', 'bad'); msg(1, bad, 'bad'); return; }
  msg(1, '확인하는 중…');
  sb = createClient(url, key);
  try {
    const st = await status();
    conn = { url, key };
    saveDraft();
    state(1, '연결됨', 'ok');
    msg(1, st.installed ? '연결됐어요. 이 서버에는 이미 설치되어 있어요.' : '연결됐어요. 아직 설치 전인 서버예요.', 'ok');
    if (st.installed) showInstalled(st);
  } catch (e) {
    sb = null;
    state(1, '확인 필요', 'bad');
    const m = String(e?.message || e);
    msg(1, /Invalid API key|JWT|401|apikey/i.test(m) || e?.code === '401'
      ? '키가 맞지 않아요. 같은 프로젝트의 Publishable key인지 확인해 주세요.'
      : '서버에 연결하지 못했어요. Project URL을 다시 확인해 주세요. (' + m + ')', 'bad');
  }
}
function needConn(n) {
  if (conn) return true;
  msg(n, '1번에서 먼저 연결 확인을 눌러 주세요.', 'bad');
  return false;
}

// ---- 2. 반·체험 코드
function buildClassPick(picked) {
  const box = $('cls-pick');
  for (let n = 1; n <= 15; n++) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${n}"${picked.includes(n) ? ' checked' : ''}>${n}반`;
    box.append(label);
  }
  box.addEventListener('change', () => { saveDraft(); checkStep2(false); });
}
function pickedClasses() {
  return [...document.querySelectorAll('#cls-pick input:checked')].map((i) => Number(i.value));
}
function checkStep2(show = true) {
  const cls = pickedClasses();
  const code = $('in-code').value.trim();
  let bad = '';
  if (!cls.length) bad = '담당 반을 하나 이상 골라 주세요.';
  else if (!/^[0-9]{6}$/.test(code)) bad = '선생님 체험 코드는 숫자 6자리예요.';
  if (bad) {
    state(2, '아직');
    if (show) msg(2, bad, 'bad');
    return null;
  }
  state(2, cls.map((n) => n + '반').join(' · '), 'ok');
  msg(2, '');
  return { cls, code };
}

// ---- 3. 설치 SQL
let sqlText = '';
async function makeSql() {
  if (!needConn(3)) return;
  const s2 = checkStep2();
  if (!s2) { msg(3, '2번을 먼저 채워 주세요.', 'bad'); return; }
  msg(3, '만드는 중…');
  const parts = [];
  for (const f of SQL_FILES) {
    let r;
    try {
      r = await fetch(new URL('supabase/' + f, location.href).href, { cache: 'no-store' });
    } catch (e) {
      msg(3, `${f} 파일을 읽지 못했어요. 인터넷 연결을 확인해 주세요. (${e?.message || e})`, 'bad');
      return;
    }
    if (!r.ok) { msg(3, `${f} 파일을 읽지 못했어요(${r.status}). 사이트가 다 올라갔는지 확인해 주세요.`, 'bad'); return; }
    let t = await r.text();
    if (f === '04_seed.sql') {
      const hits = t.match(CLASS_RE) || [];
      if (hits.length !== 1) { msg(3, '04_seed.sql에서 반 목록 줄을 찾지 못했어요. 원래 사이트 선생님께 알려 주세요.', 'bad'); return; }
      t = t.replace(CLASS_RE, `unnest(array[${s2.cls.join(', ')}])`);
    }
    t = t.split(ORIGINAL_URL).join(conn.url);
    parts.push(`-- ===== ${f} =====\n${t}`);
  }
  parts.push(`-- ===== 선생님 체험 계정(0번)·test반 코드 =====
update public.students set code_hash = extensions.crypt('${s2.code}', extensions.gen_salt('bf'))
where number = 0 or class_id = 20;
delete from public.student_sessions where student_id in (select id from public.students where number = 0 or class_id = 20);`);
  sqlText = `-- 과학 수업 포털 설치 SQL (설치 도우미가 만듦). 담당 반: ${s2.cls.join(', ')}\n`
    + `-- 이 파일에는 선생님 체험 코드가 들어 있어요. 실행한 뒤 지우고, 다른 사람에게 보내지 마세요.\n\n`
    + parts.join('\n\n') + '\n';
  const out = $('sql-out');
  out.value = sqlText;
  out.classList.remove('hidden');
  $('b-copy').classList.remove('hidden');
  $('b-dl-sql').classList.remove('hidden');
  msg(3, `만들었어요(${Math.round(sqlText.length / 1024)}KB). 복사해서 SQL Editor에 붙여 넣어 주세요.`, 'ok');
}
async function copySql() {
  try {
    await navigator.clipboard.writeText(sqlText);
    msg(3, '복사했어요. SQL Editor에 붙여 넣고 Run을 눌러 주세요.', 'ok');
  } catch {
    $('sql-out').select();
    msg(3, '자동 복사가 막혔어요. 칸 안을 누르고 ⌘A(Ctrl+A) → ⌘C(Ctrl+C)로 복사해 주세요.', 'bad');
  }
}
function showInstalled(st) {
  if (!st.seeded) { state(3, '확인 필요', 'bad'); msg(3, '설치가 중간에 멈췄어요. 설치 SQL을 다시 한 번 Run 해 주세요.', 'bad'); return false; }
  state(3, '설치됨', 'ok');
  msg(3, '설치됐어요. 서버의 반: ' + st.classes.map((n) => n + '반').join(', '), 'ok');
  if (st.has_teacher) { state(4, '등록됨', 'ok'); }
  return true;
}
async function checkInstall() {
  if (!needConn(3)) return;
  msg(3, '확인하는 중…');
  try {
    const st = await status();
    if (!st.installed) { state(3, '아직'); msg(3, '아직 설치 전이에요. 설치 SQL을 SQL Editor에서 Run 했는지 확인해 주세요.', 'bad'); return; }
    showInstalled(st);
  } catch (e) {
    msg(3, '확인하지 못했어요: ' + (e?.message || e), 'bad');
  }
}

// ---- 4. 교사 계정
function readAccount() {
  const email = $('in-mail').value.trim();
  const password = $('in-pw').value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg(4, '이메일을 확인해 주세요.', 'bad'); return null; }
  if (password.length < 8) { msg(4, '비밀번호는 8자 이상이에요.', 'bad'); return null; }
  return { email, password };
}
async function claim() {
  const { data, error } = await sb.rpc('claim_first_teacher');
  if (error) {
    msg(4, /claim_first_teacher/.test(error.message || '') ? '3번 설치를 먼저 끝내 주세요.' : '등록하지 못했어요: ' + error.message, 'bad');
    return;
  }
  if (data?.ok) {
    state(4, '등록됨', 'ok');
    msg(4, data.already ? '이미 교사로 등록된 계정이에요.' : '교사로 등록했어요. 관리 화면에서 이 계정으로 로그인합니다.', 'ok');
  } else if (data?.error === 'TAKEN') {
    msg(4, '이 서버에는 이미 다른 교사 계정이 등록되어 있어요. 그 계정으로 로그인해 주세요.', 'bad');
  } else {
    msg(4, '로그인 상태가 아니에요. 다시 시도해 주세요.', 'bad');
  }
}
async function signUp() {
  if (!needConn(4)) return;
  const acc = readAccount();
  if (!acc) return;
  msg(4, '만드는 중…');
  const { data, error } = await sb.auth.signUp({ ...acc, options: { emailRedirectTo: new URL('setup.html', location.href).href } });
  if (error) {
    msg(4, /registered|exists/i.test(error.message) ? '이미 있는 계정이에요. 로그인하고 교사 등록을 눌러 주세요.' : '계정을 만들지 못했어요: ' + error.message, 'bad');
    return;
  }
  if (data.session) { await claim(); return; }
  state(4, '메일 확인', '');
  msg(4, `${acc.email}로 확인 메일을 보냈어요. 메일 속 링크를 누른 뒤 여기서 로그인하고 교사 등록을 눌러 주세요.`, 'ok');
}
async function signInAndClaim() {
  if (!needConn(4)) return;
  const acc = readAccount();
  if (!acc) return;
  msg(4, '로그인하는 중…');
  const { error } = await sb.auth.signInWithPassword(acc);
  if (error) {
    msg(4, /confirm/i.test(error.message) ? '아직 메일 확인 전이에요. 받은 메일의 링크를 먼저 눌러 주세요.'
      : /invalid/i.test(error.message) ? '이메일이나 비밀번호가 맞지 않아요.' : '로그인하지 못했어요: ' + error.message, 'bad');
    return;
  }
  await claim();
}

// ---- 5. site.js
function siteJs() {
  const cls = pickedClasses();
  return `// 이 사이트만의 값. 설치 도우미(setup.html)가 만든 파일로 통째로 바꾼다.
// Project URL과 공개(publishable) 키만 넣는다. service_role(secret) 키는 절대 넣지 않는다.
export const SUPABASE_URL = '${conn.url}';
export const SUPABASE_ANON_KEY = '${conn.key}';
export const CLASSES = [${cls.join(', ')}];
`;
}
function dlSite() {
  if (!needConn(5)) return;
  if (!pickedClasses().length) { msg(5, '2번에서 담당 반을 골라 주세요.', 'bad'); return; }
  download('site.js', siteJs(), 'text/javascript');
  msg(5, 'site.js를 받았어요. GitHub의 assets/js 폴더에 올려 주세요.', 'ok');
}
async function checkSite() {
  if (!needConn(5)) return;
  msg(5, '확인하는 중…');
  try {
    const r = await fetch(new URL('assets/js/site.js', location.href).href + '?t=' + Date.now(), { cache: 'no-store' });
    const t = r.ok ? await r.text() : '';
    if (t.includes(`'${conn.url}'`)) {
      const want = `[${pickedClasses().join(', ')}]`;
      state(5, '바뀜', 'ok');
      msg(5, t.includes(want) ? '사이트가 내 서버로 바뀌었어요.' : '사이트가 내 서버로 바뀌었어요. 다만 반 목록이 2번에서 고른 것과 달라요. site.js를 다시 받아 올려 주세요.', t.includes(want) ? 'ok' : 'bad');
    } else {
      state(5, '아직');
      msg(5, '아직 예전 site.js예요. 올린 지 얼마 안 됐으면 몇 분 뒤에 다시 눌러 주세요.', 'bad');
    }
  } catch (e) {
    msg(5, '확인하지 못했어요: ' + (e?.message || e), 'bad');
  }
}

// ---- 시작
const draft = loadDraft();
$('in-url').value = draft.url || '';
$('in-key').value = draft.key || '';
buildClassPick(Array.isArray(draft.classes) ? draft.classes : []);
checkStep2(false);
$('in-code').addEventListener('input', () => checkStep2(false));
$('in-url').addEventListener('change', saveDraft);
$('in-key').addEventListener('change', saveDraft);
$('b-conn').addEventListener('click', (e) => busy(e.currentTarget, connect));
$('b-sql').addEventListener('click', (e) => busy(e.currentTarget, makeSql));
$('b-copy').addEventListener('click', copySql);
$('b-dl-sql').addEventListener('click', () => download('portal-install.sql', sqlText, 'text/plain'));
$('b-check').addEventListener('click', (e) => busy(e.currentTarget, checkInstall));
$('b-signup').addEventListener('click', (e) => busy(e.currentTarget, signUp));
$('b-claim').addEventListener('click', (e) => busy(e.currentTarget, signInAndClaim));
$('b-dl-site').addEventListener('click', dlSite);
$('b-site').addEventListener('click', (e) => busy(e.currentTarget, checkSite));
if (draft.url && draft.key) connect();
