-- ==== 01 ====
-- ---------------------------------------------------------
-- 윷놀이 (2026-11-05 사용자 요청): 1대1(2명)·2대2 팀전(4명) 온라인. 6개 반 전체에서 인원별로 먼저 온 사람끼리.
-- 오목 스위치(classes.omok_open)를 같이 쓴다. 이긴 편 모두 은화(settings.yut), 하루 판 수·보상 횟수 제한.
-- 윷판 29밭(고정). 말 위치 -1 안 나감 · 0~28 판 위 · 100 남. 말 8개 = 편 0(0~3) + 편 1(4~7). 자리 = 0~3, 편 = 자리 % 2.
-- 규칙은 assets/js/yut.js와 같다
-- ---------------------------------------------------------
create table if not exists public.yt_games (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'waiting' check (status in ('waiting', 'playing', 'done')),
  size       smallint not null check (size in (2, 4)),
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  ended_at   timestamptz null,
  pieces     smallint[] not null default '{-1,-1,-1,-1,-1,-1,-1,-1}',
  turn       smallint not null default 0,      -- 지금 차례 자리
  turn_at    timestamptz null,                 -- 지금 할 일(던지기·말 쓰기)이 시작된 시각(제한 시간 기준)
  throws     smallint not null default 0,      -- 남은 던지기
  results    smallint[] not null default '{}', -- 던져 나온 윷 중 아직 안 쓴 것(-1 빽도, 1~5)
  version    int not null default 0,
  moves      int not null default 0,
  last       jsonb null,                       -- 마지막 일 {seat, kind: throw|move|skip|leave, sticks, value, piece, from, to, n, caught, auto}
  winner     smallint null,                    -- 이긴 편(0 | 1)
  end_reason text null check (end_reason in ('home', 'left'))
);
create index if not exists yt_games_status_idx on public.yt_games (status, size, created_at);

create table if not exists public.yt_players (
  game_id    uuid not null references public.yt_games(id) on delete cascade,
  seat       smallint not null check (seat between 0 and 3),
  student_id uuid not null references public.students(id) on delete cascade,
  timeouts   smallint not null default 0,      -- 연속으로 시간을 넘긴 수(4번이면 나간 것으로)
  paid       boolean not null default false,   -- 이긴 편으로 은화를 받았는지
  left_at    timestamptz null,
  seen_at    timestamptz not null default now(),
  joined_at  timestamptz not null default now(),
  primary key (game_id, seat),
  unique (game_id, student_id)
);
create index if not exists yt_players_student_idx on public.yt_players (student_id, joined_at);

-- ==== 02 ====
-- ---------------------------------------------------------
-- 윷놀이 (2026-11-05): 학생은 yt_* 함수로만
-- ---------------------------------------------------------
alter table public.yt_games enable row level security;
alter table public.yt_players enable row level security;
revoke all on public.yt_games from anon;
revoke all on public.yt_players from anon;

drop policy if exists yt_games_teacher_all on public.yt_games;
create policy yt_games_teacher_all on public.yt_games
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists yt_players_teacher_all on public.yt_players;
create policy yt_players_teacher_all on public.yt_players
  for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- ==== 03 ====
-- ---------------------------------------------------------
-- 윷놀이 (2026-11-05): 1대1·2대2 팀전. 인원별로 6개 반 전체에서 먼저 온 사람끼리(advisory lock 'yt_match').
-- 오목 스위치(omok_open)가 켜진 반만. 하루 판 수는 settings.yut.daily(시작된 판), 할 일 하나(던지기·말 쓰기)마다 turn초.
-- 차례: 던지기(윷·모·잡기면 한 번 더) → 나온 윷을 하나씩 골라 말을 움직임. 쓸 수 없는 윷은 버림(판에 말이 없을 때 빽도 등).
-- 시간을 넘기면 서버가 대신 던지거나 첫 말을 움직이고, 4번 연속이면 나간 것으로. 한 편이 모두 나가면 다른 편이 이김(보상 없음).
-- 말 4개가 모두 나면 이긴 편 모두 은화(반이 켜져 있을 때, 오늘 reward_daily번까지). 규칙은 assets/js/yut.js와 같다
-- ---------------------------------------------------------
create or replace function public._yt_settings()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'xp',    0,  -- 게임은 XP 없음(은화만)
    'silver', coalesce((v ->> 'silver')::int, 0),
    'daily', greatest(coalesce((v ->> 'daily')::int, 5), 1),
    'reward_daily', coalesce((v ->> 'reward_daily')::int, 1),
    'turn',  greatest(coalesce((v ->> 'turn')::int, 20), 10))
  from (select (select value from public.settings where key = 'yut') as v) x;
$$;
revoke all on function public._yt_settings() from public, anon, authenticated;

-- 오늘(KST) 시작된 판 중 내가 들어간 판 수
create or replace function public._yt_today(p_student_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from public.yt_players p
  join public.yt_games g on g.id = p.game_id
  where p.student_id = p_student_id
    and g.started_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;
revoke all on function public._yt_today(uuid) from public, anon, authenticated;

-- 오늘(KST) 보상을 받은 윷놀이 승리 수
create or replace function public._yt_paid_today(p_student_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from public.point_events
  where student_id = p_student_id and reason = '윷놀이 승리'
    and created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;
revoke all on function public._yt_paid_today(uuid) from public, anon, authenticated;

-- 그 자리에서 앞으로 가는 길(밟는 자리 차례, 마지막은 참먹이 0). 모서리 5·10, 방 22에 멈춘 말만 안쪽으로
create or replace function public._yt_route(p int)
returns int[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_from int;
begin
  if p = -1 then return array(select generate_series(1, 19)) || 0; end if;
  if p = 5  then return array[20, 21, 22, 23, 24] || array(select generate_series(15, 19)) || 0; end if;
  if p = 10 then return array[25, 26, 22, 27, 28, 0]; end if;
  if p = 22 then return array[27, 28, 0]; end if;
  if p = 20 then return array[21, 22, 23, 24] || array(select generate_series(15, 19)) || 0; end if;
  if p = 21 then return array[22, 23, 24] || array(select generate_series(15, 19)) || 0; end if;
  if p = 23 then return array[24] || array(select generate_series(15, 19)) || 0; end if;
  if p = 24 then return array(select generate_series(15, 19)) || 0; end if;
  if p = 25 then return array[26, 22, 27, 28, 0]; end if;
  if p = 26 then return array[22, 27, 28, 0]; end if;
  if p = 27 then return array[28, 0]; end if;
  if p = 28 then return array[0]; end if;
  if p between 1 and 19 then
    v_from := p + 1;
    return array(select generate_series(v_from, 19)) || 0;
  end if;
  return '{}'::int[];
end;
$$;
revoke all on function public._yt_route(int) from public, anon, authenticated;

-- 빽도: 한 칸 뒤로(방 22 → 21, 참먹이 0 → 19). 갈 수 없으면 null
create or replace function public._yt_back(p int)
returns int
language sql
immutable
set search_path = public
as $$
  select case p
    when 0 then 19 when 5 then 4 when 10 then 9 when 15 then 14
    when 20 then 5 when 21 then 20 when 22 then 21 when 23 then 22 when 24 then 23
    when 25 then 10 when 26 then 25 when 27 then 22 when 28 then 27
    else case when p between 1 and 19 then p - 1 end
  end;
$$;
revoke all on function public._yt_back(int) from public, anon, authenticated;

-- 말이 p에서 n(-1 빽도, 1~5)만큼 가면 닿는 자리(100 = 남). 갈 수 없으면 null
create or replace function public._yt_dest(p int, n int)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  r int[];
begin
  if p = 100 or p is null or n is null then return null; end if;
  if n = -1 then
    if p = -1 then return null; end if;
    return public._yt_back(p);
  end if;
  if n < 1 or n > 5 then return null; end if;
  r := public._yt_route(p);
  if n <= coalesce(array_length(r, 1), 0) then return r[n]; end if;
  return 100;
end;
$$;
revoke all on function public._yt_dest(int, int) from public, anon, authenticated;

-- 그 편 말 중 n으로 움직일 수 있는 말이 있는지
create or replace function public._yt_usable(p_pieces smallint[], p_team int, n int)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  for i in p_team * 4 + 1 .. p_team * 4 + 4 loop
    if public._yt_dest(p_pieces[i], n) is not null then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function public._yt_usable(smallint[], int, int) from public, anon, authenticated;

-- 판 끝내기. home이면 이긴 편 중 나가지 않은 사람마다 은화(반이 켜져 있을 때, 그 사람 오늘 reward_daily번까지)
create or replace function public._yt_end(p_game_id uuid, p_team int, p_reason text)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  v_set jsonb := public._yt_settings();
  r     record;
begin
  if not exists (select 1 from public.yt_games where id = p_game_id and status = 'playing') then
    return;
  end if;
  if p_reason = 'home' and ((v_set ->> 'xp')::int <> 0 or (v_set ->> 'silver')::int <> 0) then
    for r in
      select p.seat, p.student_id from public.yt_players p
      join public.students s on s.id = p.student_id
      join public.classes c on c.id = s.class_id
      where p.game_id = p_game_id and p.seat % 2 = p_team and p.left_at is null and c.omok_open
    loop
      if public._yt_paid_today(r.student_id) < (v_set ->> 'reward_daily')::int then
        insert into public.point_events (student_id, xp, silver, reason)
        values (r.student_id, (v_set ->> 'xp')::int, (v_set ->> 'silver')::int, '윷놀이 승리');
        update public.yt_players set paid = true where game_id = p_game_id and seat = r.seat;
      end if;
    end loop;
  end if;
  update public.yt_games
  set status = 'done', ended_at = now(), winner = p_team, end_reason = p_reason, throws = 0, results = '{}', version = version + 1
  where id = p_game_id;
end;
$$;
revoke all on function public._yt_end(uuid, int, text) from public, anon, authenticated;

-- 다음 차례(자리 0 → 1 → 2 → 3). 한 편에 남은 사람이 없으면 다른 편이 이김(보상 없음)
create or replace function public._yt_next(p_game_id uuid, p_at timestamptz)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g      public.yt_games;
  v_seat int;
begin
  select * into g from public.yt_games where id = p_game_id;
  if g.status <> 'playing' then return; end if;
  for t in 0 .. 1 loop
    if not exists (select 1 from public.yt_players where game_id = p_game_id and seat % 2 = t and left_at is null) then
      perform public._yt_end(p_game_id, 1 - t, 'left');
      return;
    end if;
  end loop;
  select seat into v_seat from public.yt_players
  where game_id = p_game_id and left_at is null
  order by (seat - g.turn + 3) % 4
  limit 1;
  update public.yt_games
  set turn = v_seat, turn_at = p_at, throws = 1, results = '{}', version = version + 1
  where id = p_game_id;
end;
$$;
revoke all on function public._yt_next(uuid, timestamptz) from public, anon, authenticated;

-- 할 일 정리: 던질 게 남았으면 그대로. 아니면 쓸 수 없는 윷을 버리고, 남은 윷이 없으면 다음 차례
create or replace function public._yt_settle(p_game_id uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g    public.yt_games;
  v_ok smallint[];
begin
  select * into g from public.yt_games where id = p_game_id;
  if g.status <> 'playing' or g.throws > 0 then return; end if;
  select coalesce(array_agg(r order by i), '{}') into v_ok
  from unnest(g.results) with ordinality u(r, i)
  where public._yt_usable(g.pieces, g.turn % 2, r);
  if coalesce(array_length(v_ok, 1), 0) = 0 then
    perform public._yt_next(p_game_id, now());
  elsif v_ok <> g.results then
    update public.yt_games set results = v_ok, version = version + 1 where id = p_game_id;
  end if;
end;
$$;
revoke all on function public._yt_settle(uuid) from public, anon, authenticated;

-- 던지기(내부, 차례·남은 던지기는 부르는 쪽이 확인). 윷가락 4개, 1 = 배(평평한 쪽)가 위. 첫 윷가락이 빽도 표시
-- 배 0개 모 · 1개 도(표시 윷가락이면 빽도) · 2개 개 · 3개 걸 · 4개 윷. 윷·모면 한 번 더
create or replace function public._yt_throw(p_game_id uuid, p_auto boolean)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g      public.yt_games;
  v_st   int[] := array[(random() < .5)::int, (random() < .5)::int, (random() < .5)::int, (random() < .5)::int];
  v_up   int := v_st[1] + v_st[2] + v_st[3] + v_st[4];
  v_val  int;
begin
  select * into g from public.yt_games where id = p_game_id;
  v_val := case v_up when 0 then 5 when 1 then case when v_st[1] = 1 then -1 else 1 end when 2 then 2 when 3 then 3 else 4 end;
  update public.yt_games
  set throws = throws - 1 + case when v_val in (4, 5) then 1 else 0 end,
      results = results || v_val::smallint,
      turn_at = now(),
      last = jsonb_build_object('seat', g.turn, 'kind', 'throw', 'sticks', to_jsonb(v_st), 'value', v_val, 'auto', p_auto),
      version = version + 1
  where id = p_game_id;
  perform public._yt_settle(p_game_id);
end;
$$;
revoke all on function public._yt_throw(uuid, boolean) from public, anon, authenticated;

-- 말 쓰기(내부). p_piece = 말 번호 0~7(지금 편), p_val = 남은 윷 중 하나. 판 위 말이면 같은 자리 우리 편 말(업은 말)이 같이 간다.
-- 상대 말 자리에 닿으면 그 말을 모두 잡고(처음으로) 한 번 더 던진다. 결과: 오류 글자 또는 null
create or replace function public._yt_move(p_game_id uuid, p_piece int, p_val int, p_auto boolean)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  g       public.yt_games;
  v_team  int;
  v_from  int;
  v_to    int;
  v_n     int := 0;
  v_caught int := 0;
  v_p     smallint[];
  v_res   smallint[] := '{}';
  v_done  boolean := false;
begin
  select * into g from public.yt_games where id = p_game_id;
  v_team := g.turn % 2;
  if g.throws > 0 then return 'THROW_FIRST'; end if;
  if p_piece is null or p_piece < v_team * 4 or p_piece > v_team * 4 + 3 then return 'BAD_PIECE'; end if;
  if p_val is null or not p_val = any(g.results) then return 'BAD_VALUE'; end if;
  v_from := g.pieces[p_piece + 1];
  v_to := public._yt_dest(v_from, p_val);
  if v_to is null then return 'BAD_MOVE'; end if;

  v_p := g.pieces;
  for i in v_team * 4 + 1 .. v_team * 4 + 4 loop
    if i = p_piece + 1 or (v_from >= 0 and v_p[i] = v_from) then
      v_p[i] := v_to;
      v_n := v_n + 1;
    end if;
  end loop;
  if v_to between 0 and 28 then
    for i in (1 - v_team) * 4 + 1 .. (1 - v_team) * 4 + 4 loop
      if v_p[i] = v_to then
        v_p[i] := -1;
        v_caught := v_caught + 1;
      end if;
    end loop;
  end if;
  -- 쓴 윷 하나만 뺀다
  foreach v_from in array g.results loop
    if not v_done and v_from = p_val then v_done := true; else v_res := v_res || v_from::smallint; end if;
  end loop;

  update public.yt_games
  set pieces = v_p, results = v_res, moves = moves + 1, turn_at = now(),
      throws = throws + case when v_caught > 0 then 1 else 0 end,
      last = jsonb_build_object('seat', g.turn, 'kind', 'move', 'piece', p_piece, 'from', g.pieces[p_piece + 1], 'to', v_to,
                                'value', p_val, 'n', v_n, 'caught', v_caught, 'auto', p_auto),
      version = version + 1
  where id = p_game_id;

  if (select bool_and(v_p[i] = 100) from generate_series(v_team * 4 + 1, v_team * 4 + 4) i) then
    perform public._yt_end(p_game_id, v_team, 'home');
  else
    perform public._yt_settle(p_game_id);
  end if;
  return null;
end;
$$;
revoke all on function public._yt_move(uuid, int, int, boolean) from public, anon, authenticated;

-- 제한 시간이 지난 할 일 처리(부르는 쪽이 판 줄을 잠근 뒤, 2초 여유). 대신 던지거나 첫 윷으로 첫 말을 움직인다.
-- 4번 연속이면 나간 것으로. 아무도 안 부른 동안 밀린 것도 한 번에(최대 16번)
create or replace function public._yt_tick(p_game_id uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g      public.yt_games;
  v_turn interval := make_interval(secs => (public._yt_settings() ->> 'turn')::int);
  v_to   int;
  v_val  int;
  v_pc   int;
begin
  for k in 1 .. 16 loop
    select * into g from public.yt_games where id = p_game_id;
    exit when g.status <> 'playing' or now() < g.turn_at + v_turn + interval '2 seconds';
    update public.yt_players set timeouts = timeouts + 1
    where game_id = p_game_id and seat = g.turn
    returning timeouts into v_to;
    if v_to >= 4 then
      update public.yt_players set left_at = now() where game_id = p_game_id and seat = g.turn;
      update public.yt_games set last = jsonb_build_object('seat', g.turn, 'kind', 'leave') where id = p_game_id;
      perform public._yt_next(p_game_id, g.turn_at + v_turn);
    elsif g.throws > 0 then
      perform public._yt_throw(p_game_id, true);
    else
      v_pc := null;
      foreach v_val in array g.results loop
        select i - 1 into v_pc from generate_series(g.turn % 2 * 4 + 1, g.turn % 2 * 4 + 4) i
        where public._yt_dest(g.pieces[i], v_val) is not null
        order by g.pieces[i] desc, i
        limit 1;
        exit when v_pc is not null;
      end loop;
      if v_pc is null then
        perform public._yt_next(p_game_id, now());
      else
        perform public._yt_move(p_game_id, v_pc, v_val, true);
      end if;
    end if;
    -- 대신 한 일의 시작 시각은 원래 끝났어야 할 시각(밀린 시간 초과를 한 번에 처리하려고)
    update public.yt_games set turn_at = g.turn_at + v_turn where id = p_game_id and status = 'playing';
  end loop;
end;
$$;
revoke all on function public._yt_tick(uuid) from public, anon, authenticated;

-- 학생에게 보낼 판. 끝난 판에서 은화를 받았으면 보상도
create or replace function public._yt_view(p_game_id uuid, p_sid uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  g     public.yt_games;
  me    public.yt_players;
  v_set jsonb := public._yt_settings();
  v_tot int;
  v_rw  jsonb;
begin
  select * into g from public.yt_games where id = p_game_id;
  select * into me from public.yt_players where game_id = p_game_id and student_id = p_sid;
  if g.id is null or me.game_id is null then
    return null;
  end if;
  if g.status = 'done' and me.paid then
    select coalesce(sum(xp), 0)::int into v_tot from public.point_events where student_id = p_sid;
    v_rw := jsonb_build_object('xp', (v_set ->> 'xp')::int, 'silver', (v_set ->> 'silver')::int, 'total_xp', v_tot,
      'level_before', (public._level_info(v_tot - (v_set ->> 'xp')::int) ->> 'level')::int,
      'level_after',  (public._level_info(v_tot) ->> 'level')::int);
  end if;
  return jsonb_build_object(
    'id',       g.id,
    'status',   g.status,
    'size',     g.size,
    'version',  g.version,
    'me',       me.seat,
    'team',     me.seat % 2,
    'turn',     g.turn,
    'turn_sec', (v_set ->> 'turn')::int,
    'left_ms',  case when g.status = 'playing'
                  then greatest(0, floor(extract(epoch from (g.turn_at + make_interval(secs => (v_set ->> 'turn')::int) - now())) * 1000))::bigint
                end,
    'pieces',   to_jsonb(g.pieces),
    'throws',   g.throws,
    'results',  to_jsonb(g.results),
    'moves',    g.moves,
    'last',     g.last,
    'winner',   g.winner,
    'end_reason', g.end_reason,
    'reward',   v_rw,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'seat',     p.seat,
        'team',     p.seat % 2,
        'me',       p.student_id = p_sid,
        'class_id', s.class_id,
        'nickname', s.nickname,
        'avatar',   s.avatar,
        'left',     p.left_at is not null
      ) order by p.seat), '[]'::jsonb)
      from public.yt_players p join public.students s on s.id = p.student_id
      where p.game_id = g.id)
  );
end;
$$;
revoke all on function public._yt_view(uuid, uuid) from public, anon, authenticated;

-- 판에서 나가기(내부). 대기 중이면 자리를 비우고, 하는 중이면 기권(우리 편에 남은 사람이 없으면 상대 편이 이김)
create or replace function public._yt_leave(p_game_id uuid, p_sid uuid)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  g  public.yt_games;
  me public.yt_players;
begin
  select * into g from public.yt_games where id = p_game_id for update;
  select * into me from public.yt_players where game_id = p_game_id and student_id = p_sid;
  if g.id is null or me.game_id is null or me.left_at is not null then
    return;
  end if;
  if g.status = 'waiting' then
    delete from public.yt_players where game_id = p_game_id and student_id = p_sid;
    if not exists (select 1 from public.yt_players where game_id = p_game_id) then
      delete from public.yt_games where id = p_game_id;
    else
      update public.yt_games set version = version + 1 where id = p_game_id;
    end if;
  elsif g.status = 'playing' then
    update public.yt_players set left_at = now() where game_id = p_game_id and student_id = p_sid;
    update public.yt_games set last = jsonb_build_object('seat', me.seat, 'kind', 'leave'), version = version + 1
    where id = p_game_id;
    if not exists (select 1 from public.yt_players where game_id = p_game_id and seat % 2 = me.seat % 2 and left_at is null) then
      perform public._yt_end(p_game_id, 1 - me.seat % 2, 'left');
    elsif g.turn = me.seat then
      perform public._yt_next(p_game_id, now());
    end if;
  end if;
end;
$$;
revoke all on function public._yt_leave(uuid, uuid) from public, anon, authenticated;

-- 윷놀이 화면 (학생). p_game_id를 주면 그 판(끝난 판 포함), 없으면 지금 하는 판(없으면 game: null).
-- 부를 때마다 '아직 있음'을 기록하고 밀린 시간 초과를 처리한다. 반이 꺼져 있으면 하던 판에서 나간다.
-- 결과: {ok: true, open, today, daily, xp, silver, reward_daily, rewarded, turn, avatar, queue: {"2": n, "4": n}, game} 또는 {ok: false, error: 'NO_SESSION'}
create or replace function public.yt_state(p_token text, p_game_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid  uuid;
  s      public.students;
  v_open boolean;
  v_gid  uuid := p_game_id;
  v_set  jsonb := public._yt_settings();
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into s from public.students where id = v_sid;
  v_open := coalesce((select omok_open from public.classes where id = s.class_id), false);

  if v_gid is null or not exists (select 1 from public.yt_players where game_id = v_gid and student_id = v_sid) then
    select p.game_id into v_gid
    from public.yt_players p join public.yt_games g on g.id = p.game_id
    where p.student_id = v_sid and p.left_at is null and g.status in ('waiting', 'playing')
    order by p.joined_at desc
    limit 1;
  end if;

  if v_gid is not null then
    if not v_open then
      perform public._yt_leave(v_gid, v_sid);
    else
      perform 1 from public.yt_games where id = v_gid for update;
      update public.yt_players set seen_at = now() where game_id = v_gid and student_id = v_sid;
      perform public._yt_tick(v_gid);
    end if;
  end if;

  return jsonb_build_object(
    'ok',     true,
    'open',   v_open,
    'today',  public._yt_today(v_sid),
    'daily',  (v_set ->> 'daily')::int,
    'xp',     (v_set ->> 'xp')::int,
    'silver', (v_set ->> 'silver')::int,
    'reward_daily', (v_set ->> 'reward_daily')::int,
    'rewarded', public._yt_paid_today(v_sid),
    'turn',   (v_set ->> 'turn')::int,
    'avatar', s.avatar,
    'queue',  (select jsonb_build_object(
                 '2', count(*) filter (where g.size = 2),
                 '4', count(*) filter (where g.size = 4))
               from public.yt_players p join public.yt_games g on g.id = p.game_id
               where g.status = 'waiting' and p.seen_at >= now() - interval '15 seconds'),
    'game',   case when v_gid is null then null else public._yt_view(v_gid, v_sid) end
  );
end;
$$;
revoke all on function public.yt_state(text, uuid) from public;
grant execute on function public.yt_state(text, uuid) to anon, authenticated;

-- 판 찾기 (학생): p_size 2(1대1) | 4(2대2 팀전). 6개 반 전체에서 먼저 온 사람끼리, 이미 하는 판이 있으면 그 판.
-- 15초 넘게 소식이 없는 대기자는 빼고 채운다. 자리는 빈자리 중 무작위(편 = 자리 % 2), 다 차면 첫 차례 무작위로 시작(3초 준비)
-- 결과: yt_state와 같음 또는 error = 'NO_SESSION' | 'CLOSED' | 'LIMIT' | 'BAD_SIZE'
create or replace function public.yt_join(p_token text, p_size int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid   uuid;
  s       public.students;
  v_set   jsonb := public._yt_settings();
  v_today int;
  v_gid   uuid;
  v_seat  int;
  v_n     int;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  if p_size is null or p_size not in (2, 4) then
    return jsonb_build_object('ok', false, 'error', 'BAD_SIZE');
  end if;
  select * into s from public.students where id = v_sid;
  if not coalesce((select omok_open from public.classes where id = s.class_id), false) then
    return jsonb_build_object('ok', false, 'error', 'CLOSED');
  end if;

  perform pg_advisory_xact_lock(hashtext('yt_match'));

  if exists (select 1 from public.yt_players p join public.yt_games g on g.id = p.game_id
             where p.student_id = v_sid and p.left_at is null and g.status in ('waiting', 'playing')) then
    return public.yt_state(p_token, null);
  end if;

  v_today := public._yt_today(v_sid);
  if v_today >= (v_set ->> 'daily')::int then
    return jsonb_build_object('ok', false, 'error', 'LIMIT', 'today', v_today, 'daily', (v_set ->> 'daily')::int);
  end if;

  delete from public.yt_players p using public.yt_games g
  where p.game_id = g.id and g.status = 'waiting' and p.seen_at < now() - interval '15 seconds';
  delete from public.yt_games g
  where g.status = 'waiting' and not exists (select 1 from public.yt_players p where p.game_id = g.id);

  select g.id into v_gid from public.yt_games g
  where g.status = 'waiting' and g.size = p_size
    and (select count(*) from public.yt_players p where p.game_id = g.id) < p_size
  order by g.created_at
  limit 1
  for update;
  if v_gid is null then
    insert into public.yt_games (size) values (p_size) returning id into v_gid;
  end if;

  select x into v_seat
  from generate_series(0, p_size - 1) x
  where not exists (select 1 from public.yt_players p where p.game_id = v_gid and p.seat = x)
  order by random()
  limit 1;
  insert into public.yt_players (game_id, seat, student_id) values (v_gid, v_seat, v_sid);
  update public.yt_games set version = version + 1 where id = v_gid;

  select count(*) into v_n from public.yt_players where game_id = v_gid;
  if v_n = p_size then
    update public.yt_players set seen_at = now() where game_id = v_gid;
    update public.yt_games
    set status = 'playing', started_at = now(), pieces = '{-1,-1,-1,-1,-1,-1,-1,-1}', throws = 1, results = '{}',
        turn = (select seat from public.yt_players where game_id = v_gid order by random() limit 1),
        turn_at = now() + interval '3 seconds', version = version + 1
    where id = v_gid;
  end if;

  return public.yt_state(p_token, v_gid);
end;
$$;
revoke all on function public.yt_join(text, int) from public;
grant execute on function public.yt_join(text, int) to anon, authenticated;

-- 나가기 (학생): 대기 중이면 취소, 하는 중이면 기권
create or replace function public.yt_leave(p_token text, p_game_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid uuid;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  perform pg_advisory_xact_lock(hashtext('yt_match'));
  perform public._yt_leave(p_game_id, v_sid);
  return public.yt_state(p_token, p_game_id);
end;
$$;
revoke all on function public.yt_leave(text, uuid) from public;
grant execute on function public.yt_leave(text, uuid) to anon, authenticated;

-- 할 일 (학생, 내 차례): p_kind 'throw'(던지기) 또는 'move'(p_piece = 말 0~7, p_value = 쓸 윷 -1·1~5)
-- 결과: yt_state와 같음(ok: true) 또는 {ok: false, error: 'NO_SESSION' | 'BAD_GAME' | 'OVER' | 'NOT_TURN' | 'NO_THROW' | 'THROW_FIRST' | 'BAD_PIECE' | 'BAD_VALUE' | 'BAD_MOVE', state}
create or replace function public.yt_play(p_token text, p_game_id uuid, p_kind text, p_piece int default null, p_value int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_sid uuid;
  g     public.yt_games;
  me    public.yt_players;
  v_err text;
begin
  v_sid := public._session_student(p_token);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  select * into g from public.yt_games where id = p_game_id for update;
  select * into me from public.yt_players where game_id = p_game_id and student_id = v_sid;
  if g.id is null or me.game_id is null then
    return jsonb_build_object('ok', false, 'error', 'BAD_GAME');
  end if;
  update public.yt_players set seen_at = now() where game_id = p_game_id and student_id = v_sid;
  perform public._yt_tick(p_game_id);
  select * into g from public.yt_games where id = p_game_id;
  select * into me from public.yt_players where game_id = p_game_id and student_id = v_sid;

  if g.status <> 'playing' or me.left_at is not null then
    v_err := 'OVER';
  elsif not coalesce((select c.omok_open from public.students s join public.classes c on c.id = s.class_id where s.id = v_sid), false) then
    v_err := 'OVER';
  elsif g.turn <> me.seat then
    v_err := 'NOT_TURN';
  elsif p_kind = 'throw' then
    if g.throws <= 0 then
      v_err := 'NO_THROW';
    else
      update public.yt_players set timeouts = 0 where game_id = p_game_id and seat = me.seat;
      perform public._yt_throw(p_game_id, false);
    end if;
  elsif p_kind = 'move' then
    v_err := public._yt_move(p_game_id, p_piece, p_value, false);
    if v_err is null then
      update public.yt_players set timeouts = 0 where game_id = p_game_id and seat = me.seat;
    end if;
  else
    v_err := 'BAD_MOVE';
  end if;
  if v_err is not null then
    return jsonb_build_object('ok', false, 'error', v_err, 'state', public.yt_state(p_token, p_game_id));
  end if;
  return public.yt_state(p_token, p_game_id);
end;
$$;
revoke all on function public.yt_play(text, uuid, text, int, int) from public;
grant execute on function public.yt_play(text, uuid, text, int, int) to anon, authenticated;

-- ==== 04 ====
-- 윷놀이 (2026-11-05): 이긴 편 모두 받는 은화(XP 없음), 하루 판 수(시작된 판), 보상 받는 승리(하루), 할 일 하나 제한 시간(초)
insert into public.settings (key, value) values
  ('yut', '{"xp": 0, "silver": 3, "daily": 5, "reward_daily": 1, "turn": 20}'::jsonb)
on conflict (key) do nothing;
