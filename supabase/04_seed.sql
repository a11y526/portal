-- =========================================================
-- 04_seed.sql — 기본 데이터
-- 이미 있는 값은 덮어쓰지 않는다(관리 화면에서 바꾼 값 보존).
-- =========================================================

-- 반 6개 (7~12반)
insert into public.classes (id, label)
select n, '1-' || n from generate_series(7, 12) as n
on conflict (id) do nothing;

-- 포인트 규칙 (7절)
insert into public.settings (key, value) values
  ('points', '{"pass_xp": 10, "pass_coins": 10, "rank_bonus": [10, 6, 3]}'::jsonb),
  ('level_thresholds', '[0, 30, 70, 120, 180, 250, 330, 420, 520, 630]'::jsonb)
on conflict (key) do nothing;

-- 검사 화면 빠른 피드백 버튼 (표가 비어 있을 때만)
insert into public.feedback_presets (text, sort)
select t, n
from unnest(array['빠진 내용 있음', '질문 다시 읽기', '사진이 안 보여요', '제목에 번호 이름']) with ordinality as x(t, n)
where not exists (select 1 from public.feedback_presets);

-- 캐릭터 무료 기본 부품 (그림은 assets/js/avatar-parts.js)
insert into public.avatar_items (id, slot, name, price, rarity, min_level, sort) values
  ('face_round',  'face',   '둥근',   0, 'common', 1, 1),
  ('face_slim',   'face',   '갸름한', 0, 'common', 1, 2),
  ('face_square', 'face',   '네모',   0, 'common', 1, 3),
  ('hair_short',  'hair',   '짧은',   0, 'common', 1, 1),
  ('hair_curly',  'hair',   '곱슬',   0, 'common', 1, 2),
  ('hair_bob',    'hair',   '단발',   0, 'common', 1, 3),
  ('hair_tied',   'hair',   '묶음',   0, 'common', 1, 4),
  ('eyes_round',  'eyes',   '동그란', 0, 'common', 1, 1),
  ('eyes_smile',  'eyes',   '웃는',   0, 'common', 1, 2),
  ('eyes_sleepy', 'eyes',   '졸린',   0, 'common', 1, 3),
  ('mouth_smile', 'mouth',  '미소',   0, 'common', 1, 1),
  ('mouth_grin',  'mouth',  '활짝',   0, 'common', 1, 2),
  ('mouth_flat',  'mouth',  '일자',   0, 'common', 1, 3),
  ('outfit_tee',  'outfit', '티셔츠', 0, 'common', 1, 1),
  ('outfit_hood', 'outfit', '후드',   0, 'common', 1, 2),
  ('acc_none',    'acc',    '없음',   0, 'common', 1, 0),
  ('bg_circle',   'bg',     '연한 원', 0, 'common', 1, 1)
on conflict (id) do nothing;

-- 캐릭터가 아직 없는 학생에게 무료 부품을 무작위로 (새 학생은 03의 트리거가 채움)
update public.students set avatar = public._random_avatar() where avatar = '{}'::jsonb;
