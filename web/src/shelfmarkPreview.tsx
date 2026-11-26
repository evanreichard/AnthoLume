import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const setting = 'antholume:shelfmark-preview:';
type Mode = 'missing' | 'enabled' | 'disabled';

function readFlag(key: string) {
  try {
    return sessionStorage.getItem(setting + key) === '1';
  } catch {
    return false;
  }
}
function saveFlag(key: string, value: boolean) {
  try {
    if (value) sessionStorage.setItem(setting + key, '1');
    else sessionStorage.removeItem(setting + key);
  } catch {
    /* The preview still works without tab storage. */
  }
}

const Preview = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'missing', toggle: () => {} });
export const useShelfmarkPreview = () => useContext(Preview);

export function ShelfmarkPreview({ children }: { children: ReactNode }) {
  const [configured] = useState(() => {
    const scenario = new URLSearchParams(window.location.search).get('shelfmarkPreview');
    return scenario === 'configured' || (scenario !== 'missing' && readFlag('configured'));
  });
  const [disabled, setDisabled] = useState(() => readFlag('disabled'));
  useEffect(() => {
    saveFlag('configured', configured);
  }, [configured]);
  function toggle() {
    if (!configured) return;
    saveFlag('disabled', !disabled);
    setDisabled(!disabled);
  }
  return (
    <Preview.Provider value={{ mode: !configured ? 'missing' : disabled ? 'disabled' : 'enabled', toggle }}>
      {children}
    </Preview.Provider>
  );
}
