-- =========================================================
-- 02_policies.sql — RLS (행 수준 보안)
-- 학생(anon)은 테이블에 직접 접근할 수 없다. 학생 기능은 03의 함수로만.
-- 교사(teachers에 등록된 계정)만 모든 테이블을 읽고 쓴다.
-- =========================================================

-- 지금 로그인한 사람이 교사인지
create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.teachers where user_id = auth.uid());
$$;
revoke all on function public.is_teacher() from public, anon;
grant execute on function public.is_teacher() to authenticated;

alter table public.teachers enable row level security;
alter table public.classes  enable row level security;
alter table public.boards   enable row level security;
alter table public.settings enable row level security;

-- anon에는 테이블 권한 자체를 주지 않는다
revoke all on public.teachers, public.classes, public.boards, public.settings from anon;

-- teachers: 자기 행만 읽기 (등록은 SQL Editor에서만)
drop policy if exists teachers_self_read on public.teachers;
create policy teachers_self_read on public.teachers
  for select to authenticated
  using (user_id = auth.uid());

-- classes / boards / settings: 교사만 전부
drop policy if exists classes_teacher_all on public.classes;
create policy classes_teacher_all on public.classes
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists boards_teacher_all on public.boards;
create policy boards_teacher_all on public.boards
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists settings_teacher_all on public.settings;
create policy settings_teacher_all on public.settings
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
