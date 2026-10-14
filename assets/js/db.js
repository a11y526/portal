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

// token(로그인 출입증)을 넘기면 session, my_group, my_members도 온다
export async function getClassPage(classId, token = null) {
  return unwrap(await need().rpc('get_class_page', { p_class_id: classId, p_token: token }));
}

// 아래 학생 함수의 결과: { ok: true, ... } 또는 { ok: false, error }
// 출입증이 없거나 지워졌으면(로그아웃, 반 잠금, 코드 다시 발급) error = 'NO_SESSION'

// 로그인: { ok: true, token, class_id, number } 또는 error = 'CLASS_LOCKED' | 'LOCKED' | 'BAD_CODE'
export async function studentLogin(classId, number, code) {
  return unwrap(await need().rpc('student_login', { p_class_id: classId, p_number: number, p_code: code }));
}

export async function studentLogout(token) {
  return unwrap(await need().rpc('student_logout', { p_token: token }));
}

export async function submitGroup(boardId, token) {
  return unwrap(await need().rpc('submit_group', { p_board_id: boardId, p_token: token }));
}

// 내 기록: 레벨, XP, 순위, 코인, 받은 기록, 닉네임, 캐릭터, 입을 수 있는 부품
export async function getMyPage(token) {
  return unwrap(await need().rpc('get_my_page', { p_token: token }));
}

export async function requestNickname(token, nickname) {
  return unwrap(await need().rpc('request_nickname', { p_token: token, p_nickname: nickname }));
}

export async function saveAvatar(token, avatar) {
  return unwrap(await need().rpc('save_avatar', { p_token: token, p_avatar: avatar }));
}

// 상점: 코인, 레벨, 캐릭터, 꾸미기 아이템(owned/locked), 입을 수 있는 부품, 보상, 신청 내역, 같은 반 번호
export async function getShop(token) {
  return unwrap(await need().rpc('get_shop', { p_token: token }));
}

// 꾸미기 아이템 사기: { ok: true, item_id, coins } 또는 error = 'NOT_FOR_SALE' | 'OWNED' | 'LEVEL' | 'NO_COINS'
export async function buyAvatarItem(token, itemId) {
  return unwrap(await need().rpc('buy_avatar_item', { p_token: token, p_item_id: itemId }));
}

// 보상 신청: { ok: true, coins, purchases } 또는 error = 'NOT_FOR_SALE' | 'BAD_PARTNER' | 'NO_COINS'
export async function requestPurchase(token, itemId, partner = null) {
  return unwrap(await need().rpc('request_purchase', { p_token: token, p_item_id: itemId, p_partner: partner }));
}

// 학습지 본문(무거움: 버전이 바뀔 때만 부른다)
// { ok: true, board_id, lesson_code, title, version, pages, session, mine: { answers, done_at, xp, coins } | null } 또는 error = 'NO_SHEET'
export async function getWorksheet(classId, token = null) {
  return unwrap(await need().rpc('get_worksheet', { p_class_id: classId, p_token: token }));
}

// 쓰는 중인 답 저장: { ok: true, done, updated_at } 또는 error = 'NO_SESSION' | 'BOARD_CHANGED' | 'NO_SHEET'
export async function saveWorksheetAnswers(token, boardId, answers) {
  return unwrap(await need().rpc('save_worksheet_answers', { p_token: token, p_board_id: boardId, p_answers: answers }));
}

// 제출: { ok: true, done, already, xp, coins, level_before, level_after, total_xp }
// 또는 { ok: false, error: 'NOT_YET', empty: [칸], wrong: [칸] } (정답은 오지 않는다)
export async function submitWorksheet(token, boardId, answers) {
  return unwrap(await need().rpc('submit_worksheet', { p_token: token, p_board_id: boardId, p_answers: answers }));
}

// 결과: { month: 'YYYY-MM', rows: [{ rank, class_id, nickname, avatar, xp, move }] }
export async function getMonthTop20() {
  return unwrap(await need().rpc('get_month_top20'));
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
  return unwrap(await need().from('classes').select('id, label, today_board_id, locked').order('id'));
}

// 쓰는 중인 보드 (보관한 보드는 빠짐)
export async function listBoards() {
  return unwrap(await need().from('boards').select('*').is('archived_at', null)
    .order('created_at', { ascending: false }).limit(300));
}

export async function listArchivedBoards() {
  return unwrap(await need().from('boards').select('id, class_id, lesson_code, title, status, created_at, archived_at')
    .not('archived_at', 'is', null).order('created_at', { ascending: false }).limit(500));
}

// 보관(on = true) 또는 되돌리기
export async function archiveBoards(ids, on = true) {
  if (!ids.length) return;
  unwrap(await need().from('boards').update({ archived_at: on ? new Date().toISOString() : null }).in('id', ids));
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

// 시뮬레이션 링크는 차시마다 같다: 같은 차시의 모든 반 보드에 똑같이 넣는다
export async function setLessonSims(lesson_code, sim_links) {
  unwrap(await need().from('boards').update({ sim_links }).eq('lesson_code', lesson_code));
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

// 닉네임 승인을 기다리는 학생
export async function listNicknameRequests() {
  return unwrap(await need().from('students')
    .select('id, class_id, number, nickname, nickname_request')
    .eq('nickname_status', 'pending').eq('active', true)
    .order('class_id').order('number'));
}

// 반 잠금: 잠그면 그 반 학생 모두 로그아웃
export async function setClassLock(classId, locked) {
  return unwrap(await need().rpc('set_class_lock', { p_class_id: classId, p_locked: locked }));
}

export async function decideNickname(studentId, approve) {
  return unwrap(await need().rpc('decide_nickname', { p_student_id: studentId, p_approve: approve }));
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

/* ---------- 교사: 상점 ---------- */

// 보상 신청 (status: 'requested'만, 또는 null이면 최근 것 전부)
export async function listPurchases(status = 'requested', limit = 100) {
  let q = need().from('purchases')
    .select('id, item_id, cost, status, partner_number, used_board_id, requested_at, decided_at, item:shop_items(name, kind), student:students(class_id, number, nickname)')
    .order('requested_at', { ascending: status === 'requested' })
    .limit(limit);
  if (status) q = q.eq('status', status);
  return unwrap(await q);
}

export async function decidePurchase(id, approve) {
  return unwrap(await need().rpc('decide_purchase', { p_id: id, p_approve: approve }));
}

// 그 반에서 승인됐고 아직 안 쓴 모둠 선택권 (boardId를 주면 그 보드에서 쓴 것도): [{ number, partner_number }]
export async function listPairTickets(classId, boardId = null) {
  const rows = unwrap(await need().from('purchases')
    .select('partner_number, used_board_id, item:shop_items!inner(kind), student:students!inner(class_id, number, active)')
    .eq('status', 'approved').eq('item.kind', 'pair').eq('student.class_id', classId).eq('student.active', true));
  return rows
    .filter((r) => r.partner_number && (!r.used_board_id || r.used_board_id === boardId))
    .map((r) => ({ number: r.student.number, partner_number: r.partner_number }));
}

export async function listAvatarItems() {
  return unwrap(await need().from('avatar_items')
    .select('id, slot, name, price, rarity, min_level, active, sort')
    .order('slot').order('sort').order('id'));
}

export async function updateAvatarItem(id, patch) {
  unwrap(await need().from('avatar_items').update(patch).eq('id', id));
}

export async function listShopItems() {
  return unwrap(await need().from('shop_items').select('id, name, cost, kind, active, sort').order('sort').order('id'));
}

export async function updateShopItem(id, patch) {
  unwrap(await need().from('shop_items').update(patch).eq('id', id));
}

/* ---------- 교사: 포인트 규칙, 점수 직접 주기 ---------- */

// { pass_xp, pass_coins, rank_bonus: [1위, 2위, 3위](XP), rank_bonus_coins: [...](코인) }
export async function getPointRules() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'points'));
  return rows[0]?.value ?? null;
}

export async function savePointRules(value) {
  unwrap(await need().from('settings').upsert({ key: 'points', value }, { onConflict: 'key' }));
}

// 레벨 기준(누적 XP): [0, 30, 70, …] = Lv.1부터
export async function getLevelThresholds() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'level_thresholds'));
  return rows[0]?.value ?? null;
}

export async function saveLevelThresholds(value) {
  unwrap(await need().from('settings').upsert({ key: 'level_thresholds', value }, { onConflict: 'key' }));
}

// 고른 학생들에게 XP·코인 (음수면 빼기). 결과: { ok, count }
export async function grantPoints(studentIds, xp, coins, reason) {
  return unwrap(await need().rpc('grant_points', { p_student_ids: studentIds, p_xp: xp, p_coins: coins, p_reason: reason }));
}

// 최근 직접 준 점수 (발표 지급·학습지·아이템 구매 제외)
export async function listGrants(limit = 40) {
  return unwrap(await need().from('point_events')
    .select('id, xp, coins, reason, created_at, student:students(class_id, number, nickname)')
    .is('board_id', null).is('worksheet_board_id', null).not('reason', 'like', '아이템:%')
    .order('created_at', { ascending: false }).limit(limit));
}

/* ---------- 교사: CSV 내보내기용 전체 기록 (1000줄씩 나눠 읽음) ---------- */

async function readAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = unwrap(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function exportPointEvents() {
  return readAll(() => need().from('point_events')
    .select('id, xp, coins, reason, board_id, worksheet_board_id, created_at, student:students(class_id, number, nickname)')
    .order('created_at').order('id'));
}

export async function exportPurchases() {
  return readAll(() => need().from('purchases')
    .select('id, cost, status, partner_number, requested_at, decided_at, item:shop_items(name), student:students(class_id, number, nickname)')
    .order('requested_at').order('id'));
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

// 수업 모드 모둠 카드용: [{ group_no, number, nickname, avatar }]
export async function getBoardGroupMembers(boardId) {
  const rows = unwrap(await need().from('board_groups')
    .select('group_no, student:students(number, nickname, avatar)')
    .eq('board_id', boardId));
  return rows.filter((r) => r.student)
    .map((r) => ({ group_no: r.group_no, number: r.student.number, nickname: r.student.nickname, avatar: r.student.avatar }));
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

/* ---------- 교사: 차시별 수업자료 (수업 모드) ---------- */

export async function listLessons() {
  return unwrap(await need().from('lessons').select('code, title, lesson_src, sort, created_at').order('sort').order('code'));
}

export async function getLesson(code) {
  return unwrap(await need().from('lessons').select('code, title, lesson_src').eq('code', code).maybeSingle());
}

// { code, title, lesson_src, sort }
export async function saveLesson(row) {
  return unwrap(await need().from('lessons').upsert(row, { onConflict: 'code' }).select().single());
}

export async function deleteLesson(code) {
  unwrap(await need().from('lessons').delete().eq('code', code));
}

/* ---------- 교사: 개인 학습지 (8단계) ---------- */

// 차시별 학습지 목록 (본문 빼고): [{ lesson_code, title, page_count, field_count, updated_at }]
export async function listWorksheets() {
  return unwrap(await need().from('worksheets').select('lesson_code, title, page_count, field_count, updated_at'));
}

// 올리기(같은 차시면 바꾸기). row: { lesson_code, title, pages, key, page_count, field_count }
export async function saveWorksheet(row) {
  unwrap(await need().from('worksheets').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'lesson_code' }));
}

// 그 차시 보드에서 학습지를 쓰기 시작했거나 낸 학생 수 (다시 올릴 때 확인용)
export async function countWorksheetAnswers(code) {
  const ids = unwrap(await need().from('boards').select('id').eq('lesson_code', code)).map((b) => b.id);
  if (!ids.length) return 0;
  const { count, error } = await need().from('worksheet_answers').select('student_id', { count: 'exact', head: true }).in('board_id', ids);
  if (error) throw error;
  return count ?? 0;
}

// 수업 모드 띠: { has_sheet, done, total }
export async function getWorksheetStats(boardId) {
  return unwrap(await need().rpc('get_worksheet_stats', { p_board_id: boardId }));
}

// { xp, coins } 학습지를 모두 맞게 냈을 때
export async function getWorksheetRules() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'worksheet'));
  return rows[0]?.value ?? null;
}

export async function saveWorksheetRules(value) {
  unwrap(await need().from('settings').upsert({ key: 'worksheet', value }, { onConflict: 'key' }));
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
