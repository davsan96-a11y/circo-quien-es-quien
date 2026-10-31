import { useEffect } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };

/** Mantiene la pantalla encendida mientras el componente esté montado (si el navegador lo soporta). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } };
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        if (document.visibilityState !== 'visible') return;
        if (sentinel && !sentinel.released) return;
        const s = await nav.wakeLock!.request('screen');
        if (cancelled) s.release().catch(() => {});
        else sentinel = s;
      } catch {
        /* no soportado o denegado: ignorar */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') request();
    };
    request();
    document.addEventListener('visibilitychange', onVisible);
    // iOS solo concede el bloqueo tras un gesto del usuario
    document.addEventListener('pointerdown', request, { passive: true });
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('pointerdown', request);
      sentinel?.release().catch(() => {});
    };
  }, [active]);
}
