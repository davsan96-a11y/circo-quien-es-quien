import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, fetchSignalVersion, supabase } from './api';
import type { GameState, Session } from './types';

const POLL_MS = 3000;
const FULL_REFRESH_MS = 15000;
/** Agrupa ráfagas de avisos (p. ej. 20 votos seguidos) en un único refetch */
const DEBOUNCE_MS = 150;

/**
 * Estado de la partida sincronizado:
 *  - Realtime Broadcast "bump" en qeq:<CODE>, enviado por la propia base de datos (trigger →
 *    realtime.send) en cada cambio de la sala. No depende de la conexión de quien hizo la acción.
 *  - Sondeo cada 3 s de la versión pública (qeq_room_signal) y refetch completo cada 15 s.
 *  - Refetch inmediato al volver a primer plano / recuperar red.
 * (Medido con 30 clientes: p95 < 0,4 s. postgres_changes era más lento con muchos clientes.)
 */
export function useGameState(session: Session, onSessionLost: (msg: string) => void) {
  const [state, setState] = useState<GameState | null>(null);
  const [offline, setOffline] = useState(false);
  const versionRef = useRef(-1);
  const inflight = useRef(false);
  const again = useRef(false);
  const loop = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | null>(null);
  const lostRef = useRef(onSessionLost);
  lostRef.current = onSessionLost;
  const lastFull = useRef(0);

  const runLoop = useCallback(async () => {
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

  /** Pide el estado. La promesa se resuelve cuando hay un estado posterior a esta llamada. */
  const refresh = useCallback((): Promise<void> => {
    if (inflight.current) {
      again.current = true;
      return loop.current;
    }
    inflight.current = true;
    loop.current = runLoop();
    return loop.current;
  }, [runLoop]);

  const schedule = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      refresh();
    }, DEBOUNCE_MS);
  }, [refresh]);

  // Realtime Broadcast
  useEffect(() => {
    const code = session.roomCode;
    const ch = supabase
      .channel(`qeq:${code}`)
      .on('broadcast', { event: 'bump' }, (msg) => {
        const v = Number((msg.payload as { v?: number } | undefined)?.v ?? -1);
        if (v === -1 || v > versionRef.current) schedule();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refresh();
      });
    return () => {
      supabase.removeChannel(ch);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [session.roomCode, refresh, schedule]);

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

  /** Ejecuta una acción y espera a tener el estado nuevo (el resto se entera por la base de datos) */
  const act = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      const r = await fn();
      await refresh();
      return r;
    },
    [refresh],
  );

  return { state, setState, offline, refresh, act };
}
