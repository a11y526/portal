// 교사 화면 공통 입구: 설정 확인 → 로그인 → 교사 확인 → 화면 열기
import { sb, isConfigured, getSession, signIn, signOut, amITeacher } from './db.js';
import { toast } from './ui.js';

export function errMsg(err) {
  console.error(err);
  const m = err?.message || '';
  if (/Invalid login/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요';
  if (/fetch|network/i.test(m)) return '인터넷 연결을 확인해 주세요';
  if (/ALREADY_REVIEWED/.test(m)) return '이미 검사한 제출이에요';
  if (/BOARD_REVEALED/.test(m)) return '이미 순위를 발표한 보드예요';
  if (/HAS_SUBMISSIONS/.test(m)) return '제출이 시작돼서 모둠을 바꿀 수 없어요';
  if (/NOT_REVEALED/.test(m)) return '아직 발표하지 않은 보드예요';
  if (/NOT_PENDING/.test(m)) return '이미 처리한 신청이에요';
  if (/NOT_TEACHER/.test(m)) return '교사 계정으로 로그인해 주세요';
  if (/BAD_AMOUNT/.test(m)) return 'XP나 코인을 -1000~1000 사이로 넣어 주세요';
  if (/BAD_REASON/.test(m)) return '사유를 1~40자로 써 주세요';
  if (/NO_STUDENTS/.test(m)) return '학생을 골라 주세요';
  return '처리하지 못했어요: ' + m;
}

// app: 교사로 확인되면 보여 줄 요소. onReady: 처음 한 번 실행
export function teacherGate(app, onReady) {
  const gate = document.createElement('div');
  gate.className = 'gate';
  app.before(gate);
  app.classList.add('hidden');

  const view = (html) => {
    gate.innerHTML = html;
    gate.classList.remove('hidden');
    app.classList.add('hidden');
  };

  const showLogin = () => {
    view(`
      <form class="card glass-strong login-card rise" id="gate-login">
        <h2>교사 로그인</h2>
        <label class="field"><span>이메일</span><input class="input" type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span>비밀번호</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary" type="submit">로그인</button>
      </form>`);
    gate.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const btn = f.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        await signIn(f.email.value.trim(), f.password.value);
        await route();
      } catch (err) {
        toast(errMsg(err), 'error');
        btn.disabled = false;
      }
    });
  };

  async function route() {
    if (!isConfigured) {
      return view(`
        <section class="card glass-strong login-card">
          <h2>설정이 필요해요</h2>
          <p class="muted" style="margin:0">assets/js/config.js에 Supabase Project URL과 anon 키를 넣어 주세요.</p>
        </section>`);
    }
    let session;
    try { session = await getSession(); } catch (err) { toast(errMsg(err), 'error'); }
    if (!session) return showLogin();
    if (!(await amITeacher().catch(() => false))) {
      return view(`
        <section class="card glass-strong login-card">
          <h2>교사로 등록되지 않은 계정이에요</h2>
          <button class="btn btn-line" type="button" data-logout>로그아웃</button>
        </section>`);
    }
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    try { await onReady(); } catch (err) { toast(errMsg(err), 'error'); }
  }

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    await signOut();
    location.reload();
  });
  sb?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.reload(); });

  route();
}
