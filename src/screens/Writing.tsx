import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { clearDraft, loadDraft, saveDraft } from '../lib/session';
import { HostBar, HostButton, Stripes, joinNames, useUi } from '../components/ui';
import { GameFooter } from '../components/GameFooter';
import type { PhaseProps } from './Game';

const EXAMPLES = [
  'De pequeño me daban miedo los payasos',
  'Me senté encima de una caca en el campo y no me di cuenta',
  'Una vez me quedé encerrado en el baño de un avión',
  'Con 8 años me escondí en el armario y me quedé dormido',
  'Me he caído a una piscina vestido en una boda',
];

export function Writing(props: PhaseProps) {
  return props.state.mode === 'questions' ? <QuestionsWriting {...props} /> : <AnecdoteWriting {...props} />;
}

// ───────── Editor de texto con guardado, borrador y estado ─────────

function AnswerEditor({
  code,
  slot,
  saved,
  onSave,
  label,
  ariaLabel,
  placeholder,
  rows,
}: {
  code: string;
  slot: number;
  saved: string | null;
  onSave: (text: string) => Promise<boolean>;
  label: string;
  ariaLabel: string;
  placeholder: string;
  rows: number;
}) {
  const { toast } = useUi();
  // Un borrador solo existe si hay cambios sin guardar (se borra al guardar)
  const [text, setText] = useState(() => loadDraft(code, slot) ?? saved ?? '');
  const [busy, setBusy] = useState(false);
  const lastSaved = useRef(saved);

  // Si llega desde el servidor una versión guardada distinta y no estamos editando, la mostramos
  useEffect(() => {
    if (saved !== lastSaved.current) {
      if (text.trim() === (lastSaved.current ?? '').trim() || !text.trim()) setText(saved ?? '');
      lastSaved.current = saved;
    }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = text.trim();
  const isSaved = saved !== null && trimmed === saved;

  const save = async () => {
    if (!trimmed) return toast('Escribe algo antes de guardar');
    setBusy(true);
    const ok = await onSave(trimmed);
    setBusy(false);
    if (ok) {
      clearDraft(code, slot);
      toast('✓ Guardada', 'info');
    }
  };

  return (
    <>
      <label className="field">
        <span className="label">{label}</span>
        <textarea
          className={`input textarea ${isSaved ? 'is-saved' : ''}`}
          style={{ minHeight: rows * 30 + 30 }}
          value={text}
          maxLength={200}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            saveDraft(code, e.target.value, slot);
          }}
          aria-label={ariaLabel}
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
    </>
  );
}

// ───────── Piezas comunes ─────────

function Header({ state }: PhaseProps) {
  return (
    <div className="row-between muted">
      <span>
        Sala {state.code} · {state.me.emoji} {state.me.name}
      </span>
      <span>Paso 1 de 2</span>
    </div>
  );
}

function ProgressCard({ state, session, run }: PhaseProps) {
  const { confirm } = useUi();
  const savedIds = new Set(state.saved_player_ids ?? []);
  const total = state.players.length;
  const done = state.players.filter((p) => savedIds.has(p.id)).length;
  const missing = state.players.filter((p) => !savedIds.has(p.id));

  const kick = async (id: string, name: string) => {
    if (await confirm({ title: `¿Expulsar a ${name}?`, ok: 'Expulsar', danger: true })) run(() => api.kick(session, id));
  };

  return (
    <div className="card">
      <div className="row-between">
        <b className="text">{state.mode === 'questions' ? 'Ya han respondido' : 'Ya han guardado'}</b>
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
        <p className="green small">¡Ya están todos! 🎉</p>
      )}
    </div>
  );
}

function StartVotingBar({ state, session, run }: PhaseProps) {
  const { confirm } = useUi();
  const savedIds = new Set(state.saved_player_ids ?? []);
  const missing = state.players.filter((p) => !savedIds.has(p.id));
  const questions = state.mode === 'questions';

  const startVoting = async () => {
    if (missing.length > 0) {
      const ok = await confirm({
        title: `Faltan ${missing.length}, ¿empezar igual?`,
        body: questions
          ? `${joinNames(missing.map((p) => p.name))} no ${missing.length === 1 ? 'ha' : 'han'} respondido todo. Podrán votar, pero solo saldrán las respuestas guardadas.`
          : `${joinNames(missing.map((p) => p.name))} ${missing.length === 1 ? 'no ha' : 'no han'} guardado su anécdota. Podrán votar, pero su anécdota no saldrá.`,
        ok: 'Empezar igual',
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => api.startVoting(session));
  };

  return (
    <HostBar pin={state.host_pin} label={missing.length ? `FALTAN ${missing.length}` : 'TODOS LISTOS'}>
      <HostButton onClick={startVoting}>Empezar la votación</HostButton>
    </HostBar>
  );
}

// ───────── Modo anécdotas ─────────

function AnecdoteWriting(props: PhaseProps) {
  const { state, session, run } = props;
  const [ex, setEx] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setEx((i) => (i + 1) % EXAMPLES.length), 3500);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className={`page ${state.is_host ? 'has-hostbar' : ''}`}>
      <Stripes />
      <Header {...props} />
      <h1 className="title-creepy gold">Cuenta tu secreto</h1>
      <p className="text">
        Una anécdota, curiosidad o algo gracioso que te haya pasado. Nadie sabrá que es tuya… hasta el final.
      </p>

      <AnswerEditor
        code={state.code}
        slot={0}
        saved={state.my_anecdote ?? null}
        onSave={(t) => run(() => api.saveAnecdote(session, t))}
        label="Tu anécdota"
        ariaLabel="Tu anécdota"
        placeholder={`Ej.: ${EXAMPLES[ex]}`}
        rows={5}
      />

      <ProgressCard {...props} />
      <GameFooter state={state} session={session} run={run} />
      {state.is_host && <StartVotingBar {...props} />}
    </div>
  );
}

// ───────── Modo preguntas ─────────

function QuestionsWriting(props: PhaseProps) {
  const { state, session, run } = props;
  const { confirm } = useUi();
  const qs = state.my_questions ?? [];
  const answered = qs.filter((q) => q.answer).length;

  const reroll = async (slot: number, hasAnswer: boolean) => {
    if (
      hasAnswer &&
      !(await confirm({ title: '¿Cambiar de pregunta?', body: 'Se borrará tu respuesta a esta pregunta.', ok: 'Cambiar' }))
    )
      return;
    clearDraft(state.code, slot);
    run(() => api.rerollQuestion(session, slot));
  };

  return (
    <div className={`page ${state.is_host ? 'has-hostbar' : ''}`}>
      <Stripes />
      <Header {...props} />
      <h1 className="title-creepy gold">{qs.length > 1 ? 'Responde tus preguntas' : 'Responde tu pregunta'}</h1>
      <p className="text">
        Contesta con sinceridad (o no 😈). Luego todos intentarán adivinar de quién es cada respuesta.
      </p>
      {qs.length > 1 && (
        <p className="muted small" data-testid="answered-count">
          Has respondido {answered} de {qs.length}
        </p>
      )}

      {qs.length === 0 && <p className="muted">Preparando tus preguntas…</p>}
      {qs.map((q) => (
        <div className="card q-card" key={`${q.slot}-${q.question}`} data-testid="question-card">
          <div className="row-between">
            <span className="muted small">
              Pregunta {q.slot + 1} de {qs.length}
            </span>
            <button className="link reroll" onClick={() => reroll(q.slot, !!q.answer)}>
              🔄 Otra pregunta
            </button>
          </div>
          <p className="q-text" data-testid="question-text">
            {q.question}
          </p>
          <AnswerEditor
            code={state.code}
            slot={q.slot}
            saved={q.answer}
            onSave={(t) => run(() => api.saveAnswer(session, q.slot, t))}
            label="Tu respuesta"
            ariaLabel={`Respuesta ${q.slot + 1}`}
            placeholder="Escribe tu respuesta…"
            rows={2}
          />
        </div>
      ))}

      <ProgressCard {...props} />
      <GameFooter state={state} session={session} run={run} />
      {state.is_host && <StartVotingBar {...props} />}
    </div>
  );
}
