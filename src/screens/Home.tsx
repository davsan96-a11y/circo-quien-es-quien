import { navigate } from '../lib/router';
import type { Session } from '../lib/types';
import { Stripes, Tent, useUi } from '../components/ui';

export function Home({ session, onForget }: { session: Session | null; onForget: () => void }) {
  const { confirm } = useUi();

  const forget = async () => {
    const ok = await confirm({
      title: '¿Olvidar esta partida?',
      body: `Este móvil dejará de entrar automáticamente en la sala ${session?.roomCode}. Para volver tendrías que unirte con otro nombre.`,
      ok: 'Olvidar',
      danger: true,
    });
    if (ok) onForget();
  };

  return (
    <div className="page home">
      <Stripes />
      <div className="home-hero">
        <Tent />
        <h1 className="logo">Circo de Valdemoro</h1>
        <h2 className="logo-sub">¿Quién es quién?</h2>
        <p className="muted home-tag">Si se atreven…</p>
      </div>
      <div className="stack">
        <button className="btn btn-red" onClick={() => navigate('unirse')}>
          Unirme a una sala
        </button>
        <button className="btn btn-outline-gold" onClick={() => navigate('crear')}>
          Crear sala
        </button>
        {session && (
          <button className="btn btn-plum" onClick={() => navigate(`sala/${session.roomCode}`)}>
            Volver a mi partida · sala {session.roomCode}
          </button>
        )}
        {session && (
          <button className="link forget-link" onClick={forget}>
            Olvidar esta partida
          </button>
        )}
      </div>
      <p className="muted small home-foot">Sin registros. Solo tu nombre y el código de la sala.</p>
    </div>
  );
}
