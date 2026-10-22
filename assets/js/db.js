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

/* ---------- 모둠 칸 게시판 (패들렛 대체) ---------- */

// { board_id, status, my_group, can_write, why, groups: [{ no, posts: [...] | null(가린 칸) }] }
export async function getPosts(classId, token = null) {
  return unwrap(await need().rpc('get_posts', { p_class_id: classId, p_token: token }));
}

// 아래 결과: { ok: true, ... } 또는 error = 'NO_SESSION' | 'BOARD_CHANGED' | 'CLOSED' | 'NO_GROUP' | 'LOCKED' | ...
// 사진 올리기: 경로를 받아(post_upload_ticket) 'posts' 버킷에 jpeg로 올린다. 결과: { ok, path } 또는 { ok: false, error }
export async function uploadPostPhoto(token, boardId, blob) {
  const t = unwrap(await need().rpc('post_upload_ticket', { p_token: token, p_board_id: boardId }));
  if (!t?.ok) return t;
  const { error } = await need().storage.from(POST_BUCKET).upload(t.path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '86400' });
  if (error) throw error;
  return t;
}

// post: { title, body, link, photo }. postId가 null이면 새 글. 결과: { ok, id } 또는 error = 'EMPTY' | 'BAD_LINK' | 'BAD_PHOTO' | 'FULL' | 'NOT_FOUND' | ...
export async function savePost(token, boardId, postId, post) {
  return unwrap(await need().rpc('save_post', {
    p_token: token, p_board_id: boardId, p_post_id: postId,
    p_title: post.title ?? '', p_body: post.body ?? '', p_link: post.link ?? '', p_photo: post.photo ?? '',
  }));
}

export async function deletePost(token, postId) {
  return unwrap(await need().rpc('delete_post', { p_token: token, p_post_id: postId }));
}

export const POST_BUCKET = 'posts';
export const postPhotoUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/${POST_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;

/* ---------- 반 게시판 (교사가 올리는 자료, 반마다 섹션) ---------- */

// 그 반에 로그인한 학생만. v가 지금 버전과 같으면 { ok, v, same: true }
// { ok: true, v, sections: [{ id, name, items: [{ id, title, body, link, file, file_type, file_name }] }] } 또는 error = 'NO_SESSION'
export async function getClassMaterials(classId, token, v = null) {
  return unwrap(await need().rpc('get_class_materials', { p_class_id: classId, p_token: token, p_v: v }));
}

export const MATERIAL_BUCKET = 'materials';
export const materialUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/${MATERIAL_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;

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
// { ok: true, board_id, lesson_code, title, version, pages, session, mine: { answers, passed, done_at, xp, coins } | null } 또는 error = 'NO_SHEET'
export async function getWorksheet(classId, token = null) {
  return unwrap(await need().rpc('get_worksheet', { p_class_id: classId, p_token: token }));
}

// 쓰는 중인 답 저장: { ok: true, done, updated_at } 또는 error = 'NO_SESSION' | 'BOARD_CHANGED' | 'NO_SHEET'
export async function saveWorksheetAnswers(token, boardId, answers) {
  return unwrap(await need().rpc('save_worksheet_answers', { p_token: token, p_board_id: boardId, p_answers: answers }));
}

// 쪽별 제출(page: pages 순서, 0부터): { ok: true, done: false, passed, left }
// 또는 { ok: true, done: true, already, passed, xp, coins, level_before, level_after, total_xp }
// 또는 { ok: false, error: 'NOT_YET', empty, wrong } (그 쪽 칸만) · 'NO_PAGE' 등
export async function submitWorksheetPage(token, boardId, page, answers) {
  return unwrap(await need().rpc('submit_worksheet_page', { p_token: token, p_board_id: boardId, p_page: page, p_answers: answers }));
}

// 결과: { month: 'YYYY-MM', rows: [{ rank, class_id, nickname, avatar, xp, move }] }
// 오목: { ok: true, open, today(오늘 시작한 판 수), daily(하루 판 수), xp, coins, avatar }
export async function getOmok(token) {
  return unwrap(await need().rpc('get_omok', { p_token: token }));
}

// 한 판 시작(첫 돌을 놓을 때): { ok: true, game_id, today, daily }
// 또는 error = 'CLOSED' | 'LIMIT'(오늘 판을 다 씀, today·daily 같이)
export async function startOmok(token) {
  return unwrap(await need().rpc('start_omok', { p_token: token }));
}

// 이긴 판 내기(판 번호, 흑 수 [[행, 열], …]): { ok: true, paid, xp, coins, today, daily, level_before, level_after, total_xp }
// 또는 error = 'CLOSED' | 'BAD_GAME'
export async function submitOmok(token, gameId, moves) {
  return unwrap(await need().rpc('submit_omok', { p_token: token, p_game_id: gameId, p_moves: moves }));
}

// 오목 AI 랭킹(이번 달): { month, min_games, wins: [{ rank, me, class_id, nickname, avatar, wins, games }], rate: [{ …, rate(%) }],
//   me: null | { wins, games, rate, wins_rank, rate_rank } }
export async function getOmokRank(token = null) {
  return unwrap(await need().rpc('get_omok_rank', { p_token: token }));
}

// 퀴즈 배틀 (그날 모둠끼리, 선생님이 연 보드에서만). 결과: { ok: true, open, board_id, lesson_code, group_no, count(문제 수), xp, coins, avatar,
//   members: [{ nickname, avatar, me, joined, online }],
//   game: null | { id, status(lobby|playing|done), phase(lobby|ready|ask|reveal|done), version, total, q, start_ms, left_ms, next_ms, gain,
//                  item: { no, total, key, type(blank|choice|sym), slide, title, options, html, solved, later, answer(공개 뒤), mine, dur },
//                  players: [{ me, nickname, avatar, online, correct, answered, ok }] } }
export async function qbState(token) {
  return unwrap(await need().rpc('qb_state', { p_token: token }));
}

// 들어가기 / 시작 / 나가기(시작 전만): qbState와 같은 결과 또는 error = 'CLOSED' | 'NO_GROUP' | 'NO_ITEMS' | 'NOT_PLAYER'
export async function qbJoin(token) {
  return unwrap(await need().rpc('qb_join', { p_token: token }));
}

export async function qbStart(token) {
  return unwrap(await need().rpc('qb_start', { p_token: token }));
}

export async function qbLeave(token) {
  return unwrap(await need().rpc('qb_leave', { p_token: token }));
}

// 답 내기(지금 문제에 한 번): qbState와 같은 결과 또는 error = 'OVER' | 'STALE' | 'ALREADY' | 'EMPTY'
export async function qbAnswer(token, gameId, q, answer) {
  return unwrap(await need().rpc('qb_answer', { p_token: token, p_game_id: gameId, p_q: q, p_answer: answer }));
}

export async function getMonthTop20() {
  return unwrap(await need().rpc('get_month_top20'));
}

// 루미큐브 (3명 온라인). 결과: { ok: true, open, today, daily, xp, coins, turn(초), avatar,
//   game: null | { id, status(waiting|playing|done), version, me(내 자리), turn, left_ms, pool(남은 장 수), board, rack(내 손패),
//                  melded, left, last, winner, end_reason(out|pool|left), reward, players: [{ seat, me, class_id, nickname, avatar, count, melded, left, points }] } }
// 판 번호를 주면 그 판(끝난 판 포함), 안 주면 지금 하는 판
export async function rkState(token, gameId = null) {
  return unwrap(await need().rpc('rk_state', { p_token: token, p_game_id: gameId }));
}

// 판 찾기: rkState와 같은 결과 또는 error = 'CLOSED' | 'LIMIT'
export async function rkJoin(token) {
  return unwrap(await need().rpc('rk_join', { p_token: token }));
}

// 나가기(대기 중이면 취소, 하는 중이면 기권)
export async function rkLeave(token, gameId) {
  return unwrap(await need().rpc('rk_leave', { p_token: token, p_game_id: gameId }));
}

// 1장 가져오기 / 내기(바꾼 뒤 판 전체). 실패하면 { ok: false, error, bad?, meld?, state }
export async function rkDraw(token, gameId, version) {
  return unwrap(await need().rpc('rk_draw', { p_token: token, p_game_id: gameId, p_version: version }));
}

export async function rkPlay(token, gameId, version, board) {
  return unwrap(await need().rpc('rk_play', { p_token: token, p_game_id: gameId, p_version: version, p_board: board }));
}

// 오목 1대1. 결과: { ok: true, open, today, daily, turn(초), avatar,
//   game: null | { id, status(waiting|playing|done), version, me(1 흑 | 2 백), turn, turn_sec, left_ms, board(225칸, 0 빈 칸·1 흑·2 백),
//                  moves, last(칸), winner, end_reason(five|time|left|full), players: [{ color, me, class_id, nickname, avatar, left }] } }
export async function omState(token, gameId = null) {
  return unwrap(await need().rpc('om_state', { p_token: token, p_game_id: gameId }));
}

// 상대 찾기: omState와 같은 결과 또는 error = 'CLOSED' | 'LIMIT'
export async function omJoin(token) {
  return unwrap(await need().rpc('om_join', { p_token: token }));
}

// 나가기(대기 중이면 취소, 하는 중이면 기권)
export async function omLeave(token, gameId) {
  return unwrap(await need().rpc('om_leave', { p_token: token, p_game_id: gameId }));
}

// 한 수(칸 = 행*15 + 열). 실패하면 { ok: false, error: 'OVER' | 'NOT_TURN' | 'TAKEN' | 'BAD_GAME', state }
export async function omPlay(token, gameId, cell) {
  return unwrap(await need().rpc('om_play', { p_token: token, p_game_id: gameId, p_cell: cell }));
}

/* ---------- 실시간: 판 채널 "새로고침" 신호 (루미큐브 rk-<판>, 오목 1대1 om-<판>) ---------- */
let gameChannel = null;
let gameChannelId = null;

// 판이 바뀌면 이전 채널은 닫는다. fn = null이면 닫기만
export function onGameRefresh(gameId, fn, prefix = 'rk-') {
  if (!sb) return;
  if (gameChannel) {
    sb.removeChannel(gameChannel);
    gameChannel = null;
    gameChannelId = null;
  }
  if (!gameId || !fn) return;
  gameChannel = sb.channel(prefix + gameId);
  gameChannelId = gameId;
  gameChannel.on('broadcast', { event: 'refresh' }, () => fn());
  gameChannel.subscribe();
}

// 듣고 있는 판이 아니면(방금 나간 판 등) 잠깐 채널을 만들어 보낸다(연결 전이면 supabase-js가 HTTP로 보냄)
export function sendGameRefresh(gameId, prefix = 'rk-') {
  if (!sb || !gameId) return Promise.resolve();
  const live = gameChannelId === gameId;
  const ch = live ? gameChannel : sb.channel(prefix + gameId);
  return ch.send({ type: 'broadcast', event: 'refresh', payload: {} }).catch(() => {})
    .finally(() => { if (!live) sb.removeChannel(ch); });
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

// [제출 시작] 신호: 받은 학생 기기는 흩지 않고 바로 다시 읽는다 (먼저 낸 순서가 공평하게)
export function onWsOpen(classId, fn) {
  const ch = classChannel(classId);
  ch.on('broadcast', { event: 'ws-open' }, () => fn());
  if (ch.state === 'closed') ch.subscribe();
}

export function sendWsOpen(classId) {
  if (!sb) return Promise.resolve();
  const ch = classChannel(classId);
  if (ch.state === 'closed') ch.subscribe();
  return ch.send({ type: 'broadcast', event: 'ws-open', payload: {} }).catch(() => {});
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
  return unwrap(await need().from('classes').select('id, label, today_board_id, locked, omok_open').order('id'));
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

// items: [{ class_id }]
export async function createBoards({ lesson_code, title, sim_links, items, setToday }) {
  const rows = items.map((it) => ({
    class_id: it.class_id,
    lesson_code,
    title,
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
    .gt('number', 0) // 0번(선생님 체험 계정)은 명단·코드·모둠·점수 주기에서 뺀다
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

// 오목 켜기/끄기 (반마다)
export async function setOmokOpen(classId, open) {
  unwrap(await need().from('classes').update({ omok_open: open }).eq('id', classId));
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

// 최근 직접 준 점수 (발표 지급·학습지·첫 답·아이템 구매 제외)
export async function listGrants(limit = 40) {
  return unwrap(await need().from('point_events')
    .select('id, xp, coins, reason, created_at, student:students(class_id, number, nickname)')
    .is('board_id', null).is('worksheet_board_id', null).is('ws_first_id', null).is('qb_game_id', null).not('reason', 'like', '아이템:%').not('reason', 'in', '("오목 승리","루미큐브 승리")')
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
    .select('id, xp, coins, reason, board_id, worksheet_board_id, ws_first_id, qb_game_id, created_at, student:students(class_id, number, nickname)')
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
  const { count, error } = await need().from('submissions').select('id', { count: 'exact', head: true }).eq('board_id', boardId).neq('group_no', 0);
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

/* ---------- 교사: 모둠 칸 게시판 ---------- */

// [{ id, group_no, title, body, link, photo, created_at, student: { number, nickname, avatar } }]
export async function listPosts(boardId) {
  return unwrap(await need().from('posts')
    .select('id, group_no, title, body, link, photo, created_at, student:students(number, nickname, avatar)')
    .eq('board_id', boardId)
    .order('created_at'));
}

export async function teacherDeletePost(post) {
  unwrap(await need().from('posts').delete().eq('id', post.id));
  if (post.photo) await need().storage.from(POST_BUCKET).remove([post.photo]).catch(() => {});
}

// posts 표가 바뀌면 fn(payload)
export function onPostsChange(fn) {
  need().channel('posts-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, fn)
    .subscribe();
}

// 사진은 그 차시가 끝나면 지운다: 어느 반의 오늘 보드도 아닌 보드에 올린 사진 파일을 지우고 글에서 뺀다.
// 교사 화면(관리, 수업 모드)이 열릴 때와 오늘 보드를 바꿀 때 부른다. 결과: 지운 파일 수
export async function cleanupPostPhotos() {
  const today = unwrap(await need().from('classes').select('today_board_id'))
    .map((c) => c.today_board_id).filter(Boolean);
  let query = need().from('post_uploads').select('path').limit(1000);
  if (today.length) query = query.not('board_id', 'in', `(${today.join(',')})`);
  const paths = unwrap(await query).map((r) => r.path);
  for (let i = 0; i < paths.length; i += 100) {
    const part = paths.slice(i, i + 100);
    const { error } = await need().storage.from(POST_BUCKET).remove(part);
    if (error) throw error;
    unwrap(await need().from('posts').update({ photo: null, updated_at: new Date().toISOString() }).in('photo', part));
    unwrap(await need().from('post_uploads').delete().in('path', part));
  }
  return paths.length;
}

/* ---------- 교사: 차시별 수업자료 (수업 모드) ---------- */

export async function listLessons() {
  return unwrap(await need().from('lessons').select('code, title, lesson_src, sort, unit, slide_count, periods, classes, created_at').order('sort').order('code'));
}

export async function getLesson(code) {
  return unwrap(await need().from('lessons').select('code, title, lesson_src, slide_count').eq('code', code).maybeSingle());
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

// 학습지 진도: 지금까지 간 수업자료 쪽 중 가장 뒤 번호를 남기고 돌려준다(전부 열기는 9999)
export async function setWorksheetUpto(boardId, slide) {
  return unwrap(await need().rpc('set_worksheet_upto', { p_board_id: boardId, p_slide: slide }));
}

// 학습지 진도 되돌리기: 진도를 slide로 바로 맞춘다(뒤 쪽은 다시 잠김)
export async function resetWorksheetUpto(boardId, slide) {
  return unwrap(await need().rpc('reset_worksheet_upto', { p_board_id: boardId, p_slide: slide }));
}

// 수업 모드 띠: { has_sheet, done, total, pages: [{ page, slide }](칸이 있는 쪽), opened: [page], paused: [page](잠근 쪽),
//   accepted: { 수업자료 쪽: 인정한 학생 번호 }, waiting: { 수업자료 쪽: 안 본 첫 답 수 } }
export async function getWorksheetStats(boardId) {
  return unwrap(await need().rpc('get_worksheet_stats', { p_board_id: boardId }));
}

// 쪽별 첫 답: 수업자료 slide쪽에서 지금 띄울 하나 { item: null | { id, page, slide, pos, count, wait, class_id, number, nickname, avatar, answers, sheet_page } }
// accepted면 대기 대신 그 쪽에서 인정한 답
export async function getWsFirst(boardId, slide, accepted = false) {
  return unwrap(await need().rpc('get_ws_first', { p_board_id: boardId, p_slide: slide, p_accepted: accepted }));
}

// [인정]: { ok, xp, coins, class_id, already } · { ok: false, error: 'TAKEN' | 'SKIPPED' }
export async function acceptWsFirst(id) {
  return unwrap(await need().rpc('accept_ws_first', { p_id: id }));
}

// [제출 시작]: 수업자료 그 쪽에 해당하는 학습지 쪽의 제출을 연다. 결과: 열린 학습지 쪽 번호 목록
export async function openWsPage(boardId, slide) {
  return unwrap(await need().rpc('open_ws_page', { p_board_id: boardId, p_slide: slide }));
}

// [잠그기]: 수업자료 그 쪽에 해당하는 학습지 쪽의 쓰기·제출을 멈춘다. 다시 열기는 openWsPage
export async function closeWsPage(boardId, slide) {
  return unwrap(await need().rpc('close_ws_page', { p_board_id: boardId, p_slide: slide }));
}

// [인정 취소]: 수업자료 그 쪽에서 인정한 학생의 지급을 지우고 줄을 다시 살린다. { ok, number, xp, coins } · { ok: false, error: 'NONE' }
export async function unacceptWsFirst(boardId, slide) {
  return unwrap(await need().rpc('unaccept_ws_first', { p_board_id: boardId, p_slide: slide }));
}

// [넘기기]
export async function skipWsFirst(id) {
  return unwrap(await need().rpc('skip_ws_first', { p_id: id }));
}

// ws_firsts 표가 바뀌면 fn(payload)
export function onWsFirstsChange(fn) {
  need().channel('ws-firsts-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ws_firsts' }, fn)
    .subscribe();
}

// 퀴즈 배틀 { xp, coins(모둠 안 1등), count(한 판 문제 수, 무작위), pick·blank(문제마다 초), reveal(정답 공개 초) }
export async function getQuizRules() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'quiz_battle'));
  return rows[0]?.value ?? null;
}

export async function saveQuizRules(value) {
  unwrap(await need().from('settings').upsert({ key: 'quiz_battle', value }, { onConflict: 'key' }));
}

// 수업 모드 [모둠] 탭: 퀴즈 배틀 열기/닫기 (닫으면 하던 판은 그 점수로 끝남)
export async function setQuizOpen(boardId, open) {
  return unwrap(await need().rpc('set_quiz_open', { p_board_id: boardId, p_open: open }));
}

// 모둠별 퀴즈 배틀 판: [{ group_no, status, q, total }]
export async function listQuizGames(boardId) {
  const rows = unwrap(await need().from('qb_games').select('group_no, status, q, items').eq('board_id', boardId));
  return rows.map((r) => ({ group_no: r.group_no, status: r.status, q: r.q, total: Array.isArray(r.items) ? r.items.length : 0 }));
}

// { xp, coins } 쪽별 첫 답을 인정받았을 때
export async function getWsFirstRules() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'ws_first'));
  return rows[0]?.value ?? null;
}

export async function saveWsFirstRules(value) {
  unwrap(await need().from('settings').upsert({ key: 'ws_first', value }, { onConflict: 'key' }));
}

// { xp, coins } 학습지를 모두 맞게 냈을 때
export async function getWorksheetRules() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'worksheet'));
  return rows[0]?.value ?? null;
}

export async function saveWorksheetRules(value) {
  unwrap(await need().from('settings').upsert({ key: 'worksheet', value }, { onConflict: 'key' }));
}

// 오목 { xp, coins, daily(하루 판 수) }
export async function getOmokRules() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'omok'));
  return rows[0]?.value ?? null;
}

export async function saveOmokRules(value) {
  unwrap(await need().from('settings').upsert({ key: 'omok', value }, { onConflict: 'key' }));
}

// 오목 1대1 { daily(하루 판 수), turn(한 수 초) }
export async function getOmokPvpRules() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'omok_pvp'));
  return rows[0]?.value ?? null;
}

export async function saveOmokPvpRules(value) {
  unwrap(await need().from('settings').upsert({ key: 'omok_pvp', value }, { onConflict: 'key' }));
}

// 루미큐브 { xp, coins, daily(하루 판 수), turn(한 턴 초) }
export async function getRummikubRules() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'rummikub'));
  return rows[0]?.value ?? null;
}

export async function saveRummikubRules(value) {
  unwrap(await need().from('settings').upsert({ key: 'rummikub', value }, { onConflict: 'key' }));
}


/* ---------- 교사: 반 게시판 ---------- */

// [{ id, name, sort, items: [{ id, section_id, title, body, link, file, file_type, file_name, sort }] }] (순서대로)
export async function listSections(classId) {
  const secs = unwrap(await need().from('class_sections')
    .select('id, name, sort, created_at, items:class_materials(id, section_id, title, body, link, file, file_type, file_name, sort, created_at)')
    .eq('class_id', classId)
    .order('sort').order('created_at'));
  const byOrder = (a, b) => a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at));
  for (const s of secs) s.items.sort(byOrder);
  return secs;
}

export async function addSection(classId, name, sort) {
  return unwrap(await need().from('class_sections').insert({ class_id: classId, name, sort }).select('id').single());
}

export async function updateSection(id, fields) {
  unwrap(await need().from('class_sections').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id));
}

// 섹션을 지우면 자료도 지워지고(외래 키), 파일도 지운다
export async function deleteSection(section) {
  const files = (section.items ?? []).map((m) => m.file).filter(Boolean);
  unwrap(await need().from('class_sections').delete().eq('id', section.id));
  if (files.length) await need().storage.from(MATERIAL_BUCKET).remove(files).catch(() => {});
}

// 파일 올리기: 반/무작위.확장자 경로. 결과: 경로
export async function uploadMaterialFile(classId, file, type) {
  const ext = type === 'pdf' ? 'pdf' : (file.type === 'image/png' ? 'png' : 'jpg');
  const path = `${classId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await need().storage.from(MATERIAL_BUCKET)
    .upload(path, file, { contentType: type === 'pdf' ? 'application/pdf' : (file.type || 'image/jpeg'), upsert: false, cacheControl: '86400' });
  if (error) throw error;
  return path;
}

export async function removeMaterialFiles(paths) {
  const list = paths.filter(Boolean);
  if (list.length) await need().storage.from(MATERIAL_BUCKET).remove(list).catch(() => {});
}

// m: { section_id, title, body, link, file, file_type, file_name, sort }. id가 있으면 고치기
export async function saveMaterial(id, m) {
  if (id) {
    unwrap(await need().from('class_materials').update({ ...m, updated_at: new Date().toISOString() }).eq('id', id));
    return id;
  }
  return unwrap(await need().from('class_materials').insert(m).select('id').single()).id;
}

export async function updateMaterialSort(id, sort) {
  unwrap(await need().from('class_materials').update({ sort, updated_at: new Date().toISOString() }).eq('id', id));
}

export async function deleteMaterial(m) {
  unwrap(await need().from('class_materials').delete().eq('id', m.id));
  await removeMaterialFiles([m.file]);
}

// 다른 반의 섹션·자료를 이 반 뒤에 덧붙인다. 파일은 새 경로로 복사(한 반에서 지워도 다른 반은 남게)
export async function copySections(fromClass, toClass) {
  const src = await listSections(fromClass);
  const base = (await listSections(toClass)).length;
  for (const [i, s] of src.entries()) {
    const { id } = await addSection(toClass, s.name, base + i);
    for (const [j, m] of s.items.entries()) {
      let file = null;
      if (m.file) {
        file = `${toClass}/${crypto.randomUUID()}.${m.file.split('.').pop()}`;
        const { error } = await need().storage.from(MATERIAL_BUCKET).copy(m.file, file);
        if (error) throw error;
      }
      await saveMaterial(null, {
        section_id: id, title: m.title, body: m.body, link: m.link,
        file, file_type: file ? m.file_type : null, file_name: file ? m.file_name : null, sort: j,
      });
    }
  }
  return src.length;
}

/* ---------- 교사: 진도 관리 ---------- */

// 오늘(한국 시간) 'YYYY-MM-DD'
export const kstDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

export async function listProgressClasses() {
  return unwrap(await need().from('classes').select('id, label, next_lesson, progress_memo').order('id'));
}

export async function updateClassProgress(classId, fields) {
  unwrap(await need().from('classes').update(fields).eq('id', classId));
}

export async function getProgressRules() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'progress'));
  return rows[0]?.value ?? null;
}

export async function saveProgressRules(value) {
  unwrap(await need().from('settings').upsert({ key: 'progress', value }, { onConflict: 'key' }));
}

// [{ weekday, period, class_id }]
export async function listTimetable() {
  return unwrap(await need().from('timetable').select('weekday, period, class_id').order('weekday').order('period'));
}

// 시간표 한 칸: classId가 없으면 비움
export async function saveTimetableCell(weekday, period, classId) {
  if (!classId) unwrap(await need().from('timetable').delete().eq('weekday', weekday).eq('period', period));
  else unwrap(await need().from('timetable').upsert({ weekday, period, class_id: classId }, { onConflict: 'weekday,period' }));
}

// 수업일 [{ id, day, period, class_id, kind, memo, lesson_code }] (날짜·교시 순)
export async function listClassDays(from, to) {
  return unwrap(await need().from('class_days').select('id, day, period, class_id, kind, memo, lesson_code')
    .gte('day', from).lte('day', to).order('day').order('period'));
}

export async function updateClassDay(id, fields) {
  unwrap(await need().from('class_days').update(fields).eq('id', id));
}

// 하루 전체의 구분·메모
export async function setDayKind(day, kind, memo) {
  unwrap(await need().from('class_days').update({ kind, memo }).eq('day', day));
}

// 시간표로 수업일 만들기(이미 있는 날짜·교시는 그대로). 결과: 새로 만든 줄 수
export async function makeClassDays(from, to) {
  const tt = await listTimetable();
  const rows = [];
  for (let d = new Date(`${from}T00:00:00Z`); kstDayUTC(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    for (const t of tt) if (t.weekday === wd) rows.push({ day: kstDayUTC(d), period: t.period, class_id: t.class_id });
  }
  if (!rows.length) return 0;
  const made = unwrap(await need().from('class_days').upsert(rows, { onConflict: 'day,period', ignoreDuplicates: true }).select('id'));
  return made.length;
}
const kstDayUTC = (d) => d.toISOString().slice(0, 10);

// 그날을 다른 요일 시간표로 바꾸기(그날 줄을 지우고 새로)
export async function useWeekdayTimetable(day, weekday, memo) {
  const tt = (await listTimetable()).filter((t) => t.weekday === weekday);
  unwrap(await need().from('class_days').delete().eq('day', day));
  if (tt.length) unwrap(await need().from('class_days').insert(tt.map((t) => ({ day, period: t.period, class_id: t.class_id, memo }))));
}

// 수업 모드를 열 때: 오늘 그 반 '수업' 줄(아직 차시가 없는 첫 줄)에 차시를 적는다. 결과: 오늘 그 반 수업이 있는지
export async function recordLessonTaught(classId, code) {
  const rows = unwrap(await need().from('class_days').select('id, lesson_code')
    .eq('day', kstDay()).eq('class_id', classId).eq('kind', '수업').order('period'));
  if (!rows.length) return false;
  if (!rows.some((r) => r.lesson_code === code)) {
    const row = rows.find((r) => !r.lesson_code);
    if (row) await updateClassDay(row.id, { lesson_code: code });
  }
  return true;
}

// 수업 모드: 보드에서 실제로 간 가장 뒤 쪽(줄지 않음)
export async function setBoardSlideMax(boardId, slide) {
  unwrap(await need().from('boards').update({ slide_max: slide }).eq('id', boardId)
    .or(`slide_max.is.null,slide_max.lt.${Number(slide)}`));
}

// 수업 모드: 수업자료 쪽 수
export async function setLessonSlideCount(code, n) {
  unwrap(await need().from('lessons').update({ slide_count: n }).eq('code', code));
}

// 진도 계산용 보드 (보관한 것 포함): [{ class_id, lesson_code, slide_max, status }]
export async function listProgressBoards() {
  return unwrap(await need().from('boards').select('class_id, lesson_code, slide_max, status'));
}

// 캘린더 구독 { token, periods: [[시작, 끝], …] } (1교시부터)
export async function getCalendarSettings() {
  const rows = unwrap(await need().from('settings').select('value').eq('key', 'calendar'));
  return rows[0]?.value ?? null;
}

export async function saveCalendarSettings(value) {
  unwrap(await need().from('settings').upsert({ key: 'calendar', value }, { onConflict: 'key' }));
}

// 구독 주소 (Edge Function 'calendar')
export const calendarFeedUrl = (token) => `${SUPABASE_URL}/functions/v1/calendar?t=${encodeURIComponent(token)}`;

// 진도 계산용: 차시를 적은 수업 줄 [{ class_id, lesson_code }] (여러 시간짜리 차시를 몇 시간 했는지)
export async function listTaughtRows() {
  return unwrap(await need().from('class_days').select('class_id, lesson_code').not('lesson_code', 'is', null));
}
