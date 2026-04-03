import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createActivity, getGetDocumentFileUrl, updateProgress } from '../generated/anthoLumeAPIV1';
import type { CreateActivityRequest } from '../generated/model/createActivityRequest';
import type { UpdateProgressRequest } from '../generated/model/updateProgressRequest';
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
  isPaginationDisabled: () => boolean;
  onSwipeDown: () => void;
  onSwipeUp: () => void;
  onCenterTap: () => void;
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
  isPaginationDisabled,
  onSwipeDown,
  onSwipeUp,
  onCenterTap,
}: UseEpubReaderOptions): UseEpubReaderResult {
  const [viewerNode, setViewerNode] = useState<HTMLDivElement | null>(null);
  const readerRef = useRef<EBookReader | null>(null);
  const isPaginationDisabledRef = useRef(isPaginationDisabled);
  const onSwipeDownRef = useRef(onSwipeDown);
  const onSwipeUpRef = useRef(onSwipeUp);
  const onCenterTapRef = useRef(onCenterTap);
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
    isPaginationDisabledRef.current = isPaginationDisabled;
    onSwipeDownRef.current = onSwipeDown;
    onSwipeUpRef.current = onSwipeUp;
    onCenterTapRef.current = onCenterTap;
  }, [isPaginationDisabled, onCenterTap, onSwipeDown, onSwipeUp]);

  useEffect(() => {
    const container = viewerNode;
    if (!container) {
      return;
    }

    let isCancelled = false;
    let objectUrl: string | null = null;
    let reader: EBookReader | null = null;

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

    const saveProgress = async (payload: UpdateProgressRequest) => {
      const response = await updateProgress(payload);
      if (response.status >= 400) {
        throw new Error(
          'message' in response.data ? response.data.message : 'Unable to save reader progress'
        );
      }
    };

    const saveActivity = async (payload: CreateActivityRequest) => {
      const response = await createActivity(payload);
      if (response.status >= 400) {
        throw new Error(
          'message' in response.data ? response.data.message : 'Unable to save reader activity'
        );
      }
    };

    const initializeReader = async () => {
      try {
        const response = await fetch(getGetDocumentFileUrl(documentId));
        const contentType = response.headers.get('content-type') || '';

        if (!response.ok || contentType.includes('application/json')) {
          let message = 'Unable to load document file';
          try {
            const errorData = (await response.json()) as { message?: string };
            if (errorData.message) {
              message = errorData.message;
            }
          } catch {
            // ignore parse failure and use fallback message
          }
          throw new Error(message);
        }

        const blob = await response.blob();
        if (isCancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        reader = new EBookReader({
          container,
          bookUrl: objectUrl,
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
          onSaveProgress: saveProgress,
          onCreateActivity: saveActivity,
          isPaginationDisabled: () => isPaginationDisabledRef.current(),
          onSwipeDown: () => onSwipeDownRef.current(),
          onSwipeUp: () => onSwipeUpRef.current(),
          onCenterTap: () => onCenterTapRef.current(),
        });

        readerRef.current = reader;
      } catch (err) {
        if (isCancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Unable to load document file');
        setIsLoading(false);
      }
    };

    void initializeReader();

    return () => {
      isCancelled = true;
      reader?.destroy();
      if (readerRef.current === reader) {
        readerRef.current = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
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
