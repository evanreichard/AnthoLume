import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EBookReader, type ReaderStats, type ReaderTocItem } from '../lib/reader/EBookReader';
import type { ReaderColorScheme, ReaderFontFamily } from '../utils/localSettings';

interface UseEpubReaderOptions {
  documentId: string;
  initialProgress?: string;
  deviceId: string;
  deviceName: string;
  colorScheme: ReaderColorScheme;
  fontFamily: ReaderFontFamily;
  fontSize: number;
}

interface UseEpubReaderResult {
  viewerRef: (_node: HTMLDivElement | null) => void;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  toc: ReaderTocItem[];
  stats: ReaderStats;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  goToHref: (href: string) => Promise<void>;
  setTheme: (theme: {
    colorScheme?: ReaderColorScheme;
    fontFamily?: ReaderFontFamily;
    fontSize?: number;
  }) => Promise<void>;
}

export function useEpubReader({
  documentId,
  initialProgress,
  deviceId,
  deviceName,
  colorScheme,
  fontFamily,
  fontSize,
}: UseEpubReaderOptions): UseEpubReaderResult {
  const [viewerNode, setViewerNode] = useState<HTMLDivElement | null>(null);
  const readerRef = useRef<EBookReader | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [stats, setStats] = useState<ReaderStats>({
    chapterName: 'N/A',
    sectionPage: 0,
    sectionTotalPages: 0,
    percentage: 0,
  });

  useEffect(() => {
    const container = viewerNode;
    if (!container) {
      return;
    }

    setIsReady(false);
    setIsLoading(true);
    setError(null);
    setToc([]);
    setStats({
      chapterName: 'N/A',
      sectionPage: 0,
      sectionTotalPages: 0,
      percentage: 0,
    });

    const reader = new EBookReader({
      container,
      documentId,
      initialProgress,
      deviceId,
      deviceName,
      colorScheme,
      fontFamily,
      fontSize,
      onReady: () => setIsReady(true),
      onLoading: loading => setIsLoading(loading),
      onError: message => setError(message),
      onStats: nextStats => setStats(nextStats),
      onToc: nextToc => setToc(nextToc),
    });

    readerRef.current = reader;

    return () => {
      reader.destroy();
      if (readerRef.current === reader) {
        readerRef.current = null;
      }
    };
  }, [deviceId, deviceName, documentId, initialProgress, viewerNode]);

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || !isReady) {
      return;
    }

    void reader.applyThemeChange({
      colorScheme,
      fontFamily,
      fontSize,
    });
  }, [colorScheme, fontFamily, fontSize, isReady]);

  const nextPage = useCallback(async () => {
    await readerRef.current?.nextPage();
  }, []);

  const prevPage = useCallback(async () => {
    await readerRef.current?.prevPage();
  }, []);

  const goToHref = useCallback(async (href: string) => {
    await readerRef.current?.displayHref(href);
  }, []);

  const setTheme = useCallback(
    async (theme: {
      colorScheme?: ReaderColorScheme;
      fontFamily?: ReaderFontFamily;
      fontSize?: number;
    }) => {
      await readerRef.current?.applyThemeChange(theme);
    },
    []
  );

  return useMemo(
    () => ({
      viewerRef: setViewerNode,
      isReady,
      isLoading,
      error,
      toc,
      stats,
      nextPage,
      prevPage,
      goToHref,
      setTheme,
    }),
    [error, goToHref, isLoading, isReady, nextPage, prevPage, setTheme, stats, toc]
  );
}
