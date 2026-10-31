import { api } from '../lib/api';
import { HostBar, HostButton, Stripes, joinNames, useUi } from '../components/ui';
import { GameFooter } from '../components/GameFooter';
import type { PhaseProps } from './Game';

export function Voting({ state, session, run, setState }: PhaseProps) {
  const { confirm } = useUi();
  const idx = (state.index ?? 0) + 1;
  const total = state.total ?? 0;
  const voted = state.voted_count ?? 0;
  const voters = state.voter_count ?? state.players.length;
  const left = Math.max(0, voters - voted);
  const others = state.players.filter((p) => p.id !== state.me.id);
  const word = state.mode === 'questions' ? 'Respuesta' : 'Anécdota';
  const question = state.anecdote?.question;
  const votedIds = new Set(state.voted_player_ids ?? []);
  const notVoted = state.players.filter((p) => !votedIds.has(p.id));

  const vote = (id: string) => {
    if (state.my_vote === id) return;
    // Optimista: se marca al instante; si falla, el refetch lo corrige
    setState({ ...state, my_vote: id, voted_count: state.my_vote ? voted : voted + 1 });
    run(() => api.castVote(session, id));
  };

  const reveal = async () => {
    if (left > 0) {
      const ok = await confirm({
        title: `Faltan ${left} por votar`,
        body: '¿Revelar igualmente?',
        ok: 'Revelar',
      });
      if (!ok) return;
    }
    await run(() => api.reveal(session, state.index ?? 0));
  };

  return (
    <div className={`page ${state.is_host ? 'has-hostbar' : ''}`}>
      <Stripes />
      <div className="row-between">
        <b className="gold" data-testid="anecdote-index">
          {word} {idx} de {total}
        </b>
        <span className="muted" data-testid="voted-count">
          Han votado <b className="text">{voted}</b> de {voters}
        </span>
      </div>

      <div className="poster">
        <div className="poster-inner">
          <span className="poster-q">¿De quién es?</span>
          {question && (
            <p className="poster-question" data-testid="anecdote-question">
              {question}
            </p>
          )}
          <p className="poster-text" data-testid="anecdote-text">
            “{state.anecdote?.text}”
          </p>
        </div>
      </div>

      {state.is_mine && (
        <div className="hint-mine" data-testid="is-mine">
          🤫 Es la tuya. Vota a alguien para disimular.
        </div>
      )}

      <div className="vote-grid">
        {others.map((p) => {
          const on = state.my_vote === p.id;
          return (
            <button
              key={p.id}
              className={`vote-tile ${on ? 'is-on' : ''}`}
              onClick={() => vote(p.id)}
              aria-pressed={on}
              data-testid="vote-tile"
            >
              <span className="p-emoji">{p.emoji}</span>
              <span className="p-name">{p.name}</span>
              {on && <span className="badge-gold badge-vote">TU VOTO</span>}
            </button>
          );
        })}
      </div>

      {!state.is_host && (
        <p className="muted small center">
          {state.my_vote ? 'Puedes cambiar tu voto hasta que se revele.' : 'Toca a quien creas que la escribió.'}
        </p>
      )}

      {state.is_host && notVoted.length > 0 && (
        <p className="muted small center" data-testid="not-voted">
          Faltan por votar: {joinNames(notVoted.map((p) => p.name))}
        </p>
      )}

      <GameFooter state={state} session={session} run={run} />

      {state.is_host && (
        <HostBar pin={state.host_pin} label={left > 0 ? `FALTAN ${left}` : 'TODOS HAN VOTADO'}>
          <HostButton onClick={reveal}>Revelar</HostButton>
        </HostBar>
      )}
    </div>
  );
}
