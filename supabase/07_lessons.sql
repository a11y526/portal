-- =========================================================
-- 07_lessons.sql — 복사한 사이트(다른 선생님) 서버에 넣는 차시·수업자료 주소·반별 보드
-- 설치 화면과 매일 새벽 자동 업데이트(06)가 실행한다. 원래 사이트(a11y526/portal) 서버에서는 실행하지 않는다.
-- 다시 실행해도 된다: 선생님이 고친 제목·주소는 그대로 두고, 빈 주소만 채우고, 없는 보드만 만든다.
-- 학습지는 넣지 않는다(정답이 공개 저장소에 들어가지 않게). 학습지는 관리 '수업 시작'에서 올린다.
-- 수업자료 주소는 수업 모드(teacher/live.html) 기준 상대 주소 ../lessons/<차시>.html
-- 새 차시를 넣을 때: 아래 values에 한 줄, 수업자료 파일이 lessons/에 있으면 주소도
-- =========================================================

insert into public.lessons (code, title, lesson_src, sort, unit, periods)
select v.code, v.title, v.src, v.sort, '7단원 태양계', 1
from (values
  ('711', '태양계를 구성하는 천체',            '../lessons/711.html', 711),
  ('712', '행성의 분류',                      '../lessons/712.html', 712),
  ('713', '태양의 표면과 대기 · 태양의 활동',  '../lessons/713.html', 713),
  ('721', '지구 자전과 겉보기 운동',           '../lessons/721.html', 721),
  ('722', '지구 공전과 별자리 변화',           null,                  722),
  ('723', '달의 위상 변화',                    null,                  723),
  ('724', '일식과 월식',                       null,                  724)
) as v(code, title, src, sort)
on conflict (code) do update
  set lesson_src = coalesce(public.lessons.lesson_src, excluded.lesson_src),
      unit       = coalesce(public.lessons.unit, excluded.unit);

-- 반마다 수업자료가 있는 차시 보드(그 반에 그 차시 보드가 하나도 없을 때만)
insert into public.boards (class_id, lesson_code, title)
select c.id, l.code, l.code
from public.classes c
join public.lessons l on l.unit = '7단원 태양계' and l.lesson_src is not null
where not exists (select 1 from public.boards b where b.class_id = c.id and b.lesson_code = l.code);
