-- Aviso en tiempo real enviado por la propia base de datos (Realtime Broadcast) en cada cambio
-- de la sala. Medido con 30 clientes: p95 < 0,4 s, sin depender de la conexión de quien actúa.
create or replace function qeq__sync_signal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from qeq_room_signal where code = old.code;
    return old;
  end if;
  insert into qeq_room_signal (code, version) values (new.code, new.version)
  on conflict (code) do update set version = excluded.version;
  -- Aviso inmediato a todos los móviles de la sala (Realtime Broadcast desde la base de datos).
  -- Si fallara, la partida sigue: los clientes sondean la versión cada 3 s.
  begin
    perform realtime.send(jsonb_build_object('v', new.version), 'bump', 'qeq:' || new.code, false);
  exception when others then
    null;
  end;
  return new;
end $$;
