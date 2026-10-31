import { api } from '../lib/api';
import { HostBar, HostButton, Stripes, useUi } from '../components/ui';
import { GameFooter } from '../components/GameFooter';
import type { PhaseProps } from './Game';
import { RankRow } from './Reveal';

export function Final({ state, session, run }: PhaseProps) {
  const { confirm } = useUi();
  const scores = state.scores ?? [];
  const podium = scores.slice(0, 3);
  const rest = scores.slice(3);
  // Orden visual del podio: 2º · 1º · 3º
  const order = [podium[1], podium[0], podium[2]];
  const heights = ['p2', 'p1', 'p3'];
  const myScore = scores.find((s) => s.player_id === state.me.id);
  const questions = state.mode === 'questions';

  const again = async () => {
    if (
      await confirm({
        title: '¿Jugar otra vez?',
        body: `Se borran las ${questions ? 'respuestas' : 'anécdotas'} y los votos. Los jugadores se quedan en la sala y se puede cambiar de modo.`,
        ok: 'Jugar otra vez',
        danger: true,
      })
    )
      await run(() => api.restart(session));
  };

  return (
    <div className={`page ${state.is_host ? 'has-hostbar' : ''}`}>
      <Stripes />
      <h1 className="title-creepy gold center final-title">¡Fin del espectáculo!</h1>

      <div className="podium">
        {order.map((s, i) =>
          s ? (
            <div key={s.player_id} className={`podium-col ${heights[i]}`}>
              <span className="podium-emoji">{s.emoji}</span>
              <b className={i === 1 ? 'gold podium-name' : 'text podium-name'}>{s.name}</b>
              <span className="muted small">{s.points} pts</span>
              <div className="podium-block">{s.rank}</div>
            </div>
          ) : (
            <div key={i} className="podium-col" />
          ),
        )}
      </div>

      {myScore && (
        <p className="center text">
          Tú: <b className="gold">{myScore.rank}º</b> con <b className="gold">{myScore.points}</b>{' '}
          {myScore.points === 1 ? 'punto' : 'puntos'}
        </p>
      )}

      {rest.length > 0 && (
        <div className="card rank-list" data-testid="final-ranking">
          {rest.map((s) => (
            <RankRow key={s.player_id} s={s} me={state.me.id} />
          ))}
        </div>
      )}

      <details className="all-anecdotes">
        <summary className="btn btn-outline-purple">
          {questions ? 'Ver todas las respuestas' : 'Ver todas las anécdotas'}
        </summary>
        <ol className="anec-list">
          {(state.all_anecdotes ?? []).map((a, i) => (
            <li key={i}>
              {a.question && <span className="muted small">{a.question}</span>}
              <p className="text">“{a.text}”</p>
              <span className="gold small">
                {a.author?.emoji} {a.author?.name}
              </span>
            </li>
          ))}
        </ol>
      </details>

      <GameFooter state={state} session={session} run={run} />

      {state.is_host && (
        <HostBar pin={state.host_pin}>
          <HostButton onClick={again}>Jugar otra vez</HostButton>
        </HostBar>
      )}
    </div>
  );
}
