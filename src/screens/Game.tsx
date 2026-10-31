import { useCallback, useEffect } from 'react';
import { ApiError } from '../lib/api';
import { useGameState } from '../lib/useGameState';
import { useWakeLock } from '../lib/wakeLock';
import type { GameState, Session } from '../lib/types';
import { OfflineBanner, Stripes, useUi } from '../components/ui';
import { Lobby } from './Lobby';
import { Writing } from './Writing';
import { Voting } from './Voting';
import { Reveal } from './Reveal';
import { Final } from './Final';

export interface PhaseProps {
  state: GameState;
  session: Session;
  /** Ejecuta una acción de la partida mostrando errores en un toast. Devuelve true si fue bien. */
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  setState: (s: GameState) => void;
}

export function Game({ session, onSessionLost }: { session: Session; onSessionLost: (msg: string) => void }) {
  const { toast } = useUi();
  const { state, offline, act, setState } = useGameState(session, onSessionLost);
  useWakeLock(true);

  // Cada fase o anécdota nueva empieza arriba del todo
  const screenKey = `${state?.phase}-${state?.anecdote?.id ?? ''}`;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screenKey]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await act(fn);
        return true;
      } catch (e) {
        if (e instanceof ApiError && (e.kind === 'auth' || e.kind === 'no_room')) {
          onSessionLost(e.message);
        } else {
          toast(e instanceof ApiError ? e.message : 'Algo ha fallado, inténtalo otra vez');
        }
        return false;
      }
    },
    [act, toast, onSessionLost],
  );

  if (!state) {
    return (
      <div className="page center-page">
        <Stripes />
        <OfflineBanner show={offline} />
        <div className="big-emoji spin">🎪</div>
        <p className="muted">Entrando en la carpa…</p>
      </div>
    );
  }

  const props: PhaseProps = { state, session, run, setState };
  let screen;
  switch (state.phase) {
    case 'lobby':
      screen = <Lobby {...props} />;
      break;
    case 'writing':
      screen = <Writing {...props} />;
      break;
    case 'voting':
      screen = <Voting key={state.anecdote?.id} {...props} />;
      break;
    case 'reveal':
      screen = <Reveal key={state.anecdote?.id} {...props} />;
      break;
    default:
      screen = <Final {...props} />;
  }
  return (
    <>
      <OfflineBanner show={offline} />
      <div data-phase={state.phase} className="phase-wrap">
        {screen}
      </div>
    </>
  );
}
