// 설치 화면(science-portal/install/)의 중계. 브라우저가 직접 부를 수 없는 세 가지만 대신 부른다:
//   POST /gh-token {code}                     GitHub 로그인 앱 code → 토큰 (비밀값이 필요)
//   POST /sb-token {code, verifier, redirect}  Supabase 로그인 앱 code → 토큰 (비밀값이 필요)
//   POST /sb {token, method, path, body}      Supabase 관리 API (supabase.com 밖에서는 브라우저 호출을 막음)
// 받은 토큰·요청은 그대로 전하기만 하고 저장하거나 적지 않는다. 관리 API는 설치에 쓰는 주소만 허용.
// env: GH_CLIENT_ID, GH_CLIENT_SECRET, SB_CLIENT_ID, SB_CLIENT_SECRET, ALLOW_ORIGINS(쉼표), GH_BASE·SB_BASE(점검용)

const ALLOWED = [
  ['GET', /^\/v1\/organizations$/],
  ['GET', /^\/v1\/projects$/],
  ['POST', /^\/v1\/projects$/],
  ['GET', /^\/v1\/projects\/[a-z]{20}$/],
  ['GET', /^\/v1\/projects\/[a-z]{20}\/api-keys$/],
  ['POST', /^\/v1\/projects\/[a-z]{20}\/database\/query$/],
  ['PATCH', /^\/v1\/projects\/[a-z]{20}\/config\/auth$/],
];

function cors(origin, env) {
  const allow = (env.ALLOW_ORIGINS || 'https://a11y526.github.io').split(',').map((s) => s.trim());
  const h = { 'content-type': 'application/json; charset=utf-8', vary: 'Origin' };
  if (origin && allow.includes(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-methods'] = 'POST, OPTIONS';
    h['access-control-allow-headers'] = 'content-type';
    h['access-control-max-age'] = '3600';
  }
  return h;
}

export async function handle(req, env, fetchImpl = fetch) {
  const origin = req.headers.get('origin') || '';
  const headers = cors(origin, env);
  const out = (status, obj) => new Response(JSON.stringify(obj), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: headers['access-control-allow-origin'] ? 204 : 403, headers });
  if (!headers['access-control-allow-origin']) return out(403, { error: 'ORIGIN' });
  if (req.method !== 'POST') return out(405, { error: 'METHOD' });
  const route = new URL(req.url).pathname.replace(/^.*\/setup-relay/, '') || '/';
  let b;
  try { b = await req.json(); } catch { return out(400, { error: 'JSON' }); }
  const GH = env.GH_BASE || 'https://github.com';
  const SB = env.SB_BASE || 'https://api.supabase.com';

  if (route === '/gh-token') {
    if (typeof b.code !== 'string' || b.code.length > 200) return out(400, { error: 'CODE' });
    const r = await fetchImpl(`${GH}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: env.GH_CLIENT_ID, client_secret: env.GH_CLIENT_SECRET, code: b.code }),
    });
    const d = await r.json().catch(() => ({}));
    if (!d.access_token) return out(400, { error: d.error || 'GH_TOKEN', detail: d.error_description || '' });
    return out(200, { token: d.access_token, scope: d.scope || '' });
  }

  if (route === '/sb-token') {
    if (typeof b.code !== 'string' || typeof b.verifier !== 'string' || typeof b.redirect !== 'string') return out(400, { error: 'CODE' });
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: b.code, redirect_uri: b.redirect, code_verifier: b.verifier });
    const basic = btoa(`${env.SB_CLIENT_ID}:${env.SB_CLIENT_SECRET}`);
    const r = await fetchImpl(`${SB}/v1/oauth/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
    });
    const d = await r.json().catch(() => ({}));
    if (!d.access_token) return out(400, { error: 'SB_TOKEN', detail: d.message || d.error_description || d.error || r.status });
    return out(200, { token: d.access_token });
  }

  if (route === '/sb') {
    const method = String(b.method || '').toUpperCase();
    const path = String(b.path || '');
    if (typeof b.token !== 'string' || !b.token) return out(400, { error: 'TOKEN' });
    if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) return out(400, { error: 'PATH' });
    const init = { method, headers: { authorization: `Bearer ${b.token}`, accept: 'application/json' } };
    if (b.body !== undefined && method !== 'GET') { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(b.body); }
    const r = await fetchImpl(SB + path, init);
    const text = await r.text();
    return out(200, { status: r.status, body: text });
  }

  return out(404, { error: 'ROUTE' });
}
