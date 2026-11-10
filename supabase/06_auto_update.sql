-- =========================================================
-- 06_auto_update.sql — 복사한 사이트(다른 선생님) 서버의 자동 업데이트
-- 매일 새벽 2시(한국 시간) a11y526/science-portal의 01~04·06·07을 받아 두고, 2시 5분에 지난번과 다르면 다시 실행한다.
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
  select array['01_schema.sql', '02_policies.sql', '03_functions.sql', '04_seed.sql', '06_auto_update.sql', '07_lessons.sql'];
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

-- 2단계: 받은 네 파일이 지난번과 다르면 차례로 실행한다. 결과: 'same' | 'applied' | 'off' | 오류 글
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

  sum := md5(array_to_string(parts, E'\n'));
  if sum = cfg ->> 'md5' then
    update public.settings set value = value || jsonb_build_object('checked_at', now(), 'error', null) where key = 'auto_update';
    return 'same';
  end if;

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
    then coalesce((select (value - 'source') #- '{share,key}' from public.settings where key = 'auto_update'), '{}'::jsonb)
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
-- 원래 사이트의 차시·수업자료 주소·보드·웹 학습지 받기 (2026-11-10)
-- 원래 서버의 share_pull은 원래 선생님이 [승인]한 서버에만 답한다(학습지 정답이 공개 저장소에 들어가지 않게).
-- 10분마다 _share_tick: 받은 응답이 있으면 넣고, 승인 전이면 신청·받기를 다시 보내고, 승인된 뒤에는 하루 한 번(한국 시간 2:10 넘어서) 받는다.
-- 넣는 규칙: 차시는 없는 것만 새로(제목·순서·단원·차시 수), 이미 있는 차시는 빈 수업자료 주소·단원만 채움.
--   보드는 수업자료 주소가 있는 차시 중 그 반에 보드가 하나도 없을 때만. 오늘 보드는 바꾸지 않는다.
--   학습지는 원래 사이트에서 바뀐 것만(받은 updated_at을 share.applied에 적음). 칸 번호가 빠지거나 종류가 바뀌면,
--   또는 이미 쓰는 학생이 있는데 정답이 바뀌면 넣지 않고 share.held에 적는다(이 서버 학습지는 그대로).
-- 설정: settings.auto_update.share = {key, status, sent_at, pulled_at, applied:{차시: updated_at}, held:{차시: 까닭}, error}
-- =========================================================

-- 원래 서버 주소·공개 키. 설치·자동 업데이트가 원래 주소를 이 서버 주소로 바꿔 쓰므로 주소를 나눠 적는다
create or replace function public._share_source()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('url', 'https://' || 'sxejmhkevefwnpwldczt' || '.supabase.co',
                            'anon', 'sb_publishable_gdlN0VcGUXOPkXLSqfJn0Q_VYES-EwK');
$$;

create or replace function public._share_apply(d jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  sh      jsonb := coalesce((select value -> 'share' from public.settings where key = 'auto_update'), '{}'::jsonb);
  applied jsonb := coalesce(sh -> 'applied', '{}'::jsonb);
  held    jsonb := '{}'::jsonb;
  w       jsonb;
  old     public.worksheets;
  bad     text;
  started int;
  n_ws    int := 0;
  has_old boolean;
begin
  -- 차시
  insert into public.lessons (code, title, lesson_src, sort, unit, periods)
  select x ->> 'code', coalesce(x ->> 'title', ''),
         case when coalesce(x ->> 'file', '') ~ '^[A-Za-z0-9_-]+\.html$' then '../lessons/' || (x ->> 'file') end,
         coalesce((x ->> 'sort')::int, 0), nullif(x ->> 'unit', ''), coalesce((x ->> 'periods')::int, 1)
  from jsonb_array_elements(coalesce(d -> 'lessons', '[]'::jsonb)) x
  where coalesce(x ->> 'code', '') ~ '^[0-9]{3}[A-Za-z0-9]*$'
  on conflict (code) do update
    set lesson_src = coalesce(public.lessons.lesson_src, excluded.lesson_src),
        unit       = coalesce(nullif(public.lessons.unit, ''), excluded.unit);

  -- 보드(받은 차시 중 수업자료가 있는 것, 그 반에 그 차시 보드가 하나도 없을 때만)
  insert into public.boards (class_id, lesson_code, title)
  select c.id, l.code, l.code
  from public.classes c
  join public.lessons l on l.lesson_src is not null
   and l.code in (select x ->> 'code' from jsonb_array_elements(coalesce(d -> 'lessons', '[]'::jsonb)) x where coalesce(x ->> 'file', '') <> '')
  where not exists (select 1 from public.boards b where b.class_id = c.id and b.lesson_code = l.code);

  -- 학습지
  for w in select * from jsonb_array_elements(coalesce(d -> 'worksheets', '[]'::jsonb)) loop
    continue when coalesce(w ->> 'lesson_code', '') !~ '^[0-9]{3}[A-Za-z0-9]*$';
    continue when applied ->> (w ->> 'lesson_code') is not distinct from (w ->> 'updated_at');
    continue when not exists (select 1 from public.lessons where code = w ->> 'lesson_code');
    select * into old from public.worksheets where lesson_code = w ->> 'lesson_code';
    has_old := found;
    bad := null;
    if has_old and not (old.key = (w -> 'key') and old.pages = (w -> 'pages')) then
      select string_agg(k, ', ') into bad from (
        select k from jsonb_object_keys(old.key) k
        where not ((w -> 'key') ? k) or (old.key -> k ->> 'type') is distinct from (w -> 'key' -> k ->> 'type')
        order by k limit 6) t;
      if bad is not null then
        bad := '칸 번호가 어긋나요(' || bad || ')';
      else
        select count(*) into started from public.worksheet_answers a join public.boards b on b.id = a.board_id
        where b.lesson_code = old.lesson_code;
        if started > 0 then
          select string_agg(k, ', ') into bad from (
            select k from jsonb_object_keys(old.key) k
            where (old.key -> k -> 'answers') is distinct from (w -> 'key' -> k -> 'answers')
            order by k limit 6) t;
          if bad is not null then bad := '이미 ' || started || '명이 쓰는 중인데 정답이 바뀌어요(' || bad || ')'; end if;
        end if;
      end if;
    end if;
    if bad is not null then
      held := held || jsonb_build_object(w ->> 'lesson_code', bad);
      continue;
    end if;
    if not has_old or not (old.key = (w -> 'key') and old.pages = (w -> 'pages')) then
      insert into public.worksheets (lesson_code, title, pages, key, page_count, field_count, updated_at)
      values (w ->> 'lesson_code', coalesce(w ->> 'title', ''), w -> 'pages', w -> 'key',
              coalesce((w ->> 'page_count')::int, 0), coalesce((w ->> 'field_count')::int, 0), now())
      on conflict (lesson_code) do update
        set title = excluded.title, pages = excluded.pages, key = excluded.key,
            page_count = excluded.page_count, field_count = excluded.field_count, updated_at = now();
      n_ws := n_ws + 1;
    end if;
    applied := applied || jsonb_build_object(w ->> 'lesson_code', w ->> 'updated_at');
  end loop;

  update public.settings
  set value = jsonb_set(value, '{share}', sh || jsonb_build_object('status', 'approved', 'pulled_at', now(),
                'applied', applied, 'held', held, 'error', null, 'last_ws', n_ws))
  where key = 'auto_update';
  return 'applied';
end;
$$;

create or replace function public._share_tick()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  cfg   jsonb;
  sh    jsonb;
  src   jsonb := public._share_source();
  rid   bigint;
  body  text;
  code  int;
  d     jsonb;
  hdr   jsonb;
  res   text := 'wait';
begin
  select value into cfg from public.settings where key = 'auto_update';
  if cfg is null or not coalesce((cfg ->> 'on')::boolean, false) or coalesce(cfg ->> 'url', '') !~ '^https://[a-z0-9]{20}\.supabase\.co$' then
    return 'off';
  end if;
  if cfg ->> 'url' = src ->> 'url' then
    return 'off';  -- 원래 서버
  end if;
  sh := coalesce(cfg -> 'share', '{}'::jsonb);
  if coalesce(sh ->> 'key', '') = '' then
    sh := sh || jsonb_build_object('key', encode(gen_random_bytes(32), 'hex'), 'status', 'new');
  end if;

  -- 1) 지난번에 보낸 받기 요청의 응답
  select request_id into rid from public.auto_update_fetch where file = 'share:pull';
  if rid is not null then
    select h.content, h.status_code into body, code from net._http_response h where h.id = rid;
    if code is not null or exists (select 1 from public.auto_update_fetch where file = 'share:pull' and asked_at < now() - interval '5 minutes') then
      delete from public.auto_update_fetch where file = 'share:pull';
      begin
        d := body::jsonb;
      exception when others then
        d := null;
      end;
      if code = 200 and d is not null and coalesce((d ->> 'ok')::boolean, false) then
        update public.settings set value = jsonb_set(value, '{share}', sh) where key = 'auto_update';
        begin
          res := public._share_apply(d);
        exception when others then
          res := left(sqlerrm, 300);
          update public.settings set value = jsonb_set(value, '{share}',
            (value -> 'share') || jsonb_build_object('error', res, 'checked_at', now())) where key = 'auto_update';
        end;
        sh := (select value -> 'share' from public.settings where key = 'auto_update');
      elsif d is not null and d ->> 'error' in ('PENDING', 'NOT_FOUND', 'REJECTED') then
        sh := sh || jsonb_build_object('status', lower(case d ->> 'error' when 'NOT_FOUND' then 'pending' else d ->> 'error' end),
                                       'error', null, 'checked_at', now());
      else
        sh := sh || jsonb_build_object('error', '받지 못함(' || coalesce(code::text, '응답 없음') || ')', 'checked_at', now());
      end if;
    end if;
  end if;

  -- 2) 새로 보낼지: 승인 전이면 10분마다, 승인·거절 뒤에는 하루 한 번(한국 시간 2:10 넘어서)
  if exists (select 1 from public.auto_update_fetch where file = 'share:pull') then
    update public.settings set value = jsonb_set(value, '{share}', sh) where key = 'auto_update';
    return res;
  end if;
  if sh ->> 'status' in ('approved', 'rejected') and coalesce((sh ->> 'sent_at')::timestamptz, 'epoch') > now() - interval '20 hours' then
    update public.settings set value = jsonb_set(value, '{share}', sh) where key = 'auto_update';
    return res;
  end if;
  if sh ->> 'status' in ('approved', 'rejected') and ((now() at time zone 'Asia/Seoul')::time < time '02:10' or (now() at time zone 'Asia/Seoul')::time > time '07:00') then
    update public.settings set value = jsonb_set(value, '{share}', sh) where key = 'auto_update';
    return res;
  end if;

  hdr := jsonb_build_object('Content-Type', 'application/json', 'apikey', src ->> 'anon');
  if sh ->> 'status' is distinct from 'approved' then
    perform net.http_post(src ->> 'url' || '/rest/v1/rpc/share_hello',
      jsonb_build_object('p_url', cfg ->> 'url', 'p_key', sh ->> 'key',
        'p_label', coalesce((select string_agg(x || '반', ' ') from jsonb_array_elements_text(cfg -> 'classes') x), '')),
      '{}'::jsonb, hdr, 30000);
  end if;
  rid := net.http_post(src ->> 'url' || '/rest/v1/rpc/share_pull',
    jsonb_build_object('p_url', cfg ->> 'url', 'p_key', sh ->> 'key'), '{}'::jsonb, hdr, 60000);
  insert into public.auto_update_fetch (file, request_id, asked_at) values ('share:pull', rid, now())
  on conflict (file) do update set request_id = excluded.request_id, asked_at = excluded.asked_at;
  sh := sh || jsonb_build_object('sent_at', now());
  update public.settings set value = jsonb_set(value, '{share}', sh) where key = 'auto_update';
  return res;
end;
$$;

revoke all on function public._share_source() from public, anon, authenticated;
revoke all on function public._share_apply(jsonb) from public, anon, authenticated;
revoke all on function public._share_tick() from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('portal-share', '*/10 * * * *', 'select public._share_tick()');
  end if;
end;
$$;
