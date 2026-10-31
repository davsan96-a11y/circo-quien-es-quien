import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import type { Session } from '../lib/types';
import { Stripes, useUi } from '../components/ui';

const cleanCode = (v: string) => v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

/**
 * Recuperar el control de anfitrión con el PIN.
 * - Si este móvil ya juega en esa sala: ese jugador pasa a ser el anfitrión (qeq_reclaim_host).
 * - Si no: este móvil recupera la identidad del anfitrión original (qeq_recover_host).
 */
export function Recover({
  initialCode,
  session,
  onSession,
}: {
  initialCode: string;
  session: Session | null;
  onSession: (s: Session) => void;
}) {
  const { toast } = useUi();
  const [code, setCode] = useState(cleanCode(initialCode || session?.roomCode || ''));
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 4) return toast('El código de la sala tiene 4 letras');
    if (!/^\d{4}$/.test(pin)) return toast('El PIN tiene 4 cifras');
    setBusy(true);
    try {
      if (session && session.roomCode === code) {
        await api.reclaimHost(session, pin);
      } else {
        const r = await api.recoverHost(code, pin);
        onSession({ roomCode: r.code, playerId: r.player_id, secret: r.secret });
      }
      toast('¡Vuelves a ser el maestro de pista!', 'info');
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
        <button type="button" className="back" aria-label="Volver" onClick={() => window.history.back()}>
          ‹
        </button>
        <h1 className="title-creepy gold">Soy el anfitrión</h1>
      </header>
      <p className="muted">
        Escribe el código de la sala y el PIN de anfitrión que aparecía en la sala de espera para recuperar los
        controles.
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
      <label className="field">
        <span className="label">PIN de anfitrión</span>
        <input
          className="input input-code"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0000"
          aria-label="PIN de anfitrión"
        />
      </label>
      <button className="btn btn-gold" type="submit" disabled={busy}>
        {busy ? 'Comprobando…' : 'Recuperar el control'}
      </button>
    </form>
  );
}
