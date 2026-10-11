-- =========================================================
-- 03_functions.sql — RPC 함수
-- 학생 쪽 함수는 security definer + search_path 고정.
-- 교사 쪽 함수는 안에서 is_teacher()를 확인한다.
-- crypt()/gen_salt()는 Supabase에서 extensions 스키마에 있어서 search_path에 넣는다.
-- =========================================================

-- ---------------------------------------------------------
-- 학생 코드 확인 (내부용: 학생·교사가 직접 부를 수 없음)
-- ---------------------------------------------------------

-- 같은 학생 키로 10분 안에 5번 틀렸으면, 마지막으로 틀린 때부터 10분 동안 잠금
create or replace function public._code_locked(p_class_id int, p_number int)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key       text := p_class_id || '-' || p_number;
  v_last_ok   timestamptz;
  v_last_fail timestamptz;
  v_fails     int;
begin
  select max(attempted_at) into v_last_ok from public.code_attempts where student_key = v_key and ok;
  select max(attempted_at) into v_last_fail from public.code_attempts where student_key = v_key and not ok;
  if v_last_fail is null or v_last_fail < now() - interval '10 minutes' then
    return false;
  end if;
  select count(*) into v_fails
  from public.code_attempts
  where student_key = v_key
    and not ok
    and attempted_at > v_last_fail - interval '10 minutes'
    and attempted_at > coalesce(v_last_ok, '-infinity'::timestamptz);
  return v_fails >= 5;
end;
$$;

-- 맞으면 학생 id, 틀리면 null. 시도는 항상 기록한다.
create or replace function public._check_code(p_class_id int, p_number int, p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_id   uuid;
  v_hash text;
  v_ok   boolean := false;
begin
  select id, code_hash into v_id, v_hash
  from public.students
  where class_id = p_class_id and number = p_number and active;

  if v_hash is not null and coalesce(p_code, '') ~ '^[0-9]{6}$' then
    v_ok := crypt(p_code, v_hash) = v_hash;
  end if;

  insert into public.code_attempts (student_key, ok) values (p_class_id || '-' || p_number, v_ok);
  if random() < 0.05 then
    delete from public.code_attempts where attempted_at < now() - interval '1 day';
  end if;

  return case when v_ok then v_id end;
end;
$$;

-- 6자리 무작위 코드
create or replace function public._new_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  b bytea := gen_random_bytes(4);
begin
  return lpad(((get_byte(b, 0)::bigint * 16777216 + get_byte(b, 1) * 65536 + get_byte(b, 2) * 256 + get_byte(b, 3)) % 1000000)::text, 6, '0');
end;
$$;

revoke all on function public._code_locked(int, int) from public, anon, authenticated;
revoke all on function public._check_code(int, int, text) from public, anon, authenticated;
revoke all on function public._new_code() from public, anon, authenticated;

-- ---------------------------------------------------------
-- 학생 로그인 (출입증)
-- 로그인하면 기기 전용 출입증(무작위 64자)을 돌려주고, 저장은 sha256 해시만 한다.
-- 학생 함수는 코드 대신 출입증을 받는다. 로그아웃, 반 잠금, 코드 다시 발급 때 출입증을 지운다.
-- ---------------------------------------------------------

-- 출입증 → 학생 id. 없거나, 명단에서 뺐거나, 반이 잠겼으면 null (내부용)
create or replace function public._session_student(p_token text)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select s.id
  from public.student_sessions x
  join public.students s on s.id = x.student_id and s.active
  join public.classes c on c.id = s.class_id and not c.locked
  where coalesce(p_token, '') ~ '^[0-9a-f]{64}$'
    and x.token_hash = encode(digest(p_token, 'sha256'), 'hex');
$$;
revoke all on function public._session_student(text) from public, anon, authenticated;

-- 로그인 (학생)
-- 결과: {ok: true, token, class_id, number} 또는 {ok: false, error}
--   CLASS_LOCKED 선생님이 반을 잠금 · LOCKED 코드를 여러 번 틀림 · BAD_CODE 반, 번호 또는 코드가 맞지 않음
create or replace function public.student_login(p_class_id int, p_number int, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  v_token text;
begin
  if exists (select 1 from public.classes where id = p_class_id and locked) then
    return jsonb_build_object('ok', false, 'error', 'CLASS_LOCKED');
  end if;
  if public._code_locked(p_class_id, p_number) then
    return jsonb_build_object('ok', false, 'error', 'LOCKED');
  end if;
  v_sid := public._check_code(p_class_id, p_number, p_code);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_CODE');
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.student_sessions (token_hash, student_id)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_sid);

  return jsonb_build_object('ok', true, 'token', v_token, 'class_id', p_class_id, 'number', p_number);
end;
$$;
revoke all on function public.student_login(int, int, text) from public;
grant execute on function public.student_login(int, int, text) to anon, authenticated;

-- 로그아웃 (학생): 이 기기의 출입증을 지운다
create or replace function public.student_logout(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  delete from public.student_sessions
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.student_logout(text) from public;
grant execute on function public.student_logout(text) to anon, authenticated;

-- 반 잠금 (교사): 잠그면 그 반 학생의 출입증을 모두 지운다(모두 로그아웃)
create or replace function public.set_class_lock(p_class_id int, p_locked boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_removed int := 0;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  update public.classes set locked = p_locked where id = p_class_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if p_locked then
    delete from public.student_sessions x
    using public.students s
    where s.id = x.student_id and s.class_id = p_class_id;
    get diagnostics v_removed = row_count;
  end if;
  return jsonb_build_object('ok', true, 'class_id', p_class_id, 'locked', p_locked, 'removed', v_removed);
end;
$$;
revoke all on function public.set_class_lock(int, boolean) from public, anon;
grant execute on function public.set_class_lock(int, boolean) to authenticated;

-- ---------------------------------------------------------
-- 빈칸 질문 도우미 (7단계, 내부용)
-- ---------------------------------------------------------

-- 답 비교용: 앞뒤·사이 공백을 모두 빼고 영문은 소문자로
create or replace function public._quiz_norm(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(coalesce(p, ''), '\s+', '', 'g'));
$$;

-- 학생에게 보낼 문항: 정답(answers)을 뺀다
create or replace function public._quiz_public_items(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(e - 'answers' order by o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(e, o);
$$;
revoke all on function public._quiz_norm(text) from public, anon, authenticated;
revoke all on function public._quiz_public_items(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------
-- 반 페이지 (누구나)
-- 오늘 보드 + 그날 모둠별 상태·교사 메모. 제출 시각·순서는 주지 않는다.
-- has_roster: 이 반에 명단이 있는지
-- p_token(로그인 출입증)을 넘기면 session('ok' 또는 'none'), my_group(그날 모둠, 없으면 null),
-- my_members(그날 우리 모둠원의 승인된 닉네임·캐릭터, 번호는 주지 않음)도 준다. 다른 반 출입증은 'none'.
-- 보드가 발표됐으면 모둠 순위(rank)도 준다.
-- 발표 전에는 내 모둠이 아닌 모둠(출입증이 없으면 모든 모둠)의 'passed'를 'pending'으로 내보낸다.
-- quiz: 오늘 보드에서 마지막으로 연 빈칸 질문(7단계). 문제 글·종류·선택지만 주고 정답(answers)은 주지 않는다.
--   mine: 내가 낸 답, graded: 'graded'이면 내 결과(문항별 맞음/틀림)·받은 XP·코인·레벨 변화
-- ---------------------------------------------------------
drop function if exists public.get_class_page(int);
drop function if exists public.get_class_page(int, int);

create or replace function public.get_class_page(p_class_id int, p_token text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c        public.classes;
  b        public.boards;
  v_sid    uuid;
  v_my     smallint;
  v_groups jsonb;
  v_result jsonb;
  v_members jsonb;
  q        public.quizzes;
  a        public.quiz_answers;
  v_quiz   jsonb;
  v_gxp    int;
  v_gco    int;
  v_total  int;
begin
  select * into c from public.classes where id = p_class_id;
  if not found then
    return null;
  end if;

  if c.today_board_id is not null then
    select * into b from public.boards where id = c.today_board_id;
  end if;

  if p_token is not null then
    select s.id into v_sid from public.students s
    where s.id = public._session_student(p_token) and s.class_id = p_class_id;
    if v_sid is not null and b.id is not null then
      select group_no into v_my from public.board_groups where board_id = b.id and student_id = v_sid;
    end if;
  end if;

  if v_my is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'nickname', s.nickname,
             'avatar',   s.avatar,
             'me',       s.id = v_sid
           ) order by s.number), '[]'::jsonb)
    into v_members
    from public.board_groups g
    join public.students s on s.id = g.student_id
    where g.board_id = b.id and g.group_no = v_my;
  end if;

  v_result := case when b.status = 'revealed' then coalesce(b.result -> 'ranking', '[]'::jsonb) else '[]'::jsonb end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'no',       g.group_no,
           'members',  g.members,
           'state',    case
                         when s.status = 'passed' and b.status <> 'revealed' and g.group_no is distinct from v_my then 'pending'
                         else coalesce(s.status, 'idle')
                       end,
           'feedback', case when s.status = 'returned' then s.feedback end,
           'rank',     r.rn
         ) order by g.group_no), '[]'::jsonb)
  into v_groups
  from (
    select group_no, count(*)::int as members
    from public.board_groups
    where board_id = b.id
    group by group_no
  ) g
  left join lateral (
    select x.status, x.feedback
    from public.submissions x
    where x.board_id = b.id and x.group_no = g.group_no
    order by x.submitted_at desc
    limit 1
  ) s on true
  left join lateral (
    select (e.item ->> 'rank')::int as rn
    from jsonb_array_elements(v_result) as e(item)
    where (e.item ->> 'group_no')::int = g.group_no
    limit 1
  ) r on true;

  if b.id is not null then
    select * into q from public.quizzes where board_id = b.id order by opened_at desc limit 1;
  end if;
  if q.id is not null then
    if v_sid is not null then
      select * into a from public.quiz_answers where quiz_id = q.id and student_id = v_sid;
    end if;
    if q.status = 'graded' and v_sid is not null then
      select coalesce(sum(xp), 0)::int, coalesce(sum(coins), 0)::int into v_gxp, v_gco
      from public.point_events where student_id = v_sid and quiz_id = q.id;
      select coalesce(sum(xp), 0)::int into v_total from public.point_events where student_id = v_sid;
    end if;
    v_quiz := jsonb_build_object(
      'id',       q.id,
      'slide_no', q.slide_no,
      'status',   q.status,
      'items',    public._quiz_public_items(q.items),
      'mine',     case when a.quiz_id is null then null
                       else jsonb_build_object('answers', a.answers, 'submitted_at', a.submitted_at) end,
      'graded',   case when q.status = 'graded' and v_sid is not null then jsonb_build_object(
                    'result',       coalesce(a.result, '{}'::jsonb),
                    'answered',     a.quiz_id is not null,
                    'xp',           v_gxp,
                    'coins',        v_gco,
                    'level_before', (public._level_info(v_total - v_gxp) ->> 'level')::int,
                    'level_after',  (public._level_info(v_total) ->> 'level')::int,
                    'total_xp',     v_total
                  ) end
    );
  end if;

  return jsonb_build_object(
    'class', jsonb_build_object('id', c.id, 'label', c.label),
    'board', case when b.id is null then null else jsonb_build_object(
      'id',          b.id,
      'lesson_code', b.lesson_code,
      'title',       b.title,
      'padlet_src',  b.padlet_src,
      'sim_links',   b.sim_links,
      'status',      b.status
    ) end,
    'groups',     v_groups,
    'has_roster', exists (select 1 from public.students where class_id = p_class_id and active),
    'session',    case when p_token is null then null when v_sid is null then 'none' else 'ok' end,
    'my_group',   v_my,
    'my_members', v_members,
    'quiz',       v_quiz
  );
end;
$$;
revoke all on function public.get_class_page(int, text) from public;
grant execute on function public.get_class_page(int, text) to anon, authenticated;

-- ---------------------------------------------------------
-- 모둠 제출 (학생)
-- 결과: {ok: true, group_no} 또는 {ok: false, error}
--   NO_SESSION    로그인 안 됨(로그아웃, 반 잠금, 코드 다시 발급)
--   BOARD_CHANGED 오늘 보드가 아님
--   CLOSED        보드가 열려 있지 않음
--   NO_GROUP      그날 모둠에 없음 (아직 편성 전이거나 결석)
--   ALREADY       이미 검사 대기 중이거나 통과함
-- ---------------------------------------------------------
drop function if exists public.submit_group(uuid, int, int, text);
create or replace function public.submit_group(p_board_id uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  v_group smallint;
  v_today uuid;
  v_class int;
  b       public.boards;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;

  select s.class_id into v_class from public.students s where s.id = v_sid;
  select today_board_id into v_today from public.classes where id = v_class;
  select * into b from public.boards where id = p_board_id for update;
  if not found or b.class_id <> v_class or v_today is distinct from b.id then
    return jsonb_build_object('ok', false, 'error', 'BOARD_CHANGED');
  end if;
  if b.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;

  select group_no into v_group from public.board_groups where board_id = b.id and student_id = v_sid;
  if v_group is null then
    return jsonb_build_object('ok', false, 'error', 'NO_GROUP');
  end if;

  if exists (
    select 1 from public.submissions
    where board_id = b.id and group_no = v_group and status in ('pending', 'passed')
  ) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY');
  end if;

  insert into public.submissions (board_id, group_no, student_id) values (b.id, v_group, v_sid);
  return jsonb_build_object('ok', true, 'group_no', v_group);
end;
$$;
revoke all on function public.submit_group(uuid, text) from public;
grant execute on function public.submit_group(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------
-- 검사 (교사): 'passed' 또는 'returned'
-- ---------------------------------------------------------
create or replace function public.review_submission(p_id uuid, p_status text, p_feedback text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s public.submissions;
  b public.boards;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  if p_status not in ('passed', 'returned') then
    raise exception 'BAD_STATUS';
  end if;

  select * into s from public.submissions where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select * into b from public.boards where id = s.board_id;
  if b.status = 'revealed' then
    raise exception 'BOARD_REVEALED';
  end if;
  if s.status <> 'pending' then
    raise exception 'ALREADY_REVIEWED';
  end if;

  update public.submissions
  set status      = p_status,
      feedback    = case when p_status = 'returned' then nullif(btrim(p_feedback), '') end,
      reviewed_at = now()
  where id = p_id;

  return jsonb_build_object('ok', true, 'class_id', b.class_id);
end;
$$;
revoke all on function public.review_submission(uuid, text, text) from public, anon;
grant execute on function public.review_submission(uuid, text, text) to authenticated;

-- ---------------------------------------------------------
-- 모둠 편성 저장 (교사)
-- p_groups: 모둠 순서대로 번호 배열. 예: [[3, 12, 20], [5, 7, 9], ...] → 1모둠, 2모둠, ...
-- 그 보드에 제출이 하나라도 있으면 바꿀 수 없다(순위가 꼬이지 않게). 빈 배열이면 편성을 지운다.
-- ---------------------------------------------------------
create or replace function public.set_board_groups(p_board_id uuid, p_groups jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b       public.boards;
  v_count int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;

  select * into b from public.boards where id = p_board_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if b.status = 'revealed' then
    raise exception 'BOARD_REVEALED';
  end if;
  if exists (select 1 from public.submissions where board_id = b.id) then
    raise exception 'HAS_SUBMISSIONS';
  end if;

  delete from public.board_groups where board_id = b.id;

  insert into public.board_groups (board_id, student_id, group_no)
  select b.id, s.id, g.ord::smallint
  from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) with ordinality as g(nums, ord)
  cross join lateral jsonb_array_elements_text(g.nums) as n(num)
  join public.students s on s.class_id = b.class_id and s.number = n.num::int and s.active
  on conflict (board_id, student_id) do nothing;

  get diagnostics v_count = row_count;
  perform public._mark_pair_tickets(b.id);
  return jsonb_build_object('ok', true, 'count', v_count, 'class_id', b.class_id);
end;
$$;
revoke all on function public.set_board_groups(uuid, jsonb) from public, anon;
grant execute on function public.set_board_groups(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------
-- 순위 발표 (교사)
-- 'passed' 제출을 제출 시각 순서로 순위를 매기고, 그날 편성된 통과 모둠의 모둠원 전원에게 포인트 지급.
-- 이미 발표한 보드면 저장된 결과만 돌려준다(already: true). 포인트는 다시 주지 않는다.
-- point_events의 (student_id, board_id) 유일 조건이 중복 지급을 한 번 더 막는다.
-- ---------------------------------------------------------
create or replace function public.reveal_board(p_board_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b          public.boards;
  v_pts      jsonb;
  v_pass_xp  int;
  v_pass_co  int;
  v_bonus    jsonb;
  v_bonus_co jsonb;
  v_extra    int;
  v_extra_co int;
  v_members  int;
  v_reason   text;
  v_ranking  jsonb := '[]'::jsonb;
  v_result   jsonb;
  r          record;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;

  select * into b from public.boards where id = p_board_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if b.status = 'revealed' and b.result is not null then
    return b.result || jsonb_build_object('already', true);
  end if;

  select value into v_pts from public.settings where key = 'points';
  v_pass_xp := coalesce((v_pts ->> 'pass_xp')::int, 10);
  v_pass_co := coalesce((v_pts ->> 'pass_coins')::int, 10);
  v_bonus   := coalesce(v_pts -> 'rank_bonus', '[10, 6, 3]'::jsonb);        -- 순위 보너스 XP
  v_bonus_co := coalesce(v_pts -> 'rank_bonus_coins', v_bonus);          -- 순위 보너스 코인 (없으면 XP와 같게)

  -- 순위 변화(▲▼)용: 이번 발표로 포인트가 나갈 때만, 주기 직전의 이번 달 순위를 찍어 둔다
  if exists (select 1 from public.submissions where board_id = b.id and status = 'passed') then
    delete from public.rank_snapshots where true;
    insert into public.rank_snapshots (student_id, rank, month, board_id)
    select m.student_id, m.rnk, public._month_key(), b.id from public._month_ranks() m;
  end if;

  for r in
    select x.group_no, (row_number() over (order by x.submitted_at, x.id))::int as rn
    from public.submissions x
    where x.board_id = b.id and x.status = 'passed'
    order by x.submitted_at, x.id
  loop
    v_extra    := coalesce((v_bonus ->> (r.rn - 1))::int, 0);
    v_extra_co := coalesce((v_bonus_co ->> (r.rn - 1))::int, 0);
    v_reason := b.lesson_code || '차시 통과' || case when v_extra > 0 or v_extra_co > 0 then ' · ' || r.rn || '위' else '' end;

    insert into public.point_events (student_id, xp, coins, reason, board_id)
    select g.student_id, v_pass_xp + v_extra, v_pass_co + v_extra_co, v_reason, b.id
    from public.board_groups g
    where g.board_id = b.id and g.group_no = r.group_no
    on conflict (student_id, board_id) where board_id is not null do nothing;

    select count(*)::int into v_members
    from public.board_groups
    where board_id = b.id and group_no = r.group_no;

    v_ranking := v_ranking || jsonb_build_array(jsonb_build_object(
      'rank',     r.rn,
      'group_no', r.group_no,
      'xp',       v_pass_xp + v_extra,
      'coins',    v_pass_co + v_extra_co,
      'members',  v_members
    ));
  end loop;

  v_result := jsonb_build_object(
    'board_id',    b.id,
    'class_id',    b.class_id,
    'ranking',     v_ranking,
    'revealed_at', now()
  );
  update public.boards set status = 'revealed', result = v_result where id = b.id;

  return v_result || jsonb_build_object('already', false);
end;
$$;
revoke all on function public.reveal_board(uuid) from public, anon;
grant execute on function public.reveal_board(uuid) to authenticated;

-- ---------------------------------------------------------
-- 발표 취소 (교사)
-- 그 발표로 지급한 포인트 기록(point_events 중 board_id가 이 보드인 것)을 지우고 보드를 다시 연다.
-- 포인트 원장은 원래 정정 기록을 더하는 방식이지만, 발표 취소만은 예외로 지운다.
-- (정정 기록으로 하면 다시 발표할 때 "이미 받은 학생"이 되어 지급되지 않기 때문)
-- board_id가 붙은 포인트 기록은 발표 지급뿐이다.
-- ---------------------------------------------------------
create or replace function public.unreveal_board(p_board_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b         public.boards;
  v_removed int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;

  select * into b from public.boards where id = p_board_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if b.status <> 'revealed' then
    raise exception 'NOT_REVEALED';
  end if;

  delete from public.point_events where board_id = b.id;
  get diagnostics v_removed = row_count;
  delete from public.rank_snapshots where board_id = b.id;

  update public.boards set status = 'open', result = null where id = b.id;

  return jsonb_build_object('ok', true, 'removed', v_removed, 'class_id', b.class_id);
end;
$$;
revoke all on function public.unreveal_board(uuid) from public, anon;
grant execute on function public.unreveal_board(uuid) to authenticated;

-- ---------------------------------------------------------
-- 코드 발급 (교사)
-- 평문 코드는 이 응답에서만 돌려준다(인쇄용). 저장은 해시만.
-- p_only_missing = true면 코드가 없는 학생만.
-- ---------------------------------------------------------
create or replace function public.issue_codes(p_class_id int, p_only_missing boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  r      record;
  v_code text;
  v_out  jsonb := '[]'::jsonb;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;

  for r in
    select id, number from public.students
    where class_id = p_class_id and active and (not p_only_missing or code_hash is null)
    order by number
  loop
    v_code := public._new_code();
    update public.students set code_hash = crypt(v_code, gen_salt('bf')) where id = r.id;
    delete from public.student_sessions where student_id = r.id;
    delete from public.code_attempts where student_key = p_class_id || '-' || r.number;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'class_id', p_class_id, 'number', r.number, 'code', v_code
    ));
  end loop;

  return v_out;
end;
$$;
revoke all on function public.issue_codes(int, boolean) from public, anon;
grant execute on function public.issue_codes(int, boolean) to authenticated;

create or replace function public.reset_code(p_student_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  s      public.students;
  v_code text;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;

  select * into s from public.students where id = p_student_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  v_code := public._new_code();
  update public.students set code_hash = crypt(v_code, gen_salt('bf')) where id = s.id;
  delete from public.student_sessions where student_id = s.id;
  delete from public.code_attempts where student_key = s.class_id || '-' || s.number;

  return jsonb_build_object('class_id', s.class_id, 'number', s.number, 'code', v_code);
end;
$$;
revoke all on function public.reset_code(uuid) from public, anon;
grant execute on function public.reset_code(uuid) to authenticated;

-- =========================================================
-- 3단계: 캐릭터, 내 기록, 레벨, 닉네임, 이번 달 TOP 20
-- =========================================================

-- ---------------------------------------------------------
-- 내부용 도우미 (학생·교사가 직접 부를 수 없음)
-- ---------------------------------------------------------

-- 이번 달 1일 0시 (한국 시간)
create or replace function public._month_start()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;

-- 이번 달 이름 'YYYY-MM' (한국 시간)
create or replace function public._month_key()
returns text
language sql
stable
set search_path = public
as $$
  select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
$$;

-- 이번 달 XP와 순위 (XP가 0보다 큰 학생만, 명단에서 뺀 학생 제외, 동점은 같은 순위)
create or replace function public._month_ranks()
returns table (student_id uuid, xp int, rnk int)
language sql
stable
security definer
set search_path = public
as $$
  select t.sid, t.total, (rank() over (order by t.total desc))::int
  from (
    select e.student_id as sid, sum(e.xp)::int as total
    from public.point_events e
    join public.students s on s.id = e.student_id and s.active
    where e.created_at >= public._month_start()
    group by e.student_id
  ) t
  where t.total > 0;
$$;

-- 지난번 발표 대비 순위 변화: 숫자(+면 올라감), 'new'(지난번엔 순위 밖), null(비교할 기록 없음)
create or replace function public._rank_move(p_student_id uuid, p_rank int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_rank is null then null
    when not exists (select 1 from public.rank_snapshots where month = public._month_key()) then null
    else coalesce(
      (select to_jsonb(r.rank - p_rank) from public.rank_snapshots r
       where r.student_id = p_student_id and r.month = public._month_key()),
      to_jsonb('new'::text))
  end;
$$;

-- 누적 XP → 레벨. settings.level_thresholds를 쓰고, 표가 끝나면 마지막 간격에 10씩 더해 이어 간다
-- 결과: { level, floor(이 레벨 시작 XP), next(다음 레벨 XP) }
create or replace function public._level_info(p_xp int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_t    jsonb;
  v_arr  int[];
  v_n    int;
  v_step int;
  v_lv   int := 1;
begin
  select value into v_t from public.settings where key = 'level_thresholds';
  if jsonb_typeof(v_t) = 'array' and jsonb_array_length(v_t) > 0 then
    select array_agg(x::int order by o) into v_arr
    from jsonb_array_elements_text(v_t) with ordinality as a(x, o);
  else
    v_arr := array[0, 30, 70, 120, 180, 250, 330, 420, 520, 630];
  end if;
  v_n := array_length(v_arr, 1);
  v_step := case when v_n >= 2 then greatest(v_arr[v_n] - v_arr[v_n - 1], 10) else 30 end;
  while v_arr[v_n] <= greatest(p_xp, 0) loop
    v_step := v_step + 10;
    v_arr := v_arr || (v_arr[v_n] + v_step);
    v_n := v_n + 1;
  end loop;
  for i in 1 .. v_n loop
    if v_arr[i] <= p_xp then
      v_lv := i;
    end if;
  end loop;
  return jsonb_build_object('level', v_lv, 'floor', v_arr[v_lv], 'next', v_arr[v_lv + 1]);
end;
$$;

-- 무료 부품 무작위 조합
create or replace function public._random_avatar()
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(x.slot, x.id), '{}'::jsonb)
  from (
    select distinct on (slot) slot, id
    from public.avatar_items
    where active and price = 0
    order by slot, random()
  ) x;
$$;

revoke all on function public._month_start() from public, anon, authenticated;
revoke all on function public._month_key() from public, anon, authenticated;
revoke all on function public._month_ranks() from public, anon, authenticated;
revoke all on function public._rank_move(uuid, int) from public, anon, authenticated;
revoke all on function public._level_info(int) from public, anon, authenticated;
revoke all on function public._random_avatar() from public, anon, authenticated;

-- 새 학생은 캐릭터를 무작위로 받는다
create or replace function public._students_default_avatar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.avatar is null or new.avatar = '{}'::jsonb then
    new.avatar := public._random_avatar();
  end if;
  return new;
end;
$$;

drop trigger if exists students_default_avatar on public.students;
create trigger students_default_avatar
  before insert on public.students
  for each row execute function public._students_default_avatar();

-- ---------------------------------------------------------
-- 내 기록 (학생)
-- 결과: {ok: true, ...} 또는 {ok: false, error: 'NO_SESSION'}
-- wardrobe: 지금 입을 수 있는 부품 (판매 중인 무료 기본 + 산 아이템)
-- coins: 코인 잔액(보상 신청 중·승인된 가격은 뺌), purchases: 보상 신청 내역(최근 20개)
-- ---------------------------------------------------------
drop function if exists public.get_my_page(int, int, text);
create or replace function public.get_my_page(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  s       public.students;
  v_total int;
  v_coins int;
  v_month int;
  v_rank  int;
  v_hist  jsonb;
  v_wear  jsonb;
  v_buys  jsonb;
  v_board uuid;
  v_group smallint;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;

  select * into s from public.students where id = v_sid;

  select coalesce(sum(xp), 0)::int into v_total
  from public.point_events where student_id = v_sid;
  v_coins := public._coin_balance(v_sid);

  select m.xp, m.rnk into v_month, v_rank from public._month_ranks() m where m.student_id = v_sid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'at', e.created_at, 'reason', e.reason, 'xp', e.xp, 'coins', e.coins
         ) order by e.created_at desc, e.id desc), '[]'::jsonb)
  into v_hist
  from (
    select * from public.point_events
    where student_id = v_sid
    order by created_at desc, id desc
    limit 50
  ) e;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'slot', i.slot) order by i.slot, i.sort, i.id), '[]'::jsonb)
  into v_wear
  from public.avatar_items i
  where (i.active and i.price = 0)
     or exists (select 1 from public.student_items o where o.student_id = v_sid and o.item_id = i.id);

  v_buys := public._my_purchases(v_sid);

  select today_board_id into v_board from public.classes where id = s.class_id;
  if v_board is not null then
    select group_no into v_group from public.board_groups where board_id = v_board and student_id = v_sid;
  end if;

  return jsonb_build_object(
    'ok',               true,
    'class_id',         s.class_id,
    'number',           s.number,
    'nickname',         s.nickname,
    'nickname_request', s.nickname_request,
    'nickname_status',  s.nickname_status,
    'avatar',           s.avatar,
    'total_xp',         v_total,
    'level',            public._level_info(v_total),
    'month_xp',         coalesce(v_month, 0),
    'month_rank',       v_rank,
    'month_move',       public._rank_move(v_sid, v_rank),
    'coins',            v_coins,
    'history',          v_hist,
    'wardrobe',         v_wear,
    'purchases',        v_buys,
    'today_group',      v_group
  );
end;
$$;
revoke all on function public.get_my_page(text) from public;
grant execute on function public.get_my_page(text) to anon, authenticated;

-- ---------------------------------------------------------
-- 닉네임 신청 (학생)
-- 2~8자, 한글·영문·숫자만. 승인 전까지는 원래 닉네임(있으면)이 그대로 보인다.
-- 오류: NO_SESSION, BAD_NICK(규칙에 안 맞음), SAME(지금 닉네임과 같음), TAKEN(다른 학생이 쓰거나 신청 중)
-- ---------------------------------------------------------
drop function if exists public.request_nickname(int, int, text, text);
create or replace function public.request_nickname(p_token text, p_nickname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid  uuid;
  v_nick text := btrim(coalesce(p_nickname, ''));
  s      public.students;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;

  if char_length(v_nick) not between 2 and 8 or v_nick !~ '^[가-힣A-Za-z0-9]+$' then
    return jsonb_build_object('ok', false, 'error', 'BAD_NICK');
  end if;

  select * into s from public.students where id = v_sid for update;
  if s.nickname = v_nick then
    return jsonb_build_object('ok', false, 'error', 'SAME');
  end if;
  if exists (
    select 1 from public.students x
    where x.id <> v_sid and x.active
      and (lower(x.nickname) = lower(v_nick)
           or (x.nickname_status = 'pending' and lower(x.nickname_request) = lower(v_nick)))
  ) then
    return jsonb_build_object('ok', false, 'error', 'TAKEN');
  end if;

  update public.students
  set nickname_request = v_nick, nickname_status = 'pending'
  where id = v_sid;

  return jsonb_build_object('ok', true, 'nickname_request', v_nick, 'nickname_status', 'pending');
end;
$$;
revoke all on function public.request_nickname(text, text) from public;
grant execute on function public.request_nickname(text, text) to anon, authenticated;

-- ---------------------------------------------------------
-- 캐릭터 저장 (학생)
-- 7칸(face, hair, eyes, mouth, outfit, acc, bg)이 모두 있어야 하고, 판매 중인 무료 부품이나 산 부품만 허용
-- 오류: NO_SESSION, BAD_ITEM
-- ---------------------------------------------------------
drop function if exists public.save_avatar(int, int, text, jsonb);
create or replace function public.save_avatar(p_token text, p_avatar jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid  uuid;
  v_out  jsonb := '{}'::jsonb;
  v_slot text;
  v_id   text;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;

  foreach v_slot in array array['face', 'hair', 'eyes', 'mouth', 'outfit', 'acc', 'bg'] loop
    v_id := case when jsonb_typeof(p_avatar) = 'object' then p_avatar ->> v_slot end;
    if v_id is null or not public._can_wear(v_sid, v_id, v_slot) then
      return jsonb_build_object('ok', false, 'error', 'BAD_ITEM');
    end if;
    v_out := v_out || jsonb_build_object(v_slot, v_id);
  end loop;

  update public.students set avatar = v_out where id = v_sid;
  return jsonb_build_object('ok', true, 'avatar', v_out);
end;
$$;
revoke all on function public.save_avatar(text, jsonb) from public;
grant execute on function public.save_avatar(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- 이번 달 TOP 20 (누구나)
-- 반, 승인된 닉네임(없으면 null), 캐릭터, 이번 달 XP, 순위 변화. 번호는 주지 않는다.
-- 동점은 같은 순위라서 20줄보다 많을 수 있다.
-- ---------------------------------------------------------
create or replace function public.get_month_top20()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key  text := public._month_key();
  v_snap boolean;
  v_rows jsonb;
begin
  v_snap := exists (select 1 from public.rank_snapshots where month = v_key);

  select coalesce(jsonb_agg(jsonb_build_object(
           'rank',     m.rnk,
           'class_id', s.class_id,
           'nickname', s.nickname,
           'avatar',   s.avatar,
           'xp',       m.xp,
           'move',     case when not v_snap then null
                            when p.rank is null then to_jsonb('new'::text)
                            else to_jsonb(p.rank - m.rnk) end
         ) order by m.rnk, s.class_id, s.number), '[]'::jsonb)
  into v_rows
  from public._month_ranks() m
  join public.students s on s.id = m.student_id
  left join public.rank_snapshots p on p.student_id = m.student_id and p.month = v_key
  where m.rnk <= 20;

  return jsonb_build_object('month', v_key, 'rows', v_rows);
end;
$$;
revoke all on function public.get_month_top20() from public;
grant execute on function public.get_month_top20() to anon, authenticated;

-- ---------------------------------------------------------
-- 닉네임 승인·거절 (교사)
-- 승인: 신청한 닉네임이 공개 닉네임이 된다. 거절: 원래 닉네임(있으면)은 그대로, 상태만 'rejected'
-- ---------------------------------------------------------
create or replace function public.decide_nickname(p_student_id uuid, p_approve boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s public.students;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;

  select * into s from public.students where id = p_student_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if s.nickname_status <> 'pending' or s.nickname_request is null then
    raise exception 'NOT_PENDING';
  end if;

  if p_approve then
    update public.students
    set nickname = nickname_request, nickname_request = null, nickname_status = 'approved'
    where id = s.id;
  else
    update public.students set nickname_status = 'rejected' where id = s.id;
  end if;

  return jsonb_build_object('ok', true, 'class_id', s.class_id);
end;
$$;
revoke all on function public.decide_nickname(uuid, boolean) from public, anon;
grant execute on function public.decide_nickname(uuid, boolean) to authenticated;

-- =========================================================
-- 4단계: 포인트 상점
-- 코인 잔액 = point_events.coins 합 − purchases.cost 합('requested', 'approved')
-- 꾸미기 아이템은 사는 순간 point_events에 coins = -가격으로 남는다
-- =========================================================

-- 코인 잔액 (내부용)
create or replace function public._coin_balance(p_student_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum(coins) from public.point_events where student_id = p_student_id), 0)
    - coalesce((select sum(cost) from public.purchases
                where student_id = p_student_id and status in ('requested', 'approved')), 0)
  )::int;
$$;

-- 이 부품을 입을 수 있는지: 판매 중인 무료 부품이거나 산 부품 (내부용)
create or replace function public._can_wear(p_student_id uuid, p_item_id text, p_slot text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.avatar_items i
    where i.id = p_item_id and i.slot = p_slot
      and ((i.active and i.price = 0)
           or exists (select 1 from public.student_items o where o.student_id = p_student_id and o.item_id = i.id))
  );
$$;

-- 보상 신청 내역 최근 20개 (내부용). used: 모둠 선택권을 이미 썼는지
create or replace function public._my_purchases(p_student_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'item_id', x.item_id, 'name', x.name, 'kind', x.kind, 'cost', x.cost,
           'status', x.status, 'partner_number', x.partner_number, 'used', x.used_board_id is not null,
           'requested_at', x.requested_at, 'decided_at', x.decided_at
         ) order by x.requested_at desc), '[]'::jsonb)
  from (
    select p.*, i.name, i.kind
    from public.purchases p
    join public.shop_items i on i.id = p.item_id
    where p.student_id = p_student_id
    order by p.requested_at desc
    limit 20
  ) x;
$$;

-- 모둠 선택권 사용 표시 (내부용, set_board_groups가 부른다)
-- 이 보드 편성에서 산 학생과 고른 친구가 같은 모둠이면 그 선택권을 이 보드에서 쓴 것으로 한다.
-- 같은 보드를 다시 편성하면 먼저 이 보드의 표시를 지우고 새로 매긴다.
create or replace function public._mark_pair_tickets(p_board_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.purchases set used_board_id = null where used_board_id = p_board_id;

  update public.purchases p
  set used_board_id = p_board_id
  where p.id in (
    select distinct on (p2.student_id, p2.partner_number) p2.id
    from public.purchases p2
    join public.shop_items i on i.id = p2.item_id and i.kind = 'pair'
    join public.board_groups g1 on g1.board_id = p_board_id and g1.student_id = p2.student_id
    join public.students me on me.id = p2.student_id
    join public.students pt on pt.class_id = me.class_id and pt.number = p2.partner_number
    join public.board_groups g2 on g2.board_id = p_board_id and g2.student_id = pt.id
    where p2.status = 'approved' and p2.used_board_id is null and g1.group_no = g2.group_no
    order by p2.student_id, p2.partner_number, p2.requested_at
  );
end;
$$;

revoke all on function public._coin_balance(uuid) from public, anon, authenticated;
revoke all on function public._can_wear(uuid, text, text) from public, anon, authenticated;
revoke all on function public._my_purchases(uuid) from public, anon, authenticated;
revoke all on function public._mark_pair_tickets(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------
-- 상점 (학생)
-- 결과: {ok: true, coins, level, avatar, wardrobe, items, rewards, purchases, classmates} 또는 {ok: false, error: 'NO_SESSION'}
-- items: 판매 중인 꾸미기 아이템(가격 > 0) + 이미 산 아이템. owned/locked(레벨 부족) 표시
-- classmates: 모둠 선택권에서 고를 수 있는 같은 반 번호(나 빼고)
-- ---------------------------------------------------------
create or replace function public.get_shop(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  s       public.students;
  v_total int;
  v_lv    jsonb;
  v_items jsonb;
  v_rew   jsonb;
  v_wear  jsonb;
  v_mates jsonb;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;

  select * into s from public.students where id = v_sid;
  select coalesce(sum(xp), 0)::int into v_total from public.point_events where student_id = v_sid;
  v_lv := public._level_info(v_total);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'slot', i.slot, 'name', i.name, 'price', i.price, 'rarity', i.rarity,
           'min_level', i.min_level, 'owned', o.item_id is not null,
           'locked', o.item_id is null and i.min_level > (v_lv ->> 'level')::int
         ) order by i.slot, i.sort, i.id), '[]'::jsonb)
  into v_items
  from public.avatar_items i
  left join public.student_items o on o.student_id = v_sid and o.item_id = i.id
  where (i.active and i.price > 0) or o.item_id is not null;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'slot', i.slot) order by i.slot, i.sort, i.id), '[]'::jsonb)
  into v_wear
  from public.avatar_items i
  where (i.active and i.price = 0)
     or exists (select 1 from public.student_items o where o.student_id = v_sid and o.item_id = i.id);

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'cost', cost, 'kind', kind)
         order by sort, id), '[]'::jsonb)
  into v_rew
  from public.shop_items where active;

  select coalesce(jsonb_agg(number order by number), '[]'::jsonb)
  into v_mates
  from public.students where class_id = s.class_id and active and id <> v_sid;

  return jsonb_build_object(
    'ok',         true,
    'class_id',   s.class_id,
    'number',     s.number,
    'nickname',   s.nickname,
    'avatar',     s.avatar,
    'level',      v_lv,
    'coins',      public._coin_balance(v_sid),
    'items',      v_items,
    'wardrobe',   v_wear,
    'rewards',    v_rew,
    'purchases',  public._my_purchases(v_sid),
    'classmates', v_mates
  );
end;
$$;
revoke all on function public.get_shop(text) from public;
grant execute on function public.get_shop(text) to anon, authenticated;

-- ---------------------------------------------------------
-- 꾸미기 아이템 사기 (학생). 교사 승인 없이 바로 내 것이 된다
-- 오류: NO_SESSION, NOT_FOR_SALE(판매 안 함), OWNED(이미 가짐), LEVEL(레벨 부족), NO_COINS(코인 부족)
-- ---------------------------------------------------------
drop function if exists public.buy_avatar_item(int, int, text, text);
create or replace function public.buy_avatar_item(p_token text, p_item_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  it      public.avatar_items;
  v_total int;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  -- 같은 학생의 구매·신청을 한 줄로 세운다(두 번 눌러도 잔액이 꼬이지 않게)
  perform 1 from public.students where id = v_sid for update;

  select * into it from public.avatar_items where id = p_item_id and active and price > 0;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOR_SALE');
  end if;
  if exists (select 1 from public.student_items where student_id = v_sid and item_id = it.id) then
    return jsonb_build_object('ok', false, 'error', 'OWNED');
  end if;
  select coalesce(sum(xp), 0)::int into v_total from public.point_events where student_id = v_sid;
  if (public._level_info(v_total) ->> 'level')::int < it.min_level then
    return jsonb_build_object('ok', false, 'error', 'LEVEL', 'min_level', it.min_level);
  end if;
  if public._coin_balance(v_sid) < it.price then
    return jsonb_build_object('ok', false, 'error', 'NO_COINS');
  end if;

  insert into public.student_items (student_id, item_id) values (v_sid, it.id);
  insert into public.point_events (student_id, xp, coins, reason)
  values (v_sid, 0, -it.price, '아이템: ' || it.name);

  return jsonb_build_object('ok', true, 'item_id', it.id, 'coins', public._coin_balance(v_sid));
end;
$$;
revoke all on function public.buy_avatar_item(text, text) from public;
grant execute on function public.buy_avatar_item(text, text) to anon, authenticated;

-- ---------------------------------------------------------
-- 보상 신청 (학생). 교사가 승인하거나 거절한다. 신청하는 순간 코인에서 빠지고, 거절되면 돌아온다
-- 모둠 선택권(kind = 'pair')은 같은 반 친구 번호(p_partner)가 필요하다
-- 오류: NO_SESSION, NOT_FOR_SALE, BAD_PARTNER(친구 번호가 맞지 않음), NO_COINS
-- ---------------------------------------------------------
drop function if exists public.request_purchase(int, int, text, text);
create or replace function public.request_purchase(p_token text, p_item_id text, p_partner int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid uuid;
  s     public.students;
  it    public.shop_items;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid for update;

  select * into it from public.shop_items where id = p_item_id and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOR_SALE');
  end if;
  if it.kind = 'pair' and (
       p_partner is null or p_partner = s.number
       or not exists (select 1 from public.students where class_id = s.class_id and number = p_partner and active)
     ) then
    return jsonb_build_object('ok', false, 'error', 'BAD_PARTNER');
  end if;
  if public._coin_balance(v_sid) < it.cost then
    return jsonb_build_object('ok', false, 'error', 'NO_COINS');
  end if;

  insert into public.purchases (student_id, item_id, cost, partner_number)
  values (v_sid, it.id, it.cost, case when it.kind = 'pair' then p_partner end);

  return jsonb_build_object('ok', true, 'coins', public._coin_balance(v_sid), 'purchases', public._my_purchases(v_sid));
end;
$$;
revoke all on function public.request_purchase(text, text, int) from public;
grant execute on function public.request_purchase(text, text, int) to anon, authenticated;

-- ---------------------------------------------------------
-- 보상 승인·거절 (교사). 'requested'만 바꿀 수 있다
-- ---------------------------------------------------------
create or replace function public.decide_purchase(p_id uuid, p_approve boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  p public.purchases;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select * into p from public.purchases where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if p.status <> 'requested' then
    raise exception 'NOT_PENDING';
  end if;
  update public.purchases
  set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
  where id = p.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.decide_purchase(uuid, boolean) from public, anon;
grant execute on function public.decide_purchase(uuid, boolean) to authenticated;

-- ---------------------------------------------------------
-- 점수 직접 주기 (교사)
-- 고른 학생들에게 XP·코인을 사유와 함께 준다. 빼야 하면 음수(정정 기록). 발표 지급과 달리 board_id 없음
-- 오류: BAD_AMOUNT(둘 다 0이거나 범위 밖), BAD_REASON(사유 없음), NO_STUDENTS
-- ---------------------------------------------------------
create or replace function public.grant_points(p_student_ids uuid[], p_xp int, p_coins int, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_count  int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  if coalesce(p_xp, 0) = 0 and coalesce(p_coins, 0) = 0
     or abs(coalesce(p_xp, 0)) > 1000 or abs(coalesce(p_coins, 0)) > 1000 then
    raise exception 'BAD_AMOUNT';
  end if;
  if char_length(v_reason) not between 1 and 40 then
    raise exception 'BAD_REASON';
  end if;

  insert into public.point_events (student_id, xp, coins, reason)
  select s.id, coalesce(p_xp, 0), coalesce(p_coins, 0), v_reason
  from public.students s
  where s.id = any(coalesce(p_student_ids, '{}')) and s.active;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'NO_STUDENTS';
  end if;

  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;
revoke all on function public.grant_points(uuid[], int, int, text) from public, anon;
grant execute on function public.grant_points(uuid[], int, int, text) to authenticated;

-- =========================================================
-- 7단계: 수업 중 빈칸 답 → XP
-- 교사가 수업 모드에서 한 쪽의 빈칸을 질문으로 열면, 학생이 반 페이지에서 답을 낸다.
-- 자동 채점(단어·고르기·부등호)은 낼 때 서버에서, 문장 답은 교사가 검사 화면에서 체크한다.
-- 결과와 정답은 'graded'가 되기 전에는 학생 쪽에 내보내지 않는다(다시 내며 맞혀 보기 막기).
-- =========================================================

-- 질문 열기 (교사)
-- p_items: [{type: 'blank'|'choice'|'sym'|'text', prompt, options?, answers: [정답, 허용 답…]}]
-- key('k1'…)와 번호(no)는 여기서 매긴다. 'text'이거나 정답이 비어 있으면 교사 체크.
-- 그 보드에 열린 질문이 있으면 먼저 마감한다(열린 질문은 보드마다 1개).
create or replace function public.open_quiz(p_board_id uuid, p_slide_no int, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b       public.boards;
  v_items jsonb;
  v_id    uuid;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select * into b from public.boards where id = p_board_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 40 then
    raise exception 'BAD_ITEMS';
  end if;

  select jsonb_agg(jsonb_build_object(
           'key',     'k' || x.o,
           'no',      x.o,
           'kind',    case when x.t = 'text' or jsonb_array_length(x.ans) = 0 then 'teacher' else 'auto' end,
           'type',    x.t,
           'prompt',  left(btrim(coalesce(x.e ->> 'prompt', '')), 400),
           'options', x.opts,
           'answers', x.ans
         ) order by x.o)
  into v_items
  from (
    select e, o,
           case when e ->> 'type' in ('blank', 'choice', 'sym', 'text') then e ->> 'type' else 'blank' end as t,
           case when jsonb_typeof(e -> 'options') = 'array' then
             (select coalesce(jsonb_agg(left(btrim(v), 100)), '[]'::jsonb)
              from jsonb_array_elements_text(e -> 'options') as y(v) where btrim(v) <> '')
           else '[]'::jsonb end as opts,
           case when jsonb_typeof(e -> 'answers') = 'array' then
             (select coalesce(jsonb_agg(left(btrim(v), 200)), '[]'::jsonb)
              from jsonb_array_elements_text(e -> 'answers') as y(v) where btrim(v) <> '')
           else '[]'::jsonb end as ans
    from jsonb_array_elements(p_items) with ordinality as z(e, o)
  ) x;

  update public.quizzes set status = 'closed', closed_at = now()
  where board_id = b.id and status = 'open';

  insert into public.quizzes (board_id, slide_no, items)
  values (b.id, p_slide_no, v_items)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'class_id', b.class_id, 'items', v_items);
end;
$$;
revoke all on function public.open_quiz(uuid, int, jsonb) from public, anon;
grant execute on function public.open_quiz(uuid, int, jsonb) to authenticated;

-- 질문 마감 (교사). 이미 마감했으면 그대로
create or replace function public.close_quiz(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  q public.quizzes;
  v_class int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  update public.quizzes set status = 'closed', closed_at = now()
  where id = p_id and status = 'open';
  select * into q from public.quizzes where id = p_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select class_id into v_class from public.boards where id = q.board_id;
  return jsonb_build_object('ok', true, 'status', q.status, 'class_id', v_class);
end;
$$;
revoke all on function public.close_quiz(uuid) from public, anon;
grant execute on function public.close_quiz(uuid) to authenticated;

-- 제출 현황 (교사, 프로젝터 띠). 학생 답·이름은 주지 않는다
-- total: 그날 모둠 편성 인원(편성이 없으면 명단 인원)
-- items: 문항별 맞은 수(correct)와 자동 채점 정답률(rate, %). pending_teacher: 아직 체크하지 않은 답이 남은 교사 체크 문항 수
create or replace function public.get_quiz_stats(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q       public.quizzes;
  b       public.boards;
  v_sub   int;
  v_total int;
  v_items jsonb;
  v_left  int;
  v_paid  int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select * into q from public.quizzes where id = p_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select * into b from public.boards where id = q.board_id;

  select count(*)::int into v_sub from public.quiz_answers where quiz_id = q.id;
  select count(*)::int into v_total from public.board_groups where board_id = q.board_id;
  if v_total = 0 then
    select count(*)::int into v_total from public.students where class_id = b.class_id and active;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'key',     it ->> 'key',
           'no',      (it ->> 'no')::int,
           'kind',    it ->> 'kind',
           'correct', c.n,
           'rate',    case when it ->> 'kind' = 'auto' and v_sub > 0 then round(c.n * 100.0 / v_sub)::int end
         ) order by o), '[]'::jsonb),
         count(*) filter (where it ->> 'kind' = 'teacher' and c.unmarked > 0)::int
  into v_items, v_left
  from jsonb_array_elements(q.items) with ordinality as t(it, o)
  cross join lateral (
    select count(*) filter (where a.result ->> (it ->> 'key') = 'true')::int as n,
           count(*) filter (where not (coalesce(a.result, '{}'::jsonb) ? (it ->> 'key')))::int as unmarked
    from public.quiz_answers a
    where a.quiz_id = q.id
  ) c;

  select count(*)::int into v_paid from public.point_events where quiz_id = q.id;

  return jsonb_build_object(
    'id',              q.id,
    'status',          q.status,
    'slide_no',        q.slide_no,
    'submitted',       v_sub,
    'total',           v_total,
    'items',           v_items,
    'pending_teacher', v_left,
    'paid',            v_paid
  );
end;
$$;
revoke all on function public.get_quiz_stats(uuid) from public, anon;
grant execute on function public.get_quiz_stats(uuid) to authenticated;

-- 답 모아 보기 (교사, 검사 화면 [빈칸] 탭). 문항마다 같은 답끼리 묶어 개수와 함께
-- correct: 그 답을 낸 학생이 모두 맞음이면 true, 모두 틀림이면 false, 아직 안 정했거나 섞였으면 null
create or replace function public.get_quiz_answers(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q        public.quizzes;
  b        public.boards;
  v_groups jsonb;
  v_sub    int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select * into q from public.quizzes where id = p_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select * into b from public.boards where id = q.board_id;
  select count(*)::int into v_sub from public.quiz_answers where quiz_id = q.id;

  select coalesce(jsonb_agg(jsonb_build_object('key', it ->> 'key', 'answers', g.list) order by o), '[]'::jsonb)
  into v_groups
  from jsonb_array_elements(q.items) with ordinality as t(it, o)
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('text', x.txt, 'count', x.n, 'correct', x.c)
                              order by x.txt = '', x.n desc, x.txt), '[]'::jsonb) as list
    from (
      select public._quiz_norm(a.answers ->> (it ->> 'key')) as k,
             min(btrim(coalesce(a.answers ->> (it ->> 'key'), ''))) as txt,
             count(*)::int as n,
             case
               when count(*) filter (where a.result ->> (it ->> 'key') is null) > 0 then null
               when bool_and(a.result ->> (it ->> 'key') = 'true') then true
               else case when bool_or(a.result ->> (it ->> 'key') = 'true') then null else false end
             end as c
      from public.quiz_answers a
      where a.quiz_id = q.id
      group by 1
    ) x
  ) g;

  return jsonb_build_object(
    'quiz', jsonb_build_object(
      'id', q.id, 'board_id', q.board_id, 'slide_no', q.slide_no, 'status', q.status, 'items', q.items,
      'opened_at', q.opened_at, 'class_id', b.class_id, 'lesson_code', b.lesson_code
    ),
    'submitted', v_sub,
    'groups',    v_groups
  );
end;
$$;
revoke all on function public.get_quiz_answers(uuid) from public, anon;
grant execute on function public.get_quiz_answers(uuid) to authenticated;

-- 맞음/틀림 정하기 (교사). 같은 답을 낸 학생 모두 한 번에. 자동 채점 문항도 고칠 수 있다(허용 답 추가처럼)
-- 마감된 질문만(열려 있으면 QUIZ_OPEN, XP를 준 뒤에는 GRADED)
create or replace function public.mark_quiz(p_id uuid, p_key text, p_answer text, p_correct boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  q       public.quizzes;
  v_count int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select * into q from public.quizzes where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if q.status = 'open' then
    raise exception 'QUIZ_OPEN';
  end if;
  if q.status = 'graded' then
    raise exception 'GRADED';
  end if;
  if not exists (select 1 from jsonb_array_elements(q.items) it where it ->> 'key' = p_key) then
    raise exception 'BAD_KEY';
  end if;

  update public.quiz_answers
  set result = coalesce(result, '{}'::jsonb) || jsonb_build_object(p_key, coalesce(p_correct, false))
  where quiz_id = q.id
    and public._quiz_norm(answers ->> p_key) = public._quiz_norm(p_answer);
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;
revoke all on function public.mark_quiz(uuid, text, text, boolean) from public, anon;
grant execute on function public.mark_quiz(uuid, text, text, boolean) to authenticated;

-- XP 주기 (교사): 결과 확정 + 정답 1개당 settings.quiz의 XP·코인. 열려 있으면 먼저 마감한다.
-- 아직 체크하지 않은 답은 틀림으로 확정한다. 두 번 눌러도 한 번만(already: true, point_events 유일 조건도 막음)
create or replace function public.grade_quiz(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  q        public.quizzes;
  b        public.boards;
  v_set    jsonb;
  v_xp     int;
  v_co     int;
  v_reason text;
  v_paid   int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select * into q from public.quizzes where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select * into b from public.boards where id = q.board_id;
  if q.status = 'graded' then
    select count(*)::int into v_paid from public.point_events where quiz_id = q.id;
    return jsonb_build_object('ok', true, 'already', true, 'paid', v_paid, 'class_id', b.class_id);
  end if;

  select value into v_set from public.settings where key = 'quiz';
  v_xp := coalesce((v_set ->> 'xp')::int, 2);
  v_co := coalesce((v_set ->> 'coins')::int, 1);
  v_reason := '빈칸 ' || b.lesson_code || '-' || q.slide_no;

  -- 문항마다 맞음/틀림을 빠짐없이
  update public.quiz_answers a
  set result = (
    select coalesce(jsonb_object_agg(it ->> 'key', coalesce(a.result ->> (it ->> 'key') = 'true', false)), '{}'::jsonb)
    from jsonb_array_elements(q.items) it
  )
  where a.quiz_id = q.id;

  insert into public.point_events (student_id, xp, coins, reason, quiz_id)
  select x.student_id, x.n * v_xp, x.n * v_co, v_reason, q.id
  from (
    select a.student_id,
           (select count(*) from jsonb_each_text(a.result) r where r.value = 'true')::int as n
    from public.quiz_answers a
    join public.students s on s.id = a.student_id and s.active
    where a.quiz_id = q.id
  ) x
  where x.n > 0 and (v_xp <> 0 or v_co <> 0)
  on conflict (student_id, quiz_id) where quiz_id is not null do nothing;
  get diagnostics v_paid = row_count;

  update public.quizzes
  set status = 'graded', closed_at = coalesce(closed_at, now())
  where id = q.id;

  return jsonb_build_object('ok', true, 'already', false, 'paid', v_paid, 'class_id', b.class_id);
end;
$$;
revoke all on function public.grade_quiz(uuid) from public, anon;
grant execute on function public.grade_quiz(uuid) to authenticated;

-- 답 내기 (학생). 열려 있는 동안 다시 내면 덮어쓴다. 자동 채점은 여기서 하지만 결과는 돌려주지 않는다
-- 결과: {ok: true, submitted_at} 또는 {ok: false, error}
--   NO_SESSION 로그인 안 됨 · GONE 이 반의 질문이 아님 · CLOSED 마감됨
create or replace function public.submit_quiz(p_token text, p_quiz_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  v_class int;
  q       public.quizzes;
  b       public.boards;
  v_ans   jsonb;
  v_res   jsonb;
  v_at    timestamptz;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select class_id into v_class from public.students where id = v_sid;
  select * into q from public.quizzes where id = p_quiz_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'GONE');
  end if;
  select * into b from public.boards where id = q.board_id;
  if b.class_id <> v_class then
    return jsonb_build_object('ok', false, 'error', 'GONE');
  end if;
  if q.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;

  select coalesce(jsonb_object_agg(x.k, x.v), '{}'::jsonb),
         coalesce(jsonb_object_agg(x.k, x.ok) filter (where x.ok is not null), '{}'::jsonb)
  into v_ans, v_res
  from (
    select y.k, y.v,
           case
             when y.kind = 'auto' then y.v <> '' and exists (
               select 1 from jsonb_array_elements_text(y.it -> 'answers') as r(t)
               where public._quiz_norm(r.t) = public._quiz_norm(y.v))
             when y.v = '' then false
           end as ok
    from (
      select it ->> 'key' as k, it ->> 'kind' as kind, it,
             case
               when it ->> 'type' in ('choice', 'sym') and not exists (
                 select 1 from jsonb_array_elements_text(it -> 'options') as o(t)
                 where o.t = btrim(coalesce(p_answers ->> (it ->> 'key'), '')))
               then ''
               else left(btrim(coalesce(
                 case when jsonb_typeof(p_answers) = 'object' then p_answers ->> (it ->> 'key') end, '')), 200)
             end as v
      from jsonb_array_elements(q.items) it
    ) y
  ) x;

  insert into public.quiz_answers (quiz_id, student_id, answers, result)
  values (q.id, v_sid, v_ans, v_res)
  on conflict (quiz_id, student_id) do update
    set answers = excluded.answers, result = excluded.result, updated_at = now()
  returning submitted_at into v_at;

  return jsonb_build_object('ok', true, 'submitted_at', v_at);
end;
$$;
revoke all on function public.submit_quiz(text, uuid, jsonb) from public;
grant execute on function public.submit_quiz(text, uuid, jsonb) to anon, authenticated;
