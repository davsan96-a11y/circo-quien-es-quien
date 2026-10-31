import { test, expect, type Page } from '@playwright/test';

/**
 * Multitud: 1 anfitrión + 21 jugadores en navegadores reales (22 contextos) jugando a la vez.
 * Mide cuánto tarda cada paso en verse en TODAS las pantallas.
 */
const N = Number(process.env.CROWD || 21);

test('22 navegadores en la misma partida', async ({ browser }) => {
  test.setTimeout(600_000);
  const mk = async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    p.on('pageerror', (e) => console.log('pageerror', e.message));
    return p;
  };
  const host = await mk();
  await host.goto('./#/crear');
  await host.getByLabel('Tu nombre').fill('Anfitrión');
  await host.getByRole('button', { name: 'Crear sala' }).click();
  const code = (await host.getByTestId('room-code').textContent())!.trim();

  const players: Page[] = [];
  await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const p = await mk();
      await p.goto(`./#/sala/${code}`);
      await p.getByLabel('Tu nombre').fill(`Jugador ${i + 1}`);
      await p.getByRole('button', { name: 'Entrar' }).click();
      await expect(p.getByTestId('room-code')).toHaveText(code, { timeout: 20000 });
      players[i] = p;
    }),
  );
  const all = [host, ...players];
  const total = all.length;

  const timed = async (label: string, check: (p: Page) => Promise<void>) => {
    const t0 = Date.now();
    const times = await Promise.all(all.map(async (p) => (await check(p), Date.now() - t0)));
    console.log(`${label.padEnd(30)} última pantalla al día en ${Math.max(...times)} ms (mediana ${times.sort((a, b) => a - b)[times.length >> 1]} ms)`);
  };

  await timed(`Sala con ${total} jugadores`, (p) => expect(p.getByTestId('lobby-player')).toHaveCount(total, { timeout: 20000 }));
  await host.screenshot({ path: 'screenshots/multitud-sala.png', fullPage: true });

  await host.getByRole('radio', { name: /Preguntas/ }).click();
  await timed('Cambio a modo Preguntas', (p) =>
    p === host ? Promise.resolve() : expect(p.getByTestId('mode-label')).toContainText('Preguntas'),
  );
  await host.getByRole('button', { name: 'Empezar a responder' }).click();
  await timed('Empezar a responder', (p) => expect(p.getByTestId('question-card')).toHaveCount(1));

  // Todos responden a la vez
  await Promise.all(
    all.map(async (p, i) => {
      await p.getByLabel('Respuesta 1').fill(`Respuesta del jugador ${i}`);
      await p.getByRole('button', { name: 'Guardar', exact: true }).click();
    }),
  );
  await timed(`${total} respuestas guardadas`, (p) => expect(p.getByTestId('saved-count')).toHaveText(`${total} de ${total}`));

  await host.getByRole('button', { name: 'Empezar la votación' }).click();
  await timed('Empezar la votación', (p) => expect(p.getByTestId('anecdote-index')).toHaveText(`Respuesta 1 de ${total}`));

  for (let k = 0; k < 3; k++) {
    // Todos votan a la vez
    await Promise.all(
      all.map(async (p) => {
        await p.getByTestId('vote-tile').nth(k % 3).click();
      }),
    );
    await timed(`Ronda ${k + 1}: ${total} votos`, (p) => expect(p.getByTestId('voted-count')).toHaveText(`Han votado ${total} de ${total}`));
    if (k === 0) await host.screenshot({ path: 'screenshots/multitud-votar.png', fullPage: true });
    await host.getByRole('button', { name: 'Revelar' }).click();
    await timed(`Ronda ${k + 1}: revelar`, (p) => expect(p.getByTestId('reveal-author')).toBeVisible());
    if (k === 0) await players[0].screenshot({ path: 'screenshots/multitud-revelar.png', fullPage: true });
    if (k < 2) {
      await host.getByRole('button', { name: 'Siguiente respuesta' }).click();
      await timed(`Ronda ${k + 1}: siguiente`, (p) => expect(p.getByTestId('anecdote-index')).toHaveText(`Respuesta ${k + 2} de ${total}`));
    }
  }
  await host.getByRole('button', { name: '⚙️ Opciones del maestro de pista' }).click();
  await host.getByRole('button', { name: 'Terminar ya y ver resultados' }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'Terminar' }).click();
  await timed('Terminar ya → final', (p) => expect(p.getByRole('heading', { name: '¡Fin del espectáculo!' })).toBeVisible());
  await host.screenshot({ path: 'screenshots/multitud-final.png', fullPage: true });
});
