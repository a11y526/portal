-- =========================================================
-- 04_seed.sql — 기본 데이터
-- 이미 있는 값은 덮어쓰지 않는다(관리 화면에서 바꾼 값 보존).
-- =========================================================

-- 반 7개
insert into public.classes (id, label)
select n, '1-' || n from generate_series(6, 12) as n
on conflict (id) do nothing;

-- 포인트 규칙 (7절)
insert into public.settings (key, value) values
  ('points', '{"pass_xp": 10, "pass_coins": 10, "rank_bonus": [10, 6, 3]}'::jsonb),
  ('level_thresholds', '[0, 30, 70, 120, 180, 250, 330, 420, 520, 630]'::jsonb)
on conflict (key) do nothing;
