-- 노션 '2학기 진도관리'에서 한 번 가져오기 (2026-10-20). 01~04 뒤에 한 번만 실행.
-- 다시 실행해도 된다: 차시·시간표는 덮어쓰고, 수업일은 이 기간(10/8 ~ 12/14)을 지우고 새로 만든다.
-- 노션의 107~112반 = 포털 7~12반.

-- 차시 (순서 = 차시 번호, 수업자료 주소는 그대로. 제목이 비었거나 번호뿐이면 노션 제목으로)
insert into public.lessons (code, title, unit, sort) values
  ('611', '압력과 기체의 압력',            '6단원 기체의 성질', 611),
  ('612', '기체의 압력과 부피 관계',        '6단원 기체의 성질', 612),
  ('613', '생활 속 보일 법칙',             '6단원 기체의 성질', 613),
  ('621', '기체의 온도와 부피 관계',        '6단원 기체의 성질', 621),
  ('622', '생활 속 샤를 법칙',             '6단원 기체의 성질', 622),
  ('711', '태양계를 구성하는 천체',         '7단원 태양계', 711),
  ('712', '행성의 분류',                  '7단원 태양계', 712),
  ('713', '태양의 표면과 대기',            '7단원 태양계', 713),
  ('714', '태양의 활동',                  '7단원 태양계', 714),
  ('721', '지구 자전과 겉보기 운동',        '7단원 태양계', 721),
  ('722', '지구 공전과 별자리 변화',        '7단원 태양계', 722),
  ('723', '달의 위상 변화',               '7단원 태양계', 723),
  ('724', '일식과 월식',                  '7단원 태양계', 724),
  ('725', '천체 망원경을 이용한 태양계 관측', '7단원 태양계', 725)
on conflict (code) do update
  set unit = excluded.unit,
      sort = excluded.sort,
      title = case when public.lessons.title in ('', public.lessons.code) then excluded.title else public.lessons.title end;

-- 수업자료 쪽 수 (lessons/611.html 20쪽, 612.html 18쪽. 다른 차시는 수업 모드를 처음 열 때 적힘)
update public.lessons set slide_count = 20 where code = '611' and slide_count is null;
update public.lessons set slide_count = 18 where code = '612' and slide_count is null;

-- 2026-10-20 사용자: 613은 안 나감(단원을 비워 진도에서 뺌. 623은 노션 차시에 없음), 621은 2시간
update public.lessons set unit = '' where code = '613';
update public.lessons set periods = 2 where code = '621';
-- 2026-10-23 사용자: 622(생활 속 샤를 법칙)와 725(천체 망원경)도 진도에서 뺌
update public.lessons set unit = '' where code in ('622', '725');

-- 기본 주간 시간표 (요일, 교시, 반)
delete from public.timetable;
insert into public.timetable (weekday, period, class_id) values
  (1, 1, 11), (1, 3, 9), (1, 4, 10), (1, 6, 8),
  (2, 2, 10), (2, 3, 7), (2, 5, 12),
  (3, 2, 11), (3, 4, 8), (3, 6, 9),
  (4, 3, 7), (4, 4, 9), (4, 6, 12), (4, 7, 11),
  (5, 1, 10), (5, 2, 7), (5, 4, 12), (5, 6, 8);

-- 다음 차시는 보드 진도(slide_max·순위 발표)로 자동 계산한다. 보드가 하나도 없는 반만 이 값을 쓴다
update public.classes set next_lesson = '611' where id between 7 and 12 and next_lesson is null;

-- 수업일: 10/8 ~ 12/14 평일을 시간표대로 만든 뒤, 노션에서 바뀐 날을 덮어쓴다
delete from public.class_days where day between '2026-10-08' and '2026-12-14';
insert into public.class_days (day, period, class_id)
select d::date, t.period, t.class_id
from generate_series('2026-10-08'::date, '2026-12-14'::date, interval '1 day') d
join public.timetable t on t.weekday = extract(isodow from d)::int;

-- 10/12(월)은 금요일 시간표
delete from public.class_days where day = '2026-10-12';
insert into public.class_days (day, period, class_id, memo)
select '2026-10-12', period, class_id, '금요일 시간표' from public.timetable where weekday = 5;

update public.class_days set kind = '휴강'                         where day = '2026-10-08';
update public.class_days set kind = '휴강', memo = '한글날'         where day = '2026-10-09';
update public.class_days set kind = '휴강', memo = '동아리 활동'    where day in ('2026-10-13', '2026-11-16');
update public.class_days set kind = '휴강', memo = '진로체험'       where day = '2026-10-21';
update public.class_days set kind = '휴강', memo = '수능 재량휴업'  where day = '2026-11-19';
update public.class_days set kind = '휴강', memo = '재량휴업'       where day = '2026-11-20';
update public.class_days set kind = '미정', memo = '수행평가 주간'  where day between '2026-12-07' and '2026-12-11';
update public.class_days set kind = '미정', memo = '기말 전날'      where day = '2026-12-14';
