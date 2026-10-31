import { useCallback, useEffect, useState } from 'react';
import { clearSession, loadSession, saveSession } from './lib/session';
import { navigate, useRoute } from './lib/router';
import type { Session } from './lib/types';
import { useUi } from './components/ui';
import { Home } from './screens/Home';
import { JoinForm } from './screens/JoinForm';
import { Recover } from './screens/Recover';
import { Game } from './screens/Game';

export function App() {
  const route = useRoute();
  const { toast } = useUi();
  const [session, setSession] = useState<Session | null>(loadSession);

  // Al abrir la web con una sesión guardada, volver directamente a la partida
  useEffect(() => {
    if (route.name === 'home' && session) navigate(`sala/${session.roomCode}`, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSession = useCallback((s: Session) => {
    saveSession(s);
    setSession(s);
  }, []);

  const onSessionLost = useCallback(
    (msg: string) => {
      clearSession();
      setSession(null);
      toast(msg);
      navigate('', true);
    },
    [toast],
  );

  switch (route.name) {
    case 'create':
      return <JoinForm key="create" mode="create" onSession={onSession} />;
    case 'join':
      return <JoinForm key={`join-${route.code}`} mode="join" initialCode={route.code} onSession={onSession} />;
    case 'recover':
    case 'rejoin':
      return (
        <Recover
          key={route.name}
          mode={route.name === 'recover' ? 'host' : 'player'}
          initialCode={route.code}
          session={session}
          onSession={onSession}
        />
      );
    case 'room':
      if (session && session.roomCode === route.code)
        return <Game key={`${session.roomCode}-${session.playerId}`} session={session} onSessionLost={onSessionLost} />;
      return <JoinForm key={`join-${route.code}`} mode="join" initialCode={route.code} onSession={onSession} />;
    default:
      return (
        <Home
          session={session}
          onForget={() => {
            clearSession();
            setSession(null);
          }}
        />
      );
  }
}
