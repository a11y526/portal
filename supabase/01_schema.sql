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

-- 반 (6~12반)
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
