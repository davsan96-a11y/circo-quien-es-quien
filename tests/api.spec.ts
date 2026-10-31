import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

/**
 * Pruebas del servidor (RPC) sin navegador: validaciones, permisos, fases, seguridad,
 * idempotencia, PIN, concurrencia y puntuación.
 */

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => l.trim().split(/=(.*)/s).slice(0, 2)),
);
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

type Cred = { code: string; player_id: string; secret: string; host_pin?: string; name: string };

async function call<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function fails(fn: string, args: Record<string, unknown>, msg: RegExp) {
  const { data, error } = await sb.rpc(fn, args);
  const text = error?.message ?? (data as { error?: string })?.error;
  expect(text, `${fn} debería fallar con ${msg}`).toMatch(msg);
}
const who = (c: Cred) => ({ p_code: c.code, p_player_id: c.player_id, p_secret: c.secret });
const state = (c: Cred) => call<Record<string, any>>('qeq_get_state', who(c)); // eslint-disable-line @typescript-eslint/no-explicit-any

async function room(n: number, opts: { mode?: string; count?: number; liar?: boolean } = {}) {
  const h = await call<Cred>('qeq_create_room', { p_name: 'Host', p_emoji: '🎪' });
  h.name = 'Host';
  const ps: Cred[] = [h];
  for (let i = 1; i < n; i++) {
    const j = await call<Cred>('qeq_join_room', { p_code: h.code, p_name: `P${i}`, p_emoji: '👻' });
    ps.push({ ...j, code: h.code, name: `P${i}` });
  }
  if (opts.mode) await call('qeq_set_mode', { ...who(h), p_mode: opts.mode, p_count: opts.count ?? 1 });
  if (opts.liar) await call('qeq_set_liar_bonus', { ...who(h), p_on: true });
  return ps;
}

test.describe.configure({ mode: 'serial' });

test('validaciones al crear y unirse', async () => {
  await fails('qeq_create_room', { p_name: '   ', p_emoji: '🎃' }, /Escribe tu nombre/);
  await fails('qeq_create_room', { p_name: 'x'.repeat(17), p_emoji: '🎃' }, /demasiado largo/);
  await fails('qeq_create_room', { p_name: 'Ana', p_emoji: '' }, /Elige un personaje/);
  const [h] = await room(1);
  expect(h.code).toMatch(/^[A-HJ-NPR-Z]{4}$/);
  expect(h.host_pin).toMatch(/^\d{4}$/);
  await fails('qeq_join_room', { p_code: 'ZZZZ1', p_name: 'Ana', p_emoji: '🎃' }, /no existe/);
  // código en minúsculas y con espacios: funciona
  await call('qeq_join_room', { p_code: ` ${h.code.toLowerCase()} `, p_name: '  Ana   María ', p_emoji: '🎃' });
  await fails('qeq_join_room', { p_code: h.code, p_name: 'ana maría', p_emoji: '🎃' }, /cogido/);
  await fails('qeq_join_room', { p_code: h.code, p_name: 'HOST', p_emoji: '🎃' }, /cogido/);
  const s = await state(h);
  expect(s.players.map((p: { name: string }) => p.name)).toEqual(['Host', 'Ana María']);
});

test('máximo 30 jugadores y nombres simultáneos', async () => {
  const [h] = await room(1);
  // 20 personas intentan coger el mismo nombre a la vez: solo una lo consigue
  const same = await Promise.all(
    Array.from({ length: 20 }, () => sb.rpc('qeq_join_room', { p_code: h.code, p_name: 'Pepe', p_emoji: '💀' })),
  );
  expect(same.filter((r) => !r.error).length).toBe(1);
  expect(same.filter((r) => r.error).every((r) => /cogido/.test(r.error!.message))).toBe(true);
  const rest = await Promise.all(
    Array.from({ length: 30 }, (_, i) => sb.rpc('qeq_join_room', { p_code: h.code, p_name: `J${i}`, p_emoji: '💀' })),
  );
  expect(rest.filter((r) => !r.error).length).toBe(28); // host + Pepe + 28 = 30
  expect(rest.filter((r) => r.error).every((r) => /llena/.test(r.error!.message))).toBe(true);
});

test('permisos: solo el anfitrión, secreto correcto y su propia sala', async () => {
  const [h, a, b] = await room(3);
  const [h2] = await room(1);
  for (const [fn, extra] of [
    ['qeq_start_writing', {}],
    ['qeq_start_voting', {}],
    ['qeq_reveal', {}],
    ['qeq_next', {}],
    ['qeq_restart', {}],
    ['qeq_finish_early', {}],
    ['qeq_set_liar_bonus', { p_on: true }],
    ['qeq_set_mode', { p_mode: 'questions', p_count: 2 }],
    ['qeq_kick_player', { p_target: b.player_id }],
  ] as const)
    await fails(fn, { ...who(a), ...extra }, /maestro de pista/);
  await fails('qeq_get_state', { ...who(a), p_secret: crypto.randomUUID() }, /Ya no estás/);
  // jugador de una sala usando el código de otra
  await fails('qeq_get_state', { ...who(a), p_code: h2.code }, /Ya no estás/);
  await fails('qeq_start_writing', { ...who(h), p_code: h2.code }, /Ya no estás/);
  expect((await state(a)).host_pin).toBeUndefined();
  expect((await state(h)).host_pin).toBe(h.host_pin);
});

test('seguridad: tablas cerradas, señal mínima, funciones internas no accesibles', async () => {
  for (const t of ['qeq_rooms', 'qeq_players', 'qeq_anecdotes', 'qeq_votes', 'qeq_prompts']) {
    const { data, error } = await sb.from(t).select('*').limit(1);
    expect(error || (data && data.length === 0), t).toBeTruthy();
    const ins = await sb.from(t).insert({}).select();
    expect(ins.error, `insert ${t}`).toBeTruthy();
  }
  const sig = await sb.from('qeq_room_signal').select('*').limit(1);
  expect(sig.error).toBeNull();
  if (sig.data!.length) expect(Object.keys(sig.data![0]).sort()).toEqual(['code', 'version']);
  const insSig = await sb.from('qeq_room_signal').insert({ code: 'XXXX', version: 1 });
  expect(insSig.error).toBeTruthy();
  const upd = await sb.from('qeq_room_signal').update({ version: 999 }).neq('code', '').select();
  expect(upd.error || upd.data?.length === 0).toBeTruthy();
  for (const fn of ['qeq__auth', 'qeq__scores', 'qeq__bump', 'qeq__check_pin', 'qeq__assign_questions', 'qeq__question_bank']) {
    const { error } = await sb.rpc(fn, {});
    expect(error, fn).toBeTruthy();
  }
});

test('fases: escribir, validar textos, votar y revelar', async () => {
  const ps = await room(4);
  const [h, a, b, c] = ps;
  await fails('qeq_save_anecdote', { ...who(a), p_text: 'hola' }, /Ya no se pueden/);
  await fails('qeq_start_voting', who(h), /fase de escribir/);
  // < 3 jugadores no puede empezar
  const [h2, x] = await room(2);
  await fails('qeq_start_writing', who(h2), /al menos 3/);
  void x;

  await call('qeq_start_writing', who(h));
  expect((await call('qeq_start_writing', who(h))).noop).toBe(true); // doble toque
  await fails('qeq_save_anecdote', { ...who(a), p_text: '   ' }, /Escribe algo/);
  await fails('qeq_save_anecdote', { ...who(a), p_text: 'x'.repeat(201) }, /200/);
  await call('qeq_save_anecdote', { ...who(a), p_text: 'é'.repeat(200) });
  await call('qeq_save_anecdote', { ...who(a), p_text: '  Línea 1\nLínea 2  ' });
  expect((await state(a)).my_anecdote).toBe('Línea 1\nLínea 2');
  await fails('qeq_save_answer', { ...who(a), p_slot: 0, p_text: 'x' }, /anécdota/);
  await call('qeq_save_anecdote', { ...who(b), p_text: 'de B' });
  await fails('qeq_start_voting', who(h), /al menos 3/);
  await call('qeq_save_anecdote', { ...who(c), p_text: 'de C' });
  // nadie ve el texto de otros durante la escritura
  expect(JSON.stringify(await state(h))).not.toContain('de B');
  await call('qeq_start_voting', who(h));
  expect((await call('qeq_start_voting', who(h))).noop).toBe(true);
  await fails('qeq_save_anecdote', { ...who(a), p_text: 'tarde' }, /Ya no se pueden/);
  await fails('qeq_join_room', { p_code: h.code, p_name: 'Tarde', p_emoji: '🎃' }, /empezado/);
  await fails('qeq_kick_player', { ...who(h), p_target: a.player_id }, /Ya no se puede expulsar/);

  const s = await state(b);
  expect(s.total).toBe(3);
  expect(s).not.toHaveProperty('author');
  await fails('qeq_cast_vote', { ...who(b), p_guessed_player_id: b.player_id }, /ti mismo/);
  const [, other] = await room(2);
  await fails('qeq_cast_vote', { ...who(b), p_guessed_player_id: other.player_id }, /no está en la sala/);
  // cambiar el voto 10 veces a la vez: cuenta una sola vez
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      call('qeq_cast_vote', { ...who(b), p_guessed_player_id: [a, c, h][i % 3].player_id }),
    ),
  );
  expect((await state(b)).voted_count).toBe(1);
  await fails('qeq_next', who(h), /Primero hay que revelar/);
  await call('qeq_reveal', { ...who(h), p_index: 0 });
  expect((await call('qeq_reveal', { ...who(h), p_index: 0 })).noop).toBe(true);
  await fails('qeq_cast_vote', { ...who(c), p_guessed_player_id: a.player_id }, /no se puede votar/);
  await call('qeq_next', { ...who(h), p_index: 0 });
  // segundo "siguiente" con el mismo índice (doble toque): no avanza otra vez
  expect((await call('qeq_next', { ...who(h), p_index: 0 })).noop).toBe(true);
  expect((await state(h)).index).toBe(1);
  // revelar con índice antiguo: no hace nada
  expect((await call('qeq_reveal', { ...who(h), p_index: 0 })).noop).toBe(true);
  expect((await state(h)).phase).toBe('voting');
});

test('expulsar en la sala/escritura y el expulsado pierde el acceso', async () => {
  const [h, a, b, c] = await room(4);
  await fails('qeq_kick_player', { ...who(h), p_target: h.player_id }, /ti mismo/);
  await call('qeq_start_writing', who(h));
  await call('qeq_save_anecdote', { ...who(c), p_text: 'me van a echar' });
  await call('qeq_kick_player', { ...who(h), p_target: c.player_id });
  await fails('qeq_get_state', who(c), /Ya no estás/);
  const s = await state(h);
  expect(s.players.length).toBe(3);
  expect(s.saved_player_ids).toEqual([]);
  void a;
  void b;
});

test('PIN: recuperar anfitrión, recuperar jugador y bloqueo anti fuerza bruta', async () => {
  const [h, a, b] = await room(3);
  const wrong = h.host_pin === '0000' ? '1111' : '0000';
  await fails('qeq_recover_player', { p_code: h.code, p_pin: h.host_pin, p_name: 'Nadie' }, /No hay nadie/);
  const rp = await call<Cred>('qeq_recover_player', { p_code: h.code, p_pin: h.host_pin, p_name: ' p1 ' });
  expect(rp.player_id).toBe(a.player_id);
  expect(rp.secret).toBe(a.secret);
  const rh = await call<Cred>('qeq_recover_host', { p_code: h.code, p_pin: h.host_pin });
  expect(rh.player_id).toBe(h.player_id);
  // b pasa a ser anfitrión; el anterior ya no puede mandar
  await call('qeq_reclaim_host', { p_code: h.code, p_pin: h.host_pin, p_player_id: b.player_id, p_secret: b.secret });
  expect((await state(b)).is_host).toBe(true);
  await fails('qeq_start_writing', who(h), /maestro de pista/);
  // 5 fallos → bloqueado un minuto, incluso con el PIN correcto
  for (let i = 0; i < 4; i++) await fails('qeq_recover_host', { p_code: h.code, p_pin: wrong }, /PIN incorrecto/);
  await fails('qeq_recover_host', { p_code: h.code, p_pin: wrong }, /PIN incorrecto/);
  await fails('qeq_recover_host', { p_code: h.code, p_pin: h.host_pin }, /Demasiados intentos/);
  await fails('qeq_recover_player', { p_code: h.code, p_pin: h.host_pin, p_name: 'P1' }, /Demasiados intentos/);
});

test('terminar antes y reiniciar', async () => {
  const [h, a, b] = await room(3);
  await call('qeq_start_writing', who(h));
  for (const p of [h, a, b]) await call('qeq_save_anecdote', { ...who(p), p_text: `soy ${p.name}` });
  await call('qeq_start_voting', who(h));
  await fails('qeq_finish_early', who(h), /ninguna/);
  await call('qeq_reveal', { ...who(h), p_index: 0 });
  await call('qeq_finish_early', who(h));
  const f = await state(a);
  expect(f.phase).toBe('final');
  expect(f.all_anecdotes.length).toBe(1);
  await fails('qeq_set_mode', { ...who(h), p_mode: 'questions', p_count: 1 }, /sala de espera/);
  await call('qeq_restart', who(h));
  const l = await state(h);
  expect(l.phase).toBe('lobby');
  expect(l.players.length).toBe(3);
  await fails('qeq_set_mode', { ...who(h), p_mode: 'karaoke', p_count: 1 }, /desconocido/);
  await call('qeq_set_mode', { ...who(h), p_mode: 'questions', p_count: 9 });
  expect((await state(h)).questions_per_player).toBe(3);
});

test('modo preguntas: reparto, respuestas, cambiar pregunta y quien entra tarde', async () => {
  const ps = await room(10, { mode: 'questions', count: 3 });
  const [h, a] = ps;
  await fails('qeq_save_answer', { ...who(a), p_slot: 0, p_text: 'x' }, /Ya no se pueden/);
  await call('qeq_start_writing', who(h));
  const all = await Promise.all(ps.map(state));
  const qs = all.flatMap((s) => s.my_questions.map((q: { question: string }) => q.question));
  expect(qs.length).toBe(30);
  expect(new Set(qs).size).toBe(30); // 30 preguntas distintas en la sala
  await fails('qeq_save_anecdote', { ...who(a), p_text: 'x' }, /preguntas/);
  await fails('qeq_save_answer', { ...who(a), p_slot: 5, p_text: 'x' }, /no es tuya/);
  await call('qeq_save_answer', { ...who(a), p_slot: 1, p_text: 'respuesta' });
  const before = (await state(a)).my_questions[1].question;
  const rr = await call<{ question: string }>('qeq_reroll_question', { ...who(a), p_slot: 1 });
  const after = (await state(a)).my_questions;
  expect(after[1].question).toBe(rr.question);
  expect(after[1].question).not.toBe(before);
  expect(after[1].answer).toBeNull();
  // entra alguien durante la fase de responder: recibe sus 3 preguntas
  const late = await call<Cred>('qeq_join_room', { p_code: h.code, p_name: 'Tarde', p_emoji: '🎃' });
  const ls = await state({ ...late, code: h.code, name: 'Tarde' });
  expect(ls.my_questions.length).toBe(3);
  // "ha guardado" = ha respondido todas
  for (let s = 0; s < 3; s++) await call('qeq_save_answer', { ...who(h), p_slot: s, p_text: `h${s}` });
  const hs = await state(h);
  expect(hs.saved_player_ids).toEqual([h.player_id]);
  expect(hs.answer_count).toBe(3);
  await call('qeq_start_voting', who(h));
  const v = await state(a);
  expect(v.total).toBe(3);
  expect(v.anecdote.question).toBeTruthy();
  // restart borra preguntas
  await call('qeq_restart', who(h));
  await call('qeq_set_mode', { ...who(h), p_mode: 'questions', p_count: 1 });
  await call('qeq_start_writing', who(h));
  expect((await state(a)).my_questions.length).toBe(1);
});

test('puntuación con bonus engañador coincide con el cálculo manual', async () => {
  const ps = await room(6, { liar: true });
  const [h] = ps;
  await call('qeq_start_writing', who(h));
  for (const p of ps) await call('qeq_save_anecdote', { ...who(p), p_text: `anécdota de ${p.name}` });
  await call('qeq_start_voting', who(h));
  const authorOf = (text: string) => ps.find((p) => text === `anécdota de ${p.name}`)!;
  const expected = new Map(ps.map((p) => [p.player_id, 0]));
  for (let k = 0; k < 6; k++) {
    const s = await state(h);
    const author = authorOf(s.anecdote.text);
    let wrong = 0;
    for (const [i, p] of ps.entries()) {
      if ((i + k) % 5 === 4) continue; // alguno no vota
      const others = ps.filter((o) => o !== p);
      const target = p === author ? others[0] : (i * 7 + k) % 3 === 0 ? author : others.filter((o) => o !== author)[(i + k) % 4];
      await call('qeq_cast_vote', { ...who(p), p_guessed_player_id: target.player_id });
      if (p !== author) {
        if (target === author) expected.set(p.player_id, expected.get(p.player_id)! + 1);
        else wrong++;
      }
    }
    expected.set(author.player_id, expected.get(author.player_id)! + Math.min(3, wrong));
    await call('qeq_reveal', { ...who(h), p_index: k });
    const r = await state(ps[3]);
    for (const sc of r.scores) expect(sc.points, `tras ${k + 1}`).toBe(expected.get(sc.player_id));
    await call('qeq_next', { ...who(h), p_index: k });
  }
  const f = await state(h);
  expect(f.phase).toBe('final');
  for (const sc of f.scores) {
    expect(sc.points).toBe(expected.get(sc.player_id));
    expect(sc.rank).toBe(1 + f.scores.filter((o: { points: number }) => o.points > sc.points).length);
  }
});

test.afterAll(async () => {
  // Las salas de prueba se borran al final de la sesión con SQL (anon no puede borrar).
});
