// 16 jugadores uniéndose, escribiendo y votando a la vez contra el Supabase real.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => l.trim().split(/=(.*)/s).slice(0, 2)),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const call = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
};
const t = Date.now();
const host = await call('qeq_create_room', { p_name: 'Host', p_emoji: '🎪' });
const code = host.code;
const joins = await Promise.all(Array.from({ length: 15 }, (_, i) => call('qeq_join_room', { p_code: code, p_name: `Jugador${i + 1}`, p_emoji: '👻' })));
const ps = [host, ...joins];
const who = (p) => ({ p_code: code, p_player_id: p.player_id, p_secret: p.secret });
await call('qeq_start_writing', who(host));
await Promise.all(ps.map((p, i) => call('qeq_save_anecdote', { ...who(p), p_text: `Anécdota número ${i}` })));
await call('qeq_start_voting', who(host));
for (let k = 0; k < 3; k++) {
  await Promise.all(ps.map((p, i) => call('qeq_cast_vote', { ...who(p), p_guessed_player_id: ps[(i + 1) % ps.length].player_id })));
  const s = await call('qeq_get_state', who(ps[3]));
  console.log(`anécdota ${k + 1}: votos ${s.voted_count}/${s.voter_count}`);
  await call('qeq_reveal', who(host));
  await call('qeq_next', who(host));
}
const s = await call('qeq_get_state', who(host));
console.log('jugadores', s.players.length, 'fase', s.phase, 'en', Date.now() - t, 'ms');
process.exit(0);
