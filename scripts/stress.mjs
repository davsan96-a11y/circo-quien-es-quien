// Prueba de carga en tiempo real: N clientes independientes (cada uno con su WebSocket) juegan una
// partida completa con la misma lógica de sincronización que la app:
//   postgres_changes sobre qeq_room_signal + broadcast "bump" + sondeo de versión cada 3 s.
// Mide cuánto tarda cada cambio del anfitrión/votos en llegar a TODOS los clientes.
//
// Uso: node scripts/stress.mjs [jugadores=30] [rondas=5] [pgChanges=0] [variante=v4]
//   variante v4 (por defecto, la de la app): aviso por broadcast enviado desde la BD + agrupación + sondeo
//   v1: postgres_changes + broadcast del cliente sin agrupar (la versión inicial, para comparar)
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const N = Number(process.argv[2] || 30);
const ROUNDS = Number(process.argv[3] || 5);
const NO_RT = process.argv[4] !== '1'; // por defecto sin postgres_changes
// v2 = como la app nueva: sin broadcast redundante y agrupando ráfagas de eventos (debounce)
const V2 = process.argv[5] !== 'v1';
// v4 = el aviso lo manda la base de datos (trigger → realtime.send); el cliente no envía nada
const V4 = (process.argv[5] || 'v4') === 'v4';
const DEBOUNCE = 150;
const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => l.trim().split(/=(.*)/s).slice(0, 2)),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { rpcErrors: [], rtEvents: 0, bumps: 0, polls: 0, pollHits: 0, fetches: 0, channelErrors: [] };

class Client {
  constructor(name) {
    this.name = name;
    this.sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    this.version = -1;
    this.state = null;
    this.seen = new Map(); // version -> ms en que la recibió
    this.inflight = false;
    this.again = false;
  }
  async rpc(fn, args) {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) {
      stats.rpcErrors.push(`${this.name} ${fn}: ${error.message}`);
      throw new Error(error.message);
    }
    return data;
  }
  who() {
    return { p_code: this.code, p_player_id: this.id, p_secret: this.secret };
  }
  /** Para eventos: agrupa ráfagas (muchos votos seguidos) en un único refetch */
  schedule() {
    if (!V2) return this.refresh();
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, DEBOUNCE);
  }
  /** Devuelve una promesa que se resuelve cuando hay un estado posterior a la llamada */
  refresh() {
    if (this.inflight) {
      this.again = true;
      return this.loop;
    }
    this.inflight = true;
    this.loop = this._run();
    return this.loop;
  }
  async _run() {
    try {
      do {
        this.again = false;
        stats.fetches++;
        const s = await this.rpc('qeq_get_state', this.who());
        if (s.version >= this.version) {
          this.version = s.version;
          this.state = s;
          if (!this.seen.has(s.version)) this.seen.set(s.version, Date.now());
        }
      } while (this.again);
    } catch {
      /* contado en rpcErrors */
    } finally {
      this.inflight = false;
    }
  }
  async connect(code, id, secret) {
    Object.assign(this, { code, id, secret });
    await new Promise((resolve) => {
      let ch = this.sb.channel(`qeq:${code}`, { config: { broadcast: { self: false } } });
      if (!NO_RT)
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'qeq_room_signal', filter: `code=eq.${code}` }, (p) => {
          stats.rtEvents++;
          if (Number(p.new?.version) !== this.version) this.schedule();
        });
      ch = ch.on('broadcast', { event: 'bump' }, () => {
        stats.bumps++;
        this.schedule();
      });
      this.ch = ch.subscribe((st, err) => {
        if (st === 'SUBSCRIBED') {
          this.refresh();
          resolve();
        } else if (st !== 'CLOSED') stats.channelErrors.push(`${this.name} ${st} ${err?.message ?? ''}`);
      });
    });
    this.poll = setInterval(async () => {
      stats.polls++;
      const { data } = await this.sb.from('qeq_room_signal').select('version').eq('code', code).maybeSingle();
      if (data && Number(data.version) !== this.version) {
        stats.pollHits++;
        this.schedule();
      }
    }, 3000);
  }
  async act(fn, args = {}) {
    const r = await this.rpc(fn, { ...this.who(), ...args });
    await this.refresh();
    if (!V4 && (!V2 || NO_RT)) this.ch.send({ type: 'broadcast', event: 'bump', payload: {} });
    return r;
  }
  close() {
    clearInterval(this.poll);
    this.sb.removeAllChannels();
  }
}

const lat = [];
/** Espera a que todos los clientes tengan una versión ≥ v y apunta la latencia de cada uno */
async function waitAll(clients, v, t0, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (clients.every((c) => c.version >= v)) break;
    await sleep(20);
  }
  const lag = clients.map((c) => {
    const at = [...c.seen.entries()].filter(([ver]) => ver >= v).map(([, t]) => t);
    return at.length ? Math.min(...at) - t0 : Infinity;
  });
  const max = Math.max(...lag);
  lat.push(...lag);
  const behind = clients.filter((c) => c.version < v).map((c) => c.name);
  console.log(`  ${label.padEnd(28)} todos al día en ${max === Infinity ? 'NUNCA' : max + ' ms'}${behind.length ? '  atrasados: ' + behind.join(',') : ''}`);
  return max;
}

const t = Date.now();
const host = new Client('host');
const r = await host.rpc('qeq_create_room', { p_name: 'Host', p_emoji: '🎪' });
await host.connect(r.code, r.player_id, r.secret);
const players = await Promise.all(
  Array.from({ length: N - 1 }, async (_, i) => {
    const c = new Client(`p${i + 1}`);
    const j = await c.rpc('qeq_join_room', { p_code: r.code, p_name: `Jugador ${i + 1}`, p_emoji: '👻' });
    await c.connect(r.code, j.player_id, j.secret);
    return c;
  }),
);
const all = [host, ...players];
console.log(`Sala ${r.code}: ${all.length} clientes conectados en ${Date.now() - t} ms${NO_RT ? ' (SIN Realtime: solo broadcast + sondeo)' : ''}`);

let t0 = Date.now();
await host.act('qeq_start_writing');
await waitAll(all, host.version, t0, 'Empezar a escribir');

// Todos guardan a la vez
t0 = Date.now();
await Promise.all(all.map((c, i) => sleep(Math.random() * 1500).then(() => c.act('qeq_save_anecdote', { p_text: `Anécdota ${i}` }))));
const lastSave = Date.now();
await host.refresh();
await waitAll(all, host.version, lastSave, `${all.length} guardan (tras el último)`);
if (host.state.saved_player_ids.length !== all.length) console.log('  ¡ERROR! guardadas', host.state.saved_player_ids.length);

t0 = Date.now();
await host.act('qeq_start_voting');
await waitAll(all, host.version, t0, 'Empezar la votación');

for (let k = 0; k < ROUNDS; k++) {
  // votos repartidos en ~3 s, como en la vida real; algunos cambian de opinión
  t0 = Date.now();
  await Promise.all(
    all.map((c, i) =>
      sleep(Math.random() * 3000).then(async () => {
        const target = all[(i + k + 1) % all.length];
        await c.act('qeq_cast_vote', { p_guessed_player_id: target.id });
        if (i % 5 === 0) await c.act('qeq_cast_vote', { p_guessed_player_id: all[(i + 2) % all.length].id });
      }),
    ),
  );
  const lastVote = Date.now();
  await host.refresh();
  await waitAll(all, host.version, lastVote, `Ronda ${k + 1}: último voto`);
  const counts = all.map((c) => c.state.voted_count);
  if (!counts.every((x) => x === all.length)) console.log('  ¡ERROR! contadores', [...new Set(counts)]);
  t0 = Date.now();
  await host.act('qeq_reveal', { p_index: k });
  await waitAll(all, host.version, t0, `Ronda ${k + 1}: revelar`);
  if (!all.every((c) => c.state.phase === 'reveal' && c.state.author)) console.log('  ¡ERROR! no todos ven la revelación');
  t0 = Date.now();
  if (k === ROUNDS - 1) await host.act('qeq_finish_early');
  else await host.act('qeq_next', { p_index: k });
  await waitAll(all, host.version, t0, `Ronda ${k + 1}: siguiente`);
}
const finals = all.filter((c) => c.state.phase === 'final').length;

const ok = lat.filter((x) => x !== Infinity).sort((a, b) => a - b);
const pct = (p) => ok[Math.min(ok.length - 1, Math.floor((p / 100) * ok.length))];
console.log('\nResultado');
console.log(`  clientes: ${all.length} · en pantalla final: ${finals}`);
console.log(`  latencia hasta estar al día: p50 ${pct(50)} ms · p95 ${pct(95)} ms · máx ${ok[ok.length - 1]} ms · nunca: ${lat.length - ok.length}`);
console.log(`  eventos realtime: ${stats.rtEvents} · broadcasts: ${stats.bumps} · sondeos: ${stats.polls} (útiles ${stats.pollHits}) · get_state: ${stats.fetches}`);
console.log(`  errores RPC: ${stats.rpcErrors.length}${stats.rpcErrors.length ? ' → ' + stats.rpcErrors.slice(0, 5).join(' | ') : ''}`);
console.log(`  errores de canal: ${stats.channelErrors.length}${stats.channelErrors.length ? ' → ' + stats.channelErrors.slice(0, 5).join(' | ') : ''}`);
console.log(`  duración total: ${((Date.now() - t) / 1000).toFixed(1)} s`);
all.forEach((c) => c.close());
process.exit(0);
