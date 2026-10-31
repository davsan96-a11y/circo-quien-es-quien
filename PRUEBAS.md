# Informe de pruebas (noche del 31/10/2026)

Todas las pruebas se han ejecutado contra el Supabase real y contra la **web publicada**
(`BASE_URL=https://davsan96-a11y.github.io/circo-quien-es-quien/`), en **Chromium** y **WebKit** (el motor de
Safari/iPhone). Resultado final: **19 de 19 pruebas superadas**.

## Baterías

| Archivo | Qué cubre |
|---|---|
| `tests/api.spec.ts` (10) | Validaciones (nombre vacío/largo, código en minúsculas y con espacios, nombres duplicados ignorando mayúsculas), máx. 30 jugadores, 20 personas cogiendo el mismo nombre a la vez (solo entra 1), permisos de anfitrión en las 9 acciones, secreto incorrecto, jugador de otra sala, tablas cerradas (lectura e inserción), señal pública con solo `code`+`version`, funciones internas inaccesibles, textos de 200/201 caracteres y saltos de línea, votar fuera de fase, votarse a sí mismo, votar a alguien de otra sala, 10 cambios de voto simultáneos = 1 voto, revelar/siguiente idempotentes, expulsión, PIN (recuperar anfitrión/jugador, bloqueo tras 5 fallos), terminar antes, reiniciar, modo preguntas (30 preguntas distintas para 10 jugadores × 3, cambiar pregunta, entrar tarde), **puntuación con bonus engañador comparada con el cálculo manual tras cada ronda**. |
| `tests/game.spec.ts` | Partida completa modo anécdotas, 1 anfitrión + 5 jugadores (uno en iPhone SE 375×667): unirse, nombre duplicado, editar anécdota, recarga a mitad, forzar votación con alguien sin escribir, cambiar el voto, votarse a sí mismo saltándose la UI (rechazado), **autor nunca presente en la red antes de revelar**, ranking final = cálculo manual, salir al menú y volver, recuperar anfitrión (PIN incorrecto y correcto), reclamar anfitrión desde un jugador, jugar otra vez, olvidar partida. |
| `tests/questions.spec.ts` | Partida completa modo preguntas (2 por jugador): elegir modo, cambiar pregunta con y sin respuesta, borrador que sobrevive a una recarga, alguien que no responde todo, **doble toque en "Revelar"** (no se salta nada), terminar ya, puntuación, preguntas ajenas nunca en la red, jugar otra vez cambiando a anécdotas sin borradores fantasma. |
| `tests/resilience.spec.ts` | Jugador **sin red** (aviso, reintento, se pone al día al volver sin perder lo escrito), jugador con **WebSocket bloqueado** (funciona solo con el sondeo: se entera en < 3 s), expulsión (vuelve a la portada con aviso), entrar con la votación empezada, **volver a la partida desde otro navegador con el PIN**, quién falta por votar; textos y nombres extremos (200 «A», 100 emojis, saltos de línea, `<script>`, nombres de 16 «W»): sin scroll horizontal y el HTML se muestra como texto. |
| `tests/crowd.spec.ts` | **22 navegadores reales** (1 anfitrión + 21) en la misma partida, todos respondiendo y votando a la vez. |

## Carga en tiempo real

`scripts/stress.mjs`: N clientes independientes (cada uno con su WebSocket) con la misma lógica que la app,
partida completa con votos repartidos en 3 s y cambios de voto. Latencia = desde la acción hasta que
**todos** los clientes tienen el estado nuevo.

| Variante | Clientes | p50 | p95 | máx | Errores |
|---|---|---|---|---|---|
| Inicial: `postgres_changes` + broadcast del cliente | 30 | 200 ms | 1,5–3,2 s | 3,2 s | 0 |
| Solo `postgres_changes` + agrupación | 30 | 527 ms | 3,2 s | 3,3 s | 0 |
| Broadcast del cliente + agrupación | 30 | 200–313 ms | 430 ms | 514 ms | 0 |
| **Broadcast desde la BD + agrupación (la actual)** | **30** | **276 ms** | **365 ms** | **569 ms** | **0** |
| Ídem, dos salas a la vez | 30 + 15 | 290 ms | 389 ms | 415 ms | 0 |

Navegadores reales (22 en la misma partida): cada paso llega a la última pantalla en **0,13–0,6 s**
(una vez 1,1 s), todos acaban en la pantalla final.

## Fallos encontrados y corregidos esta noche

1. **Doble toque del anfitrión se saltaba la revelación** ("Revelar" y "Siguiente" están en el mismo
   sitio). → Botón protegido + acciones con índice en el servidor (idempotentes).
2. **"Jugar otra vez" mostraba la anécdota de la ronda anterior** en el cuadro de texto (borrador viejo).
3. **Quien perdía la sesión no podía volver** una vez empezada la votación (nombre cogido). → Volver con el
   PIN del anfitrión.
4. **El PIN de 4 cifras se podía adivinar por fuerza bruta** desde la API. → Bloqueo tras 5 fallos.
5. **El PIN solo se veía en la sala de espera**; si el anfitrión no lo apuntaba, lo perdía. → Siempre visible.
6. **Con 30 clientes, `postgres_changes` llegaba tarde** (p95 3,2 s) y el tráfico se duplicaba. →
   Broadcast desde la base de datos.
7. **`act()` no esperaba al estado nuevo** si había otra petición en curso (el botón del anfitrión se
   reactivaba con la pantalla vieja).
8. **El aviso "Sin conexión" tardaba ~7 s** porque supabase-js reintenta los GET con espera. → Sondeo sin
   reintentos.
9. **Una petición colgada bloqueaba la sincronización para siempre** (red móvil mala). → Tiempo máximo
   en todas las peticiones.
10. **Un fallo de red puntual hacía perder un "Guardar"/voto.** → Reintento automático único en acciones
    idempotentes.
11. Nombres cortados ("Jugad…") en la sala del anfitrión, barra dorada a dos líneas, aviso "✓ Guardada"
    tapando la pantalla siguiente, top 3 lleno de empates a 0, scroll que se quedaba a media pantalla al
    cambiar de fase.

Fallos de las propias pruebas (no de la app), también corregidos: comprobación de fuga demasiado amplia
(`voted_player_ids` contiene "player_id"; una pregunta descartada con "Otra pregunta" que luego le toca
a otro jugador no es una fuga), carreras en los tests, y contextos de navegador sin cerrar entre
pruebas (35 páginas vivas de pruebas anteriores dejaban sin CPU a las siguientes).

## Lo que no se ha podido probar

- **Móviles físicos.** WebKit de Playwright es el motor de Safari, pero no es un iPhone real (en Windows,
  por ejemplo, no pinta bien el grosor de las fuentes variables; Safari de verdad sí).
- **Wake Lock** (pantalla siempre encendida): solo se comprueba que no rompe nada si no está disponible.
- **Cuotas de Realtime del plan gratuito:** no ha habido ni un error de canal con 45 clientes a la vez.
