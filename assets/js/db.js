// Supabase 클라이언트와 호출 함수 모음
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = !SUPABASE_URL.includes('YOUR-') && !SUPABASE_ANON_KEY.includes('YOUR-');

export const sb = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function need() {
  if (!sb) throw new Error('NOT_CONFIGURED');
  return sb;
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/* ---------- 학생 ---------- */

export async function getClassPage(classId, number = null) {
  return unwrap(await need().rpc('get_class_page', { p_class_id: classId, p_number: number }));
}

// 결과: { ok: true, group_no } 또는 { ok: false, error }
export async function submitGroup(boardId, classId, number, code) {
  return unwrap(await need().rpc('submit_group', {
    p_board_id: boardId, p_class_id: classId, p_number: number, p_code: code,
  }));
}

/* ---------- 실시간: 반 채널 "새로고침" 신호 ----------
   신호에는 데이터를 싣지 않는다. 받은 쪽은 RPC로 다시 읽는다. */

const classChannels = new Map();

function classChannel(classId) {
  let ch = classChannels.get(classId);
  if (!ch) {
    ch = need().channel('class-' + classId);
    classChannels.set(classId, ch);
  }
  return ch;
}

export function onClassRefresh(classId, fn) {
  const ch = classChannel(classId);
  ch.on('broadcast', { event: 'refresh' }, () => fn());
  if (ch.state === 'closed') ch.subscribe();
}

export function sendClassRefresh(classId) {
  if (!sb) return Promise.resolve();
  const ch = classChannel(classId);
  if (ch.state === 'closed') ch.subscribe();
  // 아직 연결 전이면 supabase-js가 HTTP로 보낸다
  return ch.send({ type: 'broadcast', event: 'refresh', payload: {} }).catch(() => {});
}

/* ---------- 교사 ---------- */

export async function getSession() {
  const { data } = await need().auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  return unwrap(await need().auth.signInWithPassword({ email, password }));
}

export async function signOut() {
  await need().auth.signOut();
}

export async function amITeacher() {
  const session = await getSession();
  if (!session) return false;
  const rows = unwrap(await need().from('teachers').select('user_id').eq('user_id', session.user.id));
  return rows.length > 0;
}

export async function listClasses() {
  return unwrap(await need().from('classes').select('id, label, today_board_id').order('id'));
}

export async function listBoards() {
  return unwrap(await need().from('boards').select('*').order('created_at', { ascending: false }).limit(300));
}

// items: [{ class_id, padlet_src }]
export async function createBoards({ lesson_code, title, sim_links, items, setToday }) {
  const rows = items.map((it) => ({
    class_id: it.class_id,
    lesson_code,
    title,
    padlet_src: it.padlet_src || null,
    sim_links,
  }));
  const created = unwrap(await need().from('boards').insert(rows).select('id, class_id'));
  if (setToday) {
    for (const b of created) await setTodayBoard(b.class_id, b.id);
  }
  return created;
}

export async function updateBoard(id, patch) {
  return unwrap(await need().from('boards').update(patch).eq('id', id).select().single());
}

export async function deleteBoard(id) {
  unwrap(await need().from('boards').delete().eq('id', id));
}

export async function setTodayBoard(classId, boardId) {
  unwrap(await need().from('classes').update({ today_board_id: boardId }).eq('id', classId));
}

export async function getBoard(id) {
  return unwrap(await need().from('boards').select('*').eq('id', id).maybeSingle());
}

/* ---------- 교사: 명단·코드 ---------- */

export async function listStudents() {
  return unwrap(await need().from('students')
    .select('id, class_id, number, has_code, active')
    .order('class_id').order('number'));
}

// 반 명단을 1~last번으로: 없는 번호는 새로 넣고(이미 있으면 그대로), last보다 큰 번호는 명단에서 뺀다
export async function setRosterSize(classId, last) {
  const rows = Array.from({ length: last }, (_, i) => ({ class_id: classId, number: i + 1 }));
  unwrap(await need().from('students').upsert(rows, { onConflict: 'class_id,number', ignoreDuplicates: true }));
  unwrap(await need().from('students').update({ active: false })
    .eq('class_id', classId).eq('active', true).gt('number', last));
}

export async function updateStudent(id, patch) {
  unwrap(await need().from('students').update(patch).eq('id', id));
}

// 결과: [{ class_id, number, group_no, code }]  (평문 코드는 이 응답에서만)
export async function issueCodes(classId, onlyMissing) {
  return unwrap(await need().rpc('issue_codes', { p_class_id: classId, p_only_missing: onlyMissing }));
}

export async function resetCode(studentId) {
  return unwrap(await need().rpc('reset_code', { p_student_id: studentId }));
}

/* ---------- 교사: 빠른 피드백 버튼 ---------- */

export async function listPresets() {
  return unwrap(await need().from('feedback_presets').select('id, text, sort').order('sort').order('id'));
}

export async function addPreset(text, sort) {
  unwrap(await need().from('feedback_presets').insert({ text, sort }));
}

export async function deletePreset(id) {
  unwrap(await need().from('feedback_presets').delete().eq('id', id));
}

/* ---------- 교사: 검사·발표 ---------- */

export async function listSubmissions(boardId) {
  return unwrap(await need().from('submissions')
    .select('id, group_no, submitted_at, status, feedback, reviewed_at, student:students(number)')
    .eq('board_id', boardId)
    .order('submitted_at'));
}

export async function countSubmissions(boardId) {
  const { count, error } = await need().from('submissions').select('id', { count: 'exact', head: true }).eq('board_id', boardId);
  if (error) throw error;
  return count ?? 0;
}

/* ---------- 교사: 모둠 편성 (보드마다) ---------- */

// 결과: [{ group_no, number }]
export async function getBoardGroups(boardId) {
  const rows = unwrap(await need().from('board_groups')
    .select('group_no, student:students(number)')
    .eq('board_id', boardId));
  return rows.map((r) => ({ group_no: r.group_no, number: r.student?.number })).filter((r) => r.number);
}

// groups: [[번호, ...], [번호, ...], ...]  (1모둠부터 차례로)
export async function setBoardGroups(boardId, groups) {
  return unwrap(await need().rpc('set_board_groups', { p_board_id: boardId, p_groups: groups }));
}

export async function reviewSubmission(id, status, feedback = null) {
  return unwrap(await need().rpc('review_submission', { p_id: id, p_status: status, p_feedback: feedback }));
}

// 결과: { board_id, class_id, ranking: [{ rank, group_no, xp, coins, members }], already }
export async function revealBoard(boardId) {
  return unwrap(await need().rpc('reveal_board', { p_board_id: boardId }));
}

// 발표 취소: 그 발표로 준 포인트를 거둬들이고 보드를 다시 연다. 결과: { ok, removed, class_id }
export async function unrevealBoard(boardId) {
  return unwrap(await need().rpc('unreveal_board', { p_board_id: boardId }));
}

// submissions 표가 바뀌면 fn(payload)
export function onSubmissionsChange(fn) {
  need().channel('submissions-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, fn)
    .subscribe();
}

/* ---------- 패들렛 주소 ---------- */

// 임베드 코드(<iframe ...>), 보드 주소, 임베드 주소 중 무엇을 넣어도 임베드 주소로 바꾼다.
// 바꿀 수 없으면 null.
export function toPadletEmbed(input) {
  if (!input) return null;
  let s = String(input).trim();
  const m = s.match(/src\s*=\s*["']([^"']+)["']/i);
  if (m) s = m[1];
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let url;
  try { url = new URL(s); } catch { return null; }
  if (!/padlet\.(com|org)$/i.test(url.hostname) && !/\.padlet\.(com|org)$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  if (parts[0] === 'embed' && parts[1]) return `${url.origin}/embed/${parts[1]}`;
  const last = parts[parts.length - 1];
  const id = last.includes('-') ? last.slice(last.lastIndexOf('-') + 1) : last;
  if (!/^[a-z0-9]{6,}$/i.test(id)) return null;
  return `${url.origin}/embed/${id}`;
}
