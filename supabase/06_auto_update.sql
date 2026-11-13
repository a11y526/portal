-- =========================================================
-- 06_auto_update.sql — 복사한 사이트(다른 선생님) 서버의 자동 업데이트
-- 매일 새벽 2시(한국 시간) a11y526/science-portal의 01~04·06을 받아 두고, 2시 5분에 (바뀌지 않았어도) 다시 실행한다.
-- 01~04는 다시 실행해도 안전하다(관리 화면에서 바꾼 값은 그대로). 실행은 한 번에: 중간에 오류가 나면 모두 되돌리고 오류만 적는다.
-- 원래 사이트(a11y526/portal) 서버에서는 실행하지 않는다.
-- 설정 settings.auto_update = {on, source(받을 주소, 끝에 /), url(이 서버 주소), classes(담당 반), md5, applied_at, checked_at, error}
-- =========================================================

create extension if not exists pg_net;

-- 받아 둔 요청 번호 (파일마다 한 줄)
create table if not exists public.auto_update_fetch (
  file       text primary key,
  request_id bigint not null,
  asked_at   timestamptz not null default now()
);
alter table public.auto_update_fetch enable row level security;
revoke all on public.auto_update_fetch from anon, authenticated;

create or replace function public._auto_update_files()
returns text[]
language sql
immutable
as $$
  -- 07_lessons.sql(차시·수업자료 주소·보드)은 설치 때 한 번만 넣고 새벽마다 다시 넣지 않는다(2026-11-11 사용자 결정: 학습 자료는 자동으로 넣지 않음)
  select array['01_schema.sql', '02_policies.sql', '03_functions.sql', '04_seed.sql', '06_auto_update.sql'];
$$;

-- 1단계: 네 파일을 받아 달라고 요청만 한다(pg_net은 기다리지 않고 나중에 응답 표에 넣음)
create or replace function public._auto_update_fetch()
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  cfg jsonb;
  f   text;
begin
  select value into cfg from public.settings where key = 'auto_update';
  if cfg is null or not coalesce((cfg ->> 'on')::boolean, false) or coalesce(cfg ->> 'source', '') = '' then
    return;
  end if;
  foreach f in array public._auto_update_files() loop
    insert into public.auto_update_fetch (file, request_id, asked_at)
    values (f, net.http_get(cfg ->> 'source' || f || '?t=' || floor(extract(epoch from now()))::bigint, timeout_milliseconds := 60000), now())
    on conflict (file) do update set request_id = excluded.request_id, asked_at = excluded.asked_at;
  end loop;
end;
$$;

-- 2단계: 받은 파일을 매일 차례로 다시 실행한다. 결과: 'applied' | 'off' | 오류 글
create or replace function public._auto_update_apply()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  cfg    jsonb;
  files  text[] := public._auto_update_files();
  parts  text[] := '{}';
  body   text;
  code   int;
  sum    text;
  s      text;
  cls    text;
  i      int;
begin
  select value into cfg from public.settings where key = 'auto_update';
  if cfg is null or not coalesce((cfg ->> 'on')::boolean, false) then
    return 'off';
  end if;

  for i in 1 .. array_length(files, 1) loop
    body := null; code := null;
    select h.content, h.status_code into body, code
    from public.auto_update_fetch a
    left join net._http_response h on h.id = a.request_id
    where a.file = files[i];
    if code is distinct from 200 or body is null or length(body) < 100 then
      update public.settings set value = value || jsonb_build_object('checked_at', now(), 'error', '받지 못함: ' || files[i] || ' (' || coalesce(code::text, '응답 없음') || ')')
      where key = 'auto_update';
      return '받지 못함: ' || files[i];
    end if;
    parts := parts || body;
  end loop;

  -- 바뀌지 않았어도 매일 다시 실행한다(2026-11-12 사용자 결정: 이 서버에서 함수 등을 직접 고쳐도 다음 날 원래대로).
  -- 관리 화면에서 바꾼 값(명단·코드·설정·퀴즈·학습지)은 01~04가 건드리지 않는다
  sum := md5(array_to_string(parts, E'\n'));

  select string_agg(x, ', ' order by ord) into cls
  from jsonb_array_elements_text(cfg -> 'classes') with ordinality as t(x, ord)
  where x ~ '^[0-9]{1,2}$';
  if cls is null then
    update public.settings set value = value || jsonb_build_object('checked_at', now(), 'error', '담당 반이 없음') where key = 'auto_update';
    return '담당 반이 없음';
  end if;

  begin
    for i in 1 .. array_length(parts, 1) loop
      s := replace(parts[i], 'https://sxejmhkevefwnpwldczt.supabase.co', cfg ->> 'url');
      if files[i] = '04_seed.sql' then
        if (select count(*) from regexp_matches(s, 'unnest\(array\[[0-9, ]+\]\)', 'g')) <> 1 then
          raise exception '04_seed.sql에서 반 목록 줄을 찾지 못함';
        end if;
        s := regexp_replace(s, 'unnest\(array\[[0-9, ]+\]\)', 'unnest(array[' || cls || '])');
      end if;
      execute s;
    end loop;
  exception when others then
    -- 안의 실행은 모두 되돌려지고 오류만 남긴다
    update public.settings set value = value || jsonb_build_object('checked_at', now(), 'error', left(sqlerrm, 300))
    where key = 'auto_update';
    return left(sqlerrm, 300);
  end;

  update public.settings set value = value || jsonb_build_object('md5', sum, 'applied_at', now(), 'checked_at', now(), 'error', null)
  where key = 'auto_update';
  return 'applied';
end;
$$;

revoke all on function public._auto_update_files() from public, anon, authenticated;
revoke all on function public._auto_update_fetch() from public, anon, authenticated;
revoke all on function public._auto_update_apply() from public, anon, authenticated;

-- 교사(관리 화면에 로그인한 계정)가 업데이트 상태를 볼 수 있게
create or replace function public.auto_update_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_teacher()
    then coalesce((select value - 'source' from public.settings where key = 'auto_update'), '{}'::jsonb)
    else jsonb_build_object('ok', false, 'error', 'NOT_TEACHER') end;
$$;
revoke all on function public.auto_update_status() from public, anon;
grant execute on function public.auto_update_status() to authenticated;

-- 매일 17:00·17:05 UTC = 한국 시간 2:00·2:05. pg_cron이 없는 DB(점검용)에서는 건너뛴다
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('portal-update-fetch', '0 17 * * *', 'select public._auto_update_fetch()');
    perform cron.schedule('portal-update-apply', '5 17 * * *', 'select public._auto_update_apply()');
  end if;
end;
$$;

-- =========================================================
-- 원래 서버에서 차시·학습지·퀴즈 세트를 받던 기능(2026-11-10 ~ 11-11 멈춤) 지우기 (2026-11-13 사용자 결정)
-- 학습 자료는 공유 자료실(science-share)에서 가져간다. 이 서버에 남은 cron·함수·설정만 지운다.
-- 이미 받아 둔 차시·보드·학습지·퀴즈 세트는 그대로 둔다. 다시 실행해도 된다.
-- =========================================================
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'portal-share') then
      perform cron.unschedule('portal-share');
    end if;
  end if;
end;
$$;
drop function if exists public._share_tick();
drop function if exists public._share_apply(jsonb);
drop function if exists public._share_qs_img(jsonb, text);
drop function if exists public._share_source();
delete from public.auto_update_fetch where file = 'share:pull';
update public.settings set value = value - 'share' where key = 'auto_update' and value ? 'share';
