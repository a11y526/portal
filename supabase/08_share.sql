-- =========================================================
-- 08_share.sql — 원래 사이트(a11y526/portal) 서버에서만 실행한다. 복사한 사이트에는 들어가지 않는다(build-nogame DROP).
-- 다른 선생님 서버가 매일 새벽 이 서버에서 차시 목록·웹 학습지(정답 포함)를 받아 간다(그쪽은 06_auto_update.sql).
-- 정답이 공개 저장소에 들어가지 않게, 선생님이 관리 '다른 선생님 서버'에서 [승인]한 서버만 받는다.
--   ① 그쪽 서버가 무작위 열쇠(64자)를 만들어 share_hello(자기 주소, 열쇠)로 신청 → 여기는 열쇠의 sha256만 적음
--   ② 선생님이 승인 → ③ 그쪽 서버가 share_pull(주소, 열쇠)로 받아 감. 열쇠는 그쪽 서버의 settings에만 있다
-- 다시 실행해도 된다.
-- =========================================================

create table if not exists public.share_peers (
  id           uuid primary key default gen_random_uuid(),
  url          text not null unique,          -- 그쪽 Supabase 주소 https://<ref>.supabase.co
  key_hash     text not null,                 -- 열쇠 sha256(hex)
  label        text not null default '',      -- 그쪽 담당 반 등(신청 때 받은 짧은 글)
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  pulled_at    timestamptz
);
alter table public.share_peers enable row level security;
revoke all on public.share_peers from anon, authenticated;
drop policy if exists share_peers_teacher on public.share_peers;
create policy share_peers_teacher on public.share_peers for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 신청. 같은 주소가 다시 신청하면(열쇠를 새로 만든 경우) 열쇠를 바꾸고 다시 승인 대기로. 거절된 주소는 그대로 거절
create or replace function public.share_hello(p_url text, p_key text, p_label text default '')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  h   text;
  row public.share_peers;
begin
  if p_url is null or p_url !~ '^https://[a-z0-9]{20}\.supabase\.co$' or p_key is null or length(p_key) < 48 or length(p_key) > 200 then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  if p_url = 'https://sxejmhkevefwnpwldczt.supabase.co' then
    return jsonb_build_object('ok', false, 'error', 'BAD_REQUEST');
  end if;
  h := encode(digest(p_key, 'sha256'), 'hex');
  select * into row from public.share_peers where url = p_url;
  if found then
    if row.key_hash <> h and row.status <> 'rejected' then
      update public.share_peers set key_hash = h, status = 'pending', label = left(coalesce(p_label, ''), 60),
        requested_at = now(), decided_at = null where id = row.id;
      return jsonb_build_object('ok', true, 'status', 'pending');
    end if;
    return jsonb_build_object('ok', true, 'status', row.status);
  end if;
  if (select count(*) from public.share_peers where status = 'pending') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'FULL');
  end if;
  insert into public.share_peers (url, key_hash, label) values (p_url, h, left(coalesce(p_label, ''), 60));
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- 받아 가기: 승인된 서버만. 차시(이 사이트 lessons/에 수업자료가 있는 차시는 파일 이름도)와 학습지
create or replace function public.share_pull(p_url text, p_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  row public.share_peers;
begin
  select * into row from public.share_peers
  where url = p_url and key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if row.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', upper(row.status));
  end if;
  update public.share_peers set pulled_at = now() where id = row.id;
  return jsonb_build_object(
    'ok', true,
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', l.code, 'title', l.title, 'sort', l.sort, 'unit', l.unit, 'periods', l.periods,
        'file', substring(l.lesson_src from '/lessons/([A-Za-z0-9_-]+\.html)$')) order by l.sort, l.code)
      from public.lessons l), '[]'::jsonb),
    'worksheets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lesson_code', w.lesson_code, 'title', w.title, 'pages', w.pages, 'key', w.key,
        'page_count', w.page_count, 'field_count', w.field_count, 'updated_at', w.updated_at) order by w.lesson_code)
      from public.worksheets w), '[]'::jsonb)
  );
end;
$$;

-- 관리 화면: 목록과 승인·거절·지우기
create or replace function public.get_share_peers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_teacher() then jsonb_build_object('ok', true, 'peers', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'url', url, 'label', label, 'status', status,
      'requested_at', requested_at, 'decided_at', decided_at, 'pulled_at', pulled_at) order by requested_at desc)
    from public.share_peers), '[]'::jsonb))
  else jsonb_build_object('ok', false, 'error', 'NOT_TEACHER') end;
$$;

create or replace function public.decide_share_peer(p_id uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then
    return jsonb_build_object('ok', false, 'error', 'NOT_TEACHER');
  end if;
  if p_status = 'delete' then
    delete from public.share_peers where id = p_id;
  elsif p_status in ('approved', 'rejected', 'pending') then
    update public.share_peers set status = p_status, decided_at = now() where id = p_id;
  else
    return jsonb_build_object('ok', false, 'error', 'BAD_STATUS');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.share_hello(text, text, text) from public;
revoke all on function public.share_pull(text, text) from public;
revoke all on function public.get_share_peers() from public, anon;
revoke all on function public.decide_share_peer(uuid, text) from public, anon;
grant execute on function public.share_hello(text, text, text) to anon, authenticated;
grant execute on function public.share_pull(text, text) to anon, authenticated;
grant execute on function public.get_share_peers() to authenticated;
grant execute on function public.decide_share_peer(uuid, text) to authenticated;
