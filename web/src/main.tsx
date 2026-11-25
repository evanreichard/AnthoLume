import { createRoot } from 'react-dom/client';
import { deleteLegacyIndexedDB } from './legacy-storage';
import { session } from './session';
import './tokens.css';

if (CSS.supports('-webkit-touch-callout', 'none') && navigator.maxTouchPoints > 0) {
  const root = document.documentElement;
  window.addEventListener(
    'pointerdown',
    (event) => root.toggleAttribute('data-touch-focus', event.pointerType === 'touch'),
    true,
  );
  window.addEventListener('keydown', () => root.removeAttribute('data-touch-focus'), true);
}

deleteLegacyIndexedDB();
const { App } = await import('./App');
createRoot(document.getElementById('root')!).render(<App />);
void session.bootstrap();
