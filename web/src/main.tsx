import { createRoot } from 'react-dom/client';
import { session } from './session';
import './tokens.css';

const { App } = await import('./App');
createRoot(document.getElementById('root')!).render(<App />);
void session.bootstrap();
