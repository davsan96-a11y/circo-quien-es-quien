import { test, expect, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';

/**
 * Partida completa: 1 anfitrión + 5 jugadores en contextos separados.
 * Cubre: unirse, escribir (y editar), forzar votación con alguien sin escribir, recarga a mitad,
 * cambiar el voto, intento de votarse a sí mismo (servidor), revelar, ranking final contra
 * cálculo manual, fuga del autor en la red antes de revelar y recuperar el anfitrión con PIN.
 */

const SHOTS = 'screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

interface P {
  name: string;
  emoji: string;
  page: Page;
  id?: string;
}

type StateResp = { label: string; body: Record<string, unknown> };
const stateLog: StateResp[] = [];

async function newPlayer(browser: Browser, name: string, emoji: string, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: 'es-ES' });
  const page = await ctx.newPage();
  page.on('response', async (r) => {
    if (r.url().includes('/rpc/qeq_get_state') && r.ok()) {
      try {
        stateLog.push({ label: name, body: await r.json() });
      } catch {
        /* respuesta cortada por recarga */
      }
    }
  });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  return { name, emoji, page } as P;
}

async function fillIdentity(page: Page, name: string, emoji: string) {
  await page.getByLabel('Tu nombre').fill(name);
  await page.getByRole('radio', { name: emoji }).click();
}

async function sessionOf(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('qeq_session_v1') || 'null'));
}

async function shot(p: P, name: string) {
  await p.page.waitForTimeout(700); // animaciones
  await p.page.screenshot({ path: `${SHOTS}/${name}-${p.page.viewportSize()!.width}.png`, fullPage: true });
}

test('partida completa 1 anfitrión + 5 jugadores', async ({ browser }) => {
  // ───── Crear sala
  const host = await newPlayer(browser, 'Maestro', '🎪');
  await host.page.goto('./');
  await shot(host, '01-portada');
  await host.page.getByRole('button', { name: 'Crear sala' }).click();
  await fillIdentity(host.page, host.name, host.emoji);
  await host.page.getByRole('button', { name: 'Crear sala' }).click();
  const code = (await host.page.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-HJ-NPR-Z]{4}$/);
  const pin = (await host.page.getByTestId('host-pin').textContent())!.trim();
  expect(pin).toMatch(/^\d{4}$/);
  host.id = (await sessionOf(host.page)).playerId;

  // ───── 5 jugadores (uno en iPhone SE)
  const specs: [string, string][] = [
    ['Lucía', '🧛'],
    ['Javi', '👻'],
    ['Carmen', '🧙'],
    ['Marcos', '🦇'],
    ['Rosa', '🤡'],
  ];
  const players: P[] = [];
  for (const [i, [n, e]] of specs.entries()) {
    const p = await newPlayer(browser, n, e, i === 0 ? { width: 375, height: 667 } : { width: 390, height: 844 });
    await p.page.goto(`./#/sala/${code}`);
    if (i === 0) await shot(p, '02-unirse');
    await expect(p.page.getByLabel('Código de la sala')).toHaveValue(code);
    await fillIdentity(p.page, n, e);
    await p.page.getByRole('button', { name: 'Entrar' }).click();
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    p.id = (await sessionOf(p.page)).playerId;
    players.push(p);
  }
  const all = [host, ...players];
  const byId = new Map(all.map((p) => [p.id!, p]));

  // Nombre duplicado → error legible
  const dup = await newPlayer(browser, 'dup', '💀');
  await dup.page.goto(`./#/sala/${code}`);
  await fillIdentity(dup.page, 'lucía', '💀');
  await dup.page.getByRole('button', { name: 'Entrar' }).click();
  await expect(dup.page.getByText('Ese nombre ya está cogido')).toBeVisible();
  await dup.page.context().close();

  // Todos ven a los 6 en directo
  for (const p of all) await expect(p.page.getByTestId('lobby-player')).toHaveCount(6);
  await shot(host, '03-sala-espera-anfitrion');
  await shot(players[0], '03-sala-espera-jugador');

  // ───── Escribir
  await host.page.getByRole('button', { name: 'Empezar a escribir' }).click();
  const texts: Record<string, string> = {
    Maestro: 'De pequeño me daban miedo los payasos y ahora soy maestro de pista',
    Lucía: 'Me senté encima de una caca en el campo y no me di cuenta hasta llegar a casa',
    Javi: 'Una vez me quedé encerrado en el baño de un avión durante media hora',
    Carmen: 'Con 8 años me escondí en el armario y me quedé dormida; me buscaron hasta los vecinos',
    Marcos: 'Me caí a la piscina vestido en la boda de mi primo',
  };
  // Rosa no escribe → el anfitrión fuerza la votación
  for (const p of all.filter((p) => p.name !== 'Rosa')) {
    await expect(p.page.getByRole('heading', { name: 'Cuenta tu secreto' })).toBeVisible();
    const draft = p.name === 'Javi' ? 'borrador que luego cambio' : texts[p.name];
    await p.page.getByLabel('Tu anécdota').fill(draft);
    await p.page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(p.page.getByText('✓ Guardada · puedes editarla')).toBeVisible();
    if (p.name === 'Javi') {
      await p.page.getByLabel('Tu anécdota').fill(texts.Javi);
      await p.page.getByRole('button', { name: 'Guardar cambios' }).click();
      await expect(p.page.getByText('✓ Guardada · puedes editarla')).toBeVisible();
    }
  }
  await expect(host.page.getByTestId('saved-count')).toHaveText('5 de 6');
  await expect(players[4].page.getByTestId('saved-count')).toHaveText('5 de 6');

  // Recarga en fase de escritura: sigue en su sala y con su anécdota
  await players[1].page.reload();
  await expect(players[1].page.getByLabel('Tu anécdota')).toHaveValue(texts.Javi);
  await shot(players[0], '04-escribir');
  await shot(host, '04-escribir-anfitrion');

  // Forzar votación con confirmación
  await host.page.getByRole('button', { name: 'Empezar la votación' }).click();
  await expect(host.page.getByText('Faltan 1, ¿empezar igual?')).toBeVisible();
  await shot(host, '05-confirmar-forzar');
  await host.page.getByRole('button', { name: 'Empezar igual' }).click();

  // ───── Votación
  const textToAuthor = new Map(Object.entries(texts).map(([n, t]) => [t, all.find((p) => p.name === n)!]));
  const expected = new Map(all.map((p) => [p.name, 0]));
  const revealIndexStart = new Map<number, number>();

  for (let k = 0; k < 5; k++) {
    for (const p of all) await expect(p.page.getByTestId('anecdote-index')).toHaveText(`Anécdota ${k + 1} de 5`);
    const text = (await host.page.getByTestId('anecdote-text').textContent())!.replace(/[“”]/g, '').trim();
    const author = textToAuthor.get(text)!;
    expect(author, `autor de "${text}"`).toBeTruthy();

    // Solo el autor ve el aviso
    for (const p of all) {
      if (p === author) await expect(p.page.getByTestId('is-mine')).toBeVisible();
      else await expect(p.page.getByTestId('is-mine')).toHaveCount(0);
      // Nadie puede votarse a sí mismo en la UI
      await expect(p.page.getByTestId('vote-tile').filter({ hasText: p.name })).toHaveCount(0);
    }

    // Recarga a mitad de partida (anécdota 2)
    if (k === 1) {
      await players[2].page.reload();
      await expect(players[2].page.getByTestId('anecdote-index')).toHaveText('Anécdota 2 de 5');
    }

    // Intento de votarse a sí mismo saltándose la UI → el servidor lo rechaza
    if (k === 0) {
      const res = await players[0].page.evaluate(async () => {
        const s = JSON.parse(localStorage.getItem('qeq_session_v1')!);
        const env = (window as unknown as { __qeq?: { url: string; key: string } }).__qeq;
        const r = await fetch(`${env!.url}/rest/v1/rpc/qeq_cast_vote`, {
          method: 'POST',
          headers: { apikey: env!.key, Authorization: `Bearer ${env!.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_code: s.roomCode, p_player_id: s.playerId, p_secret: s.secret, p_guessed_player_id: s.playerId }),
        });
        return { status: r.status, body: await r.text() };
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body).toContain('No puedes votarte a ti mismo');
    }

    // Votos: (i + k) par → acierta; impar → falla. El autor vota a otro.
    for (const [i, p] of all.entries()) {
      let target: P;
      const others = all.filter((o) => o !== p);
      if (p === author) target = others[(k + i) % others.length];
      else if ((i + k) % 2 === 0) target = author;
      else target = others.filter((o) => o !== author)[(k + i) % (others.length - 1)];

      // Lucía primero vota mal y luego cambia de opinión
      if (p.name === 'Lucía' && p !== author) {
        const wrong = others.find((o) => o !== author && o !== target)!;
        await p.page.getByTestId('vote-tile').filter({ hasText: wrong.name }).click();
        await expect(p.page.getByTestId('vote-tile').filter({ hasText: wrong.name })).toHaveAttribute('aria-pressed', 'true');
      }
      await p.page.getByTestId('vote-tile').filter({ hasText: target.name }).click();
      await expect(p.page.getByTestId('vote-tile').filter({ hasText: target.name })).toHaveAttribute('aria-pressed', 'true');
      if (p !== author && target === author) expected.set(p.name, expected.get(p.name)! + 1);
    }
    await expect(host.page.getByTestId('voted-count')).toHaveText('Han votado 6 de 6');
    await expect(players[3].page.getByTestId('voted-count')).toHaveText('Han votado 6 de 6');
    if (k === 0) {
      await shot(host, '06-votacion-anfitrion');
      await shot(players[0], '06-votacion');
      if (author !== host) await shot(author, '06-votacion-autor');
    }

    revealIndexStart.set(k, stateLog.length);
    await host.page.getByRole('button', { name: 'Revelar' }).click();
    for (const p of all) await expect(p.page.getByTestId('reveal-author')).toHaveText(`${author.name}!`);
    if (k === 0) {
      await shot(host, '07-revelacion-anfitrion');
      await shot(players[0], '07-revelacion');
    }
    await host.page.getByRole('button', { name: k === 4 ? 'Ver resultados' : 'Siguiente anécdota' }).click();
  }

  // ───── Final
  for (const p of all) await expect(p.page.getByRole('heading', { name: '¡Fin del espectáculo!' })).toBeVisible();
  await shot(host, '08-final-anfitrion');
  await shot(players[0], '08-final');
  await players[0].page.getByText('Ver todas las anécdotas').click();
  await expect(players[0].page.getByText(texts.Carmen, { exact: false })).toBeVisible();
  await shot(players[0], '09-final-anecdotas');

  const finals = stateLog.filter((s) => s.body.phase === 'final');
  const scores = finals[finals.length - 1].body.scores as { name: string; points: number; rank: number }[];
  const got = new Map(scores.map((s) => [s.name, s.points]));
  console.log('Puntos esperados:', Object.fromEntries(expected), 'obtenidos:', Object.fromEntries(got));
  for (const [n, pts] of expected) expect(got.get(n), `puntos de ${n}`).toBe(pts);
  // Empates comparten puesto
  for (const s of scores) expect(s.rank).toBe(1 + scores.filter((o) => o.points > s.points).length);

  // ───── Seguridad: el autor nunca aparece en la red antes de revelar
  const voting = stateLog.filter((s) => s.body.phase === 'voting');
  expect(voting.length).toBeGreaterThan(20);
  for (const s of voting) {
    expect(s.body).not.toHaveProperty('author');
    expect(s.body).not.toHaveProperty('votes');
    expect(s.body).not.toHaveProperty('scores');
    expect(JSON.stringify(s.body)).not.toContain('player_id');
  }
  for (const s of stateLog.filter((x) => x.body.phase === 'writing' && x.label !== 'Lucía')) {
    expect(JSON.stringify(s.body)).not.toContain(texts.Lucía.slice(0, 20));
  }
  // is_mine solo es true en el móvil del autor
  for (const s of voting.filter((x) => x.body.is_mine === true)) {
    const anecText = (s.body.anecdote as { text: string }).text;
    expect(textToAuthor.get(anecText)!.name).toBe(s.label);
  }
  // Leer tablas directamente con la clave pública → denegado
  const direct = await host.page.evaluate(async () => {
    const env = (window as unknown as { __qeq: { url: string; key: string } }).__qeq;
    const out: Record<string, number | string> = {};
    for (const t of ['qeq_anecdotes', 'qeq_votes', 'qeq_players', 'qeq_rooms']) {
      const r = await fetch(`${env.url}/rest/v1/${t}?select=*`, { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } });
      out[t] = r.status === 200 ? (await r.text()) : r.status;
    }
    return out;
  });
  console.log('Lectura directa de tablas:', direct);
  for (const v of Object.values(direct)) expect(v === '[]' || (typeof v === 'number' && v >= 400)).toBeTruthy();

  // ───── Salir al menú y volver; al reabrir la web vuelve sola a la partida
  const lucia = players[0].page;
  await lucia.getByRole('button', { name: '‹ Salir al menú' }).click();
  await expect(lucia.getByRole('button', { name: 'Crear sala' })).toBeVisible();
  await shot(players[0], '10-portada-con-partida');
  await lucia.getByRole('button', { name: `Volver a mi partida · sala ${code}` }).click();
  await expect(lucia.getByRole('heading', { name: '¡Fin del espectáculo!' })).toBeVisible();
  await lucia.goto('./');
  await expect(lucia.getByRole('heading', { name: '¡Fin del espectáculo!' })).toBeVisible();

  // ───── Recuperar anfitrión desde un móvil nuevo con el PIN
  const rescue = await newPlayer(browser, 'rescate', '🎩', { width: 375, height: 667 });
  await rescue.page.goto(`./#/sala/${code}`);
  await rescue.page.getByRole('button', { name: 'Soy el anfitrión y he perdido mi móvil' }).click();
  await rescue.page.getByLabel('PIN de anfitrión').fill(pin === '0000' ? '1111' : '0000');
  await rescue.page.getByRole('button', { name: 'Recuperar el control' }).click();
  await expect(rescue.page.getByText('PIN incorrecto')).toBeVisible();
  await rescue.page.getByLabel('PIN de anfitrión').fill(pin);
  await rescue.page.getByRole('button', { name: 'Recuperar el control' }).click();
  await expect(rescue.page.getByRole('button', { name: 'Jugar otra vez' })).toBeVisible();

  // Un jugador ya dentro también puede reclamar el control con el PIN
  await players[3].page.goto(`./#/anfitrion/${code}`);
  await players[3].page.getByLabel('PIN de anfitrión').fill(pin);
  await players[3].page.getByRole('button', { name: 'Recuperar el control' }).click();
  await expect(players[3].page.getByRole('button', { name: 'Jugar otra vez' })).toBeVisible();
  await expect(host.page.getByRole('button', { name: 'Jugar otra vez' })).toHaveCount(0);

  // Jugar otra vez (con confirmación) → todos vuelven a la sala de espera
  await players[3].page.getByRole('button', { name: 'Jugar otra vez' }).click();
  await players[3].page.getByRole('dialog').getByRole('button', { name: 'Jugar otra vez' }).click();
  for (const p of all) await expect(p.page.getByTestId('lobby-player')).toHaveCount(6);

  // Olvidar la partida: ya no vuelve sola al reabrir
  await lucia.getByRole('button', { name: '‹ Salir al menú' }).click();
  await lucia.getByRole('button', { name: 'Olvidar esta partida' }).click();
  await lucia.getByRole('dialog').getByRole('button', { name: 'Olvidar' }).click();
  await expect(lucia.getByRole('button', { name: /Volver a mi partida/ })).toHaveCount(0);
  await lucia.reload();
  await expect(lucia.getByRole('button', { name: 'Unirme a una sala' })).toBeVisible();
  void byId;
  void revealIndexStart;
});
