import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DemoProvider } from './DemoState';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <DemoProvider>
    <App />
  </DemoProvider>,
);
