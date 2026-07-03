import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getThemeMode, setThemeMode, type ThemeMode } from '../utils/localSettings';

export type ResolvedThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  themeMode: ThemeMode;
  resolvedThemeMode: ResolvedThemeMode;
  setThemeMode: (themeMode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemThemeMode(): ResolvedThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveThemeMode(themeMode: ThemeMode): ResolvedThemeMode {
  return themeMode === 'system' ? getSystemThemeMode() : themeMode;
}

export function applyThemeMode(themeMode: ThemeMode): ResolvedThemeMode {
  const resolvedThemeMode = resolveThemeMode(themeMode);

  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', resolvedThemeMode === 'dark');
    document.documentElement.dataset.themeMode = themeMode;
    document.documentElement.style.colorScheme = resolvedThemeMode;
  }

  return resolvedThemeMode;
}

export function initializeThemeMode(): ResolvedThemeMode {
  return applyThemeMode(getThemeMode());
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeModeState, setThemeModeState] = useState<ThemeMode>(() => getThemeMode());
  const [resolvedThemeMode, setResolvedThemeMode] = useState<ResolvedThemeMode>(() =>
    resolveThemeMode(getThemeMode())
  );

  useEffect(() => {
    setResolvedThemeMode(applyThemeMode(themeModeState));
  }, [themeModeState]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');

    const handleSystemThemeChange = () => {
      if (themeModeState === 'system') {
        setResolvedThemeMode(applyThemeMode('system'));
      }
    };

    mediaQueryList.addEventListener('change', handleSystemThemeChange);
    return () => {
      mediaQueryList.removeEventListener('change', handleSystemThemeChange);
    };
  }, [themeModeState]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== 'antholume:settings') {
        return;
      }

      const nextThemeMode = getThemeMode();
      setThemeModeState(nextThemeMode);
      setResolvedThemeMode(applyThemeMode(nextThemeMode));
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const updateThemeMode = useCallback((nextThemeMode: ThemeMode) => {
    setThemeMode(nextThemeMode);
    setThemeModeState(nextThemeMode);
    setResolvedThemeMode(applyThemeMode(nextThemeMode));
  }, []);

  const value = useMemo(
    () => ({
      themeMode: themeModeState,
      resolvedThemeMode,
      setThemeMode: updateThemeMode,
    }),
    [resolvedThemeMode, themeModeState, updateThemeMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}
