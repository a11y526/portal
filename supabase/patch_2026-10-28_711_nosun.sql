-- 2026-10-28 711 학습지에서 '천체의 종류 = 태양' 빈칸 2개를 뺀 뒤, 이미 쓴 답을 새 칸 번호로 옮긴다
--   예전 칸 74개 → 새 칸 72개. 뺀 칸: f24(10쪽 한눈에 보기), f69(16쪽 배운 내용 정리)
--   f1~f23 그대로, f25~f68 → 하나씩 앞으로, f70~f74 → 둘씩 앞으로
-- 순서: 관리 화면에서 새 웹판 711을 먼저 올린 뒤(칸 72개) 이 파일을 SQL Editor에서 한 번 실행
-- 두 번 실행하면 막힌다(settings 'patch_711_nosun')
begin;

do $$
begin
  if exists (select 1 from public.settings where key = 'patch_711_nosun') then
    raise exception '이미 실행했어요';
  end if;
  if (select field_count from public.worksheets where lesson_code = '711') is distinct from 72 then
    raise exception '새 웹판 711(칸 72개)을 먼저 올려 주세요';
  end if;
end $$;

create temp table m711 (o text primary key, n text) on commit drop;
insert into m711
select 'f' || i,
       case when i < 24 then 'f' || i
            when i in (24, 69) then null
            when i < 69 then 'f' || (i - 1)
            else 'f' || (i - 2) end
from generate_series(1, 74) i;

-- 학생 답과 제출한 칸
update public.worksheet_answers wa set
  answers = coalesce((
    select jsonb_object_agg(coalesce(m.n, e.key), e.value)
    from jsonb_each(wa.answers) e left join m711 m on m.o = e.key
    where m.o is null or m.n is not null), '{}'::jsonb),
  passed = coalesce((
    select jsonb_agg(coalesce(m.n, p.k) order by p.ord)
    from jsonb_array_elements_text(wa.passed) with ordinality p(k, ord) left join m711 m on m.o = p.k
    where m.o is null or m.n is not null), '[]'::jsonb)
where wa.board_id in (select id from public.boards where lesson_code = '711');

-- AI 채점 기억표·확인 줄·끈 칸 (키가 겹치지 않게 x를 붙였다가 뗀다)
delete from public.ws_ai_cache where lesson_code = '711' and field_key in ('f24', 'f69');
delete from public.ws_ai_queue where lesson_code = '711' and field_key in ('f24', 'f69');
delete from public.ws_ai_off   where lesson_code = '711' and field_key in ('f24', 'f69');

update public.ws_ai_cache c set field_key = 'x' || m.n from m711 m where c.lesson_code = '711' and c.field_key = m.o;
update public.ws_ai_queue q set field_key = 'x' || m.n from m711 m where q.lesson_code = '711' and q.field_key = m.o;
update public.ws_ai_off   o set field_key = 'x' || m.n from m711 m where o.lesson_code = '711' and o.field_key = m.o;
update public.ws_ai_cache set field_key = substr(field_key, 2) where lesson_code = '711' and field_key like 'x%';
update public.ws_ai_queue set field_key = substr(field_key, 2) where lesson_code = '711' and field_key like 'x%';
update public.ws_ai_off   set field_key = substr(field_key, 2) where lesson_code = '711' and field_key like 'x%';

insert into public.settings (key, value) values ('patch_711_nosun', to_jsonb(now()));

commit;
