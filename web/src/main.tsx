import { createRoot } from 'react-dom/client';
import { session } from './session';
import './tokens.css';

if (location.pathname === '/') history.replaceState(null, '', `/app/${location.search}`);
const { App } = await import('./App');
createRoot(document.getElementById('root')!).render(<App />);
void session.bootstrap();
