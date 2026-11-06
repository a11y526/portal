// 과학 수업 포털 만들기(웹). install.ps1과 같은 순서를 브라우저에서 한다.
// GitHub·Supabase는 로그인 앱(OAuth)으로 연결. 토큰은 이 탭(sessionStorage)에만 두고, 끝나면 지운다.
// 체험 코드·비밀번호는 메모리에만. 사이트 파일에는 공개(publishable) 키만 넣는다(secret 키는 받지도 않음).
import { CONFIG as C } from './config.js';

const $ = (id) => document.getElementById(id);
const KEY = 'sp-install';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; } };
const S = load();
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
const here = location.origin + location.pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); };
function b64url(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64utf8(text) { let s = ''; for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b); return btoa(s); }
function unb64utf8(b64) { return new TextDecoder().decode(Uint8Array.from(atob(String(b64 || '').replace(/\s/g, '')), (c) => c.charCodeAt(0))); }
class Stop extends Error {}
const fail = (t) => { throw new Stop(t); };

// ---------- 중계·GitHub·Supabase 부르기
async function relay(route, body) {
  let r;
  try { r = await fetch(C.relay + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { fail('설치 서버에 연결하지 못했어요. 인터넷을 확인하고 다시 해 주세요.'); }
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, ...d };
}
async function sb(method, path, body) {
  const d = await relay('/sb', { token: S.sb?.token, method, path, body });
  if (d.error) fail(`Supabase 요청을 보내지 못했어요(${d.error}).`);
  let data = null; try { data = d.body ? JSON.parse(d.body) : null; } catch { data = d.body; }
  if (d.status === 401) { delete S.sb; save(); fail('Supabase 연결이 끝났어요. 2번에서 다시 연결해 주세요.'); }
  return { code: d.status, data, text: d.body || '' };
}
async function gh(method, path, body) {
  let r;
  try {
    r = await fetch(C.ghApi + path, {
      method,
      headers: { authorization: `Bearer ${S.gh?.token}`, accept: 'application/vnd.github+json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch { fail('GitHub에 연결하지 못했어요. 인터넷을 확인하고 다시 해 주세요.'); }
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (r.status === 401) { delete S.gh; save(); fail('GitHub 연결이 끝났어요. 1번에서 다시 연결해 주세요.'); }
  return { code: r.status, data, text };
}
const okc = (r) => r.code >= 200 && r.code < 300;
const need = (r, what) => { if (!okc(r)) fail(`${what}이(가) 안 됐어요 (${r.code}) ${String(r.data?.message || r.text || '').slice(0, 200)}`); return r.data; };
async function download(path) {
  let r;
  try { r = await fetch(`${C.raw}${path}?t=${Date.now()}`, { cache: 'no-store' }); } catch { r = null; }
  if (!r || !r.ok) fail(`설치 파일 ${path}을 받지 못했어요.`);
  return (await r.text()).replace(/^﻿/, '');
}

// ---------- 로그인 앱
async function startGitHub() {
  S.ghState = 'gh-' + rand(18); save();
  const u = new URL(C.ghAuthorize);
  u.search = new URLSearchParams({ client_id: C.ghClientId, redirect_uri: here, scope: 'repo', state: S.ghState, allow_signup: 'true' });
  location.href = u.toString();
}
async function startSupabase() {
  S.sbState = 'sb-' + rand(18);
  S.sbVerifier = rand(48);
  save();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(S.sbVerifier)));
  const u = new URL(C.sbAuthorize);
  u.search = new URLSearchParams({ client_id: C.sbClientId, redirect_uri: here, response_type: 'code', state: S.sbState, code_challenge: b64url(hash), code_challenge_method: 'S256' });
  location.href = u.toString();
}
async function comeBack() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), state = q.get('state');
  if (!code && !q.get('error')) return;
  history.replaceState(null, '', here);
  if (q.get('error')) { $('form-err').textContent = '연결을 취소했어요.'; return; }
  try {
    if (state && state === S.ghState) {
      const d = await relay('/gh-token', { code });
      if (!d.token) fail('GitHub 연결이 안 됐어요. 다시 눌러 주세요.');
      S.gh = { token: d.token };
      const me = need(await gh('GET', '/user'), 'GitHub 계정 확인');
      S.gh.login = me.login;
    } else if (state && state === S.sbState) {
      const d = await relay('/sb-token', { code, verifier: S.sbVerifier, redirect: here });
      if (!d.token) fail('Supabase 연결이 안 됐어요. 다시 눌러 주세요.');
      S.sb = { token: d.token };
    } else {
      fail('연결 확인이 맞지 않아요. 다시 눌러 주세요.');
    }
  } catch (e) {
    $('form-err').textContent = e instanceof Stop ? e.message : '연결 중 문제가 생겼어요. 다시 눌러 주세요.';
  } finally {
    delete S.ghState; delete S.sbState; delete S.sbVerifier; save();
  }
}
async function loadOrgs() {
  if (!S.sb?.token) return;
  try {
    const r = await sb('GET', '/v1/organizations');
    const orgs = Array.isArray(r.data) ? r.data : [];
    if (!okc(r) || !orgs.length) { $('form-err').textContent = 'Supabase 조직(organization)이 없어요. supabase.com에서 조직을 하나 만든 뒤 다시 연결해 주세요.'; return; }
    const sel = $('org');
    sel.replaceChildren(...orgs.map((o) => { const op = document.createElement('option'); op.value = o.id; op.dataset.slug = o.slug || ''; op.textContent = o.name; return op; }));
    if (S.orgId && orgs.some((o) => o.id === S.orgId)) sel.value = S.orgId;
    $('org-wrap').hidden = orgs.length < 2;
    S.orgId = sel.value; S.orgName = orgs.find((o) => o.id === sel.value)?.name; save();
    sel.onchange = () => { S.orgId = sel.value; S.orgName = sel.selectedOptions[0].textContent; save(); paint(); };
  } catch (e) { $('form-err').textContent = e.message; }
}

// ---------- 화면
function paint() {
  const g = !!S.gh?.login, s = !!S.sb?.token;
  $('b-gh').classList.toggle('done', g);
  $('gh-who').hidden = !g; $('gh-who').textContent = g ? S.gh.login : '';
  $('b-sb').classList.toggle('done', s);
  $('sb-who').hidden = !s; $('sb-who').textContent = s ? (S.orgName || '연결됨') : '';
  $('sb-go').disabled = !g;
  $('go').disabled = !(g && s && S.orgId && form());
}
function form() {
  const classes = [...document.querySelectorAll('#classes input:checked')].map((i) => Number(i.value));
  const code = $('code').value.trim(), email = $('email').value.trim(), pw = $('pw').value;
  if (!classes.length || !/^\d{6}$/.test(code) || !/^[^@\s']+@[^@\s']+\.[^@\s']+$/.test(email) || pw.length < 8) return null;
  return { classes, code, email, pw };
}
function buildForm() {
  const saved = S.classes || [1, 2, 3, 4, 5, 6];
  $('classes').replaceChildren(...Array.from({ length: 15 }, (_, i) => {
    const n = i + 1, l = document.createElement('label'), c = document.createElement('input');
    c.type = 'checkbox'; c.value = n; c.checked = saved.includes(n);
    l.append(c, `${n}반`);
    return l;
  }));
  if (S.email) $('email').value = S.email;
  for (const id of ['code', 'email', 'pw']) $(id).addEventListener('input', paint);
  $('classes').addEventListener('change', () => { S.classes = form()?.classes || [...document.querySelectorAll('#classes input:checked')].map((i) => Number(i.value)); save(); paint(); });
  $('email').addEventListener('change', () => { S.email = $('email').value.trim(); save(); });
}

const STEPS = [
  ['fork', '사이트 저장소 복사'],
  ['project', 'Supabase 서버 만들기 (서울)'],
  ['ready', '서버 준비 기다리기'],
  ['sql', '서버에 설치'],
  ['settings', '체험 코드 · 자동 업데이트'],
  ['teacher', '관리 화면 계정'],
  ['site', '사이트를 내 서버에 연결'],
  ['live', '사이트 켜지기 기다리기'],
];
function setStep(id, state, note = '') {
  const li = $('steps').querySelector(`[data-s="${id}"]`);
  li.className = state;
  li.querySelector('.note').textContent = note;
}

// ---------- 설치
async function install(f) {
  const login = S.gh.login;
  const repoFull = `${login}/${C.repo}`;
  const siteUrl = C.siteFmt.replace('{login}', login.toLowerCase());
  let cur = 'fork';
  const step = (id, note) => { if (cur && cur !== id) setStep(cur, 'ok', $('steps').querySelector(`[data-s="${cur}"] .note`).textContent); cur = id; setStep(id, 'doing', note); };
  const note = (t) => setStep(cur, 'doing', t);
  try {
    // 1) 저장소
    step('fork');
    let r = await gh('GET', `/repos/${repoFull}`);
    if (okc(r)) {
      if (!r.data.fork || r.data.parent?.full_name !== `${C.srcOwner}/${C.repo}`) fail(`내 GitHub에 이미 '${C.repo}' 저장소가 있는데 복사본이 아니에요. 그 저장소 이름을 바꾸거나 지운 뒤 다시 해 주세요.`);
      note('이미 복사해 둔 저장소');
    } else {
      need(await gh('POST', `/repos/${C.srcOwner}/${C.repo}/forks`, { default_branch_only: true }), '저장소 복사');
    }
    let siteJs = null;
    for (let i = 0; i < 40 && !siteJs; i++) {
      r = await gh('GET', `/repos/${repoFull}/contents/assets/js/site.js`);
      if (okc(r)) siteJs = r.data; else await sleep(C.wait / 2);
    }
    if (!siteJs) fail('복사한 저장소가 아직 준비되지 않았어요. 몇 분 뒤 [이어서 다시 하기]를 눌러 주세요.');
    note(`github.com/${repoFull}`);

    // 2) 프로젝트
    step('project');
    const orgSlug = $('org').selectedOptions[0]?.dataset.slug;
    const projects = need(await sb('GET', '/v1/projects'), '프로젝트 목록') || [];
    let proj = projects.find((p) => p.name === C.repo && (!p.organization_id || p.organization_id === S.orgId || p.organization_id === orgSlug));
    if (proj) note('이미 있는 서버');
    else {
      r = await sb('POST', '/v1/projects', { name: C.repo, organization_id: S.orgId, region: 'ap-northeast-2', db_pass: rand(24) + 'Aa1!' });
      if (!okc(r)) {
        if (/limit|maximum|free/i.test(r.text)) fail('Supabase 무료 서버는 2개까지예요. 안 쓰는 프로젝트를 지우거나 멈춘 뒤 다시 해 주세요.');
        need(r, '서버 만들기');
      }
      proj = r.data;
    }
    const ref = proj.id || proj.ref;
    const sbUrl = C.hostFmt.replace('{ref}', ref);

    // 3) 준비
    step('ready', '몇 분 걸려요');
    let status = '';
    for (let i = 0; i < 90 && status !== 'ACTIVE_HEALTHY'; i++) {
      r = await sb('GET', `/v1/projects/${ref}`);
      if (okc(r)) status = String(r.data?.status || '');
      if (status === 'INACTIVE' || status === 'PAUSED') fail('Supabase 서버가 멈춰 있어요. supabase.com에서 [Restore]를 누른 뒤 다시 해 주세요.');
      if (status !== 'ACTIVE_HEALTHY') await sleep(C.wait);
    }
    if (status !== 'ACTIVE_HEALTHY') fail('서버가 아직 준비되지 않았어요. 몇 분 뒤 [이어서 다시 하기]를 눌러 주세요.');
    const keys = need(await sb('GET', `/v1/projects/${ref}/api-keys`), '공개 키 받기') || [];
    const pub = keys.find((k) => k.type === 'publishable' && k.api_key && !k.api_key.includes('·')) || keys.find((k) => k.name === 'anon');
    if (!pub?.api_key) fail('공개 키를 받지 못했어요.');
    note(sbUrl.replace(/^https:\/\//, ''));

    // 4) SQL
    step('sql');
    const runSql = async (sql, what) => {
      for (let i = 0; ; i++) {
        const q = await sb('POST', `/v1/projects/${ref}/database/query`, { query: sql });
        if (okc(q)) return q.data;
        if (i < 2 && (q.code >= 500 || q.code === 0 || q.code === 429)) { await sleep(5000); continue; }
        need(q, what);
      }
    };
    const list = f.classes.join(', ');
    for (const file of ['01_schema.sql', '02_policies.sql', '03_functions.sql', '04_seed.sql', '06_auto_update.sql']) {
      note(file);
      let t = (await download('supabase/' + file)).split(C.originalUrl).join(sbUrl);
      if (file === '04_seed.sql') {
        const re = /unnest\(array\[[0-9, ]+\]\)/g;
        if ((t.match(re) || []).length !== 1) fail('04_seed.sql에서 반 목록 줄을 찾지 못했어요. 원래 사이트 선생님께 알려 주세요.');
        t = t.replace(re, `unnest(array[${list}])`);
      }
      await runSql(t, file);
    }
    // 새 서버는 realtime.messages가 늦게 생김 → 생기면 02를 한 번 더(리모컨 정책)
    let rt = false;
    for (let i = 0; i < 12 && !rt; i++) {
      const q = await runSql("select to_regclass('realtime.messages') is not null as ok;", '실시간 확인');
      rt = !!q?.[0]?.ok;
      if (!rt) { note('실시간 기능 기다리는 중'); await sleep(C.wait); }
    }
    if (rt) await runSql((await download('supabase/02_policies.sql')).split(C.originalUrl).join(sbUrl), '02_policies.sql');
    note('');

    // 5) 체험 코드·자동 업데이트
    step('settings');
    const cfg = JSON.stringify({ on: true, source: C.raw + 'supabase/', url: sbUrl, classes: f.classes }).replace(/'/g, "''");
    await runSql(`update public.students set code_hash = extensions.crypt('${f.code}', extensions.gen_salt('bf')) where number = 0 or class_id = 20;
delete from public.student_sessions where student_id in (select id from public.students where number = 0 or class_id = 20);
insert into public.settings (key, value) values ('auto_update', '${cfg}'::jsonb)
on conflict (key) do update set value = public.settings.value || excluded.value;`, '체험 코드 저장');
    const st = await runSql('select public.setup_status() as s;', '설치 확인');
    const got = st?.[0]?.s?.classes || [];
    note(got.map((n) => `${n}반`).join(' · '));

    // 6) 교사 계정: 잠깐 가입을 열어 가입 → 확인 처리 → 가입 닫기(비밀 키 없이)
    step('teacher');
    await sb('PATCH', `/v1/projects/${ref}/config/auth`, { site_url: siteUrl, uri_allow_list: siteUrl + '**', disable_signup: false, mailer_autoconfirm: true });
    const emailSql = f.email.toLowerCase().replace(/'/g, "''");
    let made = false;
    for (let i = 0; i < 6 && !made; i++) {
      const h = { apikey: pub.api_key, 'content-type': 'application/json' };
      if (pub.api_key.startsWith('eyJ')) h.authorization = `Bearer ${pub.api_key}`;
      let res = null, d = {};
      try { res = await fetch(`${sbUrl}/auth/v1/signup`, { method: 'POST', headers: h, body: JSON.stringify({ email: f.email, password: f.pw }) }); d = await res.json().catch(() => ({})); } catch {}
      const codeTxt = String(d.error_code || d.code || d.msg || d.message || '');
      if (res?.ok) { made = true; note('계정을 만들었어요'); }
      else if (/already|exists|registered/i.test(codeTxt)) { made = true; note('이미 있는 계정 · 비밀번호는 예전 것'); }
      else if (res && res.status === 422 && /password|weak/i.test(codeTxt)) fail('비밀번호가 너무 쉬워요. 다른 비밀번호로 다시 해 주세요.');
      else await sleep(4000);
    }
    if (!made) fail('관리 화면 계정을 만들지 못했어요. 잠시 뒤 [이어서 다시 하기]를 눌러 주세요.');
    const t = await runSql(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where lower(email) = '${emailSql}';
insert into public.teachers (user_id) select id from auth.users where lower(email) = '${emailSql}' on conflict do nothing;
select count(*)::int as n from public.teachers t join auth.users u on u.id = t.user_id where lower(u.email) = '${emailSql}';`, '교사 등록');
    if (!(t?.[0]?.n >= 1)) fail('교사 등록이 되지 않았어요.');
    await sb('PATCH', `/v1/projects/${ref}/config/auth`, { disable_signup: true, mailer_autoconfirm: false });

    // 7) 사이트 파일
    step('site');
    const js = `// 이 사이트만의 값. 설치 도우미(setup.html)가 만든 파일로 통째로 바꾼다.
// Project URL과 공개(publishable) 키만 넣는다. service_role(secret) 키는 절대 넣지 않는다.
export const SUPABASE_URL = '${sbUrl}';
export const SUPABASE_ANON_KEY = '${pub.api_key}';
export const CLASSES = [${list}];
`;
    const curJs = need(await gh('GET', `/repos/${repoFull}/contents/assets/js/site.js`), 'site.js 읽기');
    if (unb64utf8(curJs.content) !== js) {
      need(await gh('PUT', `/repos/${repoFull}/contents/assets/js/site.js`, { message: '내 서버로 연결', content: b64utf8(js), sha: curJs.sha }), 'site.js 바꾸기');
    }
    r = await gh('POST', `/repos/${repoFull}/pages`, { source: { branch: 'main', path: '/' } });
    const warn = [];
    if (!okc(r) && r.code !== 409) warn.push('저장소 Settings → Pages에서 Branch를 main으로 Save 해 주세요.');
    await gh('PUT', `/repos/${repoFull}/actions/permissions`, { enabled: true, allowed_actions: 'all' });
    r = await gh('PUT', `/repos/${repoFull}/actions/workflows/sync-upstream.yml/enable`);
    if (!okc(r)) warn.push('저장소 [Actions] 탭에서 초록 단추를 한 번 눌러 주세요(새 기능 자동 받기).');

    // 8) 켜지기
    step('live', '몇 분 걸려요');
    let live = false;
    for (let i = 0; i < 60 && !live; i++) {
      try { const x = await fetch(`${siteUrl}assets/js/site.js?t=${Date.now()}`, { cache: 'no-store' }); live = x.ok && (await x.text()).includes(sbUrl); } catch {}
      if (!live) await sleep(C.wait);
    }
    setStep('live', live ? 'ok' : 'doing', live ? '' : '아직 바뀌는 중 · 10분쯤 뒤 열어 보세요');
    if (live) cur = null;
    finish(siteUrl, f.email, warn);
  } catch (e) {
    setStep(cur, 'bad');
    $('run-err').textContent = e instanceof Stop ? e.message : `문제가 생겼어요: ${e?.message || e}`;
    $('retry').hidden = false;
    $('run-title').textContent = '설치를 멈췄어요';
  }
}

function finish(siteUrl, email, warn) {
  $('run-title').textContent = '설치 끝';
  $('b-run').classList.add('done');
  const fin = $('fin');
  const line = (k, url, extra = '') => `<div class="line"><b>${k}</b><a href="${url}" target="_blank" rel="noopener">${url}</a>${extra}</div>`;
  fin.innerHTML = line('학생 입구', siteUrl) + line('관리 화면', siteUrl + 'teacher/', ` <span>${email.replace(/[<>&"]/g, '')}</span>`)
    + '<div class="line"><b>체험 계정</b><span>반마다 번호 0 + 체험 코드</span></div>'
    + warn.map((w) => `<p class="err">${w}</p>`).join('')
    + `<div class="row"><a class="go link" href="${siteUrl}teacher/" target="_blank" rel="noopener">관리 화면 열기</a></div>`;
  fin.hidden = false;
  try { sessionStorage.removeItem(KEY); } catch {}
}

async function start() {
  const f = form();
  if (!f) return;
  for (const id of ['go', 'gh-go', 'sb-go']) $(id).disabled = true;
  document.querySelectorAll('#b-form input').forEach((i) => { i.disabled = true; });
  $('b-run').hidden = false;
  $('retry').hidden = true;
  $('run-err').textContent = '';
  $('run-title').textContent = '설치하는 중';
  $('steps').innerHTML = STEPS.map(([id, t]) => `<li data-s="${id}"><span class="dot"></span><span>${t}</span><span class="note"></span></li>`).join('');
  $('b-run').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await install(f);
}

async function boot() {
  buildForm();
  if (!C.ghClientId || !C.sbClientId) { $('form-err').textContent = '설치 화면이 아직 준비 중이에요.'; }
  $('gh-go').onclick = startGitHub;
  $('sb-go').onclick = startSupabase;
  $('go').onclick = start;
  $('retry').onclick = start;
  paint();
  await comeBack();
  await loadOrgs();
  paint();
  if (S.gh?.login && !S.sb?.token) $('b-sb').scrollIntoView({ block: 'center' });
  else if (S.gh?.login && S.sb?.token) $('b-form').scrollIntoView({ block: 'center' });
}
boot();
