# Decisiones tomadas durante la construcción

Decisiones que la spec dejaba abiertas o que hubo que ajustar. Siempre la opción más sencilla y razonable.

## Backend (Supabase `chispa`)

- **Señal pública como tabla, no vista.** Realtime `postgres_changes` no funciona sobre vistas, así que
  `qeq_room_signal (code, version)` es una tabla mantenida por un trigger sobre `qeq_rooms`. `anon` solo
  tiene `SELECT` sobre ella (política `using (true)`); expone únicamente código y versión.
- **Publicación Realtime.** Para que Realtime emita cambios hay que añadir la tabla a la publicación
  existente `supabase_realtime` (`alter publication supabase_realtime add table qeq_room_signal`). Es el único
  cambio fuera del prefijo `qeq_` y solo afecta a una tabla `qeq_`. El SQL de limpieza la quita.
- **Triple red de seguridad para sincronizar:** `postgres_changes` sobre la señal (medido: 100–400 ms),
  `broadcast {bump}` en `qeq:<CODE>` tras cada acción propia, y sondeo cada 3 s (lee solo la versión de la
  señal y pide el estado completo si cambió; además, estado completo cada 15 s). `visibilitychange`,
  `focus`, `online` y `pageshow` hacen refetch inmediato.
- **Funciones internas `qeq__*`** (doble guion bajo): auth, ranking, etc. Sin `EXECUTE` para nadie salvo el
  propietario. Las RPC públicas `qeq_*` solo tienen `EXECUTE` para `anon` (se revocó a `public` y
  `authenticated`).
- **Errores legibles:** las RPC lanzan mensajes en español; `hint = 'qeq_auth' / 'qeq_no_room'` permite al
  cliente distinguir "te han expulsado / la sala no existe" y volver a la portada.
- **Recuperar anfitrión: dos caminos.**
  - Móvil sin sesión en esa sala → `qeq_recover_host(code, pin)` devuelve la identidad del anfitrión
    original (su jugador, con sus puntos). Así no pierde su puntuación.
  - Móvil que ya juega en esa sala → `qeq_reclaim_host(code, pin, player, secret)` (la de la spec): ese
    jugador pasa a ser el anfitrión, sin perder su propio jugador.
  Ambos desde el enlace "Soy el anfitrión y he perdido mi móvil".
- **Bonus engañador:** cuenta los votos *equivocados* de otros jugadores (no cuenta a quien no votó, para
  no regalar puntos por gente despistada), máx. +3 por anécdota.
- **Quien no escribió anécdota** (votación forzada) sigue jugando y votando; simplemente no sale su
  anécdota.
- **Quién vota:** todos los jugadores (incluido el autor). El contador "Han votado X de N" usa N = jugadores
  en la sala.
- **Ranking:** competición estándar (1, 2, 2, 4). Desempate visual por nombre.
- `joined_at` usa `clock_timestamp()` para que el orden de llegada sea estable.

## Frontend

- `base: './'` en Vite y routing por hash: funciona en GitHub Pages en subcarpeta y en local sin tocar nada.
- Rutas: `#/` portada, `#/crear`, `#/unirse`, `#/sala/ABCD` (juego si tienes sesión en esa sala; si no,
  formulario de unirse con el código relleno), `#/anfitrion/ABCD` (recuperar). `?sala=ABCD` se convierte en
  `#/sala/ABCD`. El QR apunta a `…/#/sala/ABCD`.
- Al abrir la web con una sesión guardada se entra directamente en la partida (botón "Volver a mi partida"
  si vuelves a la portada a mano).
- El borrador de la anécdota se guarda en `localStorage` mientras escribes, por si se recarga antes de
  guardar.
- El emoji se preselecciona al azar (se puede cambiar); los emojis pueden repetirse entre jugadores.
- Confirmación también al **revelar** si falta gente por votar (además de forzar votación, expulsar y
  reiniciar, que pide la spec).
- En la escritura, el anfitrión puede expulsar a quien falta (✕ junto a su nombre).
- El QR se puede tocar para verlo a pantalla completa.
- En "Así va el ranking" solo aparecen jugadores con puntos (si no, "Aún no ha puntuado nadie").
- Se usa la clave `anon` (JWT legacy) por máxima compatibilidad con Realtime; es pública por diseño y va en
  `.env` (commiteado).

## Despliegue

- `gh` estaba autenticado → GitHub Pages con Actions (repo público `circo-quien-es-quien`).
