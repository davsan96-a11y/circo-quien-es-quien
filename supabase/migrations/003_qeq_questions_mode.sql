-- Modo "Preguntas": misma mecánica (adivinar de quién es cada respuesta), pero cada jugador
-- responde 1-3 preguntas al azar en vez de escribir una anécdota.
-- Cada respuesta es una fila de qeq_anecdotes (slot = nº de pregunta, question = texto de la pregunta),
-- así la votación, la revelación y el ranking no cambian.

alter table qeq_rooms
  add column if not exists mode text not null default 'anecdotes' check (mode in ('anecdotes', 'questions')),
  add column if not exists questions_per_player int not null default 1 check (questions_per_player between 1 and 3);

alter table qeq_anecdotes
  add column if not exists slot int not null default 0,
  add column if not exists question text;
alter table qeq_anecdotes drop constraint if exists qeq_anecdotes_room_id_player_id_key;
alter table qeq_anecdotes add constraint qeq_anecdotes_room_player_slot_key unique (room_id, player_id, slot);

-- Preguntas asignadas a cada jugador (privadas: solo las ve su dueño)
create table if not exists qeq_prompts (
  room_id uuid not null references qeq_rooms(id) on delete cascade,
  player_id uuid not null references qeq_players(id) on delete cascade,
  slot int not null check (slot between 0 and 2),
  question text not null,
  primary key (player_id, slot)
);
create index if not exists qeq_prompts_room_idx on qeq_prompts (room_id);
alter table qeq_prompts enable row level security;
revoke all on qeq_prompts from anon, authenticated;

create or replace function qeq__question_bank() returns text[]
language sql immutable set search_path = public as $$
  select array[
    '¿Cuál es tu película favorita?',
    '¿Qué es lo que más miedo te da?',
    '¿Cuál es tu comida favorita?',
    '¿Qué comida no soportas?',
    '¿Cuál es tu peor manía?',
    '¿De qué te disfrazarías si no te diera vergüenza?',
    '¿Cuál fue tu primer trabajo?',
    '¿Qué canción cantas en la ducha?',
    '¿Cuál era tu dibujo animado favorito de pequeño?',
    '¿Qué superpoder te gustaría tener?',
    '¿A qué famoso invitarías a cenar?',
    '¿Cuál es tu película de miedo favorita?',
    '¿Qué harías si te tocara la lotería?',
    '¿Cuál es el peor regalo que te han hecho?',
    '¿Qué animal te gustaría ser?',
    '¿Cuál es tu placer culpable?',
    '¿Qué es lo más raro que has comido?',
    '¿Cuál es tu serie favorita?',
    '¿Qué querías ser de mayor cuando eras pequeño?',
    '¿Cuál es tu viaje soñado?',
    '¿Qué te llevarías a una isla desierta?',
    '¿Cuál es tu monstruo favorito?',
    '¿En qué época de la historia te gustaría vivir?',
    '¿Cuál es tu dulce o chuche favorita?',
    '¿Qué es lo que más te hace reír?',
    '¿Qué canción pondrías para animar una fiesta?',
    '¿Cuál es tu talento oculto?',
    '¿Qué es lo primero que haces al levantarte?',
    '¿Qué personaje de ficción te gustaría ser?',
    '¿Qué fobia rara tienes?',
    '¿Cuál es tu bebida favorita?',
    '¿Qué app usas más en el móvil?',
    '¿Qué no has hecho nunca y te gustaría hacer?',
    '¿Cuál es tu plan perfecto de domingo?',
    '¿Qué harías si fueras invisible un día?',
    '¿Cuál ha sido tu mejor disfraz de Halloween?',
    '¿Cuál es el mejor consejo que te han dado?',
    '¿Qué coleccionas o coleccionabas?',
    '¿Cuál es tu juego de mesa favorito?',
    '¿Qué número de circo harías tú?',
    '¿Qué tatuaje te harías (o tienes)?',
    '¿Cuál es tu frase o muletilla típica?',
    '¿Qué es lo que peor se te da?',
    '¿A qué famoso dicen que te pareces?',
    '¿Qué pedirías en tu última cena?',
    '¿Qué deporte se te da fatal?',
    '¿Qué harías por un millón de euros?',
    '¿Cuál es tu grupo o cantante favorito?',
    '¿Qué apodo tenías de pequeño?',
    '¿Qué es lo que más te saca de quicio?',
    '¿Cuál es tu libro favorito?',
    '¿Qué es lo que más asco te da?',
    '¿Qué harías en un apocalipsis zombi?',
    '¿Cuál es tu estación del año favorita?',
    '¿Qué trabajo no harías nunca?',
    '¿Cuál fue tu primer concierto?',
    '¿Qué es lo más loco que has hecho por amor?',
    '¿Cuál es tu sitio favorito de Valdemoro?',
    '¿En qué gastas dinero sin remordimientos?',
    '¿Qué personaje de terror te da más miedo?',
    '¿Qué no falta nunca en tu nevera?',
    '¿Cuál fue tu primer móvil?',
    '¿Qué olor te recuerda a tu infancia?',
    '¿Qué programa de la tele veías de pequeño?',
    '¿Cuál es tu chiste malo favorito?',
    '¿Qué es lo más valiente que has hecho?',
    '¿Qué objeto inútil guardas en casa?',
    '¿Cuál es tu karaoke estrella?'
  ];
$$;

-- Asigna a un jugador las preguntas que le falten, evitando repetir preguntas ya usadas en la sala
create or replace function qeq__assign_questions(p_room uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
  v_slot int;
  v_q text;
begin
  select questions_per_player into v_n from qeq_rooms where id = p_room;
  for v_slot in 0..v_n - 1 loop
    continue when exists (select 1 from qeq_prompts where player_id = p_player and slot = v_slot);
    select q into v_q from unnest(qeq__question_bank()) q
    where q not in (select question from qeq_prompts where player_id = p_player)
    order by (q in (select question from qeq_prompts where room_id = p_room)), random()
    limit 1;
    insert into qeq_prompts (room_id, player_id, slot, question) values (p_room, p_player, v_slot, v_q);
  end loop;
end $$;

create or replace function qeq_set_mode(p_code text, p_player_id uuid, p_secret uuid, p_mode text, p_count int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase <> 'lobby' then raise exception 'Solo se puede cambiar en la sala de espera'; end if;
  if p_mode not in ('anecdotes', 'questions') then raise exception 'Modo de juego desconocido'; end if;
  update qeq_rooms
  set mode = p_mode, questions_per_player = least(3, greatest(1, coalesce(p_count, 1))), version = version + 1
  where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_start_writing(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  pl record;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  if r.phase = 'writing' then return jsonb_build_object('ok', true, 'noop', true); end if;
  if r.phase <> 'lobby' then raise exception 'La partida ya ha empezado'; end if;
  if (select count(*) from qeq_players where room_id = r.id) < 3 then
    raise exception 'Hacen falta al menos 3 jugadores';
  end if;
  delete from qeq_prompts where room_id = r.id;
  if r.mode = 'questions' then
    for pl in select id from qeq_players where room_id = r.id order by random() loop
      perform qeq__assign_questions(r.id, pl.id);
    end loop;
  end if;
  update qeq_rooms set phase = 'writing', version = version + 1 where id = r.id;
  return jsonb_build_object('ok', true);
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
  if r.phase = 'writing' and r.mode = 'questions' then
    perform qeq__assign_questions(r.id, pl.id);
  end if;
  perform qeq__bump(r.id);
  return jsonb_build_object('code', r.code, 'player_id', pl.id, 'secret', pl.secret);
end $$;

-- Modo anécdotas: slot 0
create or replace function qeq_save_anecdote(p_code text, p_player_id uuid, p_secret uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_text text := trim(coalesce(p_text, ''));
begin
  r := qeq__auth(p_code, p_player_id, p_secret, false, true);
  if r.phase <> 'writing' then raise exception 'Ya no se pueden escribir anécdotas'; end if;
  if r.mode <> 'anecdotes' then raise exception 'En este modo se responden preguntas'; end if;
  if char_length(v_text) < 1 then raise exception 'Escribe algo antes de guardar'; end if;
  if char_length(v_text) > 200 then raise exception 'Máximo 200 caracteres'; end if;
  insert into qeq_anecdotes (room_id, player_id, slot, text) values (r.id, p_player_id, 0, v_text)
  on conflict (room_id, player_id, slot) do update set text = excluded.text, updated_at = now();
  perform qeq__bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function qeq_save_answer(p_code text, p_player_id uuid, p_secret uuid, p_slot int, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_text text := trim(coalesce(p_text, ''));
  v_q text;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, false, true);
  if r.phase <> 'writing' then raise exception 'Ya no se pueden cambiar las respuestas'; end if;
  if r.mode <> 'questions' then raise exception 'En este modo se escribe una anécdota'; end if;
  select question into v_q from qeq_prompts where player_id = p_player_id and slot = p_slot;
  if not found then raise exception 'Esa pregunta no es tuya'; end if;
  if char_length(v_text) < 1 then raise exception 'Escribe algo antes de guardar'; end if;
  if char_length(v_text) > 200 then raise exception 'Máximo 200 caracteres'; end if;
  insert into qeq_anecdotes (room_id, player_id, slot, question, text) values (r.id, p_player_id, p_slot, v_q, v_text)
  on conflict (room_id, player_id, slot) do update set text = excluded.text, question = excluded.question, updated_at = now();
  perform qeq__bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

-- Cambiar una pregunta por otra (borra la respuesta que hubiera en ese hueco)
create or replace function qeq_reroll_question(p_code text, p_player_id uuid, p_secret uuid, p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r qeq_rooms;
  v_old text;
  v_q text;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, false, true);
  if r.phase <> 'writing' or r.mode <> 'questions' then raise exception 'Ahora no se puede cambiar la pregunta'; end if;
  select question into v_old from qeq_prompts where player_id = p_player_id and slot = p_slot;
  if not found then raise exception 'Esa pregunta no es tuya'; end if;
  select q into v_q from unnest(qeq__question_bank()) q
  where q not in (select question from qeq_prompts where player_id = p_player_id)
  order by (q in (select question from qeq_prompts where room_id = r.id)), random()
  limit 1;
  update qeq_prompts set question = v_q where player_id = p_player_id and slot = p_slot;
  delete from qeq_anecdotes where room_id = r.id and player_id = p_player_id and slot = p_slot;
  perform qeq__bump(r.id);
  return jsonb_build_object('ok', true, 'question', v_q);
end $$;

create or replace function qeq_restart(p_code text, p_player_id uuid, p_secret uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r qeq_rooms;
begin
  r := qeq__auth(p_code, p_player_id, p_secret, true, true);
  delete from qeq_votes where room_id = r.id;
  delete from qeq_anecdotes where room_id = r.id;
  delete from qeq_prompts where room_id = r.id;
  update qeq_rooms set phase = 'lobby', current_index = 0, anecdote_order = '{}', version = version + 1
  where id = r.id;
  return jsonb_build_object('ok', true);
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
    'liar_bonus', r.liar_bonus,
    'mode', r.mode,
    'questions_per_player', r.questions_per_player
  );
  if v_is_host then
    res := res || jsonb_build_object('host_pin', r.host_pin);
  end if;

  if r.phase = 'writing' then
    if r.mode = 'questions' then
      res := res || jsonb_build_object(
        'my_questions', coalesce((
          select jsonb_agg(jsonb_build_object('slot', q.slot, 'question', q.question, 'answer', an.text) order by q.slot)
          from qeq_prompts q
          left join qeq_anecdotes an on an.player_id = q.player_id and an.slot = q.slot
          where q.player_id = p_player_id), '[]'::jsonb),
        -- "ha guardado" = ha respondido todas sus preguntas
        'saved_player_ids', coalesce((
          select jsonb_agg(player_id) from (
            select player_id from qeq_anecdotes where room_id = r.id
            group by player_id having count(*) >= r.questions_per_player) t), '[]'::jsonb),
        'answer_count', (select count(*) from qeq_anecdotes where room_id = r.id)
      );
    else
      res := res || jsonb_build_object(
        'my_anecdote', (select text from qeq_anecdotes where room_id = r.id and player_id = p_player_id and slot = 0),
        'saved_player_ids', coalesce((select jsonb_agg(distinct player_id) from qeq_anecdotes where room_id = r.id), '[]'::jsonb)
      );
    end if;
  elsif r.phase in ('voting', 'reveal') then
    select * into a from qeq_anecdotes where id = r.anecdote_order[r.current_index + 1];
    res := res || jsonb_build_object(
      'index', r.current_index,
      'total', v_total,
      'anecdote', jsonb_build_object('id', a.id, 'text', a.text, 'question', a.question),
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
        select jsonb_agg(jsonb_build_object('text', an.text, 'question', an.question,
                                            'author', qeq__player_json(an.player_id)) order by o.ord)
        from unnest(r.anecdote_order) with ordinality o(aid, ord)
        join qeq_anecdotes an on an.id = o.aid), '[]'::jsonb)
    );
  end if;
  return res;
end $$;

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
