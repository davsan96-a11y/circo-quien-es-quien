import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { loadDraft, saveDraft } from '../lib/session';
import { HostBar, Stripes, joinNames, useUi } from '../components/ui';
import type { PhaseProps } from './Game';

const EXAMPLES = [
  'De pequeño me daban miedo los payasos',
  'Me senté encima de una caca en el campo y no me di cuenta',
  'Una vez me quedé encerrado en el baño de un avión',
  'Con 8 años me escondí en el armario y me quedé dormido',
  'Me he caído a una piscina vestido en una boda',
];

export function Writing({ state, session, run }: PhaseProps) {
  const { confirm, toast } = useUi();
  const saved = state.my_anecdote ?? null;
  const [text, setText] = useState(() => saved ?? loadDraft(state.code) ?? '');
  const [busy, setBusy] = useState(false);
  const [ex, setEx] = useState(0);
  const lastSaved = useRef(saved);

  // Si llega desde el servidor una versión guardada distinta y no estamos editando, la mostramos
  useEffect(() => {
    if (saved !== lastSaved.current) {
      if (text.trim() === (lastSaved.current ?? '').trim() || !text.trim()) setText(saved ?? '');
      lastSaved.current = saved;
    }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = window.setInterval(() => setEx((i) => (i + 1) % EXAMPLES.length), 3500);
    return () => window.clearInterval(t);
  }, []);

  const trimmed = text.trim();
  const isSaved = saved !== null && trimmed === saved;
  const savedIds = new Set(state.saved_player_ids ?? []);
  const total = state.players.length;
  const done = state.players.filter((p) => savedIds.has(p.id)).length;
  const missing = state.players.filter((p) => !savedIds.has(p.id));

  const save = async () => {
    if (!trimmed) return toast('Escribe algo antes de guardar');
    setBusy(true);
    const ok = await run(() => api.saveAnecdote(session, trimmed));
    setBusy(false);
    if (ok) toast('✓ Guardada', 'info');
  };

  const startVoting = async () => {
    if (missing.length > 0) {
      const ok = await confirm({
        title: `Faltan ${missing.length}, ¿empezar igual?`,
        body: `${joinNames(missing.map((p) => p.name))} ${missing.length === 1 ? 'no ha' : 'no han'} guardado su anécdota. Podrán votar, pero su anécdota no saldrá.`,
        ok: 'Empezar igual',
        danger: true,
      });
      if (!ok) return;
    }
    run(() => api.startVoting(session));
  };

  const kick = async (id: string, name: string) => {
    if (await confirm({ title: `¿Expulsar a ${name}?`, ok: 'Expulsar', danger: true })) run(() => api.kick(session, id));
  };

  return (
    <div className={`page ${state.is_host ? 'has-hostbar' : ''}`}>
      <Stripes />
      <div className="row-between muted">
        <span>
          Sala {state.code} · {state.me.emoji} {state.me.name}
        </span>
        <span>Paso 1 de 2</span>
      </div>
      <h1 className="title-creepy gold">Cuenta tu secreto</h1>
      <p className="text">
        Una anécdota, curiosidad o algo gracioso que te haya pasado. Nadie sabrá que es tuya… hasta el final.
      </p>

      <label className="field">
        <span className="label">Tu anécdota</span>
        <textarea
          className={`input textarea ${isSaved ? 'is-saved' : ''}`}
          value={text}
          maxLength={200}
          rows={5}
          placeholder={`Ej.: ${EXAMPLES[ex]}`}
          onChange={(e) => {
            setText(e.target.value);
            saveDraft(state.code, e.target.value);
          }}
          aria-label="Tu anécdota"
        />
      </label>
      <div className="row-between small">
        {isSaved ? (
          <b className="green">✓ Guardada · puedes editarla</b>
        ) : saved !== null ? (
          <b className="gold">Cambios sin guardar</b>
        ) : (
          <span className="muted">Aún no la has guardado</span>
        )}
        <span className="muted">{text.length} / 200</span>
      </div>

      <button
        className={`btn ${saved === null ? 'btn-red' : 'btn-outline-green'}`}
        onClick={save}
        disabled={busy || !trimmed || isSaved}
      >
        {busy ? 'Guardando…' : saved === null ? 'Guardar' : 'Guardar cambios'}
      </button>

      <div className="card">
        <div className="row-between">
          <b className="text">Ya han guardado</b>
          <b className="gold big-num" data-testid="saved-count">
            {done} de {total}
          </b>
        </div>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <div className="avatar-row">
          {state.players.map((p) => (
            <span key={p.id} className={`avatar ${savedIds.has(p.id) ? 'is-done' : ''}`} title={p.name}>
              {p.emoji}
            </span>
          ))}
        </div>
        {missing.length > 0 ? (
          state.is_host ? (
            <div className="missing-list">
              <span className="muted small">Faltan:</span>
              {missing.map((p) => (
                <span key={p.id} className="chip">
                  {p.emoji} {p.name}
                  {p.id !== state.me.id && (
                    <button className="kick small" aria-label={`Expulsar a ${p.name}`} onClick={() => kick(p.id, p.name)}>
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted small">Faltan: {joinNames(missing.map((p) => p.name))}</p>
          )
        ) : (
          <p className="green small">¡Ya están todas! 🎉</p>
        )}
      </div>

      {state.is_host && (
        <HostBar label={missing.length ? `FALTAN ${missing.length}` : 'TODAS LISTAS'}>
          <button className="btn btn-dark" onClick={startVoting}>
            Empezar la votación
          </button>
        </HostBar>
      )}
    </div>
  );
}
