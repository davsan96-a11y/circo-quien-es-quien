-- Circo de Valdemoro · ¿Quién es quién?
-- Todos los objetos llevan prefijo qeq_. Nada fuera de ese prefijo se modifica
-- (salvo añadir qeq_room_signal a la publicación supabase_realtime, necesario para Realtime).

-- ───────────── Tablas ─────────────
create table qeq_rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code ~ '^[A-HJ-NPR-Z]{4}$'),
  host_player_id uuid,
  host_pin text not null check (host_pin ~ '^[0-9]{4}$'),
  phase text not null default 'lobby' check (phase in ('lobby','writing','voting','reveal','final')),
  current_index int not null default 0,
  anecdote_order uuid[] not null default '{}',
  liar_bonus boolean not null default false,
  version bigint not null default 0,
  created_at timestamptz default now()
);

create table qeq_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references qeq_rooms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 16),
  emoji text not null check (char_length(emoji) between 1 and 16),
  secret uuid not null default gen_random_uuid(),
  joined_at timestamptz default now()
);
create unique index qeq_players_room_name_uq on qeq_players (room_id, lower(name));

create table qeq_anecdotes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references qeq_rooms(id) on delete cascade,
  player_id uuid not null references qeq_players(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 200),
  updated_at timestamptz default now(),
  unique (room_id, player_id)
);
create index qeq_anecdotes_player_idx on qeq_anecdotes (player_id);

create table qeq_votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references qeq_rooms(id) on delete cascade,
  anecdote_id uuid not null references qeq_anecdotes(id) on delete cascade,
  voter_id uuid not null references qeq_players(id) on delete cascade,
  guessed_player_id uuid not null references qeq_players(id) on delete cascade,
  created_at timestamptz default now(),
  unique (anecdote_id, voter_id)
);
create index qeq_votes_room_idx on qeq_votes (room_id);
create index qeq_votes_voter_idx on qeq_votes (voter_id);
create index qeq_votes_guessed_idx on qeq_votes (guessed_player_id);

-- Señal pública mínima: solo código y versión. Es lo único que anon puede leer.
create table qeq_room_signal (
  code text primary key,
  version bigint not null default 0
);

alter table qeq_rooms enable row level security;
alter table qeq_players enable row level security;
alter table qeq_anecdotes enable row level security;
alter table qeq_votes enable row level security;
alter table qeq_room_signal enable row level security;

revoke all on qeq_rooms, qeq_players, qeq_anecdotes, qeq_votes, qeq_room_signal from anon, authenticated;
grant select on qeq_room_signal to anon, authenticated;
create policy qeq_room_signal_read on qeq_room_signal for select to anon, authenticated using (true);

alter publication supabase_realtime add table qeq_room_signal;

-- Mantiene la señal sincronizada con la sala
create or replace function qeq__sync_signal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from qeq_room_signal where code = old.code;
    return old;
  end if;
  insert into qeq_room_signal (code, version) values (new.code, new.version)
  on conflict (code) do update set version = excluded.version;
  return new;
end $$;

create trigger qeq_rooms_signal
after insert or update of version or delete on qeq_rooms
for each row execute function qeq__sync_signal();

-- ───────────── Helpers internos (sin acceso para anon) ─────────────

-- Valida jugador + secreto en la sala. p_lock: bloquea la fila de la sala (mutaciones).
create or replace function qeq__auth(p_code text, p_player_id uuid, p_secret uuid, p_need_host boolean, p_lock boolean)
returns qeq_rooms
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
begin
  if p_lock then
    select * into r from qeq_rooms where code = upper(trim(p_code)) for update;
  else
    select * into r from qeq_rooms where code = upper(trim(p_code));
  end if;
  if not found then
    raise exception 'Esa sala no existe' using hint = 'qeq_no_room';
  end if;
  if not exists (select 1 from qeq_players where id = p_player_id and room_id = r.id and secret = p_secret) then
    raise exception 'Ya no estás en esta sala' using hint = 'qeq_auth';
  end if;
  if p_need_host and r.host_player_id is distinct from p_player_id then
    raise exception 'Solo el maestro de pista puede hacer eso' using hint = 'qeq_not_host';
  end if;
  return r;
end $$;

create or replace function qeq__bump(p_room uuid) returns void
language sql security definer set search_path = public as $$
  update qeq_rooms set version = version + 1 where id = p_room;
$$;

create or replace function qeq__player_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'name', name, 'emoji', emoji) from qeq_players where id = p_id;
$$;

-- Ranking calculado a partir de los votos de las anécdotas 0..p_upto (índices de anecdote_order)
create or replace function qeq__scores(p_room uuid, p_upto int) returns jsonb
language sql stable security definer set search_path = public as $$
  with room as (select * from qeq_rooms where id = p_room),
  shown as (
    select o.aid from room, unnest(room.anecdote_order) with ordinality o(aid, ord)
    where o.ord <= p_upto + 1
  ),
  au as (
    select s.aid, a.player_id as author_id from shown s join qeq_anecdotes a on a.id = s.aid
  ),
  hits as (
    select v.voter_id as pid, count(*) as pts
    from qeq_votes v join au on au.aid = v.anecdote_id
    where v.guessed_player_id = au.author_id and v.voter_id <> au.author_id
    group by v.voter_id
  ),
  liar as (
    select au.author_id as pid,
           least(3, count(v.id) filter (where v.voter_id <> au.author_id and v.guessed_player_id <> au.author_id)) as pts
    from au left join qeq_votes v on v.anecdote_id = au.aid
    group by au.aid, au.author_id
  ),
  totals as (
    select p.id, p.name, p.emoji,
      coalesce((select h.pts from hits h where h.pid = p.id), 0)
      + case when (select liar_bonus from room) then coalesce((select sum(l.pts) from liar l where l.pid = p.id), 0) else 0 end
      as points
    from qeq_players p where p.room_id = p_room
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'player_id', id, 'name', name, 'emoji', emoji, 'points', points, 'rank', rnk
    ) order by points desc, lower(name)), '[]'::jsonb)
  from (select *, rank() over (order by points desc) as rnk from totals) t;
$$;

create or replace function qeq__new_player(p_room uuid, p_name text, p_emoji text) returns qeq_players
language plpgsql security definer set search_path = public as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_emoji text := trim(coalesce(p_emoji, ''));
  pl qeq_players;
begin
  if char_length(v_name) < 1 then raise exception 'Escribe tu nombre'; end if;
  if char_length(v_name) > 16 then raise exception 'El nombre es demasiado largo (máx. 16)'; end if;
  if char_length(v_emoji) < 1 or char_length(v_emoji) > 16 then raise exception 'Elige un personaje'; end if;
  if exists (select 1 from qeq_players where room_id = p_room and lower(name) = lower(v_name)) then
    raise exception 'Ese nombre ya está cogido' using hint = 'qeq_name_taken';
  end if;
  insert into qeq_players (room_id, name, emoji) values (p_room, v_name, v_emoji) returning * into pl;
  return pl;
exception when unique_violation then
  raise exception 'Ese nombre ya está cogido' using hint = 'qeq_name_taken';
end $$;

-- ───────────── RPC públicas ─────────────

create or replace function qeq_create_room(p_name text, p_emoji text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_letters constant text := 'ABCDEFGHJKLMNPRSTUVWXYZ';
  v_code text;
  v_pin text := lpad(floor(random() * 10000)::int::text, 4, '0');
  r qeq_rooms;
  pl qeq_players;
  i int;
begin
  for attempt in 1..50 loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_letters, 1 + floor(random() * length(v_letters))::int, 1);
    end loop;
    exit when not exists (select 1 from qeq_rooms where code = v_code);
    v_code := null;
  end loop;
  if v_code is null then raise exception 'No se pudo crear la sala, inténtalo otra vez'; end if;

  insert into qeq_rooms (code, host_pin) values (v_code, v_pin) returning * into r;
  pl := qeq__new_player(r.id, p_name, p_emoji);
  update qeq_rooms set host_player_id = pl.id, version = version + 1 where id = r.id;
  return jsonb_build_object('code', v_code, 'player_id', pl.id, 'secret', pl.secret, 'host_pin', v_pin);
end $$;

create or replace function qeq_join_room(p_code text, p_name text, p_emoji text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  pl qeq_players;
begin
  select * into r from qeq_rooms where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'Esa sala no existe' using hint = 'qeq_no_room'; end if;
  if r.phase not in ('lobby', 'writing') then
    raise exception 'La partida ya ha empezado a votar, no se puede entrar' using hint = 'qeq_started';
  end if;
  if (select count(*) from qeq_players where room_id = r.id) >= 30 then
    raise exception 'La sala está llena (máx. 30)';
  end if;
  pl := qeq__new_player(r.id, p_name, p_emoji);
  perform qeq__bump(r.id);
  return jsonb_build_object('code', r.code, 'player_id', pl.id, 'secret', pl.secret);
end $$;

-- Un jugador ya dentro de la sala pasa a ser anfitrión si conoce el PIN
create or replace function qeq_reclaim_host(p_code text, p_pin text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, false, true);
  if r.host_pin <> trim(coalesce(p_pin, '')) then
    raise exception 'PIN incorrecto' using hint = 'qeq_bad_pin';
  end if;
  update qeq_rooms set host_player_id = p_player_id, version = version + 1 where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

-- Recuperar la identidad del anfitrión desde un móvil nuevo (sin sesión en la sala)
create or replace function qeq_recover_host(p_code text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  pl qeq_players;
begin
  select * into r from qeq_rooms where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'Esa sala no existe' using hint = 'qeq_no_room'; end if;
  if r.host_pin <> trim(coalesce(p_pin, '')) then
    raise exception 'PIN incorrecto' using hint = 'qeq_bad_pin';
  end if;
  select * into pl from qeq_players where id = r.host_player_id;
  if not found then raise exception 'El anfitrión ya no está en la sala'; end if;
  return jsonb_build_object('code', r.code, 'player_id', pl.id, 'secret', pl.secret);
end $$;

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
      'voter_count', (select count(*) from qeq_players where room_id = r.id)
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

create or replace function qeq_set_liar_bonus(p_code text, p_player_id uuid, p_secret uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase <> 'lobby' then raise exception 'Solo se puede cambiar en la sala de espera'; end if;
  update qeq_rooms set liar_bonus = coalesce(p_on, false), version = version + 1 where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_start_writing(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase <> 'lobby' then raise exception 'La partida ya ha empezado'; end if;
  if (select count(*) from qeq_players where room_id = r.id) < 3 then
    raise exception 'Hacen falta al menos 3 jugadores';
  end if;
  update qeq_rooms set phase = 'writing', version = version + 1 where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_save_anecdote(p_code text, p_player_id uuid, p_secret uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_text text := trim(coalesce(p_text, ''));
begin
  r := qeq__auth(p_code, p_player_id, p_secret, false, true);
  if r.phase <> 'writing' then raise exception 'Ya no se pueden escribir anécdotas'; end if;
  if char_length(v_text) < 1 then raise exception 'Escribe algo antes de guardar'; end if;
  if char_length(v_text) > 200 then raise exception 'Máximo 200 caracteres'; end if;
  insert into qeq_anecdotes (room_id, player_id, text) values (r.id, p_player_id, v_text)
  on conflict (room_id, player_id) do update set text = excluded.text, updated_at = now();
  perform qeq__bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_start_voting(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_order uuid[];
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase <> 'writing' then raise exception 'No estamos en la fase de escribir'; end if;
  select array_agg(id order by random()) into v_order from qeq_anecdotes where room_id = r.id;
  if coalesce(array_length(v_order, 1), 0) < 3 then
    raise exception 'Hacen falta al menos 3 anécdotas guardadas';
  end if;
  update qeq_rooms set phase = 'voting', anecdote_order = v_order, current_index = 0, version = version + 1
  where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_cast_vote(p_code text, p_player_id uuid, p_secret uuid, p_guessed_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_aid uuid;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, false, true);
  if r.phase <> 'voting' then raise exception 'Ahora no se puede votar'; end if;
  if p_guessed_player_id = p_player_id then raise exception 'No puedes votarte a ti mismo'; end if;
  if not exists (select 1 from qeq_players where id = p_guessed_player_id and room_id = r.id) then
    raise exception 'Ese jugador no está en la sala';
  end if;
  v_aid := r.anecdote_order[r.current_index + 1];
  insert into qeq_votes (room_id, anecdote_id, voter_id, guessed_player_id)
  values (r.id, v_aid, p_player_id, p_guessed_player_id)
  on conflict (anecdote_id, voter_id) do update set guessed_player_id = excluded.guessed_player_id, created_at = now();
  perform qeq__bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_reveal(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase <> 'voting' then raise exception 'No hay nada que revelar ahora'; end if;
  update qeq_rooms set phase = 'reveal', version = version + 1 where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_next(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase <> 'reveal' then raise exception 'Primero hay que revelar'; end if;
  if r.current_index + 1 >= coalesce(array_length(r.anecdote_order, 1), 0) then
    update qeq_rooms set phase = 'final', version = version + 1 where id = r.id;
  else
    update qeq_rooms set phase = 'voting', current_index = current_index + 1, version = version + 1 where id = r.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_kick_player(p_code text, p_player_id uuid, p_secret uuid, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase not in ('lobby', 'writing') then raise exception 'Ya no se puede expulsar a nadie'; end if;
  if p_target = p_player_id then raise exception 'No puedes expulsarte a ti mismo'; end if;
  delete from qeq_players where id = p_target and room_id = r.id;
  perform qeq__bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_restart(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  delete from qeq_votes where room_id = r.id;
  delete from qeq_anecdotes where room_id = r.id;
  update qeq_rooms set phase = 'lobby', current_index = 0, anecdote_order = '{}', version = version + 1
  where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── Permisos de ejecución ─────────────
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
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    end if;
  end loop;
end $$;

-- ───────────── Ajustes posteriores ─────────────
alter table qeq_players alter column joined_at set default clock_timestamp();

-- Solo anon (la app no usa usuarios autenticados)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'qeq\_%'
  loop
    execute format('revoke all on function %s from authenticated', f.sig);
  end loop;
end $$;
revoke all on qeq_room_signal from authenticated;
drop policy qeq_room_signal_read on qeq_room_signal;
create policy qeq_room_signal_read on qeq_room_signal for select to anon using (true);
