-- =========================================================
-- 01_schema.sql — 테이블
-- Supabase SQL Editor에 붙여넣고 Run. 여러 번 실행해도 안전하다.
-- =========================================================

create extension if not exists pgcrypto;

-- 교사 계정 등록 (RLS 정책의 기준)
create table if not exists public.teachers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 반 (7~12반)
create table if not exists public.classes (
  id             smallint primary key check (id between 1 and 20),
  label          text not null,
  today_board_id uuid null
);

-- 보드: 차시 × 반마다 1개
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  class_id    smallint not null references public.classes(id) on delete cascade,
  lesson_code text not null,
  title       text not null default '',
  padlet_src  text null,
  sim_links   jsonb not null default '[]'::jsonb,
  status      text not null default 'open' check (status in ('open', 'closed', 'revealed')),
  created_at  timestamptz not null default now()
);
create index if not exists boards_class_created_idx on public.boards (class_id, created_at desc);

-- 오늘 보드 → boards (보드를 지우면 오늘 보드는 비워짐)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'classes_today_board_fk') then
    alter table public.classes
      add constraint classes_today_board_fk
      foreign key (today_board_id) references public.boards(id) on delete set null;
  end if;
end $$;

-- 설정값 (포인트 규칙, 레벨 기준 등)
create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);

-- ---------------------------------------------------------
-- 2단계: 명단, 제출·검사, 포인트
-- ---------------------------------------------------------

-- 발표 결과(순위, 모둠별 지급 포인트)를 보드에 남겨 둔다
alter table public.boards add column if not exists result jsonb null;

-- 학생 명단 (이름 없음: 반·번호·코드 해시만. 모둠은 수업마다 board_groups에)
create table if not exists public.students (
  id              uuid primary key default gen_random_uuid(),
  class_id        smallint not null references public.classes(id) on delete cascade,
  number          smallint not null check (number between 1 and 99),
  code_hash       text null,
  has_code        boolean generated always as (code_hash is not null) stored,
  nickname        text null,
  nickname_status text not null default 'none' check (nickname_status in ('none', 'pending', 'approved', 'rejected')),
  avatar          jsonb not null default '{}'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (class_id, number)
);
-- 0번은 반마다 하나 있는 선생님 체험 계정(학생 화면 그대로 들어가 보기). 만들기·코드는 04_seed.sql 끝.
-- 순위·학습지 완료 수·명단·코드 발급·모둠 선택권 친구에서 빠진다
alter table public.students drop constraint if exists students_number_check;
alter table public.students add constraint students_number_check check (number between 0 and 99);
-- 모둠을 명단에 고정하던 열은 쓰지 않는다 (예전에 만들어졌으면 지움)
alter table public.students drop column if exists group_no;

-- 그날(보드)의 모둠 편성. 결석으로 뺀 학생은 행이 없다
create table if not exists public.board_groups (
  board_id   uuid not null references public.boards(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  group_no   smallint not null check (group_no between 1 and 20),
  primary key (board_id, student_id)
);
create index if not exists board_groups_board_group_idx on public.board_groups (board_id, group_no);

-- 모둠 제출
create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards(id) on delete cascade,
  group_no     smallint not null,
  student_id   uuid null references public.students(id) on delete set null,
  submitted_at timestamptz not null default now(),
  status       text not null default 'pending' check (status in ('pending', 'returned', 'passed')),
  feedback     text null,
  reviewed_at  timestamptz null
);
create index if not exists submissions_board_time_idx on public.submissions (board_id, submitted_at);
-- 한 모둠에 검사 대기는 1개, 통과도 1개만
create unique index if not exists submissions_one_pending_idx on public.submissions (board_id, group_no) where status = 'pending';
create unique index if not exists submissions_one_passed_idx  on public.submissions (board_id, group_no) where status = 'passed';

-- XP·코인 원장 (수정하지 않고 정정 이벤트를 추가)
create table if not exists public.point_events (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  xp         int not null default 0,
  coins      int not null default 0,
  reason     text not null,
  board_id   uuid null references public.boards(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists point_events_student_idx on public.point_events (student_id, created_at);
-- 한 보드에서 한 학생은 한 번만 받는다 (발표를 두 번 눌러도 중복 지급 없음)
create unique index if not exists point_events_board_once_idx on public.point_events (student_id, board_id) where board_id is not null;

-- 검사 화면의 빠른 피드백 버튼
create table if not exists public.feedback_presets (
  id   bigint generated by default as identity primary key,
  text text not null,
  sort int not null default 0
);

-- 코드 틀린 횟수 제한용
create table if not exists public.code_attempts (
  id           bigint generated always as identity primary key,
  student_key  text not null,
  attempted_at timestamptz not null default now(),
  ok           boolean not null
);
create index if not exists code_attempts_key_time_idx on public.code_attempts (student_key, attempted_at desc);

-- 검사 화면이 제출 변경을 실시간으로 받도록
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'submissions'
     ) then
    alter publication supabase_realtime add table public.submissions;
  end if;
end $$;

-- ---------------------------------------------------------
-- 3단계: 캐릭터, 닉네임, 순위 변화
-- ---------------------------------------------------------

-- 닉네임: nickname = 승인된 닉네임(공개 화면에 쓰는 것), nickname_request = 신청 중이거나 거절된 닉네임
-- 바꾸려고 신청해도 승인될 때까지는 원래 닉네임이 그대로 보인다
alter table public.students add column if not exists nickname_request text null;

-- 캐릭터 부품: 그림은 assets/js/avatar-parts.js에 있고, 이 표는 가격·판매 여부만 관리
create table if not exists public.avatar_items (
  id        text primary key,
  slot      text not null check (slot in ('face', 'hair', 'eyes', 'mouth', 'outfit', 'acc', 'bg')),
  name      text not null,
  price     int  not null default 0 check (price >= 0),
  rarity    text not null default 'common' check (rarity in ('common', 'rare', 'legend')),
  min_level int  not null default 1,
  active    boolean not null default true,
  sort      int  not null default 0
);

-- 순위 변화(▲▼)용: 마지막 발표 바로 전의 이번 달 순위. 발표할 때마다 새로 찍고, 그 발표를 취소하면 지운다
create table if not exists public.rank_snapshots (
  student_id uuid primary key references public.students(id) on delete cascade,
  rank       int  not null,
  month      text not null,  -- 'YYYY-MM' (한국 시간)
  board_id   uuid null references public.boards(id) on delete set null
);

-- ---------------------------------------------------------
-- 학생 로그인: 반별 잠금, 출입증
-- ---------------------------------------------------------

-- 잠근 반은 로그인할 수 없고, 잠글 때 그 반의 출입증을 모두 지운다
alter table public.classes add column if not exists locked boolean not null default false;

-- 로그인하면 기기마다 출입증(무작위 64자)을 발급한다. 저장은 sha256 해시만. 로그아웃하면 지운다
create table if not exists public.student_sessions (
  token_hash text primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists student_sessions_student_idx on public.student_sessions (student_id);

-- ---------------------------------------------------------
-- 4단계: 포인트 상점
-- ---------------------------------------------------------

-- 산 꾸미기 아이템 (사는 순간 point_events에 coins = -가격이 남는다)
create table if not exists public.student_items (
  student_id  uuid not null references public.students(id) on delete cascade,
  item_id     text not null references public.avatar_items(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  primary key (student_id, item_id)
);

-- 보상 품목 (교사 승인 필요). kind = 'pair'는 모둠 선택권(같이 할 친구 1명을 고름)
create table if not exists public.shop_items (
  id     text primary key,
  name   text not null,
  cost   int  not null default 0 check (cost >= 0),
  kind   text not null default 'plain' check (kind in ('plain', 'pair')),
  active boolean not null default true,
  sort   int  not null default 0
);

-- 보상 신청. 신청할 때의 가격을 복사해 둔다. 'requested'·'approved'면 코인에서 빠지고, 거절되면 돌아온다
-- partner_number: 모둠 선택권으로 고른 같은 반 친구 번호
-- used_board_id: 모둠 선택권을 쓴 보드(그 보드 편성에서 두 학생이 같은 모둠으로 저장됨). null이면 아직 안 씀
create table if not exists public.purchases (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.students(id) on delete cascade,
  item_id        text not null references public.shop_items(id) on delete cascade,
  cost           int  not null check (cost >= 0),
  status         text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  partner_number smallint null,
  used_board_id  uuid null references public.boards(id) on delete set null,
  requested_at   timestamptz not null default now(),
  decided_at     timestamptz null
);
create index if not exists purchases_student_idx on public.purchases (student_id, requested_at desc);
create index if not exists purchases_status_idx on public.purchases (status, requested_at);

-- ---------------------------------------------------------
-- 5단계: 수업 모드
-- ---------------------------------------------------------

-- 차시별 수업자료 (반과 상관없이 차시마다 1개). boards.lesson_code와 같은 값으로 잇는다(외래 키 없음)
create table if not exists public.lessons (
  code       text primary key,
  title      text not null default '',
  lesson_src text null,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 6단계: 학기말 정리
-- ---------------------------------------------------------

-- 보관한 보드: 관리 화면 목록·수업 시작에서 빠진다. 제출·점수 기록은 그대로 남는다(null = 쓰는 중)
alter table public.boards add column if not exists archived_at timestamptz null;

-- ---------------------------------------------------------
-- 8단계: 개인 학습지(웹판) → XP
-- (7단계 빈칸 질문은 8단계로 바뀌어 지운다. 7단계 SQL을 실행한 적이 없으면 아무 일도 하지 않는다)
-- ---------------------------------------------------------
alter table public.point_events drop column if exists quiz_id;
drop table if exists public.quiz_answers;
drop table if exists public.quizzes;
delete from public.settings where key = 'quiz';

-- 차시별 학습지 (반과 상관없이 차시마다 1개). 관리 화면에서 웹판 HTML을 올리면 브라우저가 읽어 저장한다
-- pages: [{slide, title, html(정답을 뺀 화면용, 칸 자리는 <span data-ws="f1"></span>), fields: [{key, type, options}]}]
-- key:   {f1: {type: 'blank'|'choice'|'sym'|'text', answers: [정답, 허용 답…], options}}  ← 학생 쪽에 내보내지 않는다
create table if not exists public.worksheets (
  lesson_code text primary key,
  title       text not null default '',
  pages       jsonb not null default '[]'::jsonb,
  key         jsonb not null default '{}'::jsonb,
  page_count  int  not null default 0,
  field_count int  not null default 0,
  updated_at  timestamptz not null default now()
);

-- 학생이 쓴 답 (보드마다 한 학생 한 줄). done_at: 모두 맞게 제출한 때
create table if not exists public.worksheet_answers (
  board_id   uuid not null references public.boards(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  answers    jsonb not null default '{}'::jsonb,
  done_at    timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (board_id, student_id)
);

-- 학습지 완료 XP는 board_id를 비우고 worksheet_board_id로 묶는다 (발표 지급·발표 취소와 섞이지 않게). 한 보드에서 한 학생 한 번
alter table public.point_events add column if not exists worksheet_board_id uuid null references public.boards(id) on delete set null;
create unique index if not exists point_events_ws_once_idx on public.point_events (student_id, worksheet_board_id) where worksheet_board_id is not null;

-- 쪽별 제출 (2026-10-14): 쪽마다 [이 쪽 제출]로 채점하고, 모두 맞은 쪽의 칸 이름(f1…)을 passed에 모은다.
-- passed에 든 칸은 답이 바뀌지 않는다. 학습지의 모든 칸이 passed에 들면 done_at + XP·코인
alter table public.worksheet_answers add column if not exists passed jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------
-- 오목 (AI 대전, 보통 난이도)
-- 교사가 켠 반만 할 수 있다(기본 꺼짐). 수업 모드를 열면 그 반은 자동으로 꺼진다.
-- 이기면 point_events에 사유 '오목 승리'로 지급
-- ---------------------------------------------------------
alter table public.classes add column if not exists omok_open boolean not null default false;

-- 오목 판 (사용자 결정 2026-10-15: 하루 '시도' 횟수 제한, settings.omok.daily).
-- 첫 돌을 놓을 때 한 줄 생긴다(그만두거나 새로고침해도 한 판으로 센다). 이긴 판은 won_at, 보상은 판마다 한 번
create table if not exists public.omok_games (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  started_at timestamptz not null default now(),
  won_at     timestamptz null
);
create index if not exists omok_games_student_started on public.omok_games (student_id, started_at);
-- 판마다 무작위 씨앗(2026-10-16 사용자 요청: AI가 늘 똑같이 두지 않게). AI는 비슷하게 좋은 수 중 씨앗으로 하나를 고른다
alter table public.omok_games add column if not exists seed int not null default 0;

-- 학습지 진도 (2026-10-15): 수업 모드가 지금까지 띄운 수업자료 쪽 중 가장 뒤 번호.
-- 학생은 data-slide가 이 번호 이하인 학습지 쪽만 보고 낼 수 있다. null이면 전부 열림(수업 모드를 켜지 않은 보드)
alter table public.boards add column if not exists ws_upto int null;

-- ---------------------------------------------------------
-- 루미큐브 (2026-10-16 사용자 요청): 3명 온라인 대전. 6개 반 전체에서 먼저 온 3명끼리.
-- 오목 스위치(classes.omok_open)를 같이 쓴다. 1등만 XP·코인(settings.rummikub), 하루 판 수 제한.
-- 타일 번호 0~105: 숫자 = t % 13 + 1, 색 = (t / 13) % 4 (검정·빨강·파랑·주황), 104·105는 조커.
-- 더미 순서·손패는 서버만 안다(학생 쪽에는 자기 손패만).
-- ---------------------------------------------------------
create table if not exists public.rk_games (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'waiting' check (status in ('waiting', 'playing', 'done')),
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  ended_at   timestamptz null,
  pool       int[] not null default '{}',     -- 남은 더미(앞에서부터 뽑음)
  board      jsonb not null default '[]',      -- 판 위 세트 [[타일…], …]
  turn       smallint not null default 0,      -- 지금 차례 자리(0~2)
  turn_at    timestamptz null,                 -- 지금 차례가 시작된 시각(제한 시간 기준)
  version    int not null default 0,           -- 바뀔 때마다 +1
  passes     smallint not null default 0,      -- 더미가 빈 뒤 연속으로 넘긴 수
  last       jsonb null,                       -- 마지막 행동 {seat, kind: play|draw|timeout|pass|leave, n, tiles}
  winner     smallint null,
  end_reason text null check (end_reason in ('out', 'pool', 'left')),
  paid       boolean not null default false
);
create index if not exists rk_games_status_idx on public.rk_games (status, created_at);

create table if not exists public.rk_players (
  game_id    uuid not null references public.rk_games(id) on delete cascade,
  seat       smallint not null check (seat between 0 and 2),
  student_id uuid not null references public.students(id) on delete cascade,
  rack       int[] not null default '{}',
  melded     boolean not null default false,   -- 첫 등록(30점)을 했는지
  timeouts   smallint not null default 0,      -- 연속으로 시간을 넘긴 수(3번이면 나간 것으로)
  left_at    timestamptz null,
  seen_at    timestamptz not null default now(),
  joined_at  timestamptz not null default now(),
  primary key (game_id, seat),
  unique (game_id, student_id)
);
create index if not exists rk_players_student_idx on public.rk_players (student_id, joined_at);

-- ---------------------------------------------------------
-- 쪽별 첫 답 (2026-10-16): 학습지 쪽 칸을 모두 채워 [이 쪽 제출]한 학생을 먼저 낸 순서로 쪽마다 5명까지 줄 세운다(맞았는지는 따지지 않음).
-- 수업 모드에 한 명씩 띄우고 교사가 [인정](1 XP·1코인) 또는 [넘기기](다음 사람). 지급은 쪽마다 한 명,
-- 지급한 뒤 줄의 나머지는 지급 없이 차례로 보여 준다
-- status: wait 대기 · accepted 인정(지급) · skipped 넘김 · closed (예전 값, 지금은 안 씀)
-- ---------------------------------------------------------
create table if not exists public.ws_firsts (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards(id) on delete cascade,
  page        int not null,
  slide       int null,
  student_id  uuid not null references public.students(id) on delete cascade,
  answers     jsonb not null default '{}'::jsonb,  -- 낸 순간 그 쪽 칸의 답
  status      text not null default 'wait' check (status in ('wait', 'accepted', 'skipped', 'closed')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz null,
  unique (board_id, page, student_id)
);
create index if not exists ws_firsts_board_idx on public.ws_firsts (board_id, page, created_at);

-- 첫 답 지급은 board_id를 비우고 ws_first_id로 묶는다. 한 줄에 한 번
alter table public.point_events add column if not exists ws_first_id uuid null references public.ws_firsts(id) on delete set null;
create unique index if not exists point_events_ws_first_once_idx on public.point_events (ws_first_id) where ws_first_id is not null;

-- 수업 모드가 새 첫 답을 실시간으로 받도록
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ws_firsts'
     ) then
    alter publication supabase_realtime add table public.ws_firsts;
  end if;
end $$;

-- 쪽별 제출 열기 (2026-10-16): 학습지 쪽의 [이 쪽 제출]은 교사가 수업 모드에서 그 쪽 [제출 시작]을 눌러야 열린다
create table if not exists public.ws_page_open (
  board_id  uuid not null references public.boards(id) on delete cascade,
  page      int not null,
  slide     int null,
  opened_at timestamptz not null default now(),
  primary key (board_id, page)
);

-- ---------------------------------------------------------
-- 퀴즈 배틀 (2026-10-16): 그날 모둠끼리 오늘 차시 학습지의 빈칸·고르기·부등호를 한 문제씩 함께 푼다.
-- 교사가 수업 모드에서 연 보드(boards.quiz_open)에서만. 모둠마다 한 판(unique), 모둠 안 1등(동점이면 모두)에게 XP·코인.
-- items: 출제 문항(정답 포함, 학생 쪽에는 지금 문제와 이미 공개된 정답만 내보낸다)
-- q: 지금 문제(0부터), q_at: 지금 문제를 보여 주기 시작한 시각, q_end: 답을 받는 마감(접속한 모둠원이 모두 냈으면 앞당김).
-- 마감 뒤 settings.quiz_battle.reveal초 동안 정답 공개, 그 뒤 다음 문제
-- ---------------------------------------------------------
alter table public.boards add column if not exists quiz_open boolean not null default false;

create table if not exists public.qb_games (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards(id) on delete cascade,
  group_no   smallint not null,
  status     text not null default 'lobby' check (status in ('lobby', 'playing', 'done')),
  items      jsonb not null default '[]'::jsonb,
  q          int not null default 0,
  q_at       timestamptz null,
  q_end      timestamptz null,
  version    int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  ended_at   timestamptz null,
  paid       boolean not null default false,
  unique (board_id, group_no)
);

create table if not exists public.qb_players (
  game_id    uuid not null references public.qb_games(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  score      int not null default 0,
  correct    int not null default 0,
  seen_at    timestamptz not null default now(),
  joined_at  timestamptz not null default now(),
  primary key (game_id, student_id)
);

create table if not exists public.qb_answers (
  game_id    uuid not null references public.qb_games(id) on delete cascade,
  q          int not null,
  student_id uuid not null references public.students(id) on delete cascade,
  answer     text not null,
  ok         boolean not null,
  at         timestamptz not null default now(),
  primary key (game_id, q, student_id)
);

-- 퀴즈 배틀 지급은 board_id를 비우고 qb_game_id로 묶는다. 한 판에 한 학생 한 번
alter table public.point_events add column if not exists qb_game_id uuid null references public.qb_games(id) on delete set null;
create unique index if not exists point_events_qb_once_idx on public.point_events (student_id, qb_game_id) where qb_game_id is not null;

-- ---------------------------------------------------------
-- 오목 1대1 (2026-10-16): 6개 반 전체에서 먼저 온 2명끼리. 보상 없음.
-- 오목 스위치(classes.omok_open)를 같이 쓰고, 하루 판 수는 AI 대전과 따로(settings.omok_pvp).
-- 보드: int[225] (r*15 + c + 1), 0 빈 칸 · 1 흑 · 2 백. 흑이 먼저
-- ---------------------------------------------------------
create table if not exists public.om_games (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'waiting' check (status in ('waiting', 'playing', 'done')),
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  ended_at   timestamptz null,
  board      int[] not null default array_fill(0, array[225]),
  turn       smallint not null default 1,        -- 지금 둘 색(1 흑 · 2 백)
  turn_at    timestamptz null,                   -- 지금 차례가 시작된 시각(제한 시간 기준)
  version    int not null default 0,             -- 바뀔 때마다 +1
  moves      smallint not null default 0,
  last       smallint null,                      -- 마지막 수 칸(0~224)
  winner     smallint null,                      -- 이긴 색(무승부면 null)
  end_reason text null check (end_reason in ('five', 'time', 'left', 'full'))
);
create index if not exists om_games_status_idx on public.om_games (status, created_at);

create table if not exists public.om_players (
  game_id    uuid not null references public.om_games(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  color      smallint not null check (color in (1, 2)),
  left_at    timestamptz null,
  seen_at    timestamptz not null default now(),
  joined_at  timestamptz not null default now(),
  primary key (game_id, student_id)
);
create index if not exists om_players_student_idx on public.om_players (student_id, joined_at);
