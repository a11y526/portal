// 딴 화면 기록 (학생 화면 공통, ui.js initUI가 부름. 교사 화면·iframe 안에서는 안 씀)
// 포털 화면을 벗어나면(다른 탭·창·앱, 창 내리기) away_mark(출입증, true), 돌아오면 false, 그 밖에 1분마다 false.
// 서버는 그 반 수업 모드가 열려 있을 때만 적고(watching), 그때만 위에 '수업 중' 표시를 띄운다.
// 포털 안의 시뮬레이션·퀴즈 쇼(iframe)를 누른 것은 document.hasFocus()가 그대로 true라 벗어난 것이 아니다.
// 벗어날 때는 페이지가 곧 멈출 수 있어서 supabase-js 대신 fetch keepalive로 바로 보낸다
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { readLogin } from './login.js';

const CHECK_MS = 1000;
const PING_MS = 60000;

let sent = null;     // 서버에 마지막으로 알린 상태 (true 벗어남 / false 있음)
let busy = false;
let lastPing = 0;
let watching = false;

const isAway = () => document.hidden || !document.hasFocus();

async function post(away) {
  const login = readLogin();
  if (!login) { sent = null; show(false); return; }
  busy = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/away_mark`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ p_token: login.token, p_away: away }),
    });
    const r = res.ok ? await res.json() : null;
    if (r) {
      sent = away;
      lastPing = Date.now();
      show(!!r.watching);
    }
  } catch {
    // 끊기면 다음 확인 때 다시 보낸다
  } finally {
    busy = false;
  }
}

function check() {
  if (busy) return;
  const away = isAway();
  if (away !== sent) post(away);
  else if (!away && Date.now() - lastPing > PING_MS) post(false);
}

// 위쪽 가운데 작은 표시 (수업 모드가 열려 있을 때만)
function show(on) {
  if (on === watching) return;
  watching = on;
  let el = document.getElementById('away-note');
  if (on && !el) {
    el = document.createElement('div');
    el.id = 'away-note';
    el.className = 'away-note';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="away-dot" aria-hidden="true"></span>수업 중 · 화면을 벗어나면 기록돼요';
    document.body.append(el);
  }
  el?.classList.toggle('hidden', !on);
}

export function startAway() {
  if (window.top !== window || !readLogin()) {
    // 로그인 전이면 로그인한 뒤 다시 확인 (입구 화면)
    if (window.top === window) setTimeout(startAway, 5000);
    return;
  }
  const now = () => { if (!busy) post(isAway()); };
  document.addEventListener('visibilitychange', now);
  window.addEventListener('blur', () => setTimeout(check, 200));
  window.addEventListener('focus', check);
  window.addEventListener('pagehide', () => post(true));
  setInterval(check, CHECK_MS);
  post(isAway());
}
