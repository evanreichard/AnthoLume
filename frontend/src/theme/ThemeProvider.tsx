import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  useLocalSetting,
  readLocalSetting,
  type ThemeMode,
} from '../utils/localSettings';

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
  return applyThemeMode(readLocalSetting('themeMode', 'system'));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeMode] = useLocalSetting('themeMode', 'system');
  const [resolvedThemeMode, setResolvedThemeMode] = useState<ResolvedThemeMode>(() =>
    resolveThemeMode(themeMode)
  );

  // Single Source Of Truth - The mode effect is the only place that applies the theme to the DOM and resolves it into state. Every other code path just calls `setThemeMode`.
  useEffect(() => {
    setResolvedThemeMode(applyThemeMode(themeMode));
  }, [themeMode]);

  // System Preference - When the user follows 'system', the resolved theme must react to OS changes even though `themeMode` is unchanged.
  useEffect(() => {
    if (typeof window === 'undefined' || themeMode !== 'system') {
      return undefined;
    }

    const mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      setResolvedThemeMode(applyThemeMode('system'));
    };

    mediaQueryList.addEventListener('change', handleSystemThemeChange);
    return () => {
      mediaQueryList.removeEventListener('change', handleSystemThemeChange);
    };
  }, [themeMode]);

  const value = useMemo(
    () => ({
      themeMode,
      resolvedThemeMode,
      setThemeMode,
    }),
    [resolvedThemeMode, themeMode, setThemeMode]
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
