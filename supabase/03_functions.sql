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

-- 점 찍기 칸 채점: p_spec = {points: [[x, y], …], tol: {x, y}}, p_v = 학생 답 "x,y|x,y"
--   정답 점마다(순서대로) 오차 안에 있고 아직 짝이 없는 학생 점 중 가장 가까운 것 하나를 짝짓는다(1:1).
--   짝이 없는 학생 점(읽을 수 없는 조각 포함)은 틀린 점. 정답 점이 모두 짝을 찾고 틀린 점이 없어야 맞음.
--   정답 점이 비어 있으면 읽을 수 있는 점이 하나라도 있으면 맞음.
--   결과 {ok, bad: [틀린 학생 점 순서(0부터)]}. 정답 점은 돌려주지 않는다
create or replace function public._ws_plot(p_spec jsonb, p_v text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_tx   numeric := greatest(coalesce((p_spec #>> '{tol,x}')::numeric, 0), 0);
  v_ty   numeric := greatest(coalesce((p_spec #>> '{tol,y}')::numeric, 0), 0);
  v_px   numeric[] := '{}';
  v_py   numeric[] := '{}';
  v_used boolean[] := '{}';
  v_bad  jsonb := '[]'::jsonb;
  v_miss int := 0;
  v_n    int;
  v_good int := 0;
  s      text;
  m      text[];
  a      jsonb;
  ax     numeric;
  ay     numeric;
  j      int;
  best   int;
  bd     numeric;
  d      numeric;
begin
  if btrim(coalesce(p_v, '')) = '' then
    return jsonb_build_object('ok', false, 'bad', '[]'::jsonb);
  end if;
  foreach s in array string_to_array(p_v, '|') loop
    m := regexp_match(btrim(s), '^(-?[0-9]+(?:\.[0-9]+)?)\s*,\s*(-?[0-9]+(?:\.[0-9]+)?)$');
    v_px := v_px || (m[1])::numeric;
    v_py := v_py || (m[2])::numeric;
    v_used := v_used || false;
  end loop;
  v_n := coalesce(array_length(v_px, 1), 0);

  for a in select value from jsonb_array_elements(case when jsonb_typeof(p_spec -> 'points') = 'array' then p_spec -> 'points' else '[]'::jsonb end) loop
    ax := (a ->> 0)::numeric;
    ay := (a ->> 1)::numeric;
    best := null;
    bd := null;
    for j in 1 .. v_n loop
      if not v_used[j] and v_px[j] is not null and abs(v_px[j] - ax) <= v_tx and abs(v_py[j] - ay) <= v_ty then
        d := abs(v_px[j] - ax) / greatest(v_tx, 0.000001) + abs(v_py[j] - ay) / greatest(v_ty, 0.000001);
        if bd is null or d < bd then
          bd := d;
          best := j;
        end if;
      end if;
    end loop;
    if best is null then
      v_miss := v_miss + 1;
    else
      v_used[best] := true;
    end if;
  end loop;

  for j in 1 .. v_n loop
    if v_px[j] is not null then v_good := v_good + 1; end if;
    if jsonb_array_length(coalesce(p_spec -> 'points', '[]'::jsonb)) = 0 then
      if v_px[j] is null then v_bad := v_bad || to_jsonb(j - 1); end if;
    elsif not v_used[j] then
      v_bad := v_bad || to_jsonb(j - 1);
    end if;
  end loop;
  return jsonb_build_object('ok', v_miss = 0 and jsonb_array_length(v_bad) = 0 and v_good > 0, 'bad', v_bad);
end;
$$;

-- 채점: {empty: [빈 칸], wrong: [틀린 칸]} (칸 이름만. 정답은 돌려주지 않는다)
--   blank  정답·허용 답 중 하나와 같으면 (띄어쓰기·영문 대소문자 무시). 정답이 비어 있으면 채우기만 하면 됨
--   choice 정답(ok)을 골라야. 정답이 없는 고르기(예측)는 보기 중 하나를 고르면 됨
--   sym    맞는 부등호. text(서술)는 채우기만 하면 됨
--   plot   _ws_plot (정답 점을 모두, 틀린 점 없이)
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
             when y.t = 'plot' then coalesce((public._ws_plot(y.spec, y.v) ->> 'ok')::boolean, false)
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
             e.value as spec,
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
revoke all on function public._ws_plot(jsonb, text) from public, anon, authenticated;

-- 학생에게 보낼 쪽 목록: 진도(p_upto)보다 뒤 쪽은 본문·칸을 빼고 {slide, locked, has_fields}만. p_upto가 null이면 그대로
create or replace function public._ws_view(p_pages jsonb, p_upto int)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when p_upto is null then p_pages else coalesce((
    select jsonb_agg(case when coalesce((pg ->> 'slide')::int, 0) > p_upto
      then jsonb_build_object('slide', pg -> 'slide', 'locked', true,
                              'has_fields', jsonb_array_length(coalesce(pg -> 'fields', '[]'::jsonb)) > 0, 'fields', '[]'::jsonb)
      else pg end order by n)
    from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) with ordinality as e(pg, n)
  ), '[]'::jsonb) end;
$$;
revoke all on function public._ws_view(jsonb, int) from public, anon, authenticated;

-- ---------------------------------------------------------
-- 반 페이지 (누구나)
-- 오늘 보드 + 그날 모둠별 상태·교사 메모. 제출 시각·순서는 주지 않는다.
-- has_roster: 이 반에 명단이 있는지
-- p_token(로그인 출입증)을 넘기면 session('ok' 또는 'none'), my_group(그날 모둠, 없으면 null),
-- my_members(그날 우리 모둠원의 승인된 닉네임·캐릭터, 번호는 주지 않음)도 준다. 다른 반 출입증은 'none'.
-- 보드가 발표됐으면 모둠 순위(rank)도 준다.
-- 발표 전에는 내 모둠이 아닌 모둠(출입증이 없으면 모든 모둠)의 'passed'를 'pending'으로 내보낸다.
-- worksheet: 오늘 보드의 차시에 학습지가 있으면 {lesson_code, title, version, pages(쪽 수), done(내가 완료했는지), upto(진도, null이면 전부 열림)}.
--   학습지 본문은 무거워서 여기 싣지 않고 get_worksheet로 따로 받는다(version이 바뀔 때만)
-- quiz: 퀴즈 배틀 {open(교사가 열었는지), state(우리 모둠 판 lobby·playing·done 또는 null)}
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
  v_firsts jsonb;
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
    select * into w from public.worksheets where lesson_code = b.lesson_code;
  end if;
  if w.lesson_code is not null then
    if v_sid is not null then
      select done_at into v_done from public.worksheet_answers where board_id = b.id and student_id = v_sid;
      -- 쪽별 첫 답으로 인정받은 것 [{id, page, slide, xp, coins}]
      select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'page', f.page, 'slide', f.slide,
               'xp', coalesce(e.xp, 0), 'coins', coalesce(e.coins, 0)) order by f.decided_at), '[]'::jsonb)
      into v_firsts
      from public.ws_firsts f left join public.point_events e on e.ws_first_id = f.id
      where f.board_id = b.id and f.student_id = v_sid and f.status = 'accepted';
      if jsonb_array_length(v_firsts) > 0 then
        select coalesce(sum(xp), 0)::int into v_total from public.point_events where student_id = v_sid;
      end if;
    end if;
    v_ws := jsonb_build_object(
      'lesson_code', w.lesson_code,
      'title',       w.title,
      'version',     w.updated_at,
      'pages',       w.page_count,
      'done',        v_done is not null,
      'upto',        b.ws_upto,
      'opened',      (select coalesce(jsonb_agg(o.page order by o.page), '[]'::jsonb) from public.ws_page_open o where o.board_id = b.id),
      'firsts',      coalesce(v_firsts, '[]'::jsonb),
      'level',       case when v_total is null then null else jsonb_build_object(
                       'level', (public._level_info(v_total) ->> 'level')::int, 'total_xp', v_total) end
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
    'worksheet',  v_ws,
    -- 퀴즈 배틀: 교사가 열었는지, 우리 모둠 판 상태(lobby·playing·done, 없으면 null)
    'quiz',       case when b.id is null then null else jsonb_build_object(
                    'open',  b.quiz_open,
                    'state', (select q.status from public.qb_games q where q.board_id = b.id and q.group_no = v_my)) end
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
-- 결과: {ok: true, board_id, lesson_code, title, version, upto, pages, session, mine: {answers, passed, done_at, xp, coins} | null}
--   upto: 수업 진도(boards.ws_upto). 그보다 뒤 쪽은 _ws_view가 본문을 빼고 보낸다
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
    'upto',        b.ws_upto,
    'pages',       public._ws_view(w.pages, b.ws_upto),
    'opened',      (select coalesce(jsonb_agg(o.page order by o.page), '[]'::jsonb) from public.ws_page_open o where o.board_id = b.id),
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

-- 출입증 + 보드 확인 (내부용). 결과: {error} 또는 {sid, board_id, lesson_code, key, upto}
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
  return jsonb_build_object('sid', v_sid, 'board_id', b.id, 'lesson_code', b.lesson_code, 'key', w.key, 'upto', b.ws_upto);
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
--   또는 {ok: false, error: 'NO_SESSION' | 'BOARD_CHANGED' | 'NO_SHEET' | 'LOCKED'(아직 수업에서 안 나간 쪽이 있음)}
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
  if t ->> 'upto' is not null and exists (
    select 1 from public.worksheets w, jsonb_array_elements(w.pages) as pg
    where w.lesson_code = t ->> 'lesson_code' and coalesce((pg ->> 'slide')::int, 0) > (t ->> 'upto')::int
  ) then
    return jsonb_build_object('ok', false, 'error', 'LOCKED');
  end if;

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
--   · {ok: false, error: 'NOT_YET', empty: [칸], wrong: [칸], points: {점 찍기 칸: [틀린 점 순서]}} (그 쪽 칸만. 정답은 주지 않는다)
--   · {ok: false, error: 'NO_SESSION' | 'BOARD_CHANGED' | 'NO_SHEET' | 'NO_PAGE' | 'LOCKED'(아직 수업에서 안 나간 쪽)}
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
  v_pts    jsonb;
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
  if t ->> 'upto' is not null and coalesce((v_pages -> p_page ->> 'slide')::int, 0) > (t ->> 'upto')::int then
    return jsonb_build_object('ok', false, 'error', 'LOCKED');
  end if;
  select coalesce(array_agg(f ->> 'key'), '{}') into v_keys
  from jsonb_array_elements(coalesce(v_pages -> p_page -> 'fields', '[]'::jsonb)) as f
  where (t -> 'key') ? (f ->> 'key');
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_pkey
  from jsonb_each(t -> 'key') as e
  where e.key = any(v_keys);
  -- 교사가 그 쪽 [제출 시작]을 누르기 전에는 낼 수 없다 (2026-10-16)
  if array_length(v_keys, 1) > 0
     and not exists (select 1 from public.ws_page_open where board_id = p_board_id and page = p_page)
     and not exists (select 1 from public.worksheet_answers where board_id = p_board_id and student_id = v_sid and done_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'NOT_OPEN');
  end if;

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
  -- 이 쪽 칸을 모두 채웠으면 맞았는지와 상관없이 첫 답 줄에 (쪽마다 5명까지)
  if jsonb_array_length(v_chk -> 'empty') = 0 and array_length(v_keys, 1) > 0 then
    perform public._ws_first_enter(p_board_id, p_page, (v_pages -> p_page ->> 'slide')::int, v_sid,
      (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(a.answers) as e where e.key = any(v_keys)));
  end if;
  if jsonb_array_length(v_chk -> 'empty') > 0 or jsonb_array_length(v_chk -> 'wrong') > 0 then
    select coalesce(jsonb_object_agg(e.key, public._ws_plot(e.value, a.answers ->> e.key) -> 'bad'), '{}'::jsonb) into v_pts
    from jsonb_each(v_pkey) as e
    where e.value ->> 'type' = 'plot' and (v_chk -> 'wrong') ? e.key;
    return jsonb_build_object('ok', false, 'error', 'NOT_YET', 'empty', v_chk -> 'empty', 'wrong', v_chk -> 'wrong', 'points', v_pts);
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

-- ---------------------------------------------------------
-- 쪽별 첫 답 (2026-10-16)
-- 학생이 쪽 칸을 모두 채워 제출하면 먼저 낸 순서로 쪽마다 5명까지 줄에 넣는다(맞았는지는 따지지 않음).
-- 수업 모드가 한 명씩 띄우고 교사가 [인정](XP·코인) 또는 [넘기기](다음 사람). 지급은 쪽마다 한 명뿐이고,
-- 지급한 뒤에도 줄의 나머지는 차례로 뜬다(지급 없이 [다음]만). 0번(체험 계정)은 넣지 않는다
-- ---------------------------------------------------------
create or replace function public._ws_first_enter(p_board_id uuid, p_page int, p_slide int, p_sid uuid, p_answers jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.students where id = p_sid and number = 0) then
    return;
  end if;
  -- 같은 쪽에 동시에 들어와도 5명을 넘지 않게
  perform pg_advisory_xact_lock(hashtext('ws_first|' || p_board_id::text || '|' || p_page::text));
  if exists (select 1 from public.ws_firsts
             where board_id = p_board_id and page = p_page and student_id = p_sid) then
    return;
  end if;
  if (select count(*) from public.ws_firsts where board_id = p_board_id and page = p_page) >= 5 then
    return;
  end if;
  insert into public.ws_firsts (board_id, page, slide, student_id, answers)
  values (p_board_id, p_page, p_slide, p_sid, coalesce(p_answers, '{}'::jsonb))
  on conflict (board_id, page, student_id) do nothing;
end;
$$;
revoke all on function public._ws_first_enter(uuid, int, int, uuid, jsonb) from public, anon, authenticated;

-- 수업 모드: 지금 띄울 첫 답 하나 (교사). 먼저 낸 것부터.
-- 결과: {item: null} 또는 {item: {id, page, slide, pos(그 쪽 몇 번째), count(그 쪽 줄 수), wait(전체 남은 수), paid(그 쪽은 이미 지급),
--        number, nickname, avatar, answers, sheet_page(학습지 그 쪽 본문, 정답 없음)}}
create or replace function public.get_ws_first(p_board_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f      public.ws_firsts;
  s      public.students;
  v_page jsonb;
  v_wait int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select x.* into f from public.ws_firsts x
  where x.board_id = p_board_id and x.status = 'wait'
  order by x.created_at, x.id
  limit 1;
  if not found then
    return jsonb_build_object('item', null);
  end if;
  select count(*)::int into v_wait from public.ws_firsts x
  where x.board_id = p_board_id and x.status = 'wait';
  select * into s from public.students where id = f.student_id;
  select w.pages -> f.page into v_page
  from public.boards b join public.worksheets w on w.lesson_code = b.lesson_code
  where b.id = p_board_id;
  return jsonb_build_object('item', jsonb_build_object(
    'id',         f.id,
    'page',       f.page,
    'slide',      f.slide,
    'pos',        (select count(*)::int from public.ws_firsts z
                   where z.board_id = f.board_id and z.page = f.page
                     and (z.created_at, z.id) <= (f.created_at, f.id)),
    'count',      (select count(*)::int from public.ws_firsts z where z.board_id = f.board_id and z.page = f.page),
    'wait',       v_wait,
    'paid',       exists (select 1 from public.ws_firsts z
                          where z.board_id = f.board_id and z.page = f.page and z.status = 'accepted'),
    'class_id',   s.class_id,
    'number',     s.number,
    'nickname',   s.nickname,
    'avatar',     s.avatar,
    'answers',    f.answers,
    'sheet_page', v_page
  ));
end;
$$;
revoke all on function public.get_ws_first(uuid) from public, anon;
grant execute on function public.get_ws_first(uuid) to authenticated;

-- [인정] (교사): 그 학생에게 settings.ws_first XP·코인. 쪽마다 한 명만, 두 번 눌러도 한 번만
-- 결과: {ok: true, xp, coins, class_id, already} · {ok: false, error: 'TAKEN'(그 쪽은 이미 다른 학생에게 지급) | 'SKIPPED'}
create or replace function public.accept_ws_first(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  f      public.ws_firsts;
  v_set  jsonb;
  v_xp   int;
  v_co   int;
  v_code text;
  v_cls  int;
  v_paid int := 0;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select * into f from public.ws_firsts where id = p_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtext('ws_first|' || f.board_id::text || '|' || f.page::text));
  select * into f from public.ws_firsts where id = p_id for update;
  select class_id into v_cls from public.students where id = f.student_id;

  if f.status = 'accepted' then
    select coalesce(sum(xp), 0)::int, coalesce(sum(coins), 0)::int into v_xp, v_co
    from public.point_events where ws_first_id = f.id;
    return jsonb_build_object('ok', true, 'already', true, 'xp', v_xp, 'coins', v_co, 'class_id', v_cls);
  end if;
  if exists (select 1 from public.ws_firsts
             where board_id = f.board_id and page = f.page and status = 'accepted') then
    return jsonb_build_object('ok', false, 'error', 'TAKEN');
  end if;
  if f.status <> 'wait' then
    return jsonb_build_object('ok', false, 'error', 'SKIPPED');
  end if;

  update public.ws_firsts set status = 'accepted', decided_at = now() where id = f.id;

  select value into v_set from public.settings where key = 'ws_first';
  v_xp := coalesce((v_set ->> 'xp')::int, 1);
  v_co := coalesce((v_set ->> 'coins')::int, 1);
  select lesson_code into v_code from public.boards where id = f.board_id;
  if v_xp <> 0 or v_co <> 0 then
    insert into public.point_events (student_id, xp, coins, reason, ws_first_id)
    values (f.student_id, v_xp, v_co,
            '첫 답 ' || coalesce(v_code, '') || coalesce('-' || f.slide::text || '쪽', ''), f.id)
    on conflict (ws_first_id) where ws_first_id is not null do nothing;
    get diagnostics v_paid = row_count;
  end if;
  if v_paid = 0 then
    v_xp := 0;
    v_co := 0;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'xp', v_xp, 'coins', v_co, 'class_id', v_cls);
end;
$$;
revoke all on function public.accept_ws_first(uuid) from public, anon;
grant execute on function public.accept_ws_first(uuid) to authenticated;

-- [넘기기] (교사): 대기 중이면 넘김으로. 결과: {ok}
create or replace function public.skip_ws_first(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  update public.ws_firsts set status = 'skipped', decided_at = now() where id = p_id and status = 'wait';
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.skip_ws_first(uuid) from public, anon;
grant execute on function public.skip_ws_first(uuid) to authenticated;

-- [제출 시작] (교사, 수업 모드): 수업자료 그 쪽(slide)에 해당하는 학습지 쪽(칸이 있는 것)의 제출을 연다. 닫지는 않는다
-- 결과: 그 쪽에 해당해 열린 학습지 쪽 번호(pages 순서) 목록. 해당하는 쪽이 없으면 []
create or replace function public.open_ws_page(p_board_id uuid, p_slide int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_pages jsonb;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  select w.pages into v_pages
  from public.boards b join public.worksheets w on w.lesson_code = b.lesson_code
  where b.id = p_board_id;
  insert into public.ws_page_open (board_id, page, slide)
  select p_board_id, (e.i - 1)::int, p_slide
  from jsonb_array_elements(coalesce(v_pages, '[]'::jsonb)) with ordinality as e(p, i)
  where (e.p ->> 'slide')::int = p_slide and jsonb_array_length(coalesce(e.p -> 'fields', '[]'::jsonb)) > 0
  on conflict (board_id, page) do nothing;
  return (select coalesce(jsonb_agg(o.page order by o.page), '[]'::jsonb)
          from public.ws_page_open o where o.board_id = p_board_id and o.slide = p_slide);
end;
$$;
revoke all on function public.open_ws_page(uuid, int) from public, anon;
grant execute on function public.open_ws_page(uuid, int) to authenticated;

-- 학습지 진도 올리기 (교사, 수업 모드). 지금까지 간 쪽 중 가장 뒤 번호만 남긴다(앞 쪽으로 돌아가도 닫히지 않음).
-- 전부 열기는 큰 수(9999)를 넘긴다. 결과: 저장된 진도
create or replace function public.set_worksheet_upto(p_board_id uuid, p_slide int)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_upto int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  if p_slide is null or p_slide < 1 then
    raise exception 'BAD_SLIDE';
  end if;
  update public.boards set ws_upto = greatest(coalesce(ws_upto, 0), p_slide)
  where id = p_board_id
  returning ws_upto into v_upto;
  if v_upto is null then
    raise exception 'NOT_FOUND';
  end if;
  return v_upto;
end;
$$;
revoke all on function public.set_worksheet_upto(uuid, int) from public, anon;
grant execute on function public.set_worksheet_upto(uuid, int) to authenticated;

-- 학습지 진도 되돌리기 (교사, 수업 모드 Shift+W): 진도를 p_slide로 바로 맞춘다(뒤 쪽은 다시 잠김). 학생이 낸 답은 그대로
create or replace function public.reset_worksheet_upto(p_board_id uuid, p_slide int)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_upto int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  if p_slide is null or p_slide < 1 then
    raise exception 'BAD_SLIDE';
  end if;
  update public.boards set ws_upto = p_slide
  where id = p_board_id
  returning ws_upto into v_upto;
  if v_upto is null then
    raise exception 'NOT_FOUND';
  end if;
  return v_upto;
end;
$$;
revoke all on function public.reset_worksheet_upto(uuid, int) from public, anon;
grant execute on function public.reset_worksheet_upto(uuid, int) to authenticated;

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
    'total',     v_total,
    -- 쪽별 제출 열기·첫 답: 칸이 있는 쪽의 수업자료 쪽 번호, 연 쪽(pages 순서), 아직 안 본 첫 답 수
    'pages',     (select coalesce(jsonb_agg(jsonb_build_object('page', e.i - 1, 'slide', (e.p ->> 'slide')::int) order by e.i), '[]'::jsonb)
                  from public.worksheets w, jsonb_array_elements(w.pages) with ordinality as e(p, i)
                  where w.lesson_code = b.lesson_code and jsonb_array_length(coalesce(e.p -> 'fields', '[]'::jsonb)) > 0),
    'opened',    (select coalesce(jsonb_agg(o.page order by o.page), '[]'::jsonb) from public.ws_page_open o where o.board_id = b.id),
    'waiting',   (select count(*)::int from public.ws_firsts f where f.board_id = b.id and f.status = 'wait')
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

-- 판마다 다른 무작위 수 (omok.js rand와 같음, 내부용): 씨앗과 백이 둔 수의 개수로 정해진다
create or replace function public._omok_rand(p_seed int, p_ply int)
returns bigint
language sql
immutable
set search_path = public
as $$
  select ((((p_seed::bigint % 2147483647) + p_ply::bigint * 7919 + 1) % 2147483647 * 48271 % 2147483647) * 48271) % 2147483647;
$$;
revoke all on function public._omok_rand(int, int) from public, anon, authenticated;

-- AI(백, 보통)의 다음 수: 칸 번호(1~225) 또는 null(둘 곳 없음) (omok.js aiMove와 같음, 내부용)
-- 돌에서 두 칸 안의 빈 칸만, 위에서 아래·왼쪽에서 오른쪽 순서로 본다.
-- 바로 이기는 칸이 있으면 그 칸. 없으면 가장 높은 점수의 90% 이상인 칸들 중 _omok_rand로 하나(본 순서대로 번호)
drop function if exists public._omok_ai(int[]);
create or replace function public._omok_ai(b int[], p_seed int, p_ply int)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  v_top   int := -1;
  v_score int;
  v_near  boolean;
  v_idx   int[] := '{}';
  v_sc    int[] := '{}';
  v_pick  int[] := '{}';
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
      v_idx := v_idx || i;
      v_sc  := v_sc || v_score;
      if v_score > v_top then
        v_top := v_score;
      end if;
    end loop;
  end loop;
  if coalesce(array_length(v_idx, 1), 0) = 0 then
    return null;
  end if;
  for k in 1 .. array_length(v_idx, 1) loop
    if v_sc[k]::bigint * 10 >= v_top::bigint * 9 then
      v_pick := v_pick || v_idx[k];
    end if;
  end loop;
  return v_pick[(public._omok_rand(p_seed, p_ply) % array_length(v_pick, 1))::int + 1];
end;
$$;
revoke all on function public._omok_ai(int[], int, int) from public, anon, authenticated;

-- 오늘(한국 시간) 시작한 오목 판 수 (내부용). 하루 한도는 이 수로 센다(사용자 결정 2026-10-15)
create or replace function public._omok_today(p_student_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from public.omok_games
  where student_id = p_student_id
    and started_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;
revoke all on function public._omok_today(uuid) from public, anon, authenticated;

-- 오목 화면 (학생)
-- 결과: {ok: true, open, today(오늘 받은 횟수), daily, xp, coins, avatar} 또는 {ok: false, error: 'NO_SESSION'}
-- 오늘(KST) 보상을 받은 오목 승리 수 (내부용). 하루 settings.omok.reward_daily번까지만 지급(2026-10-16 사용자 결정)
create or replace function public._omok_paid_today(p_student_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from public.point_events
  where student_id = p_student_id and reason = '오목 승리'
    and created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;
revoke all on function public._omok_paid_today(uuid) from public, anon, authenticated;

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
    'daily',  coalesce((v_set ->> 'daily')::int, 7),
    'xp',     coalesce((v_set ->> 'xp')::int, 2),
    'coins',  coalesce((v_set ->> 'coins')::int, 2),
    'reward_daily', coalesce((v_set ->> 'reward_daily')::int, 2),
    'rewarded', public._omok_paid_today(v_sid),
    'avatar', s.avatar
  );
end;
$$;
revoke all on function public.get_omok(text) from public;
grant execute on function public.get_omok(text) to anon, authenticated;


-- 오목 한 판 시작 (학생): 첫 돌을 놓을 때 부른다. 오늘 시작한 판이 하루 한도(settings.omok.daily)보다 적어야 한다.
-- 결과: {ok: true, game_id, seed(AI 무작위 씨앗), today, daily}
--   또는 {ok: false, error: 'NO_SESSION' | 'CLOSED'(선생님이 끔) | 'LIMIT'(오늘 판을 다 씀), today, daily}
create or replace function public.start_omok(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  s       public.students;
  v_set   jsonb;
  v_daily int;
  v_today int;
  v_id    uuid;
  v_seed  int;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  -- 학생 줄을 잠가 동시에 여러 번 눌러도 한도를 넘지 않게
  select * into s from public.students where id = v_sid for update;
  if not coalesce((select omok_open from public.classes where id = s.class_id), false) then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;
  select value into v_set from public.settings where key = 'omok';
  v_daily := coalesce((v_set ->> 'daily')::int, 7);
  v_today := public._omok_today(v_sid);
  if v_today >= v_daily then
    return jsonb_build_object('ok', false, 'error', 'LIMIT', 'today', v_today, 'daily', v_daily);
  end if;
  insert into public.omok_games (student_id, seed)
  values (v_sid, floor(random() * 2147483646)::int + 1)
  returning id, seed into v_id, v_seed;
  return jsonb_build_object('ok', true, 'game_id', v_id, 'seed', v_seed, 'today', v_today + 1, 'daily', v_daily);
end;
$$;
revoke all on function public.start_omok(text) from public;
grant execute on function public.start_omok(text) to anon, authenticated;

-- 이긴 판 내기 (학생): start_omok으로 받은 판 번호 + 흑 수 목록 [[행, 열], …] (0~14, 둔 순서대로. 무르기 없음)
-- 서버가 처음부터 다시 두며 백은 AI가 둔다. 마지막 흑 수로 다섯 개 이상이 되어야 한다. 판마다 보상 한 번.
-- 결과: {ok: true, paid, xp, coins, today, daily, level_before, level_after, total_xp}
--   또는 {ok: false, error: 'NO_SESSION' | 'CLOSED'(선생님이 끔) | 'BAD_GAME'(판 번호나 기보가 맞지 않음)}
drop function if exists public.submit_omok(text, jsonb);
create or replace function public.submit_omok(p_token text, p_game_id uuid, p_moves jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid    uuid;
  s        public.students;
  gm       public.omok_games;
  v_set    jsonb;
  b        int[] := array_fill(0, array[225]);
  v_n      int;
  r        int;
  c        int;
  w        int;
  v_won    boolean := false;
  v_cap    boolean := false;
  v_xp     int;
  v_co     int;
  v_before int;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  -- 학생 줄을 잠가 동시에 여러 판을 내도 하루 보상 횟수를 넘지 않게
  select * into s from public.students where id = v_sid for update;
  if not coalesce((select omok_open from public.classes where id = s.class_id), false) then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;

  -- 내 판이어야 한다. 줄을 잠가 같은 판을 동시에 여러 번 내도 한 번만
  select * into gm from public.omok_games where id = p_game_id and student_id = v_sid for update;
  if gm.id is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_GAME');
  end if;

  select value into v_set from public.settings where key = 'omok';
  select coalesce(sum(xp), 0)::int into v_before from public.point_events where student_id = v_sid;

  if gm.won_at is not null then
    return jsonb_build_object('ok', true, 'paid', false, 'xp', 0, 'coins', 0,
      'today', public._omok_today(v_sid), 'daily', coalesce((v_set ->> 'daily')::int, 7),
      'level_before', (public._level_info(v_before) ->> 'level')::int,
      'level_after',  (public._level_info(v_before) ->> 'level')::int,
      'total_xp',     v_before);
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
    w := public._omok_ai(b, gm.seed, k);
    exit when w is null;
    b[w] := 2;
    exit when public._omok_wins(b, (w - 1) / 15, (w - 1) % 15, 2);
  end loop;
  if not v_won then
    return jsonb_build_object('ok', false, 'error', 'BAD_GAME');
  end if;

  -- 이긴 판은 늘 기록(랭킹), 보상은 오늘 reward_daily번까지
  update public.omok_games set won_at = now() where id = gm.id;
  v_xp := coalesce((v_set ->> 'xp')::int, 2);
  v_co := coalesce((v_set ->> 'coins')::int, 2);
  v_cap := public._omok_paid_today(v_sid) >= coalesce((v_set ->> 'reward_daily')::int, 2);
  if v_cap then
    v_xp := 0;
    v_co := 0;
  end if;
  if v_xp <> 0 or v_co <> 0 then
    insert into public.point_events (student_id, xp, coins, reason)
    values (v_sid, v_xp, v_co, '오목 승리');
  end if;

  return jsonb_build_object('ok', true, 'paid', v_xp <> 0 or v_co <> 0, 'capped', v_cap, 'xp', v_xp, 'coins', v_co,
    'today', public._omok_today(v_sid), 'daily', coalesce((v_set ->> 'daily')::int, 7),
    'level_before', (public._level_info(v_before) ->> 'level')::int,
    'level_after',  (public._level_info(v_before + v_xp) ->> 'level')::int,
    'total_xp',     v_before + v_xp);
end;
$$;
revoke all on function public.submit_omok(text, uuid, jsonb) from public;
grant execute on function public.submit_omok(text, uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- 루미큐브 (2026-10-16): 3명 온라인 대전. 규칙은 assets/js/rummikub.js와 같아야 한다.
-- 판 상태는 모두 서버에. 학생은 rk_join → rk_state(몇 초마다 + rk-<판> Broadcast 신호) → rk_play / rk_draw / rk_leave.
-- 차례 제한 시간(settings.rummikub.turn초)이 지나면 누가 rk_*를 부르든 서버가 그 사람 몫으로 1장 뽑고 넘긴다(3번 연속이면 나간 것으로).
-- ---------------------------------------------------------

-- 세트 점수: 맞지 않으면 null.
-- 그룹: 3~4장, 같은 숫자, 색이 모두 다름. 줄: 3~13장, 같은 색, 이어진 숫자(조커가 빈 곳을 채우고 남으면 위로, 13을 넘으면 아래로).
-- 둘 다 되면 큰 점수.
create or replace function public._rk_set_value(s int[])
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  n    int := coalesce(array_length(s, 1), 0);
  nj   int := 0;
  t    int;
  nums int[] := '{}';
  cols int[] := '{}';
  g    int;
  r    int;
  lo   int;
  hi   int;
begin
  if n < 3 then
    return null;
  end if;
  foreach t in array s loop
    if t is null or t < 0 or t > 105 then
      return null;
    end if;
    if t >= 104 then
      nj := nj + 1;
    else
      nums := nums || (t % 13 + 1);
      cols := cols || ((t / 13) % 4);
    end if;
  end loop;
  if nj = n then
    return null;
  end if;
  if n <= 4 and (select count(distinct x) from unnest(nums) x) = 1
     and (select count(distinct x) from unnest(cols) x) = n - nj then
    g := nums[1] * n;
  end if;
  if n <= 13 and (select count(distinct x) from unnest(cols) x) = 1
     and (select count(distinct x) from unnest(nums) x) = n - nj then
    select min(x), max(x) into lo, hi from unnest(nums) x;
    if hi - lo + 1 <= n then
      hi := lo + n - 1;
      if hi > 13 then
        hi := 13;
        lo := 14 - n;
      end if;
      r := (lo + hi) * n / 2;
    end if;
  end if;
  return greatest(g, r);
end;
$$;
revoke all on function public._rk_set_value(int[]) from public, anon, authenticated;

-- 손패 점수(끝날 때 비교). 조커 30
create or replace function public._rk_rack_points(p_rack int[])
returns int
language sql
immutable
set search_path = public
as $$
  select coalesce(sum(case when t >= 104 then 30 else t % 13 + 1 end), 0)::int from unnest(p_rack) t;
$$;
revoke all on function public._rk_rack_points(int[]) from public, anon, authenticated;

-- 오늘(KST) 시작된 판 중 내가 들어간 판 수
create or replace function public._rk_today(p_student_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from public.rk_players p
  join public.rk_games g on g.id = p.game_id
  where p.student_id = p_student_id
    and g.started_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;
revoke all on function public._rk_today(uuid) from public, anon, authenticated;

create or replace function public._rk_settings()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'xp',    coalesce((v ->> 'xp')::int, 5),
    'coins', coalesce((v ->> 'coins')::int, 5),
    'daily', coalesce((v ->> 'daily')::int, 5),
    'turn',  greatest(coalesce((v ->> 'turn')::int, 60), 15))
  from (select (select value from public.settings where key = 'rummikub') as v) x;
$$;
revoke all on function public._rk_settings() from public, anon, authenticated;

-- 판 끝내기. 손패를 다 냈거나(out) 더미가 비고 모두 넘겼으면(pool) 1등에게 보상(반이 켜져 있을 때, 판마다 한 번).
-- 다른 사람이 모두 나가서 끝나면(left) 보상 없음
create or replace function public._rk_end(p_game_id uuid, p_winner int, p_reason text)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  v_sid uuid;
  v_set jsonb := public._rk_settings();
  v_pay boolean := false;
begin
  select student_id into v_sid from public.rk_players where game_id = p_game_id and seat = p_winner;
  if p_reason in ('out', 'pool') and v_sid is not null
     and coalesce((select c.omok_open from public.students s join public.classes c on c.id = s.class_id where s.id = v_sid), false)
     and ((v_set ->> 'xp')::int <> 0 or (v_set ->> 'coins')::int <> 0) then
    insert into public.point_events (student_id, xp, coins, reason)
    values (v_sid, (v_set ->> 'xp')::int, (v_set ->> 'coins')::int, '루미큐브 승리');
    v_pay := true;
  end if;
  update public.rk_games
  set status = 'done', ended_at = now(), winner = p_winner, end_reason = p_reason, paid = v_pay, version = version + 1
  where id = p_game_id;
end;
$$;
revoke all on function public._rk_end(uuid, int, text) from public, anon, authenticated;

-- 다음 차례로. 남은 사람이 1명이면 그 사람이 이긴 것으로(보상 없음). p_at: 새 차례가 시작된 시각
create or replace function public._rk_next(p_game_id uuid, p_at timestamptz)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g      public.rk_games;
  v_left int;
  v_seat int;
begin
  select * into g from public.rk_games where id = p_game_id;
  select count(*) into v_left from public.rk_players where game_id = p_game_id and left_at is null;
  if v_left <= 1 then
    select seat into v_seat from public.rk_players where game_id = p_game_id and left_at is null;
    perform public._rk_end(p_game_id, coalesce(v_seat, g.turn), 'left');
    return;
  end if;
  select seat into v_seat from public.rk_players
  where game_id = p_game_id and left_at is null
  order by (seat - g.turn + 2) % 3
  limit 1;
  update public.rk_games set turn = v_seat, turn_at = p_at, version = version + 1 where id = p_game_id;
end;
$$;
revoke all on function public._rk_next(uuid, timestamptz) from public, anon, authenticated;

-- 지금 차례인 사람이 1장 뽑기(더미가 비었으면 넘김). 모두 연속으로 넘기면 손패 점수가 가장 낮은 사람이 1등.
-- 끝나지 않았으면 다음 차례로 넘기지는 않는다(부르는 쪽이 _rk_next)
-- 결과: 판이 끝났으면 true
create or replace function public._rk_draw_one(p_game_id uuid, p_kind text)
returns boolean
language plpgsql
volatile
set search_path = public
as $$
declare
  g      public.rk_games;
  v_tile int;
  v_left int;
  v_win  int;
begin
  select * into g from public.rk_games where id = p_game_id;
  if coalesce(array_length(g.pool, 1), 0) > 0 then
    v_tile := g.pool[1];
    update public.rk_players set rack = rack || v_tile where game_id = p_game_id and seat = g.turn;
    update public.rk_games
    set pool = pool[2:], passes = 0, last = jsonb_build_object('seat', g.turn, 'kind', p_kind, 'n', 1)
    where id = p_game_id;
    return false;
  end if;
  update public.rk_games
  set passes = passes + 1, last = jsonb_build_object('seat', g.turn, 'kind', case when p_kind = 'timeout' then 'timeout' else 'pass' end, 'n', 0)
  where id = p_game_id;
  select count(*) into v_left from public.rk_players where game_id = p_game_id and left_at is null;
  if g.passes + 1 >= v_left then
    select seat into v_win from public.rk_players
    where game_id = p_game_id and left_at is null
    order by public._rk_rack_points(rack), coalesce(array_length(rack, 1), 0), (seat - g.turn + 3) % 3
    limit 1;
    perform public._rk_end(p_game_id, v_win, 'pool');
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public._rk_draw_one(uuid, text) from public, anon, authenticated;

-- 제한 시간이 지난 차례 처리(부르는 쪽이 판 줄을 잠근 뒤). 시간 넘긴 사람은 1장 뽑고 다음 사람,
-- 3번 연속이면 나간 것으로. 아무도 안 부른 동안 밀린 차례도 한 번에(최대 30번)
create or replace function public._rk_tick(p_game_id uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g      public.rk_games;
  v_turn interval := make_interval(secs => (public._rk_settings() ->> 'turn')::int);
  v_to   int;
  v_due  timestamptz;
begin
  for i in 1 .. 30 loop
    select * into g from public.rk_games where id = p_game_id;
    exit when g.status <> 'playing' or now() < g.turn_at + v_turn + interval '3 seconds';
    v_due := g.turn_at + v_turn;
    update public.rk_players set timeouts = timeouts + 1
    where game_id = p_game_id and seat = g.turn
    returning timeouts into v_to;
    if v_to >= 3 then
      update public.rk_players set left_at = now() where game_id = p_game_id and seat = g.turn;
      update public.rk_games set last = jsonb_build_object('seat', g.turn, 'kind', 'leave', 'n', 0) where id = p_game_id;
    elsif public._rk_draw_one(p_game_id, 'timeout') then
      exit;
    end if;
    perform public._rk_next(p_game_id, v_due);
  end loop;
end;
$$;
revoke all on function public._rk_tick(uuid) from public, anon, authenticated;

-- 학생에게 보낼 판(자기 손패만). 끝난 판이면 손패 점수와 보상도
create or replace function public._rk_view(p_game_id uuid, p_sid uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  g      public.rk_games;
  me     public.rk_players;
  v_set  jsonb := public._rk_settings();
  v_tot  int;
  v_rw   jsonb;
begin
  select * into g from public.rk_games where id = p_game_id;
  select * into me from public.rk_players where game_id = p_game_id and student_id = p_sid;
  if g.id is null or me.game_id is null then
    return null;
  end if;
  if g.status = 'done' and g.paid and g.winner = me.seat then
    select coalesce(sum(xp), 0)::int into v_tot from public.point_events where student_id = p_sid;
    v_rw := jsonb_build_object('xp', (v_set ->> 'xp')::int, 'coins', (v_set ->> 'coins')::int, 'total_xp', v_tot,
      'level_before', (public._level_info(v_tot - (v_set ->> 'xp')::int) ->> 'level')::int,
      'level_after',  (public._level_info(v_tot) ->> 'level')::int);
  end if;
  return jsonb_build_object(
    'id',      g.id,
    'status',  g.status,
    'version', g.version,
    'me',      me.seat,
    'turn',    g.turn,
    'turn_sec', (v_set ->> 'turn')::int,
    'left_ms', case when g.status = 'playing'
                 then greatest(0, floor(extract(epoch from (g.turn_at + make_interval(secs => (v_set ->> 'turn')::int) - now())) * 1000))::bigint
               end,
    'pool',    coalesce(array_length(g.pool, 1), 0),
    'board',   g.board,
    'rack',    to_jsonb(me.rack),
    'melded',  me.melded,
    'left',    me.left_at is not null,
    'last',    g.last,
    'winner',  g.winner,
    'end_reason', g.end_reason,
    'reward',  v_rw,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'seat',     p.seat,
        'me',       p.student_id = p_sid,
        'class_id', s.class_id,
        'nickname', s.nickname,
        'avatar',   s.avatar,
        'count',    coalesce(array_length(p.rack, 1), 0),
        'melded',   p.melded,
        'left',     p.left_at is not null,
        'points',   case when g.status = 'done' then public._rk_rack_points(p.rack) end
      ) order by p.seat), '[]'::jsonb)
      from public.rk_players p join public.students s on s.id = p.student_id
      where p.game_id = g.id)
  );
end;
$$;
revoke all on function public._rk_view(uuid, uuid) from public, anon, authenticated;

-- 판에서 나가기(내부). 대기 중이면 자리를 비우고, 하는 중이면 기권(남은 사람끼리 계속)
create or replace function public._rk_leave(p_game_id uuid, p_sid uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g  public.rk_games;
  me public.rk_players;
begin
  select * into g from public.rk_games where id = p_game_id for update;
  select * into me from public.rk_players where game_id = p_game_id and student_id = p_sid;
  if g.id is null or me.game_id is null or me.left_at is not null then
    return;
  end if;
  if g.status = 'waiting' then
    delete from public.rk_players where game_id = p_game_id and student_id = p_sid;
    if not exists (select 1 from public.rk_players where game_id = p_game_id) then
      delete from public.rk_games where id = p_game_id;
    else
      update public.rk_games set version = version + 1 where id = p_game_id;
    end if;
  elsif g.status = 'playing' then
    update public.rk_players set left_at = now() where game_id = p_game_id and student_id = p_sid;
    update public.rk_games set last = jsonb_build_object('seat', me.seat, 'kind', 'leave', 'n', 0), version = version + 1
    where id = p_game_id;
    if g.turn = me.seat or (select count(*) from public.rk_players where game_id = p_game_id and left_at is null) <= 1 then
      perform public._rk_next(p_game_id, now());
    end if;
  end if;
end;
$$;
revoke all on function public._rk_leave(uuid, uuid) from public, anon, authenticated;

-- 루미큐브 화면 (학생). p_game_id를 주면 그 판(끝난 판 포함), 없으면 지금 하는 판(없으면 game: null).
-- 부를 때마다 '아직 있음'을 기록하고 밀린 시간 초과를 처리한다. 반이 꺼져 있으면 하던 판에서 나간다.
-- 결과: {ok: true, open, today, daily, xp, coins, turn, avatar, game} 또는 {ok: false, error: 'NO_SESSION'}
create or replace function public.rk_state(p_token text, p_game_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid  uuid;
  s      public.students;
  v_open boolean;
  v_gid  uuid := p_game_id;
  v_set  jsonb := public._rk_settings();
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid;
  v_open := coalesce((select omok_open from public.classes where id = s.class_id), false);

  if v_gid is null or not exists (select 1 from public.rk_players where game_id = v_gid and student_id = v_sid) then
    select p.game_id into v_gid
    from public.rk_players p join public.rk_games g on g.id = p.game_id
    where p.student_id = v_sid and p.left_at is null and g.status in ('waiting', 'playing')
    order by p.joined_at desc
    limit 1;
  end if;

  if v_gid is not null then
    if not v_open then
      perform public._rk_leave(v_gid, v_sid);
    else
      perform 1 from public.rk_games where id = v_gid for update;
      update public.rk_players set seen_at = now() where game_id = v_gid and student_id = v_sid;
      perform public._rk_tick(v_gid);
    end if;
  end if;

  return jsonb_build_object(
    'ok',     true,
    'open',   v_open,
    'today',  public._rk_today(v_sid),
    'daily',  (v_set ->> 'daily')::int,
    'xp',     (v_set ->> 'xp')::int,
    'coins',  (v_set ->> 'coins')::int,
    'turn',   (v_set ->> 'turn')::int,
    'avatar', s.avatar,
    'game',   case when v_gid is null then null else public._rk_view(v_gid, v_sid) end
  );
end;
$$;
revoke all on function public.rk_state(text, uuid) from public;
grant execute on function public.rk_state(text, uuid) to anon, authenticated;

-- 판 찾기 (학생): 6개 반 전체에서 먼저 온 3명끼리. 이미 하는 판이 있으면 그 판.
-- 15초 넘게 소식이 없는 대기자는 빼고 채운다. 3명이 되면 섞어서 14장씩 나누고 시작(첫 차례는 무작위).
-- 결과: rk_state와 같음 또는 {ok: false, error: 'NO_SESSION' | 'CLOSED' | 'LIMIT', today, daily}
create or replace function public.rk_join(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  s       public.students;
  v_set   jsonb := public._rk_settings();
  v_today int;
  v_gid   uuid;
  v_seat  int;
  v_n     int;
  v_deck  int[];
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid;
  if not coalesce((select omok_open from public.classes where id = s.class_id), false) then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;

  -- 짝 맞추기는 한 번에 한 명씩
  perform pg_advisory_xact_lock(hashtext('rk_match'));

  if exists (select 1 from public.rk_players p join public.rk_games g on g.id = p.game_id
             where p.student_id = v_sid and p.left_at is null and g.status in ('waiting', 'playing')) then
    return public.rk_state(p_token, null);
  end if;

  v_today := public._rk_today(v_sid);
  if v_today >= (v_set ->> 'daily')::int then
    return jsonb_build_object('ok', false, 'error', 'LIMIT', 'today', v_today, 'daily', (v_set ->> 'daily')::int);
  end if;

  delete from public.rk_players p using public.rk_games g
  where p.game_id = g.id and g.status = 'waiting' and p.seen_at < now() - interval '15 seconds';
  delete from public.rk_games g
  where g.status = 'waiting' and not exists (select 1 from public.rk_players p where p.game_id = g.id);

  select g.id into v_gid from public.rk_games g
  where g.status = 'waiting' and (select count(*) from public.rk_players p where p.game_id = g.id) < 3
  order by g.created_at
  limit 1
  for update;
  if v_gid is null then
    insert into public.rk_games default values returning id into v_gid;
  end if;

  select min(x) into v_seat from generate_series(0, 2) x
  where not exists (select 1 from public.rk_players p where p.game_id = v_gid and p.seat = x);
  insert into public.rk_players (game_id, seat, student_id) values (v_gid, v_seat, v_sid);
  update public.rk_games set version = version + 1 where id = v_gid;

  select count(*) into v_n from public.rk_players where game_id = v_gid;
  if v_n = 3 then
    select array_agg(x order by random()) into v_deck from generate_series(0, 105) x;
    update public.rk_players set rack = v_deck[seat * 14 + 1 : seat * 14 + 14], seen_at = now() where game_id = v_gid;
    update public.rk_games
    set status = 'playing', started_at = now(), pool = v_deck[43:106], board = '[]',
        turn = floor(random() * 3)::int, turn_at = now() + interval '3 seconds', version = version + 1
    where id = v_gid;
  end if;

  return public.rk_state(p_token, v_gid);
end;
$$;
revoke all on function public.rk_join(text) from public;
grant execute on function public.rk_join(text) to anon, authenticated;

-- 나가기 (학생): 대기 중이면 취소, 하는 중이면 기권
create or replace function public.rk_leave(p_token text, p_game_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid uuid;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  perform pg_advisory_xact_lock(hashtext('rk_match'));
  perform public._rk_leave(p_game_id, v_sid);
  return public.rk_state(p_token, p_game_id);
end;
$$;
revoke all on function public.rk_leave(text, uuid) from public;
grant execute on function public.rk_leave(text, uuid) to anon, authenticated;

-- 내 차례 확인(내부): 판 줄을 잠그고 시간 초과를 처리한 뒤 내 자리. 아니면 error
create or replace function public._rk_my_turn(p_game_id uuid, p_sid uuid, p_version int)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  g  public.rk_games;
  me public.rk_players;
begin
  select * into g from public.rk_games where id = p_game_id for update;
  select * into me from public.rk_players where game_id = p_game_id and student_id = p_sid;
  if g.id is null or me.game_id is null then
    return jsonb_build_object('error', 'BAD_GAME');
  end if;
  update public.rk_players set seen_at = now() where game_id = p_game_id and student_id = p_sid;
  perform public._rk_tick(p_game_id);
  select * into g from public.rk_games where id = p_game_id;
  select * into me from public.rk_players where game_id = p_game_id and student_id = p_sid;
  if g.status <> 'playing' or me.left_at is not null then
    return jsonb_build_object('error', 'OVER');
  end if;
  if g.turn <> me.seat then
    return jsonb_build_object('error', 'NOT_TURN');
  end if;
  if g.version <> p_version then
    return jsonb_build_object('error', 'STALE');
  end if;
  return jsonb_build_object('seat', me.seat);
end;
$$;
revoke all on function public._rk_my_turn(uuid, uuid, int) from public, anon, authenticated;

-- 1장 가져오기 (학생, 내 차례). 판을 바꾼 게 있으면 화면이 되돌린 뒤 부른다
-- 결과: rk_state와 같음(ok: true) 또는 {ok: false, error: 'NO_SESSION' | 'BAD_GAME' | 'OVER' | 'NOT_TURN' | 'STALE', state}
create or replace function public.rk_draw(p_token text, p_game_id uuid, p_version int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid uuid;
  v_chk jsonb;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  v_chk := public._rk_my_turn(p_game_id, v_sid, p_version);
  if v_chk ? 'error' then
    return jsonb_build_object('ok', false, 'error', v_chk ->> 'error', 'state', public.rk_state(p_token, p_game_id));
  end if;
  update public.rk_players set timeouts = 0 where game_id = p_game_id and student_id = v_sid;
  if not public._rk_draw_one(p_game_id, 'draw') then
    perform public._rk_next(p_game_id, now());
  end if;
  return public.rk_state(p_token, p_game_id);
end;
$$;
revoke all on function public.rk_draw(text, uuid, int) from public;
grant execute on function public.rk_draw(text, uuid, int) to anon, authenticated;

-- 내기 (학생, 내 차례): 바꾼 뒤의 판 전체 [[타일…], …]를 보낸다. 서버가 확인하는 것:
-- 판에 있던 타일이 모두 남아 있음(LOST), 새로 놓은 타일은 내 손패(NOT_MINE), 모든 세트가 맞음(BAD_SET, bad: 세트 순서),
-- 한 장 이상 냄(NONE), 첫 등록 전이면 판의 세트는 그대로 두고 내 타일로만 30점 이상(FIRST_TOUCH · FIRST_30)
-- 결과: rk_state와 같음(ok: true) 또는 {ok: false, error, bad?, meld?, state}
create or replace function public.rk_play(p_token text, p_game_id uuid, p_version int, p_board jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid    uuid;
  v_chk    jsonb;
  g        public.rk_games;
  me       public.rk_players;
  v_new    int[] := '{}';
  v_old    int[] := '{}';
  v_set    int[];
  v_keys   text[] := '{}';
  v_bad    int[] := '{}';
  v_played int[];
  v_meld   int := 0;
  v_k      text;
  v_i      int;
  v_found  boolean;
  v_err    text;
  v_n      int;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  v_chk := public._rk_my_turn(p_game_id, v_sid, p_version);
  if v_chk ? 'error' then
    return jsonb_build_object('ok', false, 'error', v_chk ->> 'error', 'state', public.rk_state(p_token, p_game_id));
  end if;
  select * into g from public.rk_games where id = p_game_id;
  select * into me from public.rk_players where game_id = p_game_id and student_id = v_sid;

  -- 모양: 세트 60개까지, 세트마다 정수 타일 13장까지
  if jsonb_typeof(p_board) <> 'array' or jsonb_array_length(p_board) > 60 then
    return jsonb_build_object('ok', false, 'error', 'BAD_SET', 'bad', '[]'::jsonb, 'state', public.rk_state(p_token, p_game_id));
  end if;
  v_n := jsonb_array_length(p_board);
  for i in 0 .. v_n - 1 loop
    if jsonb_typeof(p_board -> i) <> 'array' or jsonb_array_length(p_board -> i) > 13
       or exists (select 1 from jsonb_array_elements(p_board -> i) e
                  where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric <> floor((e #>> '{}')::numeric)
                     or (e #>> '{}')::numeric not between 0 and 105) then
      return jsonb_build_object('ok', false, 'error', 'BAD_SET', 'bad', jsonb_build_array(i), 'state', public.rk_state(p_token, p_game_id));
    end if;
    v_set := array(select (e #>> '{}')::int from jsonb_array_elements(p_board -> i) e);
    v_new := v_new || v_set;
    v_keys := v_keys || array_to_string(array(select x from unnest(v_set) x order by x), ',');
    if public._rk_set_value(v_set) is null then
      v_bad := v_bad || i;
    end if;
  end loop;
  v_old := array(select (e #>> '{}')::int from jsonb_array_elements(g.board) s, jsonb_array_elements(s) e);

  if (select count(*) from unnest(v_new)) <> (select count(distinct x) from unnest(v_new) x)
     or exists (select unnest(v_old) except select unnest(v_new)) then
    v_err := 'LOST';
  else
    v_played := array(select unnest(v_new) except select unnest(v_old));
    if not v_played <@ me.rack then
      v_err := 'NOT_MINE';
    elsif cardinality(v_bad) > 0 then
      v_err := 'BAD_SET';
    elsif cardinality(v_played) = 0 then
      v_err := 'NONE';
    elsif not me.melded then
      -- 턴 시작 때 세트가 모두 그대로 있어야 한다(같은 타일 묶음). 남은 새 세트 점수가 30 이상
      for v_i in 0 .. jsonb_array_length(g.board) - 1 loop
        v_k := array_to_string(array(select (e #>> '{}')::int as x from jsonb_array_elements(g.board -> v_i) e order by x), ',');
        v_found := false;
        for j in 1 .. coalesce(array_length(v_keys, 1), 0) loop
          if v_keys[j] = v_k then
            v_keys[j] := null;
            v_found := true;
            exit;
          end if;
        end loop;
        if not v_found then
          v_err := 'FIRST_TOUCH';
          exit;
        end if;
      end loop;
      if v_err is null then
        for i in 0 .. v_n - 1 loop
          if v_keys[i + 1] is not null then
            v_meld := v_meld + public._rk_set_value(array(select (e #>> '{}')::int from jsonb_array_elements(p_board -> i) e));
          end if;
        end loop;
        if v_meld < 30 then
          v_err := 'FIRST_30';
        end if;
      end if;
    end if;
  end if;
  if v_err is not null then
    return jsonb_build_object('ok', false, 'error', v_err, 'bad', to_jsonb(v_bad), 'meld', v_meld,
      'state', public.rk_state(p_token, p_game_id));
  end if;

  update public.rk_players
  set rack = array(select t from unnest(rack) with ordinality u(t, o) where not t = any(v_played) order by o),
      melded = true, timeouts = 0
  where game_id = p_game_id and student_id = v_sid;
  update public.rk_games
  set board = p_board, passes = 0,
      last = jsonb_build_object('seat', me.seat, 'kind', 'play', 'n', cardinality(v_played), 'tiles', to_jsonb(v_played))
  where id = p_game_id;

  if not exists (select 1 from public.rk_players where game_id = p_game_id and student_id = v_sid and cardinality(rack) > 0) then
    perform public._rk_end(p_game_id, me.seat, 'out');
  else
    perform public._rk_next(p_game_id, now());
  end if;
  return public.rk_state(p_token, p_game_id);
end;
$$;
revoke all on function public.rk_play(text, uuid, int, jsonb) from public;
grant execute on function public.rk_play(text, uuid, int, jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- 퀴즈 배틀 (2026-10-16): 그날 모둠끼리 오늘 차시 학습지 문제를 한 문제씩 함께 푼다.
-- 교사가 수업 모드 [모둠] 탭에서 연 보드(boards.quiz_open)에서만. 모둠마다 한 판.
-- 출제: 학습지의 빈칸·고르기·부등호 중 정답이 있는 칸 전부를 f1부터 순서대로(서술·점 찍기·정답 없는 고르기는 뺀다)
-- 진행은 모두 서버 시각으로: 문제마다 q_at(시작) ~ q_end(마감) 동안 답을 받고, 접속한 모둠원이 모두 내면 마감을 앞당긴다.
-- 마감 뒤 reveal초 동안 정답 공개, 그 뒤 다음 문제. 누가 qb_*를 부르든 밀린 진행을 _qb_tick이 처리한다.
-- 맞히면 10점(먼저 낸 순서 보너스 없음). 끝나면 모둠 안 1등(동점이면 모두, 2명 이상 한 판, 1문제 이상 맞힘)에게 XP·코인 한 번.
-- 학생 쪽에는 지금 문제와 이미 공개된 정답만 내보낸다
-- ---------------------------------------------------------

create or replace function public._qb_settings()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'xp',     coalesce((v ->> 'xp')::int, 4),
    'coins',  coalesce((v ->> 'coins')::int, 4),
    'pick',   least(greatest(coalesce((v ->> 'pick')::int, 15), 5), 120),
    'blank',  least(greatest(coalesce((v ->> 'blank')::int, 25), 5), 120),
    'reveal', least(greatest(coalesce((v ->> 'reveal')::int, 3), 1), 10))
  from (select (select value from public.settings where key = 'quiz_battle') as v) x;
$$;
revoke all on function public._qb_settings() from public, anon, authenticated;

-- 출제 문항 [{key, type, page(학습지 쪽 순서, 0부터), slide, title, options, answers}]
create or replace function public._qb_items(p_lesson text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key',     f.k,
           'type',    f.t,
           'page',    f.pi - 1,
           'slide',   f.slide,
           'title',   f.title,
           'options', case when f.t = 'sym' then '["<", "=", ">"]'::jsonb else coalesce(f.spec -> 'options', '[]'::jsonb) end,
           'answers', f.spec -> 'answers'
         ) order by f.pi, f.o), '[]'::jsonb)
  from (
    select fl ->> 'key' as k,
           w.key -> (fl ->> 'key') ->> 'type' as t,
           w.key -> (fl ->> 'key') as spec,
           pg.pi,
           (pg.pg ->> 'slide')::int as slide,
           pg.pg ->> 'title' as title,
           coalesce(nullif(regexp_replace(fl ->> 'key', '\D', '', 'g'), ''), '0')::int as o
    from public.worksheets w
    cross join lateral jsonb_array_elements(w.pages) with ordinality as pg(pg, pi)
    cross join lateral jsonb_array_elements(coalesce(pg.pg -> 'fields', '[]'::jsonb)) as fl
    where w.lesson_code = p_lesson
  ) f
  where f.t in ('blank', 'choice', 'sym')
    and jsonb_typeof(f.spec -> 'answers') = 'array'
    and exists (select 1 from jsonb_array_elements_text(f.spec -> 'answers') a where btrim(a) <> '');
$$;
revoke all on function public._qb_items(text) from public, anon, authenticated;

-- 한 문제에 주는 시간(초)
create or replace function public._qb_dur(p_item jsonb)
returns int
language sql
stable
set search_path = public
as $$
  select (public._qb_settings() ->> case when p_item ->> 'type' = 'blank' then 'blank' else 'pick' end)::int;
$$;
revoke all on function public._qb_dur(jsonb) from public, anon, authenticated;

-- 채점: 빈칸은 공백·대소문자 무시(_ws_norm), 고르기·부등호는 그대로 같아야
create or replace function public._qb_ok(p_item jsonb, p_answer text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_item ->> 'type' = 'blank' then exists (
      select 1 from jsonb_array_elements_text(p_item -> 'answers') a
      where public._ws_norm(a) <> '' and public._ws_norm(a) = public._ws_norm(p_answer))
    else exists (select 1 from jsonb_array_elements_text(p_item -> 'answers') a where btrim(a) = btrim(coalesce(p_answer, '')))
  end;
$$;
revoke all on function public._qb_ok(jsonb, text) from public, anon, authenticated;

-- 판 끝내기: 맞힌 수로 점수를 확정하고 모둠 안 1등에게 한 번 지급
create or replace function public._qb_end(p_game_id uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g     public.qb_games;
  v_set jsonb := public._qb_settings();
  v_top int;
  v_n   int;
  v_code text;
begin
  select * into g from public.qb_games where id = p_game_id for update;
  if g.id is null or g.status = 'done' then
    return;
  end if;
  update public.qb_players p
  set correct = coalesce((select count(*) from public.qb_answers a where a.game_id = p.game_id and a.student_id = p.student_id and a.ok), 0),
      score   = 10 * coalesce((select count(*) from public.qb_answers a where a.game_id = p.game_id and a.student_id = p.student_id and a.ok), 0)
  where p.game_id = p_game_id;
  select max(correct), count(*) into v_top, v_n from public.qb_players where game_id = p_game_id;
  select lesson_code into v_code from public.boards where id = g.board_id;
  if v_n >= 2 and coalesce(v_top, 0) > 0 and ((v_set ->> 'xp')::int <> 0 or (v_set ->> 'coins')::int <> 0) then
    insert into public.point_events (student_id, xp, coins, reason, qb_game_id)
    select p.student_id, (v_set ->> 'xp')::int, (v_set ->> 'coins')::int, '퀴즈 배틀 ' || coalesce(v_code, ''), p_game_id
    from public.qb_players p
    where p.game_id = p_game_id and p.correct = v_top
    on conflict do nothing;
  end if;
  update public.qb_games set status = 'done', ended_at = now(), paid = true, version = version + 1 where id = p_game_id;
end;
$$;
revoke all on function public._qb_end(uuid) from public, anon, authenticated;

-- 밀린 진행 처리: 접속한 모둠원(12초 안에 소식)이 모두 냈으면 마감을 앞당기고,
-- 정답 공개가 끝난 문제는 다음 문제로(오래 비었으면 지금부터 다시 시작). 마지막 문제 뒤나 교사가 닫았으면 끝
create or replace function public._qb_tick(p_game_id uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g        public.qb_games;
  v_reveal interval := make_interval(secs => (public._qb_settings() ->> 'reveal')::int);
  v_n      int;
  v_next   timestamptz;
  v_guard  int := 0;
begin
  select * into g from public.qb_games where id = p_game_id for update;
  if g.id is null or g.status <> 'playing' then
    return;
  end if;
  if not coalesce((select quiz_open from public.boards where id = g.board_id), false) then
    perform public._qb_end(p_game_id);
    return;
  end if;
  v_n := jsonb_array_length(g.items);
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 500;
    -- 답을 받는 중: 접속한 모둠원이 모두 냈으면 지금 마감
    if now() >= g.q_at and now() < g.q_end and not exists (
         select 1 from public.qb_players p
         where p.game_id = g.id and p.seen_at > now() - interval '12 seconds'
           and not exists (select 1 from public.qb_answers a where a.game_id = g.id and a.q = g.q and a.student_id = p.student_id)) then
      update public.qb_games set q_end = now(), version = version + 1 where id = g.id returning * into g;
    end if;
    exit when now() < g.q_end + v_reveal;
    if g.q + 1 >= v_n then
      perform public._qb_end(g.id);
      return;
    end if;
    v_next := g.q_end + v_reveal;
    if v_next < now() - interval '2 seconds' then
      v_next := now();
    end if;
    update public.qb_games
    set q = g.q + 1, q_at = v_next, q_end = v_next + make_interval(secs => public._qb_dur(g.items -> (g.q + 1))), version = version + 1
    where id = g.id
    returning * into g;
  end loop;
end;
$$;
revoke all on function public._qb_tick(uuid) from public, anon, authenticated;

-- 학생에게 보여 줄 판
--   phase: lobby | ready(첫 문제 전 3초) | ask | reveal | done
--   item: 지금 문제 {no, total, key, type, slide, title, options, html(그 쪽 학습지 화면용 html), solved({칸: 정답}, 같은 쪽 앞 문제), later(같은 쪽 뒤 문제 칸)}
--   공개 뒤(reveal·done)에만 answer(정답)·각자의 맞음/틀림. 점수는 공개된 문제까지만
create or replace function public._qb_view(p_game_id uuid, p_sid uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  g        public.qb_games;
  v_reveal interval := make_interval(secs => (public._qb_settings() ->> 'reveal')::int);
  v_phase  text;
  v_upto   int;      -- 점수에 넣는 마지막 문제(공개된 문제까지)
  v_item   jsonb;
  v_html   text;
  v_ans    jsonb;
  v_mine   jsonb;
  v_gain   jsonb;
begin
  select * into g from public.qb_games where id = p_game_id;
  if g.id is null then
    return null;
  end if;
  v_phase := case
    when g.status = 'lobby' then 'lobby'
    when g.status = 'done' then 'done'
    when now() < g.q_at then 'ready'
    when now() < g.q_end then 'ask'
    else 'reveal' end;
  v_upto := case when v_phase in ('reveal', 'done') then g.q else g.q - 1 end;
  if g.status = 'done' then
    v_upto := jsonb_array_length(g.items);
  end if;

  if g.status = 'playing' then
    v_item := g.items -> g.q;
    select pg ->> 'html' into v_html
    from public.boards b join public.worksheets w on w.lesson_code = b.lesson_code,
         lateral (select w.pages -> (v_item ->> 'page')::int as pg) x
    where b.id = g.board_id;
    select jsonb_build_object('answer', a.answer, 'ok', case when v_phase = 'reveal' then a.ok end) into v_mine
    from public.qb_answers a where a.game_id = g.id and a.q = g.q and a.student_id = p_sid;
    v_item := jsonb_build_object(
      'no',      g.q + 1,
      'total',   jsonb_array_length(g.items),
      'key',     v_item -> 'key',
      'type',    v_item -> 'type',
      'slide',   v_item -> 'slide',
      'title',   v_item -> 'title',
      'options', v_item -> 'options',
      'html',    v_html,
      'solved',  (select coalesce(jsonb_object_agg(it ->> 'key', it -> 'answers' -> 0), '{}'::jsonb)
                  from jsonb_array_elements(g.items) with ordinality as e(it, n)
                  where e.n - 1 < g.q and it ->> 'page' = v_item ->> 'page'),
      'later',   (select coalesce(jsonb_agg(it -> 'key'), '[]'::jsonb)
                  from jsonb_array_elements(g.items) with ordinality as e(it, n)
                  where e.n - 1 > g.q and it ->> 'page' = v_item ->> 'page'),
      'answer',  case when v_phase = 'reveal' then g.items -> g.q -> 'answers' end,
      'mine',    v_mine,
      'dur',     public._qb_dur(g.items -> g.q)
    );
  end if;

  if g.status = 'done' then
    select jsonb_build_object('xp', e.xp, 'coins', e.coins) into v_gain
    from public.point_events e where e.qb_game_id = g.id and e.student_id = p_sid;
  end if;

  return jsonb_build_object(
    'id',        g.id,
    'status',    g.status,
    'phase',     v_phase,
    'version',   g.version,
    'total',     jsonb_array_length(g.items),
    'q',         g.q,
    'start_ms',  case when v_phase = 'ready' then ceil(extract(epoch from g.q_at - now()) * 1000)::int end,
    'left_ms',   case when v_phase = 'ask' then ceil(extract(epoch from g.q_end - now()) * 1000)::int end,
    'next_ms',   case when v_phase = 'reveal' then greatest(0, ceil(extract(epoch from g.q_end + v_reveal - now()) * 1000))::int end,
    'item',      v_item,
    'gain',      v_gain,
    'players',   (select coalesce(jsonb_agg(jsonb_build_object(
                    'me',       p.student_id = p_sid,
                    'nickname', s.nickname,
                    'avatar',   s.avatar,
                    'online',   p.seen_at > now() - interval '12 seconds',
                    'correct',  (select count(*) from public.qb_answers a where a.game_id = g.id and a.student_id = p.student_id and a.ok and a.q <= v_upto),
                    'answered', exists (select 1 from public.qb_answers a where a.game_id = g.id and a.q = g.q and a.student_id = p.student_id),
                    'ok',       case when v_phase = 'reveal' then
                                  (select a.ok from public.qb_answers a where a.game_id = g.id and a.q = g.q and a.student_id = p.student_id) end
                  ) order by s.number), '[]'::jsonb)
                  from public.qb_players p join public.students s on s.id = p.student_id
                  where p.game_id = g.id)
  );
end;
$$;
revoke all on function public._qb_view(uuid, uuid) from public, anon, authenticated;

-- 퀴즈 배틀 상태 (학생). 부를 때마다 '아직 있음'을 기록하고 밀린 진행을 처리한다.
-- 결과: {ok, open, board_id, lesson_code, group_no, count(나올 문제 수), xp, coins, members(그날 우리 모둠: 닉네임·캐릭터·me·joined·online), game}
--   또는 {ok: false, error: 'NO_SESSION'}. 오늘 보드가 없으면 open false, 그날 모둠에 없으면 group_no null
create or replace function public.qb_state(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sid  uuid;
  s      public.students;
  b      public.boards;
  v_my   smallint;
  g      public.qb_games;
  v_set  jsonb := public._qb_settings();
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid;
  select bb.* into b from public.classes c join public.boards bb on bb.id = c.today_board_id where c.id = s.class_id;
  if b.id is null then
    return jsonb_build_object('ok', true, 'open', false, 'board_id', null, 'group_no', null);
  end if;
  select group_no into v_my from public.board_groups where board_id = b.id and student_id = v_sid;
  if v_my is not null then
    select * into g from public.qb_games where board_id = b.id and group_no = v_my;
  end if;
  if g.id is not null then
    update public.qb_players set seen_at = now() where game_id = g.id and student_id = v_sid;
    perform public._qb_tick(g.id);
  end if;
  return jsonb_build_object(
    'ok',          true,
    'open',        b.quiz_open,
    'board_id',    b.id,
    'lesson_code', b.lesson_code,
    'group_no',    v_my,
    'count',       jsonb_array_length(public._qb_items(b.lesson_code)),
    'xp',          (v_set ->> 'xp')::int,
    'coins',       (v_set ->> 'coins')::int,
    'avatar',      s.avatar,
    'members',     case when v_my is null then '[]'::jsonb else (
                     select coalesce(jsonb_agg(jsonb_build_object(
                              'nickname', st.nickname,
                              'avatar',   st.avatar,
                              'me',       st.id = v_sid,
                              'joined',   p.student_id is not null,
                              'online',   coalesce(p.seen_at > now() - interval '12 seconds', false)
                            ) order by st.number), '[]'::jsonb)
                     from public.board_groups bg
                     join public.students st on st.id = bg.student_id
                     left join public.qb_players p on p.game_id = g.id and p.student_id = bg.student_id
                     where bg.board_id = b.id and bg.group_no = v_my) end,
    'game',        case when g.id is null then null else public._qb_view(g.id, v_sid) end
  );
end;
$$;
revoke all on function public.qb_state(text) from public;
grant execute on function public.qb_state(text) to anon, authenticated;

-- 들어가기 (학생): 우리 모둠 판에 들어간다(없으면 만든다). 하는 중인 판에도 들어갈 수 있다(앞 문제는 0점).
-- 결과: qb_state와 같음 또는 {ok: false, error: 'NO_SESSION' | 'CLOSED' | 'NO_GROUP' | 'NO_ITEMS'}
create or replace function public.qb_join(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sid uuid;
  b     public.boards;
  v_my  smallint;
  g     public.qb_games;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select bb.* into b from public.students s join public.classes c on c.id = s.class_id
  join public.boards bb on bb.id = c.today_board_id where s.id = v_sid;
  if b.id is null or not b.quiz_open then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;
  select group_no into v_my from public.board_groups where board_id = b.id and student_id = v_sid;
  if v_my is null then
    return jsonb_build_object('ok', false, 'error', 'NO_GROUP');
  end if;
  insert into public.qb_games (board_id, group_no) values (b.id, v_my) on conflict (board_id, group_no) do nothing;
  select * into g from public.qb_games where board_id = b.id and group_no = v_my for update;
  if g.status = 'lobby' and jsonb_array_length(public._qb_items(b.lesson_code)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'NO_ITEMS');
  end if;
  if g.status <> 'done' then
    insert into public.qb_players (game_id, student_id) values (g.id, v_sid)
    on conflict (game_id, student_id) do update set seen_at = now();
    update public.qb_games set version = version + 1 where id = g.id;
  end if;
  return public.qb_state(p_token);
end;
$$;
revoke all on function public.qb_join(text) from public;
grant execute on function public.qb_join(text) to anon, authenticated;

-- 나가기 (학생): 시작 전 대기실에서만. 아무도 없으면 판을 지운다
create or replace function public.qb_leave(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sid uuid;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  delete from public.qb_players p using public.qb_games g
  where p.game_id = g.id and g.status = 'lobby' and p.student_id = v_sid;
  delete from public.qb_games g
  where g.status = 'lobby' and not exists (select 1 from public.qb_players p where p.game_id = g.id);
  return public.qb_state(p_token);
end;
$$;
revoke all on function public.qb_leave(text) from public;
grant execute on function public.qb_leave(text) to anon, authenticated;

-- 시작 (학생): 대기실에 들어온 모둠원 누구나. 문항을 이때 정해 두고 3초 뒤 첫 문제
-- 결과: qb_state와 같음 또는 {ok: false, error: 'NO_SESSION' | 'CLOSED' | 'NOT_PLAYER' | 'NO_ITEMS'}
create or replace function public.qb_start(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sid   uuid;
  b       public.boards;
  g       public.qb_games;
  v_items jsonb;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select bb.* into b from public.students s join public.classes c on c.id = s.class_id
  join public.boards bb on bb.id = c.today_board_id where s.id = v_sid;
  if b.id is null or not b.quiz_open then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;
  select g2.* into g from public.qb_games g2 join public.qb_players p on p.game_id = g2.id
  where g2.board_id = b.id and p.student_id = v_sid for update of g2;
  if g.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_PLAYER');
  end if;
  if g.status = 'lobby' then
    v_items := public._qb_items(b.lesson_code);
    if jsonb_array_length(v_items) = 0 then
      return jsonb_build_object('ok', false, 'error', 'NO_ITEMS');
    end if;
    update public.qb_games
    set status = 'playing', items = v_items, q = 0, started_at = now(),
        q_at = now() + interval '3 seconds',
        q_end = now() + interval '3 seconds' + make_interval(secs => public._qb_dur(v_items -> 0)),
        version = version + 1
    where id = g.id;
  end if;
  return public.qb_state(p_token);
end;
$$;
revoke all on function public.qb_start(text) from public;
grant execute on function public.qb_start(text) to anon, authenticated;

-- 답 내기 (학생): 지금 문제(p_q)에 한 번만. 마감 전에만. 맞았는지는 정답 공개 때 보인다
-- 결과: qb_state와 같음 또는 {ok: false, error: 'NO_SESSION' | 'NOT_PLAYER' | 'OVER' | 'STALE' | 'ALREADY' | 'EMPTY'}
create or replace function public.qb_answer(p_token text, p_game_id uuid, p_q int, p_answer text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sid uuid;
  g     public.qb_games;
  v_ans text := left(btrim(coalesce(p_answer, '')), 100);
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  if not exists (select 1 from public.qb_players where game_id = p_game_id and student_id = v_sid) then
    return jsonb_build_object('ok', false, 'error', 'NOT_PLAYER');
  end if;
  update public.qb_players set seen_at = now() where game_id = p_game_id and student_id = v_sid;
  perform public._qb_tick(p_game_id);
  select * into g from public.qb_games where id = p_game_id for update;
  if g.status <> 'playing' then
    return jsonb_build_object('ok', false, 'error', 'OVER');
  end if;
  if p_q is distinct from g.q or now() < g.q_at or now() >= g.q_end then
    return jsonb_build_object('ok', false, 'error', 'STALE');
  end if;
  if v_ans = '' then
    return jsonb_build_object('ok', false, 'error', 'EMPTY');
  end if;
  insert into public.qb_answers (game_id, q, student_id, answer, ok)
  values (g.id, g.q, v_sid, v_ans, public._qb_ok(g.items -> g.q, v_ans))
  on conflict do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ALREADY');
  end if;
  update public.qb_games set version = version + 1 where id = g.id;
  perform public._qb_tick(g.id);
  return public.qb_state(p_token);
end;
$$;
revoke all on function public.qb_answer(text, uuid, int, text) from public;
grant execute on function public.qb_answer(text, uuid, int, text) to anon, authenticated;

-- 열기/닫기 (교사): 닫으면 하던 판은 지금 점수로 끝난다(1등 지급). 다시 열어도 끝난 모둠은 다시 못 한다
create or replace function public.set_quiz_open(p_board_id uuid, p_open boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  update public.boards set quiz_open = p_open where id = p_board_id;
  if not p_open then
    for v_id in select id from public.qb_games where board_id = p_board_id and status = 'playing' loop
      perform public._qb_end(v_id);
    end loop;
    delete from public.qb_games where board_id = p_board_id and status = 'lobby';
  end if;
  return jsonb_build_object('ok', true, 'open', p_open);
end;
$$;
revoke all on function public.set_quiz_open(uuid, boolean) from public, anon;
grant execute on function public.set_quiz_open(uuid, boolean) to authenticated;

-- ---------------------------------------------------------
-- 오목 1대1 (2026-10-16): 6개 반 전체에서 먼저 온 2명끼리(advisory lock). 보상 없음.
-- 오목 스위치(omok_open)가 켜진 반만. 하루 판 수는 settings.omok_pvp.daily(시작된 판), 한 수 turn초.
-- 시간을 넘기면 진다. 누가 om_*를 부르든 밀린 시간 초과를 _om_tick이 처리한다.
-- 승리 판정은 AI 대전과 같은 _omok_wins(자유룰: 다섯 개 이상)
-- ---------------------------------------------------------
create or replace function public._om_settings()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'daily', greatest(coalesce((v ->> 'daily')::int, 5), 1),
    'turn',  greatest(coalesce((v ->> 'turn')::int, 30), 10))
  from (select (select value from public.settings where key = 'omok_pvp') as v) x;
$$;
revoke all on function public._om_settings() from public, anon, authenticated;

-- 오늘(KST) 시작된 판 중 내가 들어간 판 수
create or replace function public._om_today(p_student_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from public.om_players p
  join public.om_games g on g.id = p.game_id
  where p.student_id = p_student_id
    and g.started_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;
revoke all on function public._om_today(uuid) from public, anon, authenticated;

create or replace function public._om_end(p_game_id uuid, p_winner int, p_reason text)
returns void
language sql
volatile
set search_path = public
as $$
  update public.om_games
  set status = 'done', ended_at = now(), winner = p_winner, end_reason = p_reason, version = version + 1
  where id = p_game_id and status = 'playing';
$$;
revoke all on function public._om_end(uuid, int, text) from public, anon, authenticated;

-- 차례 시간을 넘겼으면(2초 여유) 그 차례인 사람이 진다
create or replace function public._om_tick(p_game_id uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g public.om_games;
begin
  select * into g from public.om_games where id = p_game_id;
  if g.status = 'playing'
     and now() >= g.turn_at + make_interval(secs => (public._om_settings() ->> 'turn')::int) + interval '2 seconds' then
    perform public._om_end(p_game_id, 3 - g.turn, 'time');
  end if;
end;
$$;
revoke all on function public._om_tick(uuid) from public, anon, authenticated;

-- 판에서 나가기(내부). 대기 중이면 자리를 비우고, 하는 중이면 기권(상대가 이김)
create or replace function public._om_leave(p_game_id uuid, p_sid uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g  public.om_games;
  me public.om_players;
begin
  select * into g from public.om_games where id = p_game_id for update;
  select * into me from public.om_players where game_id = p_game_id and student_id = p_sid;
  if g.id is null or me.game_id is null or me.left_at is not null then
    return;
  end if;
  if g.status = 'waiting' then
    delete from public.om_games where id = p_game_id;
  elsif g.status = 'playing' then
    update public.om_players set left_at = now() where game_id = p_game_id and student_id = p_sid;
    perform public._om_end(p_game_id, 3 - me.color, 'left');
  end if;
end;
$$;
revoke all on function public._om_leave(uuid, uuid) from public, anon, authenticated;

-- 학생에게 보낼 판
create or replace function public._om_view(p_game_id uuid, p_sid uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  g    public.om_games;
  me   public.om_players;
  v_t  int := (public._om_settings() ->> 'turn')::int;
begin
  select * into g from public.om_games where id = p_game_id;
  select * into me from public.om_players where game_id = p_game_id and student_id = p_sid;
  if g.id is null or me.game_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id',       g.id,
    'status',   g.status,
    'version',  g.version,
    'me',       me.color,
    'turn',     g.turn,
    'turn_sec', v_t,
    'left_ms',  case when g.status = 'playing'
                  then greatest(0, floor(extract(epoch from (g.turn_at + make_interval(secs => v_t) - now())) * 1000))::bigint
                end,
    'board',    to_jsonb(g.board),
    'moves',    g.moves,
    'last',     g.last,
    'winner',   g.winner,
    'end_reason', g.end_reason,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'color',    p.color,
        'me',       p.student_id = p_sid,
        'class_id', s.class_id,
        'nickname', s.nickname,
        'avatar',   s.avatar,
        'left',     p.left_at is not null
      ) order by p.color), '[]'::jsonb)
      from public.om_players p join public.students s on s.id = p.student_id
      where p.game_id = g.id)
  );
end;
$$;
revoke all on function public._om_view(uuid, uuid) from public, anon, authenticated;

-- 1대1 화면 (학생). p_game_id를 주면 그 판(끝난 판 포함), 없으면 지금 하는 판(없으면 game: null).
-- 부를 때마다 '아직 있음'을 기록하고 밀린 시간 초과를 처리한다. 반이 꺼져 있으면 하던 판에서 나간다.
-- 결과: {ok: true, open, today, daily, turn, avatar, game} 또는 {ok: false, error: 'NO_SESSION'}
create or replace function public.om_state(p_token text, p_game_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid  uuid;
  s      public.students;
  v_open boolean;
  v_gid  uuid := p_game_id;
  v_set  jsonb := public._om_settings();
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid;
  v_open := coalesce((select omok_open from public.classes where id = s.class_id), false);

  if v_gid is null or not exists (select 1 from public.om_players where game_id = v_gid and student_id = v_sid) then
    select p.game_id into v_gid
    from public.om_players p join public.om_games g on g.id = p.game_id
    where p.student_id = v_sid and p.left_at is null and g.status in ('waiting', 'playing')
    order by p.joined_at desc
    limit 1;
  end if;

  if v_gid is not null then
    if not v_open then
      perform public._om_leave(v_gid, v_sid);
    else
      perform 1 from public.om_games where id = v_gid for update;
      update public.om_players set seen_at = now() where game_id = v_gid and student_id = v_sid;
      perform public._om_tick(v_gid);
    end if;
  end if;

  return jsonb_build_object(
    'ok',     true,
    'open',   v_open,
    'today',  public._om_today(v_sid),
    'daily',  (v_set ->> 'daily')::int,
    'turn',   (v_set ->> 'turn')::int,
    'avatar', s.avatar,
    'game',   case when v_gid is null then null else public._om_view(v_gid, v_sid) end
  );
end;
$$;
revoke all on function public.om_state(text, uuid) from public;
grant execute on function public.om_state(text, uuid) to anon, authenticated;

-- 상대 찾기 (학생): 6개 반 전체에서 먼저 온 2명끼리. 이미 하는 판이 있으면 그 판.
-- 15초 넘게 소식이 없는 대기자는 지운다. 2명이 되면 흑·백을 무작위로 정하고 시작(흑이 먼저, 3초 준비)
-- 결과: om_state와 같음 또는 error = 'NO_SESSION' | 'CLOSED' | 'LIMIT'
create or replace function public.om_join(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  s       public.students;
  v_set   jsonb := public._om_settings();
  v_today int;
  v_gid   uuid;
  v_color int;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid;
  if not coalesce((select omok_open from public.classes where id = s.class_id), false) then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;

  -- 짝 맞추기는 한 번에 한 명씩
  perform pg_advisory_xact_lock(hashtext('om_match'));

  if exists (select 1 from public.om_players p join public.om_games g on g.id = p.game_id
             where p.student_id = v_sid and p.left_at is null and g.status in ('waiting', 'playing')) then
    return public.om_state(p_token, null);
  end if;

  v_today := public._om_today(v_sid);
  if v_today >= (v_set ->> 'daily')::int then
    return jsonb_build_object('ok', false, 'error', 'LIMIT', 'today', v_today, 'daily', (v_set ->> 'daily')::int);
  end if;

  delete from public.om_games g
  where g.status = 'waiting'
    and not exists (select 1 from public.om_players p where p.game_id = g.id and p.seen_at >= now() - interval '15 seconds');

  select g.id into v_gid from public.om_games g
  where g.status = 'waiting'
  order by g.created_at
  limit 1
  for update;

  if v_gid is null then
    insert into public.om_games default values returning id into v_gid;
    insert into public.om_players (game_id, student_id, color) values (v_gid, v_sid, 1);
  else
    v_color := case when random() < 0.5 then 1 else 2 end;
    update public.om_players set color = 3 - v_color, seen_at = now() where game_id = v_gid;
    insert into public.om_players (game_id, student_id, color) values (v_gid, v_sid, v_color);
    update public.om_games
    set status = 'playing', started_at = now(), turn = 1, turn_at = now() + interval '3 seconds', version = version + 1
    where id = v_gid;
  end if;

  return public.om_state(p_token, v_gid);
end;
$$;
revoke all on function public.om_join(text) from public;
grant execute on function public.om_join(text) to anon, authenticated;

-- 나가기 (학생): 대기 중이면 취소, 하는 중이면 기권
create or replace function public.om_leave(p_token text, p_game_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid uuid;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  perform pg_advisory_xact_lock(hashtext('om_match'));
  perform public._om_leave(p_game_id, v_sid);
  return public.om_state(p_token, p_game_id);
end;
$$;
revoke all on function public.om_leave(text, uuid) from public;
grant execute on function public.om_leave(text, uuid) to anon, authenticated;

-- 한 수 두기 (학생, 내 차례): p_cell = r*15 + c (0~224)
-- 결과: om_state와 같음(ok: true) 또는 {ok: false, error: 'NO_SESSION' | 'BAD_GAME' | 'OVER' | 'NOT_TURN' | 'TAKEN', state}
create or replace function public.om_play(p_token text, p_game_id uuid, p_cell int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid uuid;
  g     public.om_games;
  me    public.om_players;
  v_err text;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into g from public.om_games where id = p_game_id for update;
  select * into me from public.om_players where game_id = p_game_id and student_id = v_sid;
  if g.id is null or me.game_id is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_GAME');
  end if;
  update public.om_players set seen_at = now() where game_id = p_game_id and student_id = v_sid;
  perform public._om_tick(p_game_id);
  select * into g from public.om_games where id = p_game_id;

  if g.status <> 'playing' or me.left_at is not null then
    v_err := 'OVER';
  elsif not coalesce((select c.omok_open from public.students s join public.classes c on c.id = s.class_id where s.id = v_sid), false) then
    v_err := 'OVER';
  elsif g.turn <> me.color then
    v_err := 'NOT_TURN';
  elsif p_cell is null or p_cell < 0 or p_cell > 224 or g.board[p_cell + 1] <> 0 then
    v_err := 'TAKEN';
  end if;
  if v_err is not null then
    return jsonb_build_object('ok', false, 'error', v_err, 'state', public.om_state(p_token, p_game_id));
  end if;

  g.board[p_cell + 1] := me.color;
  update public.om_games
  set board = g.board, moves = moves + 1, last = p_cell, turn = 3 - me.color, turn_at = now(), version = version + 1
  where id = p_game_id;
  if public._omok_wins(g.board, p_cell / 15, p_cell % 15, me.color) then
    perform public._om_end(p_game_id, me.color, 'five');
  elsif g.moves + 1 >= 225 then
    perform public._om_end(p_game_id, null, 'full');
  end if;

  return public.om_state(p_token, p_game_id);
end;
$$;
revoke all on function public.om_play(text, uuid, int) from public;
grant execute on function public.om_play(text, uuid, int) to anon, authenticated;

-- ---------------------------------------------------------
-- 오목 AI 랭킹 (2026-10-16 사용자 요청): 이번 달(KST) AI 대전 기록으로 TOP 10 두 가지.
-- 이긴 판 수(서버가 기보를 확인한 승리 won_at만), 승률(이번 달 20판 이상). 동점은 같은 순위.
-- 6개 반 합산, 0번(선생님)·명단에서 뺀 학생 제외, 번호는 내보내지 않는다. 출입증을 주면 내 기록과 순위도
-- 결과: {month, min_games, wins: [{rank, me, class_id, nickname, avatar, wins, games}], rate: [{rank, …, rate}], me: null | {wins, games, rate, wins_rank, rate_rank}}
-- ---------------------------------------------------------
-- 이번 달 학생별 기록과 두 순위(내부용)
create or replace function public._omok_month_stats()
returns table (sid uuid, class_id int, number int, nickname text, avatar jsonb, games int, wins int, wr int, rr int)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select g.student_id as sid, count(*)::int as games, count(g.won_at)::int as wins
    from public.omok_games g
    join public.students s on s.id = g.student_id and s.active and s.number > 0
    where g.started_at >= public._month_start()
    group by g.student_id
  )
  select t.sid, s.class_id::int, s.number::int, s.nickname, s.avatar, t.games, t.wins,
         case when t.wins > 0 then (rank() over (order by t.wins desc))::int end,
         case when t.games >= 20 then (rank() over (order by (t.games >= 20) desc, t.wins::numeric / t.games desc))::int end
  from t join public.students s on s.id = t.sid;
$$;
revoke all on function public._omok_month_stats() from public, anon, authenticated;

create or replace function public.get_omok_rank(p_token text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_sid  uuid := case when p_token is null then null else public._session_student(p_token) end;
  v_wins jsonb;
  v_rate jsonb;
  v_me   jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', o.wr, 'me', coalesce(o.sid = v_sid, false), 'class_id', o.class_id, 'nickname', o.nickname, 'avatar', o.avatar, 'wins', o.wins, 'games', o.games)
         order by o.wr, o.wins::numeric / o.games desc, o.class_id, o.number), '[]'::jsonb)
  into v_wins from public._omok_month_stats() o where o.wr <= 10;

  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', o.rr, 'me', coalesce(o.sid = v_sid, false), 'class_id', o.class_id, 'nickname', o.nickname, 'avatar', o.avatar, 'wins', o.wins, 'games', o.games,
           'rate', round(o.wins * 100.0 / o.games)::int)
         order by o.rr, o.games desc, o.class_id, o.number), '[]'::jsonb)
  into v_rate from public._omok_month_stats() o where o.rr <= 10;

  if v_sid is not null then
    select jsonb_build_object('wins', coalesce(o.wins, 0), 'games', coalesce(o.games, 0),
             'rate', case when o.games > 0 then round(o.wins * 100.0 / o.games)::int end,
             'wins_rank', o.wr, 'rate_rank', o.rr)
    into v_me
    from (select 1) one left join public._omok_month_stats() o on o.sid = v_sid;
  end if;

  return jsonb_build_object('month', public._month_key(), 'min_games', 20, 'wins', v_wins, 'rate', v_rate, 'me', v_me);
end;
$$;
revoke all on function public.get_omok_rank(text) from public;
grant execute on function public.get_omok_rank(text) to anon, authenticated;
