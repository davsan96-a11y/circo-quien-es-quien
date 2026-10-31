import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { api, ApiError, fetchSignalVersion, supabase } from './api';
import type { GameState, Session } from './types';

const POLL_MS = 3000;
const FULL_REFRESH_MS = 15000;

/**
 * Estado de la partida sincronizado:
 *  - Realtime postgres_changes sobre qeq_room_signal (solo code + version)
 *  - Broadcast "bump" en qeq:<CODE> tras cada acción propia
 *  - Sondeo cada 3 s de la versión (y refetch completo cada 15 s)
 *  - Refetch inmediato al volver a primer plano / recuperar red
 */
export function useGameState(session: Session, onSessionLost: (msg: string) => void) {
  const [state, setState] = useState<GameState | null>(null);
  const [offline, setOffline] = useState(false);
  const versionRef = useRef(-1);
  const inflight = useRef(false);
  const again = useRef(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lostRef = useRef(onSessionLost);
  lostRef.current = onSessionLost;
  const lastFull = useRef(0);

  const refresh = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    try {
      do {
        again.current = false;
        const s = await api.getState(session);
        lastFull.current = Date.now();
        if (s.version >= versionRef.current) {
          versionRef.current = s.version;
          setState(s);
        }
        setOffline(false);
      } while (again.current);
    } catch (e) {
      if (e instanceof ApiError && (e.kind === 'auth' || e.kind === 'no_room')) {
        lostRef.current(e.kind === 'auth' ? 'Ya no estás en esta sala' : 'Esa sala ya no existe');
      } else {
        setOffline(true);
      }
    } finally {
      inflight.current = false;
    }
  }, [session]);

  const bump = useCallback(() => {
    try {
      channelRef.current?.send({ type: 'broadcast', event: 'bump', payload: {} });
    } catch {
      /* el sondeo lo cubre */
    }
  }, []);

  // Realtime
  useEffect(() => {
    const code = session.roomCode;
    const ch = supabase
      .channel(`qeq:${code}`, { config: { broadcast: { self: false } } })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'qeq_room_signal', filter: `code=eq.${code}` },
        (payload) => {
          const v = Number((payload.new as { version?: number })?.version ?? -1);
          if (v !== versionRef.current) refresh();
        },
      )
      .on('broadcast', { event: 'bump' }, () => refresh())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refresh();
      });
    channelRef.current = ch;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [session.roomCode, refresh]);

  // Sondeo de respaldo
  useEffect(() => {
    refresh();
    const t = window.setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastFull.current > FULL_REFRESH_MS) {
        refresh();
        return;
      }
      try {
        const v = await fetchSignalVersion(session.roomCode);
        if (v === null || v !== versionRef.current) refresh();
      } catch {
        refresh();
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [session.roomCode, refresh]);

  // Vuelta a primer plano
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [refresh]);

  /** Ejecuta una acción, refresca el estado y avisa al resto */
  const act = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      const r = await fn();
      await refresh();
      bump();
      return r;
    },
    [refresh, bump],
  );

  return { state, setState, offline, refresh, act };
}
