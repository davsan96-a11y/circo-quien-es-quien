import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'join'; code: string }
  | { name: 'create' }
  | { name: 'recover'; code: string }
  | { name: 'room'; code: string };

const cleanCode = (c: string | undefined | null) =>
  (c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

export function parseRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [seg, arg] = h.split('/');
  switch (seg) {
    case 'sala':
      return { name: 'room', code: cleanCode(arg) };
    case 'unirse':
      return { name: 'join', code: cleanCode(arg) };
    case 'crear':
      return { name: 'create' };
    case 'anfitrion':
      return { name: 'recover', code: cleanCode(arg) };
    default:
      return { name: 'home' };
  }
}

export function navigate(path: string, replace = false) {
  const target = `#/${path.replace(/^\/+/, '')}`;
  if (replace) window.history.replaceState(null, '', target);
  else window.location.hash = target;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Convierte ?sala=ABCD en #/sala/ABCD al arrancar */
export function normalizeInitialUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const sala = cleanCode(params.get('sala'));
    if (sala) {
      const base = window.location.pathname;
      window.history.replaceState(null, '', `${base}#/sala/${sala}`);
    }
  } catch {
    /* nada */
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function roomUrl(code: string) {
  return `${window.location.origin}${window.location.pathname}#/sala/${code}`;
}
