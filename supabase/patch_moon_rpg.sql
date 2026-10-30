-- =========================================================
-- patch_moon_rpg.sql — 712 「다누리 탐사대장」 달 자원 RPG (2단계)
-- 테이블(moon_rpg_runs) + RLS 정책 + 설정(settings.moon_rpg) + RPC 3종
-- 주의: 이 파일은 선생님이 Supabase SQL Editor에서 직접 실행합니다.
-- =========================================================

-- 1. 판 기록 테이블
create table if not exists public.moon_rpg_runs (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  ending     text not null check (ending in ('peace', 'balance', 'monopoly', 'conflict')),
  stats      jsonb not null,     -- {"res":..,"trust":..,"peace":..}
  choices    jsonb not null,     -- [{"event":1,"pick":2}, ...]
  created_at timestamptz not null default now()
);
create index if not exists moon_rpg_runs_student_idx on public.moon_rpg_runs (student_id, created_at desc);

-- 2. RLS 정책 (교사만 직접 조회, 학생은 security definer 함수로만)
alter table public.moon_rpg_runs enable row level security;
revoke all on public.moon_rpg_runs from anon;

drop policy if exists moon_rpg_runs_teacher_all on public.moon_rpg_runs;
create policy moon_rpg_runs_teacher_all on public.moon_rpg_runs
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 3. 기본 설정 (처음 끝까지 했을 때 한 번 주는 은화, 이미 있으면 유지)
insert into public.settings (key, value) values ('moon_rpg', '{"silver": 5}'::jsonb)
on conflict (key) do nothing;

-- 4. 설정 읽기 (내부용)
create or replace function public._moon_rpg_settings()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'silver', greatest(coalesce((v ->> 'silver')::int, 5), 0))
  from (select (select value from public.settings where key = 'moon_rpg') as v) x;
$$;
revoke all on function public._moon_rpg_settings() from public, anon, authenticated;

-- 보상을 이미 받았는지: 지급 수가 회수 수보다 많으면 받은 것 (2026-10-30 712 밖에서 받은 은화를 회수함)
create or replace function public._moon_rpg_paid(p_sid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select count(*) filter (where reason = '달 자원 RPG 완료')
       > count(*) filter (where reason = '달 자원 RPG 은화 회수')
  from public.point_events
  where student_id = p_sid and reason in ('달 자원 RPG 완료', '달 자원 RPG 은화 회수');
$$;
revoke all on function public._moon_rpg_paid(uuid) from public, anon, authenticated;

-- 5. 학생 상태 조회: 닉네임, 설정된 보상 은화, 이미 받았는지 여부
create or replace function public.moon_rpg_state(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sid      uuid;
  s          public.students;
  v_silver   int := (public._moon_rpg_settings() ->> 'silver')::int;
  v_rewarded boolean;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid;
  v_rewarded := public._moon_rpg_paid(v_sid);
  return jsonb_build_object(
    'ok',       true,
    'nickname', coalesce(nullif(s.nickname, ''), '닉네임 미정'),
    'silver',   v_silver,
    'rewarded', v_rewarded
  );
end;
$$;
revoke all on function public.moon_rpg_state(text) from public;
grant execute on function public.moon_rpg_state(text) to anon, authenticated;

-- 6. 완료 기록 저장 + 첫 완료 시 은화 보상 지급 (XP = 0, coins = 0, 은화만)
create or replace function public.moon_rpg_finish(
  p_token   text,
  p_ending  text,
  p_stats   jsonb,
  p_choices jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sid      uuid;
  s          public.students;
  v_res      int;
  v_trust    int;
  v_peace    int;
  v_expect   text;
  v_silver   int := (public._moon_rpg_settings() ->> 'silver')::int;
  v_already  boolean;
  v_rewarded boolean := false;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;

  -- 두 번 동시에 눌러도 보상이 한 번만 나가도록 학생 행 잠금
  select * into s from public.students where id = v_sid for update;
  if s.id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;

  -- 712 수업 중(그 반 오늘 보드가 712)일 때만 기록·보상
  if not exists (
    select 1 from public.classes c join public.boards b on b.id = c.today_board_id
    where c.id = s.class_id and b.lesson_code = '712'
  ) then
    return jsonb_build_object('ok', false, 'error', 'NOT_712');
  end if;

  if p_stats is null or jsonb_typeof(p_stats) <> 'object'
     or p_choices is null or jsonb_typeof(p_choices) <> 'array'
     or jsonb_array_length(p_choices) < 1 or jsonb_array_length(p_choices) > 20 then
    return jsonb_build_object('ok', false, 'error', 'BAD_RUN');
  end if;

  begin
    v_res   := (p_stats ->> 'res')::int;
    v_trust := (p_stats ->> 'trust')::int;
    v_peace := (p_stats ->> 'peace')::int;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'BAD_RUN');
  end;

  if v_res is null or v_trust is null or v_peace is null
     or v_res < 0 or v_res > 100
     or v_trust < 0 or v_trust > 100
     or v_peace < 0 or v_peace > 100 then
    return jsonb_build_object('ok', false, 'error', 'BAD_RUN');
  end if;

  -- 평화의 달은 마지막 회의(7번)에서 국제법·국제기구(②)를 고른 경우에만 (rpg-moon-data.js ENDINGS와 같게)
  v_expect := case
    when v_peace >= 70 and v_trust >= 60
         and exists (
           select 1 from jsonb_array_elements(p_choices) c
           where c ->> 'event' = '7' and c ->> 'pick' = '2'
         ) then 'peace'
    when v_peace >= 50 then 'balance'
    when v_res >= 70 and v_peace < 50 then 'monopoly'
    else 'conflict'
  end;

  if p_ending is distinct from v_expect then
    return jsonb_build_object('ok', false, 'error', 'BAD_RUN');
  end if;

  insert into public.moon_rpg_runs (student_id, ending, stats, choices)
  values (
    v_sid,
    p_ending,
    jsonb_build_object('res', v_res, 'trust', v_trust, 'peace', v_peace),
    p_choices
  );

  v_already := public._moon_rpg_paid(v_sid);

  if not v_already and v_silver > 0 then
    insert into public.point_events (student_id, xp, coins, silver, reason)
    values (v_sid, 0, 0, v_silver, '달 자원 RPG 완료');
    v_rewarded := true;
  end if;

  return jsonb_build_object(
    'ok',       true,
    'rewarded', v_rewarded,
    'silver',   case when v_rewarded then v_silver else 0 end
  );
end;
$$;
revoke all on function public.moon_rpg_finish(text, text, jsonb, jsonb) from public;
grant execute on function public.moon_rpg_finish(text, text, jsonb, jsonb) to anon, authenticated;

-- 7. 교사 통계 조회: 반별 엔딩 분포 + 이벤트별 선택 비율 (0번 선생님 계정 제외, 학생별 최근 완료 판 기준)
create or replace function public.get_moon_rpg_class(p_class_id int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_runs     int;
  v_students int;
  v_endings  jsonb;
  v_events   jsonb;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;

  select count(*)::int, count(distinct r.student_id)::int
  into v_runs, v_students
  from public.moon_rpg_runs r
  join public.students s on s.id = r.student_id
  where s.number > 0
    and (p_class_id is null or p_class_id = 0 or s.class_id = p_class_id);

  with latest as (
    select distinct on (r.student_id) r.ending, r.choices
    from public.moon_rpg_runs r
    join public.students s on s.id = r.student_id
    where s.number > 0
      and (p_class_id is null or p_class_id = 0 or s.class_id = p_class_id)
    order by r.student_id, r.created_at desc, r.id desc
  )
  select jsonb_build_object(
    'peace',    count(*) filter (where ending = 'peace'),
    'balance',  count(*) filter (where ending = 'balance'),
    'monopoly', count(*) filter (where ending = 'monopoly'),
    'conflict', count(*) filter (where ending = 'conflict')
  ) into v_endings
  from latest;

  with latest as (
    select distinct on (r.student_id) r.choices
    from public.moon_rpg_runs r
    join public.students s on s.id = r.student_id
    where s.number > 0
      and (p_class_id is null or p_class_id = 0 or s.class_id = p_class_id)
    order by r.student_id, r.created_at desc, r.id desc
  ),
  picked as (
    select
      (c ->> 'event')::int as ev,
      (c ->> 'pick')::int  as pk
    from latest,
    lateral jsonb_array_elements(latest.choices) as c
    where (c ->> 'event') ~ '^[1-7]$' and (c ->> 'pick') ~ '^[1-3]$'
  )
  select jsonb_agg(
    jsonb_build_object(
      'event', e.ev,
      'total', coalesce(t.cnt, 0),
      'picks', jsonb_build_array(coalesce(t.p1, 0), coalesce(t.p2, 0), coalesce(t.p3, 0))
    ) order by e.ev
  ) into v_events
  from generate_series(1, 7) as e(ev)
  left join (
    select ev,
      count(*)::int as cnt,
      count(*) filter (where pk = 1)::int as p1,
      count(*) filter (where pk = 2)::int as p2,
      count(*) filter (where pk = 3)::int as p3
    from picked
    group by ev
  ) t on t.ev = e.ev;

  return jsonb_build_object(
    'runs',     coalesce(v_runs, 0),
    'students', coalesce(v_students, 0),
    'endings',  coalesce(v_endings, '{"peace":0,"balance":0,"monopoly":0,"conflict":0}'::jsonb),
    'events',   coalesce(v_events, '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_moon_rpg_class(int) from public, anon;
grant execute on function public.get_moon_rpg_class(int) to authenticated;
