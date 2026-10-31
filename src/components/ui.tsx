import { Component, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { navigate } from '../lib/router';

// ───────── Toasts + confirmaciones ─────────

interface ConfirmOpts {
  title: string;
  body?: string;
  ok: string;
  danger?: boolean;
}

interface UiCtx {
  toast: (msg: string, kind?: 'error' | 'info') => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
}

const Ctx = createContext<UiCtx>({ toast: () => {}, confirm: async () => false });
export const useUi = () => useContext(Ctx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [dlg, setDlg] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const idRef = useRef(0);

  const toast = useCallback((msg: string, kind: 'error' | 'info' = 'error') => {
    const id = ++idRef.current;
    setToasts((t) => [...t.filter((x) => x.msg !== msg), { id, msg, kind }].slice(-3));
    // Los avisos de éxito duran poco para no tapar la pantalla siguiente
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'info' ? 1600 : 3800);
  }, []);

  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setDlg({ ...o, resolve })),
    [],
  );

  const close = (v: boolean) => {
    dlg?.resolve(v);
    setDlg(null);
  };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
      {dlg && (
        <div className="modal-back" onClick={() => close(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">{dlg.title}</h3>
            {dlg.body && <p className="modal-body">{dlg.body}</p>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => close(false)}>
                Cancelar
              </button>
              <button className={`btn ${dlg.danger ? 'btn-red' : 'btn-gold'}`} onClick={() => close(true)}>
                {dlg.ok}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

// ───────── Error boundary ─────────

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error(err);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page center-page">
        <Stripes />
        <div className="big-emoji">🤡</div>
        <h1 className="title-creepy">¡Ups! Algo se ha roto</h1>
        <p className="muted">No pasa nada: recarga y vuelves a tu partida.</p>
        <button className="btn btn-red" onClick={() => window.location.reload()}>
          Recargar
        </button>
      </div>
    );
  }
}

// ───────── Piezas visuales ─────────

export function Stripes() {
  return <div className="stripes" aria-hidden="true" />;
}

export function Tent() {
  return (
    <svg className="tent" viewBox="0 0 120 110" aria-hidden="true">
      <polygon points="60,6 60,0 74,4 60,8" fill="#F4B942" />
      <polygon points="60,8 0,68 120,68" fill="#E0313F" />
      <polygon points="60,8 42,68 78,68" fill="#FBF3E4" />
      <rect x="8" y="68" width="104" height="40" fill="#2A1830" />
      <circle cx="31" cy="87" r="5" fill="#F4B942" />
      <circle cx="89" cy="87" r="5" fill="#F4B942" />
      <path d="M44 108 a16 16 0 0 1 32 0 z" fill="#120A14" />
    </svg>
  );
}

export function HostBar({ children, label, pin }: { children: ReactNode; label?: ReactNode; pin?: string }) {
  return (
    <div className="hostbar">
      <div className="hostbar-head">
        <span>
          MAESTRO DE PISTA{pin && <span className="hostbar-pin"> · PIN {pin}</span>}
        </span>
        {label && <span>{label}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Botón principal del anfitrión. Se desactiva mientras la acción está en curso y durante un
 * instante al aparecer, para que un doble toque no dispare la acción de la pantalla siguiente
 * (p. ej. "Revelar" → "Siguiente anécdota" están en el mismo sitio).
 */
export function HostButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => Promise<unknown> | void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 600);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <button
      className="btn btn-dark"
      disabled={disabled || busy || !ready}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

/** Vuelve a la portada sin abandonar la partida (se puede volver con "Volver a mi partida") */
export function ExitLink() {
  return (
    <button className="link exit-link muted-link" onClick={() => navigate('')}>
      ‹ Salir al menú
    </button>
  );
}

export function OfflineBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return <div className="offline">Sin conexión, reintentando…</div>;
}

export function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}
