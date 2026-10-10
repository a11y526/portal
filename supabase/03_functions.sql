-- =========================================================
-- 03_functions.sql — RPC 함수
-- 학생 쪽 함수는 security definer + search_path 고정.
-- =========================================================

-- 반 페이지: 오늘 보드 정보 (1단계: 보드 정보만)
create or replace function public.get_class_page(p_class_id int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.classes;
  b public.boards;
begin
  select * into c from public.classes where id = p_class_id;
  if not found then
    return null;
  end if;

  if c.today_board_id is not null then
    select * into b from public.boards where id = c.today_board_id;
  end if;

  return jsonb_build_object(
    'class', jsonb_build_object('id', c.id, 'label', c.label),
    'board', case when b.id is null then null else jsonb_build_object(
      'id',          b.id,
      'lesson_code', b.lesson_code,
      'title',       b.title,
      'padlet_src',  b.padlet_src,
      'sim_links',   b.sim_links,
      'status',      b.status
    ) end
  );
end;
$$;
revoke all on function public.get_class_page(int) from public;
grant execute on function public.get_class_page(int) to anon, authenticated;
