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

-- ---------------------------------------------------------
-- 2단계: 명단, 제출, 포인트, 피드백 버튼, 코드 시도 기록
-- ---------------------------------------------------------
alter table public.students         enable row level security;
alter table public.submissions      enable row level security;
alter table public.point_events     enable row level security;
alter table public.feedback_presets enable row level security;
alter table public.code_attempts    enable row level security;

revoke all on public.students, public.submissions, public.point_events,
              public.feedback_presets, public.code_attempts from anon;

drop policy if exists students_teacher_all on public.students;
create policy students_teacher_all on public.students
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists submissions_teacher_all on public.submissions;
create policy submissions_teacher_all on public.submissions
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists point_events_teacher_all on public.point_events;
create policy point_events_teacher_all on public.point_events
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists feedback_presets_teacher_all on public.feedback_presets;
create policy feedback_presets_teacher_all on public.feedback_presets
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists code_attempts_teacher_all on public.code_attempts;
create policy code_attempts_teacher_all on public.code_attempts
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 모둠 편성 (보드마다)
alter table public.board_groups enable row level security;
revoke all on public.board_groups from anon;

drop policy if exists board_groups_teacher_all on public.board_groups;
create policy board_groups_teacher_all on public.board_groups
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- ---------------------------------------------------------
-- 3단계: 캐릭터 부품, 순위 스냅샷
-- ---------------------------------------------------------
alter table public.avatar_items   enable row level security;
alter table public.rank_snapshots enable row level security;
revoke all on public.avatar_items, public.rank_snapshots from anon;

drop policy if exists avatar_items_teacher_all on public.avatar_items;
create policy avatar_items_teacher_all on public.avatar_items
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists rank_snapshots_teacher_all on public.rank_snapshots;
create policy rank_snapshots_teacher_all on public.rank_snapshots
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 학생 출입증 (학생은 03의 함수로만)
alter table public.student_sessions enable row level security;
revoke all on public.student_sessions from anon;

drop policy if exists student_sessions_teacher_all on public.student_sessions;
create policy student_sessions_teacher_all on public.student_sessions
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- ---------------------------------------------------------
-- 4단계: 포인트 상점 (학생은 03의 함수로만)
-- ---------------------------------------------------------
alter table public.student_items enable row level security;
alter table public.shop_items    enable row level security;
alter table public.purchases     enable row level security;
revoke all on public.student_items, public.shop_items, public.purchases from anon;

drop policy if exists student_items_teacher_all on public.student_items;
create policy student_items_teacher_all on public.student_items
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists shop_items_teacher_all on public.shop_items;
create policy shop_items_teacher_all on public.shop_items
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists purchases_teacher_all on public.purchases;
create policy purchases_teacher_all on public.purchases
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- ---------------------------------------------------------
-- 5단계: 수업자료 (교사만. 학생 함수에도 내보내지 않는다)
-- ---------------------------------------------------------
alter table public.lessons enable row level security;
revoke all on public.lessons from anon;

drop policy if exists lessons_teacher_all on public.lessons;
create policy lessons_teacher_all on public.lessons
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- ---------------------------------------------------------
-- 8단계: 학습지 (교사만. 학생은 03의 함수로만, 정답(key)은 학생에게 내보내지 않는다)
-- ---------------------------------------------------------
alter table public.worksheets        enable row level security;
alter table public.worksheet_answers enable row level security;
revoke all on public.worksheets, public.worksheet_answers from anon;

drop policy if exists worksheets_teacher_all on public.worksheets;
create policy worksheets_teacher_all on public.worksheets
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists worksheet_answers_teacher_all on public.worksheet_answers;
create policy worksheet_answers_teacher_all on public.worksheet_answers
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 오목 판 (2026-10-15): 학생은 start_omok·submit_omok로만
alter table public.omok_games enable row level security;
revoke all on public.omok_games from anon;

drop policy if exists omok_games_teacher_all on public.omok_games;
create policy omok_games_teacher_all on public.omok_games
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 루미큐브 (2026-10-16): 학생은 rk_* 함수로만
alter table public.rk_games enable row level security;
alter table public.rk_players enable row level security;
revoke all on public.rk_games from anon;
revoke all on public.rk_players from anon;

drop policy if exists rk_games_teacher_all on public.rk_games;
create policy rk_games_teacher_all on public.rk_games
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists rk_players_teacher_all on public.rk_players;
create policy rk_players_teacher_all on public.rk_players
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 쪽별 첫 답 (2026-10-16): 학생은 submit_worksheet_page로만 들어간다
alter table public.ws_firsts enable row level security;
revoke all on public.ws_firsts from anon;

drop policy if exists ws_firsts_teacher_all on public.ws_firsts;
create policy ws_firsts_teacher_all on public.ws_firsts
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

alter table public.ws_page_open enable row level security;
revoke all on public.ws_page_open from anon;

drop policy if exists ws_page_open_teacher_all on public.ws_page_open;
create policy ws_page_open_teacher_all on public.ws_page_open
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 퀴즈 배틀 (2026-10-16): 학생은 qb_* 함수로만
alter table public.qb_games enable row level security;
alter table public.qb_players enable row level security;
alter table public.qb_answers enable row level security;
revoke all on public.qb_games from anon;
revoke all on public.qb_players from anon;
revoke all on public.qb_answers from anon;

drop policy if exists qb_games_teacher_all on public.qb_games;
create policy qb_games_teacher_all on public.qb_games
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists qb_players_teacher_all on public.qb_players;
create policy qb_players_teacher_all on public.qb_players
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists qb_answers_teacher_all on public.qb_answers;
create policy qb_answers_teacher_all on public.qb_answers
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 오목 1대1 (2026-10-16): 학생은 om_* 함수로만
alter table public.om_games enable row level security;
alter table public.om_players enable row level security;
revoke all on public.om_games from anon;
revoke all on public.om_players from anon;

drop policy if exists om_games_teacher_all on public.om_games;
create policy om_games_teacher_all on public.om_games
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists om_players_teacher_all on public.om_players;
create policy om_players_teacher_all on public.om_players
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
