# Circo de Valdemoro · ¿Quién es quién?

Webapp para jugar desde el móvil (sin instalar nada) a **¿Quién es quién?** en la fiesta de Halloween.

**URL pública:** https://davsan96-a11y.github.io/circo-quien-es-quien/

## Cómo se juega

1. El anfitrión (maestro de pista) abre la URL → **Crear sala** → nombre + personaje. Aparece el código de
   4 letras, el QR y el **PIN de anfitrión** (también sale siempre en su barra dorada).
2. El resto escanea el QR (o abre la URL y escribe el código), pone su nombre y elige personaje.
3. En la sala de espera el anfitrión elige el **modo de juego**:
   - **📜 Anécdotas**: cada uno escribe en secreto una anécdota, curiosidad o secreto gracioso suyo.
   - **❓ Preguntas**: cada uno responde 1, 2 o 3 preguntas al azar ("¿Cuál es tu película favorita?",
     "¿Qué es lo que más miedo te da?"…). Se puede pedir **otra pregunta** si no te gusta la que te toca.
4. Anfitrión: **Empezar a escribir / responder** → cada uno escribe y pulsa **Guardar** (se puede editar).
5. Anfitrión: **Empezar la votación**. Salen una a una; todos votan de quién creen que es (el autor también,
   para disimular). Anfitrión: **Revelar** → **Siguiente**.
6. +1 punto por acierto. Al final: podio, ranking y todo lo que se ha contado con su autor.

- Si alguien recarga o bloquea el móvil, al volver a abrir la web vuelve a su partida.
- **El anfitrión se queda sin móvil:** en otro móvil, **Unirme a una sala → "Soy el anfitrión y he perdido
  mi móvil"** → código + PIN.
- **A un jugador se le cierra la partida o cambia de navegador:** **Unirme a una sala → "Ya estaba jugando y
  se me ha cerrado"** → código + su nombre + el anfitrión teclea su PIN.
- **⚙️ Opciones del maestro de pista** (abajo, durante la partida): terminar ya y ver resultados, o volver a
  la sala de espera.
- Opcional en la sala de espera: **Bonus engañador** (+1 al autor por cada uno que falle, máx. 3).

## Desarrollo

```bash
npm install
npm run dev                      # http://localhost:5173
npm run build
npx playwright install chromium webkit
npm run test:e2e                 # toda la batería (API + partidas + multitud + resiliencia), Chromium y WebKit
BASE_URL=https://davsan96-a11y.github.io/circo-quien-es-quien/ npm run test:e2e   # contra la web publicada
node scripts/stress.mjs 30 5     # carga en tiempo real: 30 clientes con su propio WebSocket
node scripts/load-check.mjs      # 16 jugadores uniéndose y votando a la vez (solo servidor)
```

- Frontend: Vite + React + TypeScript, routing por hash, `qrcode`.
- Backend: Supabase, proyecto `chispa` (`pydsarqfzwtnzozvlgyv`). Todo lleva prefijo `qeq_`.
  Esquema en [`supabase/migrations/`](supabase/migrations/) (aplicar en orden 001 → 004).
- Despliegue: cada push a `main` publica en GitHub Pages (`.github/workflows/deploy.yml`).
- Decisiones de diseño: [`DECISIONES.md`](DECISIONES.md). Informe de pruebas: [`PRUEBAS.md`](PRUEBAS.md).
- Las pruebas crean salas reales (anfitrión "Host", "Maestro", "Anfitrión"…); se borran con el SQL de abajo.

## Después de la fiesta: borrar los datos

Ejecuta en el **SQL Editor** de Supabase (proyecto `chispa`).

**Solo borrar las partidas** (la app sigue funcionando):

```sql
delete from qeq_rooms;   -- borra en cascada jugadores, anécdotas, respuestas, preguntas, votos y señales
```

**Borrar la app entera** (todos los objetos `qeq_`, nada más; comprobado que deja intactas las demás tablas):

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

drop table if exists qeq_votes, qeq_anecdotes, qeq_prompts, qeq_players, qeq_room_signal, qeq_rooms cascade;
```

Y si quieres retirar la web: `gh repo delete davsan96-a11y/circo-quien-es-quien`.
