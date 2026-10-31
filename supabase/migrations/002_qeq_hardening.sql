-- Endurecimiento tras pruebas intensivas:
--  * Acciones del anfitrión idempotentes (doble toque / dos móviles anfitriones no se saltan pasos)
--  * PIN con bloqueo anti fuerza bruta (5 fallos → 1 minuto)
--  * Recuperar un jugador que perdió su sesión (con el PIN del anfitrión)
--  * Terminar la partida antes de tiempo
--  * Quién ha votado ya (sin revelar a quién)

alter table qeq_rooms
  add column if not exists pin_fails int not null default 0,
  add column if not exists pin_locked_until timestamptz;

-- Devuelve null si el PIN es correcto, o el mensaje de error. No lanza excepción para que el
-- contador de fallos se guarde (una excepción desharía el update).
create or replace function qeq__check_pin(p_room_id uuid, p_pin text) returns text
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  select * into r from qeq_rooms where id = p_room_id for update;
  if r.pin_locked_until is not null and r.pin_locked_until > now() then
    return 'Demasiados intentos. Espera un minuto y vuelve a probar';
  end if;
  if r.host_pin = trim(coalesce(p_pin, '')) then
    if r.pin_fails > 0 then
      update qeq_rooms set pin_fails = 0, pin_locked_until = null where id = r.id;
    end if;
    return null;
  end if;
  if r.pin_fails + 1 >= 5 then
    update qeq_rooms set pin_fails = 0, pin_locked_until = now() + interval '1 minute' where id = r.id;
  else
    update qeq_rooms set pin_fails = pin_fails + 1 where id = r.id;
  end if;
  return 'PIN incorrecto';
end $$;

create or replace function qeq_reclaim_host(p_code text, p_pin text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_err text;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, false, true);
  v_err := qeq__check_pin(r.id, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  update qeq_rooms set host_player_id = p_player_id, version = version + 1 where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_recover_host(p_code text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  pl qeq_players;
  v_err text;
begin
  select * into r from qeq_rooms where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'Esa sala no existe' using hint = 'qeq_no_room'; end if;
  v_err := qeq__check_pin(r.id, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  select * into pl from qeq_players where id = r.host_player_id;
  if not found then return jsonb_build_object('error', 'El anfitrión ya no está en la sala'); end if;
  return jsonb_build_object('code', r.code, 'player_id', pl.id, 'secret', pl.secret);
end $$;

-- Un jugador que perdió su sesión vuelve a ser él mismo; el anfitrión teclea su PIN en ese móvil.
create or replace function qeq_recover_player(p_code text, p_pin text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  pl qeq_players;
  v_err text;
begin
  select * into r from qeq_rooms where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'Esa sala no existe' using hint = 'qeq_no_room'; end if;
  v_err := qeq__check_pin(r.id, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  select * into pl from qeq_players
  where room_id = r.id and lower(name) = lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  if not found then return jsonb_build_object('error', 'No hay nadie con ese nombre en la sala'); end if;
  return jsonb_build_object('code', r.code, 'player_id', pl.id, 'secret', pl.secret);
end $$;

-- Idempotentes: repetir la acción no da error ni avanza dos veces
create or replace function qeq_start_writing(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase = 'writing' then return jsonb_build_object('ok', true, 'noop', true); end if;
  if r.phase <> 'lobby' then raise exception 'La partida ya ha empezado'; end if;
  if (select count(*) from qeq_players where room_id = r.id) < 3 then
    raise exception 'Hacen falta al menos 3 jugadores';
  end if;
  update qeq_rooms set phase = 'writing', version = version + 1 where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_start_voting(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_order uuid[];
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase in ('voting', 'reveal') then return jsonb_build_object('ok', true, 'noop', true); end if;
  if r.phase <> 'writing' then raise exception 'No estamos en la fase de escribir'; end if;
  select array_agg(id order by random()) into v_order from qeq_anecdotes where room_id = r.id;
  if coalesce(array_length(v_order, 1), 0) < 3 then
    raise exception 'Hacen falta al menos 3 anécdotas guardadas';
  end if;
  update qeq_rooms set phase = 'voting', anecdote_order = v_order, current_index = 0, version = version + 1
  where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

drop function if exists qeq_reveal(text, uuid, uuid);
create function qeq_reveal(p_code text, p_player_id uuid, p_secret uuid, p_index int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if p_index is not null and p_index <> r.current_index then return jsonb_build_object('ok', true, 'noop', true); end if;
  if r.phase = 'reveal' then return jsonb_build_object('ok', true, 'noop', true); end if;
  if r.phase <> 'voting' then raise exception 'No hay nada que revelar ahora'; end if;
  update qeq_rooms set phase = 'reveal', version = version + 1 where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

drop function if exists qeq_next(text, uuid, uuid);
create function qeq_next(p_code text, p_player_id uuid, p_secret uuid, p_index int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if p_index is not null and (p_index <> r.current_index or r.phase <> 'reveal') then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;
  if r.phase <> 'reveal' then raise exception 'Primero hay que revelar'; end if;
  if r.current_index + 1 >= coalesce(array_length(r.anecdote_order, 1), 0) then
    update qeq_rooms set phase = 'final', version = version + 1 where id = r.id;
  else
    update qeq_rooms set phase = 'voting', current_index = current_index + 1, version = version + 1 where id = r.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Terminar ya: el final solo incluye las anécdotas ya reveladas; las demás siguen en secreto.
create or replace function qeq_finish_early(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_shown int;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase = 'final' then return jsonb_build_object('ok', true, 'noop', true); end if;
  if r.phase not in ('voting', 'reveal') then raise exception 'Solo se puede terminar durante la votación'; end if;
  v_shown := case when r.phase = 'reveal' then r.current_index + 1 else r.current_index end;
  if v_shown < 1 then raise exception 'Aún no se ha revelado ninguna anécdota'; end if;
  update qeq_rooms
  set anecdote_order = r.anecdote_order[1:v_shown], current_index = v_shown - 1, phase = 'final', version = version + 1
  where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

-- get_state: añade voted_player_ids en votación (quién ha votado, nunca a quién)
create or replace function qeq_get_state(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_is_host boolean;
  v_total int;
  a qeq_anecdotes;
  res jsonb;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, false, false);
  v_is_host := r.host_player_id = p_player_id;
  v_total := coalesce(array_length(r.anecdote_order, 1), 0);

  res := jsonb_build_object(
    'phase', r.phase,
    'version', r.version,
    'code', r.code,
    'is_host', v_is_host,
    'me', qeq__player_json(p_player_id),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'emoji', p.emoji,
                                          'is_host', p.id = r.host_player_id) order by p.joined_at, p.id)
      from qeq_players p where p.room_id = r.id), '[]'::jsonb),
    'liar_bonus', r.liar_bonus
  );
  if v_is_host then
    res := res || jsonb_build_object('host_pin', r.host_pin);
  end if;

  if r.phase = 'writing' then
    res := res || jsonb_build_object(
      'my_anecdote', (select text from qeq_anecdotes where room_id = r.id and player_id = p_player_id),
      'saved_player_ids', coalesce((select jsonb_agg(player_id) from qeq_anecdotes where room_id = r.id), '[]'::jsonb)
    );
  elsif r.phase in ('voting', 'reveal') then
    select * into a from qeq_anecdotes where id = r.anecdote_order[r.current_index + 1];
    res := res || jsonb_build_object(
      'index', r.current_index,
      'total', v_total,
      'anecdote', jsonb_build_object('id', a.id, 'text', a.text),
      'is_mine', coalesce(a.player_id = p_player_id, false),
      'my_vote', (select guessed_player_id from qeq_votes where anecdote_id = a.id and voter_id = p_player_id),
      'voted_count', (select count(*) from qeq_votes where anecdote_id = a.id),
      'voter_count', (select count(*) from qeq_players where room_id = r.id),
      'voted_player_ids', coalesce((select jsonb_agg(voter_id) from qeq_votes where anecdote_id = a.id), '[]'::jsonb)
    );
    if r.phase = 'reveal' then
      res := res || jsonb_build_object(
        'author', qeq__player_json(a.player_id),
        'votes', coalesce((
          select jsonb_agg(jsonb_build_object('voter_id', v.voter_id, 'guessed_player_id', v.guessed_player_id,
                                              'correct', v.guessed_player_id = a.player_id))
          from qeq_votes v where v.anecdote_id = a.id), '[]'::jsonb),
        'scores', qeq__scores(r.id, r.current_index)
      );
    end if;
  elsif r.phase = 'final' then
    res := res || jsonb_build_object(
      'scores', qeq__scores(r.id, v_total - 1),
      'all_anecdotes', coalesce((
        select jsonb_agg(jsonb_build_object('text', an.text, 'author', qeq__player_json(an.player_id)) order by o.ord)
        from unnest(r.anecdote_order) with ordinality o(aid, ord)
        join qeq_anecdotes an on an.id = o.aid), '[]'::jsonb)
    );
  end if;
  return res;
end $$;

-- Permisos: públicas solo para anon; internas para nadie
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'qeq\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if left(f.proname, 5) <> 'qeq__' then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;
