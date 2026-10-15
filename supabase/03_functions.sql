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
-- 7단계(빈칸 질문) 함수 지우기: 8단계 학습지로 바뀜. 없으면 아무 일도 하지 않는다
-- ---------------------------------------------------------
drop function if exists public.open_quiz(uuid, int, jsonb);
drop function if exists public.close_quiz(uuid);
drop function if exists public.get_quiz_stats(uuid);
drop function if exists public.get_quiz_answers(uuid);
drop function if exists public.mark_quiz(uuid, text, text, boolean);
drop function if exists public.grade_quiz(uuid);
drop function if exists public.submit_quiz(text, uuid, jsonb);
drop function if exists public._quiz_public_items(jsonb);
drop function if exists public._quiz_norm(text);

-- ---------------------------------------------------------
-- 학습지 도우미 (8단계, 내부용)
-- ---------------------------------------------------------

-- 빈칸 비교용: 앞뒤·사이 공백을 모두 빼고 영문은 소문자로
create or replace function public._ws_norm(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(coalesce(p, ''), '\s+', '', 'g'));
$$;

-- 학생 답 정리: 학습지에 있는 칸만, 빈 답은 빼고, 한 칸 300자까지
create or replace function public._ws_clean(p_key jsonb, p_answers jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, left(btrim(p_answers ->> k), 300)), '{}'::jsonb)
  from jsonb_object_keys(coalesce(p_key, '{}'::jsonb)) as k
  where jsonb_typeof(p_answers) = 'object'
    and btrim(coalesce(p_answers ->> k, '')) <> '';
$$;

-- 채점: {empty: [빈 칸], wrong: [틀린 칸]} (칸 이름만. 정답은 돌려주지 않는다)
--   blank  정답·허용 답 중 하나와 같으면 (띄어쓰기·영문 대소문자 무시). 정답이 비어 있으면 채우기만 하면 됨
--   choice 정답(ok)을 골라야. 정답이 없는 고르기(예측)는 보기 중 하나를 고르면 됨
--   sym    맞는 부등호. text(서술)는 채우기만 하면 됨
create or replace function public._ws_check(p_key jsonb, p_answers jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'empty', coalesce(jsonb_agg(x.k order by x.o) filter (where x.v = ''), '[]'::jsonb),
    'wrong', coalesce(jsonb_agg(x.k order by x.o) filter (where x.v <> '' and not x.ok), '[]'::jsonb)
  )
  from (
    select y.k, y.o, y.v,
           case
             when y.t = 'text' then true
             when y.t in ('choice', 'sym') and jsonb_array_length(y.ans) = 0 then
               exists (select 1 from jsonb_array_elements_text(y.opts) as z(t) where z.t = y.v)
             when y.t in ('choice', 'sym') then
               exists (select 1 from jsonb_array_elements_text(y.ans) as z(t) where btrim(z.t) = y.v)
             when jsonb_array_length(y.ans) = 0 then true
             else exists (select 1 from jsonb_array_elements_text(y.ans) as z(t) where public._ws_norm(z.t) = public._ws_norm(y.v))
           end as ok
    from (
      select e.key as k,
             coalesce(nullif(regexp_replace(e.key, '\D', '', 'g'), ''), '0')::int as o,
             e.value ->> 'type' as t,
             coalesce(e.value -> 'answers', '[]'::jsonb) as ans,
             coalesce(e.value -> 'options', '[]'::jsonb) as opts,
             btrim(coalesce(case when jsonb_typeof(p_answers) = 'object' then p_answers ->> e.key end, '')) as v
      from jsonb_each(coalesce(p_key, '{}'::jsonb)) as e
    ) y
  ) x;
$$;
-- 저장할 답 합치기: 이미 제출한 칸(passed)은 원래 답 그대로, 나머지는 새 답
create or replace function public._ws_merge(p_old jsonb, p_passed jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select (coalesce(p_new, '{}'::jsonb) - array(select jsonb_array_elements_text(coalesce(p_passed, '[]'::jsonb))))
      || coalesce((select jsonb_object_agg(k, p_old -> k)
                   from jsonb_array_elements_text(coalesce(p_passed, '[]'::jsonb)) as k
                   where coalesce(p_old, '{}'::jsonb) ? k), '{}'::jsonb);
$$;
revoke all on function public._ws_merge(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._ws_norm(text) from public, anon, authenticated;
revoke all on function public._ws_clean(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._ws_check(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------
-- 반 페이지 (누구나)
-- 오늘 보드 + 그날 모둠별 상태·교사 메모. 제출 시각·순서는 주지 않는다.
-- has_roster: 이 반에 명단이 있는지
-- p_token(로그인 출입증)을 넘기면 session('ok' 또는 'none'), my_group(그날 모둠, 없으면 null),
-- my_members(그날 우리 모둠원의 승인된 닉네임·캐릭터, 번호는 주지 않음)도 준다. 다른 반 출입증은 'none'.
-- 보드가 발표됐으면 모둠 순위(rank)도 준다.
-- 발표 전에는 내 모둠이 아닌 모둠(출입증이 없으면 모든 모둠)의 'passed'를 'pending'으로 내보낸다.
-- worksheet: 오늘 보드의 차시에 학습지가 있으면 {lesson_code, title, version, pages(쪽 수), done(내가 완료했는지)}.
--   학습지 본문은 무거워서 여기 싣지 않고 get_worksheet로 따로 받는다(version이 바뀔 때만)
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
  w        public.worksheets;
  v_done   timestamptz;
  v_ws     jsonb;
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
    select * into w from public.worksheets where lesson_code = b.lesson_code;
  end if;
  if w.lesson_code is not null then
    if v_sid is not null then
      select done_at into v_done from public.worksheet_answers where board_id = b.id and student_id = v_sid;
    end if;
    v_ws := jsonb_build_object(
      'lesson_code', w.lesson_code,
      'title',       w.title,
      'version',     w.updated_at,
      'pages',       w.page_count,
      'done',        v_done is not null
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
    'has_roster', exists (select 1 from public.students where class_id = p_class_id and active and number > 0),
    'session',    case when p_token is null then null when v_sid is null then 'none' else 'ok' end,
    'my_group',   v_my,
    'my_members', v_members,
    'worksheet',  v_ws
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
    where class_id = p_class_id and active and number > 0 and (not p_only_missing or code_hash is null)
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
    join public.students s on s.id = e.student_id and s.active and s.number > 0
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
  from public.students where class_id = s.class_id and active and number > 0 and id <> v_sid;

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
       or not exists (select 1 from public.students where class_id = s.class_id and number = p_partner and number > 0 and active)
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
-- 8단계: 개인 학습지(웹판) → XP
-- 교사가 관리 화면에서 올린 학습지(worksheets)를 학생이 반 페이지에서 쪽마다 채운다.
-- 쓰는 대로 저장(save_worksheet_answers)하고, [제출](submit_worksheet)하면 서버가 채점한다.
-- 틀리거나 빈 칸은 칸 이름만 돌려준다(정답은 학생 쪽에 절대 내보내지 않는다).
-- 모두 맞으면 settings.worksheet의 XP·코인을 한 번만 준다(point_events.worksheet_board_id 유일 조건).
-- =========================================================

-- 학습지 본문 (누구나. 출입증을 주면 내 답도)
-- 결과: {ok: true, board_id, lesson_code, title, version, pages, session, mine: {answers, passed, done_at, xp, coins} | null}
--   또는 {ok: false, error: 'NO_SHEET'} (오늘 보드가 없거나 그 차시에 학습지가 없음)
create or replace function public.get_worksheet(p_class_id int, p_token text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c     public.classes;
  b     public.boards;
  w     public.worksheets;
  a     public.worksheet_answers;
  v_sid uuid;
  v_xp  int;
  v_co  int;
begin
  select * into c from public.classes where id = p_class_id;
  if c.today_board_id is not null then
    select * into b from public.boards where id = c.today_board_id;
    select * into w from public.worksheets where lesson_code = b.lesson_code;
  end if;
  if w.lesson_code is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SHEET');
  end if;

  if p_token is not null then
    select s.id into v_sid from public.students s
    where s.id = public._session_student(p_token) and s.class_id = p_class_id;
    if v_sid is not null then
      select * into a from public.worksheet_answers where board_id = b.id and student_id = v_sid;
      if a.done_at is not null then
        select coalesce(sum(xp), 0)::int, coalesce(sum(coins), 0)::int into v_xp, v_co
        from public.point_events where student_id = v_sid and worksheet_board_id = b.id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok',          true,
    'board_id',    b.id,
    'lesson_code', w.lesson_code,
    'title',       w.title,
    'version',     w.updated_at,
    'pages',       w.pages,
    'session',     case when p_token is null then null when v_sid is null then 'none' else 'ok' end,
    'mine',        case when a.board_id is null then null else jsonb_build_object(
                     'answers', a.answers,
                     'passed',  a.passed,
                     'done_at', a.done_at,
                     'xp',      v_xp,
                     'coins',   v_co
                   ) end
  );
end;
$$;
revoke all on function public.get_worksheet(int, text) from public;
grant execute on function public.get_worksheet(int, text) to anon, authenticated;

-- 출입증 + 보드 확인 (내부용). 결과: {error} 또는 {sid, board_id, lesson_code, key}
create or replace function public._ws_target(p_token text, p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sid   uuid;
  v_today uuid;
  b       public.boards;
  w       public.worksheets;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('error', 'NO_SESSION');
  end if;
  select c.today_board_id into v_today
  from public.students s join public.classes c on c.id = s.class_id
  where s.id = v_sid;
  if v_today is distinct from p_board_id then
    return jsonb_build_object('error', 'BOARD_CHANGED');
  end if;
  select * into b from public.boards where id = p_board_id;
  select * into w from public.worksheets where lesson_code = b.lesson_code;
  if w.lesson_code is null then
    return jsonb_build_object('error', 'NO_SHEET');
  end if;
  return jsonb_build_object('sid', v_sid, 'board_id', b.id, 'lesson_code', b.lesson_code, 'key', w.key);
end;
$$;
revoke all on function public._ws_target(text, uuid) from public, anon, authenticated;

-- 쓰는 중인 답 저장 (학생). 완료한 뒤에는 바꾸지 않는다
-- 결과: {ok: true, done: false, updated_at} · {ok: true, done: true} (이미 완료) · {ok: false, error}
--   NO_SESSION 로그인 안 됨 · BOARD_CHANGED 오늘 보드가 바뀜 · NO_SHEET 학습지가 없음
create or replace function public.save_worksheet_answers(p_token text, p_board_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  t    jsonb;
  v_at timestamptz;
begin
  t := public._ws_target(p_token, p_board_id);
  if t ? 'error' then
    return jsonb_build_object('ok', false, 'error', t ->> 'error');
  end if;

  insert into public.worksheet_answers as x (board_id, student_id, answers)
  values (p_board_id, (t ->> 'sid')::uuid, public._ws_clean(t -> 'key', p_answers))
  on conflict (board_id, student_id) do update
    set answers = public._ws_merge(x.answers, x.passed, excluded.answers), updated_at = now()
    where x.done_at is null
  returning x.updated_at into v_at;

  if v_at is null then
    return jsonb_build_object('ok', true, 'done', true);
  end if;
  return jsonb_build_object('ok', true, 'done', false, 'updated_at', v_at);
end;
$$;
revoke all on function public.save_worksheet_answers(text, uuid, jsonb) from public;
grant execute on function public.save_worksheet_answers(text, uuid, jsonb) to anon, authenticated;

-- 제출 (학생): 답을 저장하고 학습지 전체를 채점한다. 반 페이지는 쪽별 제출(submit_worksheet_page)을 쓴다.
-- 업로드 순서 때문에 남겨 둠(SQL을 먼저 실행해도 예전 화면이 동작하게)
-- 결과: {ok: true, done: true, already, xp, coins, level_before, level_after, total_xp}
--   또는 {ok: false, error: 'NOT_YET', empty: [칸], wrong: [칸]} (고쳐서 다시 제출)
--   또는 {ok: false, error: 'NO_SESSION' | 'BOARD_CHANGED' | 'NO_SHEET'}
create or replace function public.submit_worksheet(p_token text, p_board_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  t        jsonb;
  v_sid    uuid;
  a        public.worksheet_answers;
  v_chk    jsonb;
  v_set    jsonb;
  v_xp     int;
  v_co     int;
  v_before int;
  v_paid   int := 0;
begin
  t := public._ws_target(p_token, p_board_id);
  if t ? 'error' then
    return jsonb_build_object('ok', false, 'error', t ->> 'error');
  end if;
  v_sid := (t ->> 'sid')::uuid;

  -- 저장하면서 이 학생 줄을 잠근다 (두 번 눌러도 한 번만)
  insert into public.worksheet_answers as x (board_id, student_id, answers)
  values (p_board_id, v_sid, public._ws_clean(t -> 'key', p_answers))
  on conflict (board_id, student_id) do update
    set answers = case when x.done_at is null then public._ws_merge(x.answers, x.passed, excluded.answers) else x.answers end,
        updated_at = case when x.done_at is null then now() else x.updated_at end;
  select * into a from public.worksheet_answers
  where board_id = p_board_id and student_id = v_sid for update;

  select coalesce(sum(xp), 0)::int into v_before from public.point_events where student_id = v_sid;

  if a.done_at is not null then
    select coalesce(sum(xp), 0)::int, coalesce(sum(coins), 0)::int into v_xp, v_co
    from public.point_events where student_id = v_sid and worksheet_board_id = p_board_id;
    return jsonb_build_object('ok', true, 'done', true, 'already', true, 'xp', v_xp, 'coins', v_co,
      'level_before', (public._level_info(v_before) ->> 'level')::int,
      'level_after',  (public._level_info(v_before) ->> 'level')::int,
      'total_xp',     v_before);
  end if;

  v_chk := public._ws_check(t -> 'key', a.answers);
  if jsonb_array_length(v_chk -> 'empty') > 0 or jsonb_array_length(v_chk -> 'wrong') > 0 then
    return jsonb_build_object('ok', false, 'error', 'NOT_YET', 'empty', v_chk -> 'empty', 'wrong', v_chk -> 'wrong');
  end if;

  update public.worksheet_answers set done_at = now()
  where board_id = p_board_id and student_id = v_sid;

  select value into v_set from public.settings where key = 'worksheet';
  v_xp := coalesce((v_set ->> 'xp')::int, 10);
  v_co := coalesce((v_set ->> 'coins')::int, 5);
  if v_xp <> 0 or v_co <> 0 then
    insert into public.point_events (student_id, xp, coins, reason, worksheet_board_id)
    values (v_sid, v_xp, v_co, '학습지 ' || (t ->> 'lesson_code'), p_board_id)
    on conflict (student_id, worksheet_board_id) where worksheet_board_id is not null do nothing;
    get diagnostics v_paid = row_count;
  end if;
  if v_paid = 0 then
    v_xp := 0;
    v_co := 0;
  end if;

  return jsonb_build_object('ok', true, 'done', true, 'already', false, 'xp', v_xp, 'coins', v_co,
    'level_before', (public._level_info(v_before) ->> 'level')::int,
    'level_after',  (public._level_info(v_before + v_xp) ->> 'level')::int,
    'total_xp',     v_before + v_xp);
end;
$$;
revoke all on function public.submit_worksheet(text, uuid, jsonb) from public;
grant execute on function public.submit_worksheet(text, uuid, jsonb) to anon, authenticated;

-- 쪽별 제출 (학생, 2026-10-14): 답을 모두 저장하고 p_page(0부터, pages 순서) 쪽의 칸만 채점한다.
-- 그 쪽이 모두 맞으면 그 칸들을 passed에 넣는다(그 뒤로 답이 바뀌지 않음).
-- 학습지의 모든 칸이 passed에 들면 완료(done_at) + settings.worksheet XP·코인 한 번.
-- 결과: {ok: true, done: false, passed, left(아직 제출 안 한 칸 수)}
--   · {ok: true, done: true, already, passed, xp, coins, level_before, level_after, total_xp}
--   · {ok: false, error: 'NOT_YET', empty: [칸], wrong: [칸]} (그 쪽 칸만. 정답은 주지 않는다)
--   · {ok: false, error: 'NO_SESSION' | 'BOARD_CHANGED' | 'NO_SHEET' | 'NO_PAGE'}
create or replace function public.submit_worksheet_page(p_token text, p_board_id uuid, p_page int, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  t        jsonb;
  v_sid    uuid;
  v_pages  jsonb;
  v_keys   text[];
  v_pkey   jsonb;
  a        public.worksheet_answers;
  v_chk    jsonb;
  v_passed jsonb;
  v_left   int;
  v_set    jsonb;
  v_xp     int;
  v_co     int;
  v_before int;
  v_paid   int := 0;
begin
  t := public._ws_target(p_token, p_board_id);
  if t ? 'error' then
    return jsonb_build_object('ok', false, 'error', t ->> 'error');
  end if;
  v_sid := (t ->> 'sid')::uuid;

  select pages into v_pages from public.worksheets where lesson_code = t ->> 'lesson_code';
  if p_page is null or p_page < 0 or p_page >= coalesce(jsonb_array_length(v_pages), 0) then
    return jsonb_build_object('ok', false, 'error', 'NO_PAGE');
  end if;
  select coalesce(array_agg(f ->> 'key'), '{}') into v_keys
  from jsonb_array_elements(coalesce(v_pages -> p_page -> 'fields', '[]'::jsonb)) as f
  where (t -> 'key') ? (f ->> 'key');
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_pkey
  from jsonb_each(t -> 'key') as e
  where e.key = any(v_keys);

  -- 저장하면서 이 학생 줄을 잠근다 (두 번 눌러도 한 번만)
  insert into public.worksheet_answers as x (board_id, student_id, answers)
  values (p_board_id, v_sid, public._ws_clean(t -> 'key', p_answers))
  on conflict (board_id, student_id) do update
    set answers = case when x.done_at is null then public._ws_merge(x.answers, x.passed, excluded.answers) else x.answers end,
        updated_at = case when x.done_at is null then now() else x.updated_at end;
  select * into a from public.worksheet_answers
  where board_id = p_board_id and student_id = v_sid for update;

  select coalesce(sum(xp), 0)::int into v_before from public.point_events where student_id = v_sid;

  if a.done_at is not null then
    select coalesce(sum(xp), 0)::int, coalesce(sum(coins), 0)::int into v_xp, v_co
    from public.point_events where student_id = v_sid and worksheet_board_id = p_board_id;
    return jsonb_build_object('ok', true, 'done', true, 'already', true, 'passed', a.passed, 'xp', v_xp, 'coins', v_co,
      'level_before', (public._level_info(v_before) ->> 'level')::int,
      'level_after',  (public._level_info(v_before) ->> 'level')::int,
      'total_xp',     v_before);
  end if;

  v_chk := public._ws_check(v_pkey, a.answers);
  if jsonb_array_length(v_chk -> 'empty') > 0 or jsonb_array_length(v_chk -> 'wrong') > 0 then
    return jsonb_build_object('ok', false, 'error', 'NOT_YET', 'empty', v_chk -> 'empty', 'wrong', v_chk -> 'wrong');
  end if;

  -- 이 쪽 칸을 passed에 넣는다 (학습지에 지금 있는 칸만, 문서 순서대로)
  select coalesce(jsonb_agg(k order by coalesce(nullif(regexp_replace(k, '\D', '', 'g'), ''), '0')::int), '[]'::jsonb)
  into v_passed
  from (
    select k from jsonb_object_keys(t -> 'key') as k
    where k = any(v_keys) or coalesce(a.passed, '[]'::jsonb) ? k
  ) z;
  select count(*)::int into v_left
  from jsonb_object_keys(t -> 'key') as k
  where not v_passed ? k;

  if v_left > 0 then
    update public.worksheet_answers set passed = v_passed
    where board_id = p_board_id and student_id = v_sid;
    return jsonb_build_object('ok', true, 'done', false, 'passed', v_passed, 'left', v_left);
  end if;

  update public.worksheet_answers set passed = v_passed, done_at = now()
  where board_id = p_board_id and student_id = v_sid;

  select value into v_set from public.settings where key = 'worksheet';
  v_xp := coalesce((v_set ->> 'xp')::int, 10);
  v_co := coalesce((v_set ->> 'coins')::int, 5);
  if v_xp <> 0 or v_co <> 0 then
    insert into public.point_events (student_id, xp, coins, reason, worksheet_board_id)
    values (v_sid, v_xp, v_co, '학습지 ' || (t ->> 'lesson_code'), p_board_id)
    on conflict (student_id, worksheet_board_id) where worksheet_board_id is not null do nothing;
    get diagnostics v_paid = row_count;
  end if;
  if v_paid = 0 then
    v_xp := 0;
    v_co := 0;
  end if;

  return jsonb_build_object('ok', true, 'done', true, 'already', false, 'passed', v_passed, 'xp', v_xp, 'coins', v_co,
    'level_before', (public._level_info(v_before) ->> 'level')::int,
    'level_after',  (public._level_info(v_before + v_xp) ->> 'level')::int,
    'total_xp',     v_before + v_xp);
end;
$$;
revoke all on function public.submit_worksheet_page(text, uuid, int, jsonb) from public;
grant execute on function public.submit_worksheet_page(text, uuid, int, jsonb) to anon, authenticated;

-- 완료 현황 (교사, 수업 모드 띠). 학생 답·이름은 주지 않는다
-- total: 그날 모둠 편성 인원(편성이 없으면 명단 인원)
create or replace function public.get_worksheet_stats(p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b       public.boards;
  v_done  int;
  v_total int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select * into b from public.boards where id = p_board_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select count(*)::int into v_done
  from public.worksheet_answers a join public.students s on s.id = a.student_id and s.number > 0
  where a.board_id = b.id and a.done_at is not null;
  select count(*)::int into v_total from public.board_groups where board_id = b.id;
  if v_total = 0 then
    select count(*)::int into v_total from public.students where class_id = b.class_id and active and number > 0;
  end if;
  return jsonb_build_object(
    'has_sheet', exists (select 1 from public.worksheets where lesson_code = b.lesson_code),
    'done',      v_done,
    'total',     v_total
  );
end;
$$;
revoke all on function public.get_worksheet_stats(uuid) from public, anon;
grant execute on function public.get_worksheet_stats(uuid) to authenticated;

-- ---------------------------------------------------------
-- 오목 (AI 대전, 보통 난이도, 자유룰: 다섯 개 이상 이으면 승리)
-- 학생 화면(assets/js/omok.js)과 같은 AI를 서버에서 다시 돌려, 학생이 낸 흑 수만으로
-- 기보를 처음부터 다시 둔다. 정말 이긴 대국일 때만 지급한다.
-- 보드: int[225] (r*15 + c + 1), 0 빈 칸 · 1 흑 · 2 백
-- ---------------------------------------------------------

-- (r, c)에 p를 놓았다고 보고 (dr, dc) 방향으로 이어진 개수 (내부용)
create or replace function public._omok_run(b int[], r int, c int, dr int, dc int, p int)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  n int := 1;
  y int;
  x int;
begin
  y := r + dr; x := c + dc;
  while y between 0 and 14 and x between 0 and 14 and b[y * 15 + x + 1] = p loop
    n := n + 1; y := y + dr; x := x + dc;
  end loop;
  y := r - dr; x := c - dc;
  while y between 0 and 14 and x between 0 and 14 and b[y * 15 + x + 1] = p loop
    n := n + 1; y := y - dr; x := x - dc;
  end loop;
  return n;
end;
$$;
revoke all on function public._omok_run(int[], int, int, int, int, int) from public, anon, authenticated;

-- (r, c)에 p를 놓으면 다섯 개 이상인지 (내부용)
create or replace function public._omok_wins(b int[], r int, c int, p int)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public._omok_run(b, r, c, 0, 1, p) >= 5 or public._omok_run(b, r, c, 1, 0, p) >= 5
      or public._omok_run(b, r, c, 1, 1, p) >= 5 or public._omok_run(b, r, c, 1, -1, p) >= 5;
$$;
revoke all on function public._omok_wins(int[], int, int, int) from public, anon, authenticated;

-- 빈 칸 (r, c)의 p 쪽 모양 점수 (omok.js patternScore와 같음, 내부용)
create or replace function public._omok_pattern(b int[], r int, c int, p int)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  s    int := 0;
  d    int[];
  n    int;
  o    int;
  y    int;
  x    int;
begin
  foreach d slice 1 in array array[[0, 1], [1, 0], [1, 1], [1, -1]] loop
    n := 1; o := 0;
    y := r + d[1]; x := c + d[2];
    while y between 0 and 14 and x between 0 and 14 and b[y * 15 + x + 1] = p loop
      n := n + 1; y := y + d[1]; x := x + d[2];
    end loop;
    if y between 0 and 14 and x between 0 and 14 and b[y * 15 + x + 1] = 0 then o := o + 1; end if;
    y := r - d[1]; x := c - d[2];
    while y between 0 and 14 and x between 0 and 14 and b[y * 15 + x + 1] = p loop
      n := n + 1; y := y - d[1]; x := x - d[2];
    end loop;
    if y between 0 and 14 and x between 0 and 14 and b[y * 15 + x + 1] = 0 then o := o + 1; end if;
    s := s + case
      when n >= 5 then 100000
      when o = 0 then n
      when n = 4 then case when o = 2 then 50000 else 12000 end
      when n = 3 then case when o = 2 then 5000 else 600 end
      when n = 2 then case when o = 2 then 200 else 40 end
      else case when o = 2 then 20 else 5 end
    end;
  end loop;
  return s;
end;
$$;
revoke all on function public._omok_pattern(int[], int, int, int) from public, anon, authenticated;

-- AI(백, 보통)의 다음 수: 칸 번호(1~225) 또는 null(둘 곳 없음) (omok.js aiMove와 같음, 내부용)
-- 돌에서 두 칸 안의 빈 칸만, 위에서 아래·왼쪽에서 오른쪽 순서로 본다.
-- 바로 이기는 칸이 있으면 그 칸, 없으면 점수가 가장 높은 칸(같으면 먼저 본 칸)
create or replace function public._omok_ai(b int[])
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  v_best  int := null;
  v_top   int := -1;
  v_score int;
  v_near  boolean;
  i       int;
begin
  if not (1 = any(b) or 2 = any(b)) then
    return 7 * 15 + 7 + 1;
  end if;
  for r in 0 .. 14 loop
    for c in 0 .. 14 loop
      i := r * 15 + c + 1;
      continue when b[i] <> 0;
      v_near := false;
      <<near>>
      for y in greatest(r - 2, 0) .. least(r + 2, 14) loop
        for x in greatest(c - 2, 0) .. least(c + 2, 14) loop
          if b[y * 15 + x + 1] <> 0 then
            v_near := true;
            exit near;
          end if;
        end loop;
      end loop;
      continue when not v_near;
      if public._omok_wins(b, r, c, 2) then
        return i;
      end if;
      v_score := public._omok_pattern(b, r, c, 2)
               + (11 * public._omok_pattern(b, r, c, 1)) / 10
               + (14 - (abs(r - 7) + abs(c - 7)));
      if v_score > v_top then
        v_top := v_score;
        v_best := i;
      end if;
    end loop;
  end loop;
  return v_best;
end;
$$;
revoke all on function public._omok_ai(int[]) from public, anon, authenticated;

-- 오늘(한국 시간) 오목으로 받은 횟수 (내부용)
create or replace function public._omok_today(p_student_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from public.point_events
  where student_id = p_student_id and reason = '오목 승리' and board_id is null and worksheet_board_id is null
    and created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;
revoke all on function public._omok_today(uuid) from public, anon, authenticated;

-- 오목 화면 (학생)
-- 결과: {ok: true, open, today(오늘 받은 횟수), daily, xp, coins, avatar} 또는 {ok: false, error: 'NO_SESSION'}
create or replace function public.get_omok(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_sid uuid;
  s     public.students;
  v_set jsonb;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid;
  select value into v_set from public.settings where key = 'omok';
  return jsonb_build_object(
    'ok',     true,
    'open',   (select omok_open from public.classes where id = s.class_id),
    'today',  public._omok_today(v_sid),
    'daily',  coalesce((v_set ->> 'daily')::int, 3),
    'xp',     coalesce((v_set ->> 'xp')::int, 2),
    'coins',  coalesce((v_set ->> 'coins')::int, 2),
    'avatar', s.avatar
  );
end;
$$;
revoke all on function public.get_omok(text) from public;
grant execute on function public.get_omok(text) to anon, authenticated;

-- 이긴 대국 내기 (학생): 흑 수 목록 [[행, 열], …] (0~14, 무르기한 수는 빼고 마지막 판의 순서대로)
-- 서버가 처음부터 다시 두며 백은 AI가 둔다. 마지막 흑 수로 다섯 개 이상이 되어야 한다.
-- 결과: {ok: true, paid, xp, coins, today, daily, level_before, level_after, total_xp}
--   또는 {ok: false, error: 'NO_SESSION' | 'CLOSED'(선생님이 끔) | 'BAD_GAME'(기보가 맞지 않음)}
create or replace function public.submit_omok(p_token text, p_moves jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid    uuid;
  s        public.students;
  v_set    jsonb;
  b        int[] := array_fill(0, array[225]);
  v_n      int;
  r        int;
  c        int;
  w        int;
  v_won    boolean := false;
  v_today  int;
  v_daily  int;
  v_xp     int;
  v_co     int;
  v_before int;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid;
  if not coalesce((select omok_open from public.classes where id = s.class_id), false) then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;

  -- 기보 모양: 흑 5~113수, 칸마다 [0~14, 0~14]
  if jsonb_typeof(p_moves) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'BAD_GAME');
  end if;
  v_n := jsonb_array_length(p_moves);
  if v_n < 5 or v_n > 113 then
    return jsonb_build_object('ok', false, 'error', 'BAD_GAME');
  end if;

  for k in 0 .. v_n - 1 loop
    if jsonb_typeof(p_moves -> k) <> 'array' or jsonb_array_length(p_moves -> k) <> 2
       or jsonb_typeof(p_moves -> k -> 0) <> 'number' or jsonb_typeof(p_moves -> k -> 1) <> 'number' then
      return jsonb_build_object('ok', false, 'error', 'BAD_GAME');
    end if;
    r := (p_moves -> k ->> 0)::numeric;
    c := (p_moves -> k ->> 1)::numeric;
    if (p_moves -> k ->> 0)::numeric <> r or (p_moves -> k ->> 1)::numeric <> c
       or r not between 0 and 14 or c not between 0 and 14 or b[r * 15 + c + 1] <> 0 then
      return jsonb_build_object('ok', false, 'error', 'BAD_GAME');
    end if;
    b[r * 15 + c + 1] := 1;
    if public._omok_wins(b, r, c, 1) then
      v_won := k = v_n - 1;
      exit;
    end if;
    exit when k = v_n - 1;
    w := public._omok_ai(b);
    exit when w is null;
    b[w] := 2;
    exit when public._omok_wins(b, (w - 1) / 15, (w - 1) % 15, 2);
  end loop;
  if not v_won then
    return jsonb_build_object('ok', false, 'error', 'BAD_GAME');
  end if;

  -- 학생 줄을 잠가 동시에 여러 번 내도 하루 횟수를 넘지 않게
  perform 1 from public.students where id = v_sid for update;
  select value into v_set from public.settings where key = 'omok';
  v_daily := coalesce((v_set ->> 'daily')::int, 3);
  v_xp    := coalesce((v_set ->> 'xp')::int, 2);
  v_co    := coalesce((v_set ->> 'coins')::int, 2);
  v_today := public._omok_today(v_sid);
  select coalesce(sum(xp), 0)::int into v_before from public.point_events where student_id = v_sid;

  if v_today >= v_daily or (v_xp = 0 and v_co = 0) then
    return jsonb_build_object('ok', true, 'paid', false, 'xp', 0, 'coins', 0, 'today', v_today, 'daily', v_daily,
      'level_before', (public._level_info(v_before) ->> 'level')::int,
      'level_after',  (public._level_info(v_before) ->> 'level')::int,
      'total_xp',     v_before);
  end if;

  insert into public.point_events (student_id, xp, coins, reason)
  values (v_sid, v_xp, v_co, '오목 승리');

  return jsonb_build_object('ok', true, 'paid', true, 'xp', v_xp, 'coins', v_co, 'today', v_today + 1, 'daily', v_daily,
    'level_before', (public._level_info(v_before) ->> 'level')::int,
    'level_after',  (public._level_info(v_before + v_xp) ->> 'level')::int,
    'total_xp',     v_before + v_xp);
end;
$$;
revoke all on function public.submit_omok(text, jsonb) from public;
grant execute on function public.submit_omok(text, jsonb) to anon, authenticated;
