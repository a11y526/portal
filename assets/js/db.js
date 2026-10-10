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

export async function getClassPage(classId) {
  return unwrap(await need().rpc('get_class_page', { p_class_id: classId }));
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
