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

// Borradores de lo que se está escribiendo y aún no se ha guardado (por sala y hueco)
const draftKey = (code: string, slot: number) => `qeq_draft_${code}_${slot}`;

export function loadDraft(code: string, slot = 0): string | null {
  try {
    return localStorage.getItem(draftKey(code, slot));
  } catch {
    return null;
  }
}

export function saveDraft(code: string, text: string, slot = 0): void {
  try {
    localStorage.setItem(draftKey(code, slot), text);
  } catch {
    /* nada */
  }
}

export function clearDraft(code: string, slot = 0): void {
  try {
    localStorage.removeItem(draftKey(code, slot));
  } catch {
    /* nada */
  }
}

/** Borra todos los borradores de una sala (al salir de la fase de escribir) */
export function clearDrafts(code: string): void {
  try {
    const prefix = `qeq_draft_${code}`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) localStorage.removeItem(k);
    }
  } catch {
    /* nada */
  }
}
