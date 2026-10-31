import { createClient } from '@supabase/supabase-js';
import type { GameState, Session } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Valores públicos; expuestos para poder probar el servidor desde los tests E2E
(window as unknown as { __qeq: unknown }).__qeq = { url, key };

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

/** Error con mensaje legible para el usuario. `kind` distingue fallos de sesión y de red. */
export class ApiError extends Error {
  kind: 'auth' | 'no_room' | 'network' | 'game';
  constructor(message: string, kind: ApiError['kind']) {
    super(message);
    this.kind = kind;
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch {
    throw new ApiError('Sin conexión, reintentando…', 'network');
  }
  const { data, error } = res;
  if (error) {
    const hint = (error as { hint?: string }).hint;
    if (hint === 'qeq_auth') throw new ApiError(error.message, 'auth');
    if (hint === 'qeq_no_room') throw new ApiError(error.message, 'no_room');
    // PostgREST devuelve errores sin `code` SQL cuando el fetch falla
    if (!error.code || /fetch|network|Failed/i.test(error.message)) {
      throw new ApiError('Sin conexión, reintentando…', 'network');
    }
    throw new ApiError(error.message, 'game');
  }
  return data as T;
}

const who = (s: Session) => ({ p_code: s.roomCode, p_player_id: s.playerId, p_secret: s.secret });

export const api = {
  createRoom: (name: string, emoji: string) =>
    rpc<{ code: string; player_id: string; secret: string; host_pin: string }>('qeq_create_room', {
      p_name: name,
      p_emoji: emoji,
    }),
  joinRoom: (code: string, name: string, emoji: string) =>
    rpc<{ code: string; player_id: string; secret: string }>('qeq_join_room', {
      p_code: code,
      p_name: name,
      p_emoji: emoji,
    }),
  recoverHost: (code: string, pin: string) =>
    rpc<{ code: string; player_id: string; secret: string }>('qeq_recover_host', { p_code: code, p_pin: pin }),
  reclaimHost: (s: Session, pin: string) =>
    rpc('qeq_reclaim_host', { p_code: s.roomCode, p_pin: pin, p_player_id: s.playerId, p_secret: s.secret }),
  getState: (s: Session) => rpc<GameState>('qeq_get_state', who(s)),
  setLiarBonus: (s: Session, on: boolean) => rpc('qeq_set_liar_bonus', { ...who(s), p_on: on }),
  startWriting: (s: Session) => rpc('qeq_start_writing', who(s)),
  saveAnecdote: (s: Session, text: string) => rpc('qeq_save_anecdote', { ...who(s), p_text: text }),
  startVoting: (s: Session) => rpc('qeq_start_voting', who(s)),
  castVote: (s: Session, guessed: string) => rpc('qeq_cast_vote', { ...who(s), p_guessed_player_id: guessed }),
  reveal: (s: Session) => rpc('qeq_reveal', who(s)),
  next: (s: Session) => rpc('qeq_next', who(s)),
  kick: (s: Session, target: string) => rpc('qeq_kick_player', { ...who(s), p_target: target }),
  restart: (s: Session) => rpc('qeq_restart', who(s)),
};

export async function fetchSignalVersion(code: string): Promise<number | null> {
  const { data, error } = await supabase.from('qeq_room_signal').select('version').eq('code', code).maybeSingle();
  if (error) throw new ApiError('Sin conexión, reintentando…', 'network');
  return data ? Number(data.version) : null;
}
