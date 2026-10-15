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
-- 이기면 point_events에 사유 '오목 승리'로 지급(하루 횟수 제한은 settings.omok). 따로 표는 없다
-- ---------------------------------------------------------
alter table public.classes add column if not exists omok_open boolean not null default false;
