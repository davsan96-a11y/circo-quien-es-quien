// Comprueba que Realtime (postgres_changes sobre qeq_room_signal) llega con la clave anon y mide la latencia.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => l.trim().split(/=(.*)/s).slice(0, 2)),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data: room, error } = await sb.rpc('qeq_create_room', { p_name: 'RT', p_emoji: '🎃' });
if (error) throw error;
const code = room.code;
let t0 = 0;
const got = new Promise((resolve) => {
  sb.channel('t:' + code)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'qeq_room_signal', filter: `code=eq.${code}` },
      (p) => { if (t0) resolve({ ms: Date.now() - t0, v: p.new.version }); })
    .subscribe(async (s) => {
      if (s !== 'SUBSCRIBED') return;
      await new Promise((r) => setTimeout(r, 1000));
      t0 = Date.now();
      await sb.rpc('qeq_join_room', { p_code: code, p_name: 'Otro', p_emoji: '👻' });
    });
});
const r = await Promise.race([got, new Promise((r) => setTimeout(() => r('TIMEOUT'), 10000))]);
console.log('sala', code, 'realtime:', r);
process.exit(0);
