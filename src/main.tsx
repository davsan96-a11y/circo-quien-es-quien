import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary, UiProvider } from './components/ui';
import { normalizeInitialUrl } from './lib/router';
import './styles.css';

normalizeInitialUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <UiProvider>
        <App />
      </UiProvider>
    </ErrorBoundary>
  </StrictMode>,
);
