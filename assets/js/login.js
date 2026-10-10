// 학생 로그인 상태: 출입증을 이 기기에 저장하고 로그아웃할 때까지 유지한다. 코드는 저장하지 않는다.
const KEY = 'student';

// 결과: { token, class_id, number } 또는 null
export function readLogin() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && /^[0-9a-f]{64}$/.test(v.token) && Number.isInteger(v.class_id) ? v : null;
  } catch { return null; }
}

export function saveLogin({ token, class_id, number }) {
  try { localStorage.setItem(KEY, JSON.stringify({ token, class_id, number })); } catch {}
}

export function clearLogin() {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem('me-mark');
  } catch {}
}
