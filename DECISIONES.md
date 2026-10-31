# Decisiones tomadas durante la construcción

Decisiones que la spec dejaba abiertas o que hubo que ajustar. Siempre la opción más sencilla y razonable.
Las pruebas y medidas que justifican varias de ellas están en [`PRUEBAS.md`](PRUEBAS.md).

## Backend (Supabase `chispa`)

- **Señal pública como tabla, no vista.** `qeq_room_signal (code, version)` es una tabla mantenida por un
  trigger sobre `qeq_rooms`. `anon` solo tiene `SELECT` sobre ella; expone únicamente código y versión. La
  usa el sondeo de respaldo.
- **Sincronización en tiempo real (cambiada tras las pruebas de carga):**
  1. El trigger de la sala envía un **Realtime Broadcast** `bump` al canal `qeq:<CODE>` con
     `realtime.send(...)` en cada cambio. Lo manda la base de datos, así que no depende de la conexión del
     móvil que hizo la acción. Si `realtime.send` fallara, la excepción se ignora y la partida sigue.
  2. El cliente agrupa ráfagas de avisos (150 ms) en un único refetch del estado.
  3. Sondeo cada 3 s de la versión (sin reintentos y con tiempo máximo) + estado completo cada 15 s.
  4. Refetch inmediato en `visibilitychange`, `focus`, `online` y `pageshow`.
  - La primera versión usaba `postgres_changes` sobre la señal + broadcast desde el cliente. Con 30 clientes,
    `postgres_changes` llegaba tarde o no llegaba (p95 3,2 s; el sondeo tenía que rescatarlo) y duplicaba el
    tráfico. Con el broadcast desde la BD: **p95 < 0,4 s con 30 clientes y con 45 en dos salas**.
  - `qeq_room_signal` sigue en la publicación `supabase_realtime` (único cambio fuera del prefijo `qeq_`,
    inocuo); el SQL de limpieza la quita.
- **Funciones internas `qeq__*`** (doble guion bajo): auth, ranking, PIN, reparto de preguntas… Sin
  `EXECUTE` para nadie salvo el propietario. Las RPC públicas `qeq_*` solo tienen `EXECUTE` para `anon`.
- **Errores legibles:** las RPC lanzan mensajes en español; `hint = 'qeq_auth' / 'qeq_no_room'` permite al
  cliente distinguir "te han expulsado / la sala no existe" y volver a la portada.
- **Acciones del anfitrión idempotentes.** `qeq_reveal` y `qeq_next` reciben el índice de la anécdota que
  se ve en pantalla (`p_index`) y no hacen nada si ya no es la actual; empezar a escribir / votar dos veces
  tampoco da error. Así un doble toque (o dos móviles con el control) nunca se salta la revelación.
- **PIN con bloqueo anti fuerza bruta:** 5 fallos → 1 minuto bloqueado (incluso con el PIN correcto).
  Las funciones con PIN devuelven `{error}` en vez de lanzar excepción, porque una excepción desharía el
  contador de fallos.
- **Recuperar el acceso, tres caminos** (todos con el PIN de anfitrión):
  - Móvil sin sesión → `qeq_recover_host`: recupera la identidad del anfitrión original (con sus puntos).
  - Móvil que ya juega en esa sala → `qeq_reclaim_host` (la de la spec): ese jugador pasa a ser anfitrión.
  - **Nuevo:** un jugador que perdió su sesión (otro navegador, borró datos, le expulsaron por error de
    pestaña) → `qeq_recover_player(code, pin, nombre)`: el anfitrión teclea su PIN en ese móvil.
    Antes era imposible volver una vez empezada la votación (el nombre ya estaba cogido).
- **Terminar antes (`qeq_finish_early`):** el final solo incluye las anécdotas/respuestas ya reveladas;
  las que no salieron siguen en secreto.
- **Bonus engañador:** cuenta los votos *equivocados* de otros jugadores (no cuenta a quien no votó), máx.
  +3 por anécdota/respuesta.
- **Quien no escribió** (votación forzada) sigue jugando y votando; simplemente no sale lo suyo.
- **Quién vota:** todos (incluido el autor). "Han votado X de N" usa N = jugadores en la sala.
  `get_state` devuelve también `voted_player_ids` (quién ha votado, nunca a quién) para que el anfitrión
  sepa a quién esperar.
- **Ranking:** competición estándar (1, 2, 2, 4). Desempate visual por nombre.
- `joined_at` usa `clock_timestamp()` para que el orden de llegada sea estable.

## Modo "Preguntas"

- Misma mecánica que el modo anécdotas: cada **respuesta** es una fila de `qeq_anecdotes` (`slot` = nº de
  pregunta, `question` = texto de la pregunta), así votación, revelación, puntuación, bonus y final no
  cambian. La única tabla nueva es `qeq_prompts` (preguntas asignadas a cada jugador, privadas).
- El anfitrión elige el modo y **1, 2 o 3 preguntas por jugador** en la sala de espera (solo ahí). La sala
  muestra cuántas respuestas habrá en total, para no hacer una partida eterna (30 jugadores × 3 = 90).
- Cada jugador recibe preguntas **distintas** al azar de un banco de 68 (película favorita, qué te da miedo,
  comida favorita, karaoke estrella, tu sitio favorito de Valdemoro…), evitando repetir preguntas dentro de
  la sala. Se reparten al empezar; quien entra durante la fase de responder recibe las suyas al unirse.
- **"Otra pregunta"**: cambia una pregunta por otra no usada; si ya estaba respondida, pide confirmación y
  borra esa respuesta.
- "Ha guardado" = ha respondido **todas** sus preguntas. Si el anfitrión fuerza la votación, salen las
  respuestas guardadas aunque alguien no haya respondido todo.
- En la votación y la revelación se ve la pregunta encima de la respuesta; en el final, la lista de todas
  las respuestas con su pregunta y su autor.
- Las preguntas de los demás nunca viajan al navegador durante la fase de responder (comprobado en red).

## Frontend

- `base: './'` en Vite y routing por hash: funciona en GitHub Pages en subcarpeta y en local sin tocar nada.
- Rutas: `#/` portada, `#/crear`, `#/unirse`, `#/sala/ABCD` (juego si tienes sesión en esa sala; si no,
  formulario de unirse con el código relleno), `#/anfitrion/ABCD` y `#/volver/ABCD` (recuperar).
  `?sala=ABCD` se convierte en `#/sala/ABCD`. El QR apunta a `…/#/sala/ABCD`.
- Al abrir la web con una sesión guardada se entra directamente en la partida. "‹ Salir al menú" vuelve a la
  portada sin abandonar la partida; en la portada, "Olvidar esta partida" borra la sesión de ese móvil.
- **Botón del anfitrión protegido:** se desactiva mientras la acción está en curso y durante 0,6 s al
  aparecer, porque "Revelar" y "Siguiente" ocupan el mismo sitio. El servidor además ignora acciones con un
  índice antiguo.
- **PIN siempre visible para el anfitrión** en la barra dorada (antes solo en la sala de espera) y en
  "⚙️ Opciones del maestro de pista", que además permite **terminar ya** o **volver a la sala de espera**.
- **Peticiones con tiempo máximo** (8 s el estado, 12 s las acciones). En móvil, una petición colgada
  dejaría la sincronización bloqueada para siempre.
- **Reintento automático único** ante fallo de red en las acciones idempotentes (guardar, votar, revelar…),
  no en crear/unirse (podría duplicar la sala o dejar el nombre "cogido").
- El sondeo de la versión va **sin reintentos**: supabase-js 2.118 reintenta los GET 3 veces con espera
  (1+2+4 s), lo que retrasaba ~7 s el aviso de "Sin conexión".
- Borradores en `localStorage` por sala y por pregunta mientras escribes; se borran al guardar y al salir
  de la fase de escribir (antes reaparecía la anécdota de la ronda anterior al "Jugar otra vez").
- El emoji se preselecciona al azar; los emojis pueden repetirse entre jugadores.
- Confirmación también al **revelar** si falta gente por votar (además de forzar votación, expulsar,
  reiniciar y terminar ya).
- El anfitrión ve **quién falta por votar** (si son 8 o menos; si no, solo el número).
- Los nombres largos ocupan dos líneas en las tarjetas en vez de cortarse.
- Los avisos de éxito duran 1,6 s para no tapar la pantalla siguiente; los de error, 3,8 s.
- Se usa la clave `anon` (JWT legacy); es pública por diseño y va en `.env` (commiteado).

## Despliegue

- `gh` estaba autenticado → GitHub Pages con Actions (repo público `circo-quien-es-quien`).
