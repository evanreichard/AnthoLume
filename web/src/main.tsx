import { createRoot } from 'react-dom/client';
import { deleteLegacyIndexedDB } from './legacy-storage';
import { session } from './session';
import './tokens.css';

deleteLegacyIndexedDB();
const { App } = await import('./App');
createRoot(document.getElementById('root')!).render(<App />);
void session.bootstrap();
