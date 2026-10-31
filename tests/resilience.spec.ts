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

/**
 * Situaciones de la vida real: sin red, WebSocket bloqueado (solo sondeo), expulsión, volver a la
 * partida con el PIN desde otro navegador, entrar tarde, textos y nombres extremos.
 */

async function ctx(browser: Browser, viewport = { width: 390, height: 844 }) {
  const c = await track(browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: 'es-ES' }));
  const page = await c.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  return page;
}

async function create(page: Page, name: string) {
  await page.goto('./#/crear');
  await page.getByLabel('Tu nombre').fill(name);
  await page.getByRole('button', { name: 'Crear sala' }).click();
  return (await page.getByTestId('room-code').textContent())!.trim();
}

async function join(page: Page, code: string, name: string) {
  await page.goto(`./#/sala/${code}`);
  await page.getByLabel('Tu nombre').fill(name);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('room-code')).toHaveText(code);
}

test('sin red, WebSocket bloqueado, expulsión y volver con el PIN', async ({ browser }) => {
  const host = await ctx(browser);
  const code = await create(host, 'Host');
  const pin = (await host.getByTestId('host-pin').textContent())!.trim();

  const ana = await ctx(browser);
  await join(ana, code, 'Ana');

  // Bea sin Realtime: se le cierra todo WebSocket → tiene que funcionar solo con el sondeo
  const bea = await ctx(browser, { width: 375, height: 667 });
  await bea.routeWebSocket(/.*/, (ws) => ws.close());
  await join(bea, code, 'Bea');

  const cris = await ctx(browser);
  await join(cris, code, 'Cris');
  const dani = await ctx(browser);
  await join(dani, code, 'Dani');

  for (const p of [host, ana, bea, cris, dani]) await expect(p.getByTestId('lobby-player')).toHaveCount(5);

  // Expulsar a Dani: vuelve a la portada con un aviso
  await host.getByRole('button', { name: 'Expulsar a Dani' }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'Expulsar' }).click();
  await expect(dani.getByText('Ya no estás en esta sala')).toBeVisible({ timeout: 8000 });
  await expect(dani.getByRole('button', { name: 'Unirme a una sala' })).toBeVisible();
  await expect(dani.getByRole('button', { name: /Volver a mi partida/ })).toHaveCount(0);

  // Bea (solo sondeo) se entera del cambio de fase en ≤ ~3,5 s
  const t0 = Date.now();
  await host.getByRole('button', { name: 'Empezar a escribir' }).click();
  await expect(bea.getByRole('heading', { name: 'Cuenta tu secreto' })).toBeVisible({ timeout: 5000 });
  console.log(`Bea sin WebSocket se enteró en ${Date.now() - t0} ms`);

  // Ana se queda sin red: aviso visible, la partida sigue; al volver se pone al día
  await ana.context().setOffline(true);
  await expect(ana.getByText('Sin conexión, reintentando…')).toBeVisible({ timeout: 8000 });
  for (const [p, t] of [
    [host, 'La del host'],
    [bea, 'La de Bea'],
    [cris, 'La de Cris'],
  ] as const) {
    await p.getByLabel('Tu anécdota').fill(t);
    await p.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(p.getByText('✓ Guardada · puedes editarla')).toBeVisible();
  }
  // Ana escribe sin red: falla con aviso y no pierde el texto
  await ana.getByLabel('Tu anécdota').fill('La de Ana, escrita sin red');
  await ana.getByRole('button', { name: 'Guardar', exact: true }).click();
  // tras el reintento automático, sigue sin red → aviso de que no se ha podido
  await expect(ana.getByText('Sin conexión. Vuelve a intentarlo en un momento.')).toBeVisible();
  await ana.context().setOffline(false);
  await expect(ana.getByText('Sin conexión, reintentando…')).toHaveCount(0, { timeout: 8000 });
  await expect(ana.getByTestId('saved-count')).toHaveText('3 de 4');
  await expect(ana.getByLabel('Tu anécdota')).toHaveValue('La de Ana, escrita sin red');
  await ana.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(host.getByTestId('saved-count')).toHaveText('4 de 4');

  await host.getByRole('button', { name: 'Empezar la votación' }).click();
  for (const p of [host, ana, bea, cris]) await expect(p.getByTestId('anecdote-index')).toHaveText('Anécdota 1 de 4');

  // Alguien intenta entrar ya empezada la votación → mensaje y pista para volver
  const late = await ctx(browser);
  await late.goto(`./#/sala/${code}`);
  await late.getByLabel('Tu nombre').fill('Tardón');
  await late.getByRole('button', { name: 'Entrar' }).click();
  await expect(late.getByText(/ya ha empezado a votar/)).toBeVisible();

  // Cris pierde la sesión (otro navegador) y vuelve con el PIN que teclea el anfitrión
  const cris2 = await ctx(browser);
  await cris2.goto(`./#/sala/${code}`);
  await cris2.getByRole('button', { name: 'Ya estaba jugando y se me ha cerrado' }).click();
  await cris2.getByLabel('Tu nombre en la partida').fill('cris');
  await cris2.getByLabel('PIN del maestro de pista').fill(pin);
  await cris2.getByRole('button', { name: 'Volver a la partida' }).click();
  await expect(cris2.getByTestId('anecdote-index')).toHaveText('Anécdota 1 de 4');

  // El anfitrión ve quién falta por votar; votan todos (Cris desde su móvil nuevo)
  const voters: [Page, string][] = [
    [host, 'Ana'],
    [ana, 'Bea'],
    [bea, 'Cris'],
    [cris2, 'Host'],
  ];
  await expect(host.getByTestId('not-voted')).toContainText('Ana');
  for (const [p, target] of voters) await p.getByTestId('vote-tile').filter({ hasText: target }).click();
  await expect(host.getByTestId('voted-count')).toHaveText('Han votado 4 de 4');
  await expect(host.getByTestId('not-voted')).toHaveCount(0);
  // El móvil antiguo de Cris también ve el voto (es la misma persona)
  await expect(cris.getByTestId('vote-tile').filter({ hasText: 'Host' })).toHaveAttribute('aria-pressed', 'true');

  await host.getByRole('button', { name: 'Revelar' }).click();
  for (const p of [host, ana, bea, cris, cris2]) await expect(p.getByTestId('reveal-author')).toBeVisible();
});

test('textos y nombres extremos no rompen la pantalla', async ({ browser }) => {
  const long = 'Supercalifragil'; // 15
  const host = await ctx(browser, { width: 375, height: 667 });
  const code = await create(host, 'WWWWWWWWWWWWWWWW');
  const names = ['MMMMMMMMMMMMMMMM', 'Ana', `${long}X`, 'María José Pilar'];
  const pages: Page[] = [host];
  for (const n of names) {
    const p = await ctx(browser, { width: 375, height: 667 });
    await join(p, code, n);
    pages.push(p);
  }
  await host.getByRole('button', { name: 'Empezar a escribir' }).click();
  const texts = [
    'A'.repeat(200),
    '😂'.repeat(100),
    'Línea uno\nLínea dos\nLínea tres',
    '<script>alert(1)</script> & "comillas" \'simples\'',
    'Normal y corriente',
  ];
  for (const [i, p] of pages.entries()) {
    await p.getByLabel('Tu anécdota').fill(texts[i]);
    await p.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(p.getByText('✓ Guardada · puedes editarla')).toBeVisible();
  }
  await expect(host.getByTestId('saved-count')).toHaveText('5 de 5');
  await host.getByRole('button', { name: 'Empezar la votación' }).click();
  for (let k = 0; k < 5; k++) {
    await expect(host.getByTestId('anecdote-index')).toHaveText(`Anécdota ${k + 1} de 5`);
    for (const p of pages) {
      // Ninguna pantalla con scroll horizontal
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'scroll horizontal').toBeLessThanOrEqual(0);
    }
    await host.screenshot({ path: `screenshots/extremo-votar-${k}.png`, fullPage: true });
    await host.getByRole('button', { name: 'Revelar' }).click();
    // nadie ha votado: pide confirmación
    await host.getByRole('dialog').getByRole('button', { name: 'Revelar' }).click();
    await expect(host.getByTestId('reveal-author')).toBeVisible();
    await host.waitForTimeout(700);
    const overflow = await host.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await host.screenshot({ path: `screenshots/extremo-revelar-${k}.png`, fullPage: true });
    await host.getByRole('button', { name: k === 4 ? 'Ver resultados' : 'Siguiente anécdota' }).click();
  }
  await expect(host.getByRole('heading', { name: '¡Fin del espectáculo!' })).toBeVisible();
  // el HTML del texto se muestra como texto, nunca se ejecuta
  await host.getByText('Ver todas las anécdotas').click();
  await expect(host.getByText('<script>alert(1)</script>', { exact: false })).toBeVisible();
  await host.waitForTimeout(500);
  await host.screenshot({ path: 'screenshots/extremo-final.png', fullPage: true });
});
