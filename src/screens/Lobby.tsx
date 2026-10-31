import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { roomUrl } from '../lib/router';
import { HostBar, HostButton, Stripes, useUi } from '../components/ui';
import { GameFooter } from '../components/GameFooter';
import type { GameState } from '../lib/types';
import type { PhaseProps } from './Game';

export function QrCode({ code, className }: { code: string; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(roomUrl(code), {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#120A14', light: '#FBF3E4' },
    })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [code]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function modeLabel(s: Pick<GameState, 'mode' | 'questions_per_player'>) {
  if (s.mode === 'questions')
    return `❓ Preguntas · ${s.questions_per_player} por jugador`;
  return '📜 Anécdotas';
}

function ModePicker({ state, session, run }: PhaseProps) {
  const q = state.mode === 'questions';
  const set = (mode: string, count: number) => run(() => api.setMode(session, mode, count));
  return (
    <div className="card">
      <span className="label">Modo de juego</span>
      <div className="mode-grid" role="radiogroup" aria-label="Modo de juego">
        <button
          role="radio"
          aria-checked={!q}
          className={`mode-btn ${!q ? 'is-on' : ''}`}
          onClick={() => !q || set('anecdotes', state.questions_per_player)}
        >
          <span className="mode-icon">📜</span>
          <b>Anécdotas</b>
          <span className="small muted">Cada uno cuenta un secreto suyo</span>
        </button>
        <button
          role="radio"
          aria-checked={q}
          className={`mode-btn ${q ? 'is-on' : ''}`}
          onClick={() => q || set('questions', state.questions_per_player)}
        >
          <span className="mode-icon">❓</span>
          <b>Preguntas</b>
          <span className="small muted">Cada uno responde preguntas al azar</span>
        </button>
      </div>
      {q && (
        <div className="row-between">
          <span className="text">Preguntas por jugador</span>
          <div className="seg" role="radiogroup" aria-label="Preguntas por jugador">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={state.questions_per_player === n}
                className={`seg-btn ${state.questions_per_player === n ? 'is-on' : ''}`}
                onClick={() => set('questions', n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      {q && (
        <p className="muted small">
          Habrá unas {state.players.length * state.questions_per_player} respuestas que adivinar con{' '}
          {state.players.length} jugadores.
        </p>
      )}
    </div>
  );
}

export function Lobby({ state, session, run }: PhaseProps) {
  const { confirm } = useUi();
  const [bigQr, setBigQr] = useState(false);
  const host = state.is_host;
  const n = state.players.length;

  const kick = async (id: string, name: string) => {
    if (await confirm({ title: `¿Expulsar a ${name}?`, body: 'Tendrá que volver a entrar con el código.', ok: 'Expulsar', danger: true }))
      run(() => api.kick(session, id));
  };

  return (
    <div className={`page ${host ? 'has-hostbar' : ''}`}>
      <Stripes />
      <button className="card qr-card" onClick={() => setBigQr(true)} aria-label="Ampliar QR">
        <QrCode code={state.code} className="qr" />
        <div className="qr-info">
          <span className="muted small">Código de la sala</span>
          <span className="room-code" data-testid="room-code">
            {state.code}
          </span>
          <span className="muted small">Escanead el QR para entrar</span>
        </div>
      </button>

      <div className="section-head">
        <h2 className="title-creepy red">En la carpa</h2>
        <span className="muted">
          <b className="text">{n}</b> {n === 1 ? 'jugador' : 'jugadores'}
        </span>
      </div>

      <div className="player-grid">
        {state.players.map((p) => (
          <div key={p.id} className="player-tile" data-testid="lobby-player">
            <span className="p-emoji">
              {p.emoji}
              {p.is_host && (
                <span className="host-mark" title="Maestro de pista">
                  🎩
                </span>
              )}
            </span>
            <span className="p-name">{p.name}</span>
            {p.id === state.me.id ? (
              <span className="badge-gold">TÚ</span>
            ) : (
              host && (
                <button className="kick" aria-label={`Expulsar a ${p.name}`} onClick={() => kick(p.id, p.name)}>
                  ✕
                </button>
              )
            )}
          </div>
        ))}
      </div>

      {host && <ModePicker state={state} session={session} run={run} setState={() => {}} />}

      {host ? (
        <div className="card host-card">
          <div className="row-between">
            <span className="muted">PIN de anfitrión</span>
            <span className="pin" data-testid="host-pin">
              {state.host_pin}
            </span>
          </div>
          <p className="muted small">Apúntalo: si te quedas sin batería, entra desde otro móvil con este PIN.</p>
          <label className="row-between toggle-row">
            <span>
              <span className="text">Bonus engañador</span>
              <br />
              <span className="muted small">+1 al autor por cada uno que falle (máx. 3)</span>
            </span>
            <input
              type="checkbox"
              className="toggle"
              checked={state.liar_bonus}
              onChange={(e) => run(() => api.setLiarBonus(session, e.target.checked))}
              aria-label="Bonus engañador"
            />
          </label>
        </div>
      ) : (
        <div className="card waiting-card">
          <p className="text">⏳ Esperando a que el maestro de pista empiece…</p>
          <p className="gold" data-testid="mode-label">
            Modo: {modeLabel(state)}
          </p>
          {state.liar_bonus && <p className="muted small">Bonus engañador activado: el autor gana +1 por cada uno que falle (máx. 3).</p>}
        </div>
      )}

      <GameFooter state={state} session={session} run={run} />

      {host && (
        <HostBar label={n < 3 ? 'MÍNIMO 3' : undefined}>
          <HostButton disabled={n < 3} onClick={() => run(() => api.startWriting(session))}>
            {state.mode === 'questions' ? 'Empezar a responder' : 'Empezar a escribir'}
          </HostButton>
        </HostBar>
      )}

      {bigQr && (
        <div className="modal-back" onClick={() => setBigQr(false)}>
          <div className="qr-big-wrap">
            <QrCode code={state.code} className="qr-big" />
            <span className="room-code">{state.code}</span>
            <span className="muted">Toca para cerrar</span>
          </div>
        </div>
      )}
    </div>
  );
}
