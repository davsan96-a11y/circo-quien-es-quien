import { useState } from 'react';
import { api } from '../lib/api';
import type { GameState, Session } from '../lib/types';
import { ExitLink, useUi } from './ui';

/** Pie de las pantallas de juego: "Salir al menú" y, para el anfitrión, opciones extra. */
export function GameFooter({
  state,
  session,
  run,
}: {
  state: GameState;
  session: Session;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const { confirm } = useUi();
  const [open, setOpen] = useState(false);
  const word = state.mode === 'questions' ? 'respuestas' : 'anécdotas';
  const canFinish =
    (state.phase === 'reveal' || (state.phase === 'voting' && (state.index ?? 0) > 0));

  const finish = async () => {
    setOpen(false);
    const ok = await confirm({
      title: '¿Terminar ya?',
      body: `Se verán los resultados con las ${word} reveladas hasta ahora. Las que no han salido seguirán en secreto.`,
      ok: 'Terminar',
      danger: true,
    });
    if (ok) run(() => api.finishEarly(session));
  };

  const restart = async () => {
    setOpen(false);
    const ok = await confirm({
      title: '¿Volver a la sala de espera?',
      body: `Se borran las ${word} y los votos de esta partida. Los jugadores se quedan en la sala.`,
      ok: 'Volver a empezar',
      danger: true,
    });
    if (ok) run(() => api.restart(session));
  };

  return (
    <div className="footer-links">
      {state.is_host && state.phase !== 'lobby' && state.phase !== 'final' && (
        <button className="link exit-link" onClick={() => setOpen(true)}>
          ⚙️ Opciones del maestro de pista
        </button>
      )}
      <ExitLink />
      {open && (
        <div className="modal-back" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Opciones del maestro de pista</h3>
            <p className="modal-body">PIN de anfitrión: <b className="text">{state.host_pin}</b></p>
            {canFinish && (
              <button className="btn btn-gold" onClick={finish}>
                Terminar ya y ver resultados
              </button>
            )}
            <button className="btn btn-red" onClick={restart}>
              Volver a la sala de espera
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
