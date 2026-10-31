import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import type { Session } from '../lib/types';
import { Stripes, useUi } from '../components/ui';

export const EMOJIS = ['🎃', '👻', '🤡', '🧛', '🧟', '🧙', '💀', '🦇', '🕷️', '🐺', '🎪', '🦁', '🐘', '🤹', '🎩', '🍭'];

const cleanCode = (v: string) => v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

export function JoinForm({
  mode,
  initialCode = '',
  onSession,
}: {
  mode: 'join' | 'create';
  initialCode?: string;
  onSession: (s: Session) => void;
}) {
  const { toast } = useUi();
  const [code, setCode] = useState(cleanCode(initialCode));
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(() => EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const n = name.trim();
    if (mode === 'join' && code.length !== 4) return toast('El código de la sala tiene 4 letras');
    if (!n) return toast('Escribe tu nombre');
    setBusy(true);
    try {
      const r = mode === 'create' ? await api.createRoom(n, emoji) : await api.joinRoom(code, n, emoji);
      const s = { roomCode: r.code, playerId: r.player_id, secret: r.secret };
      onSession(s);
      navigate(`sala/${r.code}`, true);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Algo ha fallado, inténtalo otra vez');
      setBusy(false);
    }
  };

  return (
    <form className="page" onSubmit={submit}>
      <Stripes />
      <header className="topbar">
        <button type="button" className="back" aria-label="Volver" onClick={() => navigate('', true)}>
          ‹
        </button>
        <h1 className="title-creepy gold">{mode === 'create' ? 'Monta tu circo' : 'Entra al circo'}</h1>
      </header>

      {mode === 'join' && (
        <label className="field">
          <span className="label">Código de la sala</span>
          <input
            className="input input-code"
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD"
            maxLength={4}
            aria-label="Código de la sala"
          />
        </label>
      )}

      <label className="field">
        <span className="label">Tu nombre</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 16))}
          maxLength={16}
          autoComplete="nickname"
          autoCapitalize="words"
          placeholder="Cómo te llamas"
          aria-label="Tu nombre"
        />
      </label>

      <div className="field">
        <span className="label">Elige tu personaje</span>
        <div className="emoji-grid" role="radiogroup" aria-label="Elige tu personaje">
          {EMOJIS.map((e) => (
            <button
              type="button"
              key={e}
              role="radio"
              aria-checked={emoji === e}
              className={`emoji-btn ${emoji === e ? 'is-on' : ''}`}
              onClick={() => setEmoji(e)}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn-red" type="submit" disabled={busy}>
        {busy ? 'Entrando…' : mode === 'create' ? 'Crear sala' : 'Entrar'}
      </button>

      {mode === 'join' && (
        <button type="button" className="link" onClick={() => navigate(`anfitrion/${code}`)}>
          Soy el anfitrión y he perdido mi móvil
        </button>
      )}
    </form>
  );
}
