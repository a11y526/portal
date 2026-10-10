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
-- 반 페이지 (누구나)
-- 오늘 보드 + 그날 모둠별 상태·교사 메모. 제출 시각·순서는 주지 않는다.
-- has_roster: 이 반에 명단이 있는지
-- p_number를 넘기면 my_known(명단에 있는 번호인지), my_group(그날 모둠, 없으면 null)도 준다.
-- 보드가 발표됐으면 모둠 순위(rank)도 준다.
-- ---------------------------------------------------------
drop function if exists public.get_class_page(int);

create or replace function public.get_class_page(p_class_id int, p_number int default null)
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
begin
  select * into c from public.classes where id = p_class_id;
  if not found then
    return null;
  end if;

  if c.today_board_id is not null then
    select * into b from public.boards where id = c.today_board_id;
  end if;

  if p_number is not null then
    select id into v_sid from public.students
    where class_id = p_class_id and number = p_number and active;
    if v_sid is not null and b.id is not null then
      select group_no into v_my from public.board_groups where board_id = b.id and student_id = v_sid;
    end if;
  end if;

  v_result := case when b.status = 'revealed' then coalesce(b.result -> 'ranking', '[]'::jsonb) else '[]'::jsonb end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'no',       g.group_no,
           'members',  g.members,
           'state',    coalesce(s.status, 'idle'),
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
    'my_known',   case when p_number is null then null else v_sid is not null end,
    'my_group',   v_my
  );
end;
$$;
revoke all on function public.get_class_page(int, int) from public;
grant execute on function public.get_class_page(int, int) to anon, authenticated;

-- ---------------------------------------------------------
-- 모둠 제출 (학생)
-- 결과: {ok: true, group_no} 또는 {ok: false, error}
--   LOCKED        코드를 여러 번 틀림
--   BAD_CODE      반, 번호 또는 코드가 맞지 않음
--   BOARD_CHANGED 오늘 보드가 아님
--   CLOSED        보드가 열려 있지 않음
--   NO_GROUP      그날 모둠에 없음 (아직 편성 전이거나 결석)
--   ALREADY       이미 검사 대기 중이거나 통과함
-- (틀린 시도 기록이 지워지지 않도록 오류를 raise하지 않고 돌려준다)
-- ---------------------------------------------------------
create or replace function public.submit_group(p_board_id uuid, p_class_id int, p_number int, p_code text)
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
  b       public.boards;
begin
  if public._code_locked(p_class_id, p_number) then
    return jsonb_build_object('ok', false, 'error', 'LOCKED');
  end if;

  v_sid := public._check_code(p_class_id, p_number, p_code);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_CODE');
  end if;

  select today_board_id into v_today from public.classes where id = p_class_id;
  select * into b from public.boards where id = p_board_id for update;
  if not found or b.class_id <> p_class_id or v_today is distinct from b.id then
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
revoke all on function public.submit_group(uuid, int, int, text) from public;
grant execute on function public.submit_group(uuid, int, int, text) to anon, authenticated;

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
  v_extra    int;
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
  v_bonus   := coalesce(v_pts -> 'rank_bonus', '[10, 6, 3]'::jsonb);

  for r in
    select x.group_no, (row_number() over (order by x.submitted_at, x.id))::int as rn
    from public.submissions x
    where x.board_id = b.id and x.status = 'passed'
    order by x.submitted_at, x.id
  loop
    v_extra  := coalesce((v_bonus ->> (r.rn - 1))::int, 0);
    v_reason := b.lesson_code || '차시 통과' || case when v_extra > 0 then ' · ' || r.rn || '위' else '' end;

    insert into public.point_events (student_id, xp, coins, reason, board_id)
    select g.student_id, v_pass_xp + v_extra, v_pass_co + v_extra, v_reason, b.id
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
      'coins',    v_pass_co + v_extra,
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
  delete from public.code_attempts where student_key = s.class_id || '-' || s.number;

  return jsonb_build_object('class_id', s.class_id, 'number', s.number, 'code', v_code);
end;
$$;
revoke all on function public.reset_code(uuid) from public, anon;
grant execute on function public.reset_code(uuid) to authenticated;
