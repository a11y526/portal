create or replace function public.reset_worksheet_upto(p_board_id uuid, p_slide int)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_upto int;
begin
  if not public.is_teacher() then
    raise exception 'NOT_TEACHER';
  end if;
  if p_slide is null or p_slide < 1 then
    raise exception 'BAD_SLIDE';
  end if;
  -- 수업 끝(ws_free)도 풀고, 수업 끝이 연 뒤 쪽 [제출 시작]은 닫는다(2026-11-06)
  update public.boards set ws_upto = p_slide, ws_free = false
  where id = p_board_id
  returning ws_upto into v_upto;
  if v_upto is null then
    raise exception 'NOT_FOUND';
  end if;
  update public.ws_page_open set closed_at = now()
  where board_id = p_board_id and slide > p_slide and closed_at is null;
  return v_upto;
end;
$$;
revoke all on function public.reset_worksheet_upto(uuid, int) from public, anon;
grant execute on function public.reset_worksheet_upto(uuid, int) to authenticated;

-- test반 721 보드를 처음 상태로(시험하다 '수업 끝'이 된 것 풀기)
update public.boards set ws_free = false, ws_upto = null, ws_now = null where class_id = 20 and lesson_code = '721' and archived_at is null;
