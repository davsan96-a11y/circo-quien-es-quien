import { api } from '../lib/api';
import { HostBar, Stripes } from '../components/ui';
import type { Score } from '../lib/types';
import type { PhaseProps } from './Game';

export function RankRow({ s, me, compact }: { s: Score; me: string; compact?: boolean }) {
  return (
    <div className={`rank-row ${s.player_id === me ? 'is-me' : ''}`}>
      <span className={compact ? `rank-dot rank-${Math.min(s.rank, 4)}` : 'rank-num'}>{s.rank}</span>
      <span className="rank-name">
        {s.emoji} {s.name}
      </span>
      <b className={compact ? 'gold' : 'text'}>{compact ? `${s.points} ${s.points === 1 ? 'pt' : 'pts'}` : s.points}</b>
    </div>
  );
}

export function Reveal({ state, session, run }: PhaseProps) {
  const idx = (state.index ?? 0) + 1;
  const total = state.total ?? 0;
  const author = state.author;
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const votes = (state.votes ?? []).filter((v) => v.voter_id !== author?.id);
  const right = votes.filter((v) => v.correct).map((v) => byId.get(v.voter_id)).filter(Boolean);
  const wrong = votes.filter((v) => !v.correct).map((v) => byId.get(v.voter_id)).filter(Boolean);
  const votedIds = new Set(votes.map((v) => v.voter_id));
  const noVote = state.players.filter((p) => p.id !== author?.id && !votedIds.has(p.id));
  const myVote = votes.find((v) => v.voter_id === state.me.id);
  const isMine = author?.id === state.me.id;
  const liarPts = Math.min(3, wrong.length);
  const top3 = (state.scores ?? []).filter((s) => s.rank <= 3 && s.points > 0).slice(0, 5);
  const last = idx >= total;

  return (
    <div className={`page ${state.is_host ? 'has-hostbar' : ''}`}>
      <Stripes />
      <b className="gold">
        Anécdota {idx} de {total}
      </b>
      <p className="quote-muted">“{state.anecdote?.text}”</p>

      <div className="reveal-card">
        <span className="title-creepy red reveal-pre">¡Era de…</span>
        <span className="reveal-emoji">{author?.emoji}</span>
        <span className="reveal-name" data-testid="reveal-author">
          {author?.name}!
        </span>
      </div>

      {isMine ? (
        <p className="my-result">
          {state.liar_bonus && liarPts > 0
            ? `😈 Has engañado a ${wrong.length}: +${liarPts}`
            : `Era la tuya: engañaste a ${wrong.length}`}
        </p>
      ) : myVote ? (
        <p className={`my-result ${myVote.correct ? 'green' : 'red'}`}>
          {myVote.correct ? '🎯 ¡Acertaste! +1' : '❌ Fallaste esta vez'}
        </p>
      ) : (
        <p className="my-result muted">No votaste en esta</p>
      )}

      <h3 className="green list-head">Acertaron (+1) · {right.length}</h3>
      <div className="chips">
        {right.map((p) => (
          <span key={p!.id} className="chip chip-green">
            {p!.emoji} {p!.name}
          </span>
        ))}
        {right.length === 0 && <span className="muted small">Nadie. ¡Qué bien escondido!</span>}
      </div>

      <h3 className="muted list-head">Fallaron · {wrong.length}</h3>
      <div className="chips">
        {wrong.map((p) => (
          <span key={p!.id} className="chip">
            {p!.emoji} {p!.name}
          </span>
        ))}
      </div>

      {noVote.length > 0 && (
        <>
          <h3 className="muted list-head">Sin votar · {noVote.length}</h3>
          <div className="chips">
            {noVote.map((p) => (
              <span key={p.id} className="chip chip-dim">
                {p.emoji} {p.name}
              </span>
            ))}
          </div>
        </>
      )}

      {state.liar_bonus && author && liarPts > 0 && (
        <p className="purple small">
          😈 Bonus engañador: +{liarPts} para {author.name}
        </p>
      )}

      <div className="card">
        <span className="muted">Así va el ranking</span>
        {top3.map((s) => (
          <RankRow key={s.player_id} s={s} me={state.me.id} compact />
        ))}
        {top3.length === 0 && <span className="text">Aún no ha puntuado nadie 👀</span>}
      </div>

      {state.is_host && (
        <HostBar>
          <button className="btn btn-dark" onClick={() => run(() => api.next(session))}>
            {last ? 'Ver resultados' : 'Siguiente anécdota'}
          </button>
        </HostBar>
      )}
    </div>
  );
}
