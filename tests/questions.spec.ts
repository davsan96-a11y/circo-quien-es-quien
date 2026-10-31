import { test, expect, type Browser, type Page } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';

// Cada prueba cierra sus navegadores al acabar: el navegador se comparte entre pruebas y las páginas
// abiertas de pruebas anteriores (p. ej. las 22 de la multitud) le robarían CPU a las siguientes.
const openContexts: BrowserContext[] = [];
async function track(c: Promise<BrowserContext>) {
  const ctx = await c;
  openContexts.push(ctx);
  return ctx;
}
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => {})));
});
import fs from 'node:fs';

/**
 * Modo "Preguntas": 1 anfitrión + 4 jugadores, 2 preguntas por jugador.
 * Cubre: elegir modo, cambiar pregunta (con y sin respuesta), borrador tras recarga, alguien que
 * no responde todo, doble toque en "Revelar", "Terminar ya", puntuación, fuga del autor en la red,
 * y "Jugar otra vez" cambiando a anécdotas sin que reaparezcan borradores.
 */

const SHOTS = 'screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

interface P {
  name: string;
  emoji: string;
  page: Page;
  questions: string[];
}
const stateLog: { label: string; body: Record<string, unknown> }[] = [];

async function newPlayer(browser: Browser, name: string, emoji: string, viewport = { width: 390, height: 844 }) {
  const ctx = await track(browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: 'es-ES' }));
  const page = await ctx.newPage();
  page.on('response', async (r) => {
    if (r.url().includes('/rpc/qeq_get_state') && r.ok()) {
      try {
        stateLog.push({ label: name, body: await r.json() });
      } catch {
        /* recarga */
      }
    }
  });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  return { name, emoji, page, questions: [] } as P;
}

async function shot(p: P, name: string) {
  await p.page.waitForTimeout(700);
  await p.page.screenshot({ path: `${SHOTS}/q-${name}-${p.page.viewportSize()!.width}.png`, fullPage: true });
}

test('modo preguntas completo', async ({ browser }) => {
  const host = await newPlayer(browser, 'Maestro', '🎪');
  await host.page.goto('./');
  await host.page.getByRole('button', { name: 'Crear sala' }).click();
  await host.page.getByLabel('Tu nombre').fill(host.name);
  await host.page.getByRole('radio', { name: host.emoji }).click();
  await host.page.getByRole('button', { name: 'Crear sala' }).click();
  const code = (await host.page.getByTestId('room-code').textContent())!.trim();

  const players: P[] = [];
  for (const [i, [n, e]] of ([['Ana', '👻'], ['Beto', '🤡'], ['Cris', '🧙'], ['Dani', '🦇']] as const).entries()) {
    const p = await newPlayer(browser, n, e, i === 0 ? { width: 375, height: 667 } : { width: 390, height: 844 });
    await p.page.goto(`./#/sala/${code}`);
    await p.page.getByLabel('Tu nombre').fill(n);
    await p.page.getByRole('radio', { name: e }).click();
    await p.page.getByRole('button', { name: 'Entrar' }).click();
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    players.push(p);
  }
  const all = [host, ...players];
  const [ana, beto, cris, dani] = players;

  // ───── Elegir modo Preguntas, 2 por jugador
  await host.page.getByRole('radio', { name: /Preguntas/ }).click();
  await host.page.getByRole('radiogroup', { name: 'Preguntas por jugador' }).getByRole('radio', { name: '2' }).click();
  for (const p of players) await expect(p.page.getByTestId('mode-label')).toHaveText('Modo: ❓ Preguntas · 2 por jugador');
  await shot(host, 'sala-modo');
  await host.page.getByRole('button', { name: 'Empezar a responder' }).click();

  // ───── Responder
  for (const p of all) {
    await expect(p.page.getByRole('heading', { name: 'Responde tus preguntas' })).toBeVisible();
    await expect(p.page.getByTestId('question-card')).toHaveCount(2);
  }
  const qText = (p: P, slot: number) => p.page.getByTestId('question-card').nth(slot).getByTestId('question-text');

  // Ana cambia su pregunta 1 sin haber respondido (sin confirmación)
  const anaQ0 = (await qText(ana, 0).textContent())!;
  await ana.page.getByTestId('question-card').nth(0).getByRole('button', { name: '🔄 Otra pregunta' }).click();
  await expect(qText(ana, 0)).not.toHaveText(anaQ0);
  const anaQ1 = (await qText(ana, 1).textContent())!;
  await expect(qText(ana, 0)).not.toHaveText(anaQ1);

  // Beto responde y luego cambia la pregunta: confirma y se borra la respuesta
  const betoCard0 = beto.page.getByTestId('question-card').nth(0);
  await beto.page.getByLabel('Respuesta 1').fill('respuesta que voy a perder');
  await betoCard0.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(betoCard0.getByText('✓ Guardada · puedes editarla')).toBeVisible();
  await betoCard0.getByRole('button', { name: '🔄 Otra pregunta' }).click();
  await beto.page.getByRole('dialog').getByRole('button', { name: 'Cambiar' }).click();
  await expect(beto.page.getByLabel('Respuesta 1')).toHaveValue('');

  // Cris escribe sin guardar y recarga: el borrador sigue ahí
  await cris.page.getByLabel('Respuesta 2').fill('borrador sin guardar');
  await cris.page.reload();
  await expect(cris.page.getByLabel('Respuesta 2')).toHaveValue('borrador sin guardar');

  const answerOf = new Map<string, P>();
  for (const p of all) {
    const slots = p === dani ? [0] : [0, 1];
    for (const slot of slots) {
      const card = p.page.getByTestId('question-card').nth(slot);
      const text = `${p.name} responde la ${slot + 1}`;
      p.questions[slot] = (await card.getByTestId('question-text').textContent())!;
      await p.page.getByLabel(`Respuesta ${slot + 1}`).fill(text);
      await card.getByRole('button', { name: /^Guardar/ }).click();
      await expect(card.getByText('✓ Guardada · puedes editarla')).toBeVisible();
      answerOf.set(text, p);
    }
  }
  await expect(host.page.getByTestId('saved-count')).toHaveText('4 de 5');
  await expect(host.page.getByText(/PIN \d{4}/)).toBeVisible(); // PIN siempre visible para el anfitrión
  await shot(ana, 'responder');

  // Las preguntas de cada uno son distintas entre sí
  const allQs = all.flatMap((p) => p.questions.filter(Boolean));
  expect(new Set(allQs).size).toBe(allQs.length);

  await host.page.getByRole('button', { name: 'Empezar la votación' }).click();
  await host.page.getByRole('button', { name: 'Empezar igual' }).click();

  // ───── Votación (4 respuestas y luego "Terminar ya")
  const expected = new Map(all.map((p) => [p.name, 0]));
  for (let k = 0; k < 4; k++) {
    for (const p of all) await expect(p.page.getByTestId('anecdote-index')).toHaveText(`Respuesta ${k + 1} de 9`);
    const text = (await host.page.getByTestId('anecdote-text').textContent())!.replace(/[“”]/g, '').trim();
    const author = answerOf.get(text)!;
    expect(author, text).toBeTruthy();
    const slot = Number(text.slice(-1)) - 1;
    await expect(host.page.getByTestId('anecdote-question')).toHaveText(author.questions[slot]);

    for (const [i, p] of all.entries()) {
      const others = all.filter((o) => o !== p);
      let target: P;
      if (p === author) target = others[k % others.length];
      else if ((i + k) % 2 === 0) target = author;
      else target = others.filter((o) => o !== author)[k % (others.length - 1)];
      await p.page.getByTestId('vote-tile').filter({ hasText: target.name }).click();
      await expect(p.page.getByTestId('vote-tile').filter({ hasText: target.name })).toHaveAttribute('aria-pressed', 'true');
      if (p !== author && target === author) expected.set(p.name, expected.get(p.name)! + 1);
    }
    await expect(host.page.getByTestId('voted-count')).toHaveText('Han votado 5 de 5');
    if (k === 0) {
      await shot(ana, 'votar');
      // Doble toque en "Revelar": no debe saltarse la revelación
      await host.page.getByRole('button', { name: 'Revelar' }).dblclick();
      await host.page.waitForTimeout(1500);
      for (const p of all) await expect(p.page.getByTestId('reveal-author')).toHaveText(`${author.name}!`);
      await shot(ana, 'revelar');
    } else {
      await host.page.getByRole('button', { name: 'Revelar' }).click();
      for (const p of all) await expect(p.page.getByTestId('reveal-author')).toHaveText(`${author.name}!`);
    }
    if (k < 3) await host.page.getByRole('button', { name: 'Siguiente respuesta' }).click();
  }

  // ───── Terminar ya
  await host.page.getByRole('button', { name: '⚙️ Opciones del maestro de pista' }).click();
  await host.page.getByRole('button', { name: 'Terminar ya y ver resultados' }).click();
  await host.page.getByRole('dialog').getByRole('button', { name: 'Terminar' }).click();
  for (const p of all) await expect(p.page.getByRole('heading', { name: '¡Fin del espectáculo!' })).toBeVisible();
  await ana.page.getByText('Ver todas las respuestas').click();
  await shot(ana, 'final');

  const finals = stateLog.filter((s) => s.body.phase === 'final');
  const last = finals[finals.length - 1].body;
  expect((last.all_anecdotes as unknown[]).length).toBe(4);
  for (const a of last.all_anecdotes as { question: string }[]) expect(a.question).toBeTruthy();
  const got = new Map((last.scores as { name: string; points: number }[]).map((s) => [s.name, s.points]));
  console.log('Preguntas · esperados:', Object.fromEntries(expected), 'obtenidos:', Object.fromEntries(got));
  for (const [n, pts] of expected) expect(got.get(n), n).toBe(pts);

  // Nada de autor antes de revelar; las preguntas de otros nunca llegan en la fase de escribir
  for (const s of stateLog.filter((x) => x.body.phase === 'voting')) {
    expect(JSON.stringify(s.body)).not.toMatch(/"(player_id|author|author_id|guessed_player_id|correct)"/);
  }
  for (const s of stateLog.filter((x) => x.body.phase === 'writing')) {
    const mine = (s.body.my_questions as { question: string }[] | undefined) ?? [];
    const owner = all.find((p) => p.name === s.label)!;
    for (const q of mine) expect(q.question).toBeTruthy();
    for (const other of all.filter((p) => p !== owner))
      for (const q of other.questions.filter(Boolean))
        if (!owner.questions.includes(q)) expect(JSON.stringify(s.body)).not.toContain(q);
  }

  // ───── Jugar otra vez → Anécdotas: no reaparece ningún borrador
  await host.page.getByRole('button', { name: 'Jugar otra vez' }).click();
  await host.page.getByRole('dialog').getByRole('button', { name: 'Jugar otra vez' }).click();
  await host.page.getByRole('radio', { name: /Anécdotas/ }).click();
  for (const p of players) await expect(p.page.getByTestId('mode-label')).toHaveText('Modo: 📜 Anécdotas');
  await host.page.getByRole('button', { name: 'Empezar a escribir' }).click();
  for (const p of all) await expect(p.page.getByLabel('Tu anécdota')).toHaveValue('');
});
