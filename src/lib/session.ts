import type { Session } from './types';

const KEY = 'qeq_session_v1';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (s && s.roomCode && s.playerId && s.secret) return s;
  } catch {
    /* localStorage no disponible */
  }
  return null;
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* modo privado o almacenamiento lleno: seguimos en memoria */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}

export function loadDraft(code: string): string | null {
  try {
    return localStorage.getItem(`qeq_draft_${code}`);
  } catch {
    return null;
  }
}

export function saveDraft(code: string, text: string): void {
  try {
    localStorage.setItem(`qeq_draft_${code}`, text);
  } catch {
    /* nada */
  }
}
