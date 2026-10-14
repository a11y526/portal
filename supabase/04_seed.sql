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
  ('points', '{"pass_xp": 10, "pass_coins": 10, "rank_bonus": [10, 6, 3], "rank_bonus_coins": [10, 6, 3]}'::jsonb),
  ('level_thresholds', '[0, 30, 70, 120, 180, 250, 330, 420, 520, 630]'::jsonb)
on conflict (key) do nothing;

-- 순위 보너스 코인을 XP와 따로 정할 수 있게 (예전에 만든 설정이면 XP 보너스와 같은 값으로 채움)
update public.settings
set value = value || jsonb_build_object('rank_bonus_coins', coalesce(value -> 'rank_bonus', '[10, 6, 3]'::jsonb))
where key = 'points' and not (value ? 'rank_bonus_coins');

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

-- 4단계: 상점 꾸미기 아이템 (가격·등급·레벨 조건·판매 여부는 관리 화면에서 바꾼다)
insert into public.avatar_items (id, slot, name, price, rarity, min_level, sort) values
  ('hair_spiky',     'hair',   '삐죽 머리',     30, 'common', 1,  11),
  ('hair_long',      'hair',   '긴 생머리',     30, 'common', 1,  12),
  ('hair_einstein',  'hair',   '아인슈타인 머리', 80, 'rare',   1,  13),
  ('eyes_sparkle',   'eyes',   '반짝 눈',       80, 'rare',   1,  11),
  ('mouth_tongue',   'mouth',  '혀 내밀기',     30, 'common', 1,  11),
  ('outfit_labcoat', 'outfit', '실험복',       30, 'common', 1,  11),
  ('outfit_space',   'outfit', '우주복',       80, 'rare',   1,  12),
  ('acc_glasses',    'acc',    '보안경',       30, 'common', 1,  11),
  ('acc_headphones', 'acc',    '헤드폰',       30, 'common', 1,  12),
  ('acc_goggles',    'acc',    '실험 고글',     30, 'common', 1,  13),
  ('acc_atom',       'acc',    '원자 배지',     30, 'common', 1,  14),
  ('acc_crown',      'acc',    '왕관',        200, 'legend', 10, 15),
  ('bg_stars',       'bg',     '별 무늬',       30, 'common', 1,  11),
  ('bg_elements',    'bg',     '원소 기호',     80, 'rare',   1,  12)
on conflict (id) do nothing;

-- 4단계: 보상 (교사 승인 필요)
insert into public.shop_items (id, name, cost, kind, sort) values
  ('pair_ticket', '모둠 선택권', 50,  'pair',  1),
  ('store',       '상점',       100, 'plain', 2)
on conflict (id) do nothing;

-- 8단계: 학습지를 모두 맞게 내면 받는 XP·코인 (한 보드에서 한 번)
insert into public.settings (key, value) values
  ('worksheet', '{"xp": 10, "coins": 5}'::jsonb)
on conflict (key) do nothing;

-- 오목: AI에게 이기면 받는 XP·코인, 하루에 받을 수 있는 횟수(한국 시간 0시에 새로)
insert into public.settings (key, value) values
  ('omok', '{"xp": 2, "coins": 2, "daily": 3}'::jsonb)
on conflict (key) do nothing;
