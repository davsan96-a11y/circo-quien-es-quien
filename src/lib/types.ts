export type Phase = 'lobby' | 'writing' | 'voting' | 'reveal' | 'final';
export type Mode = 'anecdotes' | 'questions';

export interface PlayerLite {
  id: string;
  name: string;
  emoji: string;
}

export interface Player extends PlayerLite {
  is_host: boolean;
}

export interface Score {
  player_id: string;
  name: string;
  emoji: string;
  points: number;
  rank: number;
}

export interface Vote {
  voter_id: string;
  guessed_player_id: string;
  correct: boolean;
}

export interface GameState {
  phase: Phase;
  version: number;
  code: string;
  is_host: boolean;
  me: PlayerLite;
  players: Player[];
  liar_bonus: boolean;
  mode: Mode;
  questions_per_player: number;
  host_pin?: string;
  // writing
  my_anecdote?: string | null;
  saved_player_ids?: string[];
  my_questions?: { slot: number; question: string; answer: string | null }[];
  answer_count?: number;
  // voting / reveal
  index?: number;
  total?: number;
  anecdote?: { id: string; text: string; question?: string | null };
  is_mine?: boolean;
  my_vote?: string | null;
  voted_count?: number;
  voter_count?: number;
  voted_player_ids?: string[];
  // reveal
  author?: PlayerLite;
  votes?: Vote[];
  scores?: Score[];
  // final
  all_anecdotes?: { text: string; question?: string | null; author: PlayerLite }[];
}

export interface Session {
  roomCode: string;
  playerId: string;
  secret: string;
}
