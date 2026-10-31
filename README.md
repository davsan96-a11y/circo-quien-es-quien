# Circo de Valdemoro · ¿Quién es quién?

Webapp para jugar desde el móvil (sin instalar nada) a **¿Quién es quién?** en la fiesta de Halloween.

**URL pública:** https://davsan96-a11y.github.io/circo-quien-es-quien/

## Cómo se juega

1. El anfitrión (maestro de pista) abre la URL → **Crear sala** → nombre + personaje. Aparece el código de
   4 letras, el QR y el **PIN de anfitrión** (apúntalo).
2. El resto escanea el QR (o abre la URL y escribe el código), pone su nombre y elige personaje.
3. Anfitrión: **Empezar a escribir**. Cada uno escribe en secreto una anécdota suya y pulsa **Guardar**.
4. Anfitrión: **Empezar la votación**. Salen las anécdotas una a una; todos votan de quién creen que es
   (el autor también, para disimular). Anfitrión: **Revelar** → **Siguiente anécdota**.
5. +1 punto por acierto. Al final: podio, ranking y todas las anécdotas con su autor.

- Si alguien recarga o bloquea el móvil, al volver a abrir la web vuelve a su partida.
- Si el anfitrión se queda sin móvil: en otro móvil, **Unirme a una sala → "Soy el anfitrión y he perdido
  mi móvil"** → código + PIN.
- Opcional en la sala de espera: **Bonus engañador** (+1 al autor por cada uno que falle, máx. 3).

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:5173
npm run build
npx playwright install chromium
npm run test:e2e     # partida completa 1 anfitrión + 5 jugadores (usa el Supabase real)
node scripts/rt-check.mjs   # comprueba que Realtime llega y mide la latencia
```

- Frontend: Vite + React + TypeScript, routing por hash, `qrcode`.
- Backend: Supabase, proyecto `chispa` (`pydsarqfzwtnzozvlgyv`). Todo lleva prefijo `qeq_`.
  Esquema completo en [`supabase/migrations/001_qeq_schema.sql`](supabase/migrations/001_qeq_schema.sql).
- Despliegue: cada push a `main` publica en GitHub Pages (`.github/workflows/deploy.yml`).
- Decisiones de diseño: [`DECISIONES.md`](DECISIONES.md).

## Después de la fiesta: borrar los datos

Ejecuta en el **SQL Editor** de Supabase (proyecto `chispa`).

**Solo borrar las partidas** (la app sigue funcionando):

```sql
delete from qeq_rooms;   -- borra en cascada jugadores, anécdotas, votos y señales
```

**Borrar la app entera** (todos los objetos `qeq_`, nada más):

```sql
alter publication supabase_realtime drop table qeq_room_signal;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'qeq\_%'
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

drop table if exists qeq_votes, qeq_anecdotes, qeq_players, qeq_room_signal, qeq_rooms cascade;
```

Y si quieres retirar la web: `gh repo delete davsan96-a11y/circo-quien-es-quien`.
