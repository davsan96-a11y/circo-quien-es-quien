import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import type { Session } from '../lib/types';
import { Stripes, useUi } from '../components/ui';

const cleanCode = (v: string) => v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

/**
 * Recuperar el acceso con el PIN de anfitrión.
 * Modo "host":
 *  - Si este móvil ya juega en esa sala: ese jugador pasa a ser el anfitrión (qeq_reclaim_host).
 *  - Si no: este móvil recupera la identidad del anfitrión original (qeq_recover_host).
 * Modo "player": alguien que perdió su sesión vuelve a ser él mismo; el anfitrión teclea su PIN
 * en ese móvil (qeq_recover_player).
 */
export function Recover({
  initialCode,
  mode,
  session,
  onSession,
}: {
  initialCode: string;
  mode: 'host' | 'player';
  session: Session | null;
  onSession: (s: Session) => void;
}) {
  const { toast } = useUi();
  const [code, setCode] = useState(cleanCode(initialCode || session?.roomCode || ''));
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const isHost = mode === 'host';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (code.length !== 4) return toast('El código de la sala tiene 4 letras');
    if (!isHost && !name.trim()) return toast('Escribe tu nombre tal y como entraste');
    if (!/^\d{4}$/.test(pin)) return toast('El PIN tiene 4 cifras');
    setBusy(true);
    try {
      if (!isHost) {
        const r = await api.recoverPlayer(code, pin, name.trim());
        onSession({ roomCode: r.code, playerId: r.player_id, secret: r.secret });
        toast('¡Has vuelto a la partida!', 'info');
      } else if (session && session.roomCode === code) {
        await api.reclaimHost(session, pin);
        toast('¡Ahora eres el maestro de pista!', 'info');
      } else {
        const r = await api.recoverHost(code, pin);
        onSession({ roomCode: r.code, playerId: r.player_id, secret: r.secret });
        toast('¡Vuelves a ser el maestro de pista!', 'info');
      }
      navigate(`sala/${code}`, true);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Algo ha fallado, inténtalo otra vez');
      setBusy(false);
    }
  };

  return (
    <form className="page" onSubmit={submit}>
      <Stripes />
      <header className="topbar">
        <button type="button" className="back" aria-label="Volver" onClick={() => navigate(code ? `sala/${code}` : '', true)}>
          ‹
        </button>
        <h1 className="title-creepy gold">{isHost ? 'Soy el anfitrión' : 'Volver a la partida'}</h1>
      </header>

      <div className="seg seg-wide" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={isHost}
          className={`seg-btn ${isHost ? 'is-on' : ''}`}
          onClick={() => navigate(`anfitrion/${code}`, true)}
        >
          Soy el anfitrión
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isHost}
          className={`seg-btn ${!isHost ? 'is-on' : ''}`}
          onClick={() => navigate(`volver/${code}`, true)}
        >
          Ya estaba jugando
        </button>
      </div>

      <p className="muted">
        {isHost
          ? 'Escribe el código de la sala y el PIN de anfitrión (sale en la sala de espera y en la barra dorada) para recuperar los controles.'
          : '¿Se te cerró la partida o cambiaste de navegador? Escribe tu nombre tal y como entraste y pide al maestro de pista que teclee su PIN.'}
      </p>

      <label className="field">
        <span className="label">Código de la sala</span>
        <input
          className="input input-code"
          value={code}
          onChange={(e) => setCode(cleanCode(e.target.value))}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ABCD"
          aria-label="Código de la sala"
        />
      </label>
      {!isHost && (
        <label className="field">
          <span className="label">Tu nombre en la partida</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 16))}
            autoCapitalize="words"
            placeholder="Cómo entraste"
            aria-label="Tu nombre en la partida"
          />
        </label>
      )}
      <label className="field">
        <span className="label">{isHost ? 'PIN de anfitrión' : 'PIN del maestro de pista'}</span>
        <input
          className="input input-code"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0000"
          aria-label={isHost ? 'PIN de anfitrión' : 'PIN del maestro de pista'}
        />
      </label>
      <button className="btn btn-gold" type="submit" disabled={busy}>
        {busy ? 'Comprobando…' : isHost ? 'Recuperar el control' : 'Volver a la partida'}
      </button>
    </form>
  );
}
