-- 2026-10-28 711 학습지에서 '천체의 종류 = 태양' 빈칸 2개를 뺀 뒤, 이미 쓴 답을 새 칸 번호로 옮긴다
--   예전 칸 74개 → 새 칸 72개. 뺀 칸: f24(10쪽 한눈에 보기), f69(16쪽 배운 내용 정리)
--   f1~f23 그대로, f25~f68 → 하나씩 앞으로, f70~f74 → 둘씩 앞으로
-- 순서: 관리 화면에서 새 웹판 711을 먼저 올린 뒤(칸 72개) 이 파일을 SQL Editor에서 한 번 실행
-- SQL Editor가 문장마다 따로 실행할 수 있어서 전부 do 블록 하나(한 트랜잭션)에 넣는다
-- 두 번 실행하면 막힌다(settings 'patch_711_nosun')
do $$
declare
  m jsonb;
begin
  if exists (select 1 from public.settings where key = 'patch_711_nosun') then
    raise exception '이미 실행했어요';
  end if;
  if (select field_count from public.worksheets where lesson_code = '711') is distinct from 72 then
    raise exception '새 웹판 711(칸 72개)을 먼저 올려 주세요';
  end if;

  -- 예전 키 → 새 키 (뺀 칸은 null)
  select jsonb_object_agg('f' || i,
           case when i < 24 then to_jsonb('f' || i)
                when i in (24, 69) then 'null'::jsonb
                when i < 69 then to_jsonb('f' || (i - 1))
                else to_jsonb('f' || (i - 2)) end)
    into m
  from generate_series(1, 74) i;

  -- 학생 답과 제출한 칸 (표에 없는 키는 그대로, 뺀 칸은 지움)
  update public.worksheet_answers wa set
    answers = coalesce((
      select jsonb_object_agg(coalesce(m ->> e.key, e.key), e.value)
      from jsonb_each(wa.answers) e
      where not (m ? e.key) or jsonb_typeof(m -> e.key) <> 'null'), '{}'::jsonb),
    passed = coalesce((
      select jsonb_agg(coalesce(m ->> p.k, p.k) order by p.ord)
      from jsonb_array_elements_text(wa.passed) with ordinality p(k, ord)
      where not (m ? p.k) or jsonb_typeof(m -> p.k) <> 'null'), '[]'::jsonb)
  where wa.board_id in (select id from public.boards where lesson_code = '711');

  -- AI 채점 기억표·확인 줄·끈 칸 (키가 겹치지 않게 x를 붙였다가 뗀다)
  delete from public.ws_ai_cache where lesson_code = '711' and field_key in ('f24', 'f69');
  delete from public.ws_ai_queue where lesson_code = '711' and field_key in ('f24', 'f69');
  delete from public.ws_ai_off   where lesson_code = '711' and field_key in ('f24', 'f69');

  update public.ws_ai_cache set field_key = 'x' || (m ->> field_key) where lesson_code = '711' and m ? field_key;
  update public.ws_ai_queue set field_key = 'x' || (m ->> field_key) where lesson_code = '711' and m ? field_key;
  update public.ws_ai_off   set field_key = 'x' || (m ->> field_key) where lesson_code = '711' and m ? field_key;
  update public.ws_ai_cache set field_key = substr(field_key, 2) where lesson_code = '711' and field_key like 'x%';
  update public.ws_ai_queue set field_key = substr(field_key, 2) where lesson_code = '711' and field_key like 'x%';
  update public.ws_ai_off   set field_key = substr(field_key, 2) where lesson_code = '711' and field_key like 'x%';

  insert into public.settings (key, value) values ('patch_711_nosun', to_jsonb(now()));
end $$;
