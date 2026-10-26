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

-- 2026-10-16 꾸미기 아이템 추가 (5코인부터. 그림은 avatar-parts.js, 미리보기 docs/design/shop-parts-new.html)
insert into public.avatar_items (id, slot, name, price, rarity, min_level, sort) values
  ('hair_buzz',      'hair',   '까까머리',       10, 'common', 1, 21),
  ('hair_side',      'hair',   '옆가르마',       15, 'common', 1, 22),
  ('hair_bun',       'hair',   '똥머리',        20, 'common', 1, 23),
  ('hair_twin',      'hair',   '양갈래',        25, 'common', 1, 24),
  ('eyes_dot',       'eyes',   '점 눈',          5, 'common', 1, 21),
  ('eyes_wink',      'eyes',   '윙크',          10, 'common', 1, 22),
  ('eyes_heart',     'eyes',   '하트 눈',        15, 'common', 1, 23),
  ('eyes_star',      'eyes',   '별 눈',          60, 'rare',   1, 24),
  ('mouth_o',        'mouth',  '오',             5, 'common', 1, 21),
  ('mouth_cat',      'mouth',  '고양이 입',       5, 'common', 1, 22),
  ('mouth_smirk',    'mouth',  '씩 웃기',        10, 'common', 1, 23),
  ('mouth_teeth',    'mouth',  '앞니',          15, 'common', 1, 24),
  ('outfit_stripe',  'outfit', '줄무늬 티',      15, 'common', 1, 21),
  ('outfit_jersey',  'outfit', '체육복',        20, 'common', 1, 22),
  ('outfit_vest',    'outfit', '니트 조끼',      25, 'common', 1, 23),
  ('outfit_shirt',   'outfit', '셔츠와 넥타이',   30, 'common', 1, 24),
  ('outfit_tux',     'outfit', '턱시도',        80, 'rare',   1, 25),
  ('acc_bandaid',    'acc',    '반창고',         5, 'common', 1, 21),
  ('acc_pencil',     'acc',    '귀에 연필',      10, 'common', 1, 22),
  ('acc_bow',        'acc',    '리본 핀',        10, 'common', 1, 23),
  ('acc_scarf',      'acc',    '목도리',        20, 'common', 1, 24),
  ('acc_beaker',     'acc',    '비커',          25, 'common', 1, 25),
  ('acc_cap',        'acc',    '야구 모자',      30, 'common', 1, 26),
  ('acc_magnifier',  'acc',    '돋보기',        30, 'common', 1, 27),
  ('acc_hat_chick',  'acc',    '병아리 모자',    35, 'common', 1, 31),
  ('acc_hat_frog',   'acc',    '개구리 모자',    40, 'common', 1, 32),
  ('acc_hat_cat',    'acc',    '고양이 모자',    40, 'common', 1, 33),
  ('acc_hat_bear',   'acc',    '곰 모자',       40, 'common', 1, 34),
  ('acc_hat_rabbit', 'acc',    '토끼 모자',      45, 'common', 1, 35),
  ('acc_hat_dino',   'acc',    '공룡 모자',      80, 'rare',   1, 36),
  ('acc_flask',      'acc',    '빛나는 플라스크', 80, 'rare',   1, 41),
  ('acc_halo',       'acc',    '전자 고리',     250, 'legend', 8, 42),
  ('bg_dots',        'bg',     '물방울',         5, 'common', 1, 21),
  ('bg_check',       'bg',     '체크',          10, 'common', 1, 22),
  ('bg_hex',         'bg',     '분자 구조',      30, 'common', 1, 23),
  ('bg_planet',      'bg',     '행성',          80, 'rare',   1, 24),
  ('bg_dna',         'bg',     'DNA',          100, 'rare',   1, 25),
  ('bg_galaxy',      'bg',     '은하',         200, 'legend', 5, 26)
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
  ('omok', '{"xp": 2, "coins": 2, "daily": 7}'::jsonb)
on conflict (key) do nothing;

-- 루미큐브: 1등이 받는 XP·코인, 하루 판 수(시작된 판), 한 턴 제한 시간(초)
insert into public.settings (key, value) values
  ('rummikub', '{"xp": 5, "coins": 5, "daily": 5, "turn": 60}'::jsonb)
on conflict (key) do nothing;

-- 쪽별 첫 답: 교사가 [인정]하면 받는 XP·코인 (쪽마다 한 명)
insert into public.settings (key, value) values
  ('ws_first', '{"xp": 1, "coins": 1}'::jsonb)
on conflict (key) do nothing;

-- 퀴즈 배틀: 모둠 안 1등이 받는 XP·코인, 한 판 문제 수(무작위), 문제마다 받는 시간(초: 고르기·부등호 / 빈칸), 정답 공개(초)
insert into public.settings (key, value) values
  ('quiz_battle', '{"xp": 4, "coins": 4, "count": 20, "pick": 10, "blank": 10, "reveal": 3}'::jsonb)
on conflict (key) do nothing;

-- 선생님 체험 계정: 반마다 0번. 코드는 이 파일에 쓰지 않는다(공개 저장소, 2026-10-20 코드가 알려져 바꿈).
-- 여기서는 0번 줄만 만들고 코드는 건드리지 않는다. 코드는 SQL Editor에서 따로 정한다(저장하지 않음):
--   update public.students set code_hash = extensions.crypt('새코드', extensions.gen_salt('bf')) where number = 0;
--   delete from public.student_sessions where student_id in (select id from public.students where number = 0);
-- 순위·명단·코드 발급 등에서는 빠진다(01_schema 0번 설명)
insert into public.students (class_id, number)
select id, 0 from public.classes
on conflict (class_id, number) do update set active = true;

-- 오목 1대1: 하루 판 수(시작된 판), 한 수 제한 시간(초). 보상 없음
insert into public.settings (key, value) values
  ('omok_pvp', '{"daily": 5, "turn": 30}'::jsonb)
on conflict (key) do nothing;

-- 오목 AI 대전 보상은 하루 이긴 판 2번까지(2026-10-16). 이미 있는 설정에도 넣는다(값이 있으면 그대로)
update public.settings set value = value || '{"reward_daily": 2}'::jsonb
where key = 'omok' and not (value ? 'reward_daily');

-- 루미큐브 보상은 하루 1등 1번까지(2026-10-19). 이미 있는 설정에도 넣는다(값이 있으면 그대로)
update public.settings set value = value || '{"reward_daily": 1}'::jsonb
where key = 'rummikub' and not (value ? 'reward_daily');

-- 진도 관리: 진도 마감일(이날까지 남은 수업을 셈)
insert into public.settings (key, value) values
  ('progress', '{"deadline": "2026-12-04"}'::jsonb)
on conflict (key) do nothing;

-- 캘린더 구독: 교시 시간(1교시부터 [시작, 끝]). token은 관리 '진도 관리'에서 만든다(비어 있으면 구독 주소 없음)
insert into public.settings (key, value) values
  ('calendar', '{"token": "", "periods": [["09:00","09:45"],["09:55","10:40"],["10:50","11:35"],["11:45","12:30"],["13:30","14:15"],["14:25","15:10"],["15:20","16:05"]]}'::jsonb)
on conflict (key) do nothing;

-- 퀴즈 쇼: 1~3위가 받는 XP·코인(모둠 대항이면 1~3위 모둠원 모두)
insert into public.settings (key, value) values
  ('quiz_show', '{"xp": [10, 6, 3], "coins": [10, 6, 3]}'::jsonb)
on conflict (key) do nothing;

-- 쿼리도: 도착한 사람이 받는 XP·코인, 하루 판 수(시작된 판), 보상 받는 승리(하루), 한 수 제한 시간(초)
insert into public.settings (key, value) values
  ('quoridor', '{"xp": 5, "coins": 5, "daily": 5, "reward_daily": 1, "turn": 40}'::jsonb)
on conflict (key) do nothing;

-- 학습지 AI 채점 (2026-10-24): 처음 설치할 때만. on은 꺼 둠(관리 'AI 채점'에서 켬)
--   url = Edge Function ws-grade 주소, secret = cron이 함수에 보내는 비밀 표(48자). 둘 다 학생 쪽으로 나가지 않는다
--   wait = 이 초가 지나도록 판정이 없으면 지금 방식으로 채점(빈칸은 등록 답, 서술은 채우면 맞음)
--   예측 칸(621B1 f12)은 정답이 없어 AI를 끈다(사용자 결정). 관리 화면에서 다시 켤 수 있고, 이 줄은 처음 한 번만 넣는다
do $$
begin
  if not exists (select 1 from public.settings where key = 'ai_grade') then
    insert into public.settings (key, value) values ('ai_grade', jsonb_build_object(
      'on', false, 'model', 'gemini-3.5-flash-lite', 'batch', 40, 'wait', 20,
      'url', 'https://sxejmhkevefwnpwldczt.supabase.co/functions/v1/ws-grade',
      'secret', encode(extensions.gen_random_bytes(24), 'hex')));
    insert into public.ws_ai_off (lesson_code, field_key) values ('621B1', 'f12')
    on conflict do nothing;
  end if;
end;
$$;
insert into public.settings (key, value) values ('ai_state', '{}'::jsonb)
on conflict (key) do nothing;
