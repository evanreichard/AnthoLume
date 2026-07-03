import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGetDocument, useGetProgress } from '../generated/anthoLumeAPIV1';
import { LoadingState } from '../components/LoadingState';
import { SegmentedControl } from '../components/SegmentedControl';
import { CloseIcon } from '../icons';
import {
  READER_COLOR_SCHEMES,
  READER_FONT_FAMILIES,
  type ReaderColorScheme,
  type ReaderFontFamily,
  getReaderDevice,
  useLocalSetting,
} from '../utils/localSettings';
import { useEpubReader } from '../hooks/useEpubReader';
import { dataForStatus } from '../utils/apiResponses';

const READER_SEGMENT_BUTTON = 'rounded border px-2 py-1.5 text-xs sm:text-sm';
const READER_SEGMENT_ACTIVE = 'border-primary-500 bg-primary-500/10 text-content';
const READER_SEGMENT_INACTIVE =
  'border-border text-content-muted hover:bg-surface-muted hover:text-content';

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const [isTopBarOpen, setIsTopBarOpen] = useState(false);
  const [isBottomBarOpen, setIsBottomBarOpen] = useState(false);
  const [colorScheme, setColorScheme] = useLocalSetting('readerColorScheme', 'tan');
  const [fontFamily, setFontFamily] = useLocalSetting('readerFontFamily', 'Serif');
  const [fontSize, setFontSize] = useLocalSetting('readerFontSize', 1);

  const { id: defaultDeviceId, name: defaultDeviceName } = useMemo(() => getReaderDevice(), []);

  const { data: documentResponse, isLoading: isDocumentLoading } = useGetDocument(id || '', {
    query: { enabled: Boolean(id) },
  });
  const { data: progressResponse, isLoading: isProgressLoading } = useGetProgress(id || '', {
    query: {
      retry: false,
      refetchOnWindowFocus: false,
      enabled: Boolean(id),
    },
  });
  const document = dataForStatus(documentResponse, 200)?.document;
  const progress = dataForStatus(progressResponse, 200)?.progress;

  const deviceId = defaultDeviceId;
  const deviceName = defaultDeviceName;

  const handleSwipeDown = useCallback(() => {
    if (isBottomBarOpen) {
      setIsBottomBarOpen(false);
      return;
    }
    if (!isTopBarOpen) {
      setIsTopBarOpen(true);
    }
  }, [isBottomBarOpen, isTopBarOpen]);

  const handleSwipeUp = useCallback(() => {
    if (isTopBarOpen) {
      setIsTopBarOpen(false);
      return;
    }
    if (!isBottomBarOpen) {
      setIsBottomBarOpen(true);
    }
  }, [isBottomBarOpen, isTopBarOpen]);

  const handleCenterTap = useCallback(() => {
    setIsTopBarOpen(false);
    setIsBottomBarOpen(false);
  }, []);

  const reader = useEpubReader({
    documentId: id || '',
    initialProgress: progress?.progress,
    deviceId,
    deviceName,
    colorScheme,
    fontFamily,
    fontSize,
    isPaginationDisabled: useCallback(
      () => isTopBarOpen || isBottomBarOpen,
      [isTopBarOpen, isBottomBarOpen]
    ),
    onSwipeDown: handleSwipeDown,
    onSwipeUp: handleSwipeUp,
    onCenterTap: handleCenterTap,
  });

  useEffect(() => {
    if (document?.title) {
      window.document.title = `AnthoLume - Reader - ${document.title}`;
    }
  }, [document?.title]);

  useEffect(() => {
    if (isTopBarOpen || isBottomBarOpen) {
      return;
    }

    const activeElement = window.document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }, [isBottomBarOpen, isTopBarOpen]);

  if (isDocumentLoading || isProgressLoading) {
    return <LoadingState className="min-h-screen bg-canvas" message="Loading reader..." />;
  }

  if (!id || !document) {
    return <div className="p-6 text-content-muted">Document not found</div>;
  }

  return (
    <div className="fixed inset-0 z-50 bg-canvas text-content">
      <div className="relative flex h-dvh flex-col overflow-hidden">
        <div
          className={`absolute inset-x-0 top-0 z-20 border-b border-border bg-surface/95 backdrop-blur transition-transform duration-200 ${
            isTopBarOpen ? 'translate-y-0' : '-translate-y-full'
          }`}
        >
          <div className="mx-auto flex max-h-[70vh] min-h-0 w-full max-w-6xl flex-col gap-4 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <Link to={`/documents/${document.id}`} className="block shrink-0">
                  <img
                    className="h-28 w-20 rounded object-cover shadow-sm"
                    src={`/api/v1/documents/${document.id}/cover`}
                    alt={`${document.title} cover`}
                  />
                </Link>
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-content-subtle">Title</p>
                  <p className="truncate text-lg font-semibold text-content">{document.title}</p>
                  <p className="mt-3 text-xs uppercase tracking-wide text-content-subtle">Author</p>
                  <p className="truncate text-sm text-content-muted">{document.author}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  to={`/documents/${document.id}`}
                  className="rounded border border-border px-3 py-2 text-sm text-content-muted hover:bg-surface-muted hover:text-content"
                >
                  Back
                </Link>
                <button
                  type="button"
                  onClick={() => setIsTopBarOpen(false)}
                  className="rounded border border-border p-2 text-content-muted hover:bg-surface-muted hover:text-content"
                  aria-label="Close reader details"
                >
                  <CloseIcon size={18} />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto pb-2 sm:grid-cols-2 lg:grid-cols-3">
              {reader.toc.map(item => (
                <button
                  key={`${item.href}-${item.title}`}
                  type="button"
                  onClick={() => {
                    void reader.goToHref(item.href);
                    setIsTopBarOpen(false);
                  }}
                  className="truncate rounded border border-border bg-surface px-3 py-2 text-left text-sm text-content-muted hover:bg-surface-muted hover:text-content"
                >
                  {item.title}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="absolute inset-0 pt-[env(safe-area-inset-top)]">
          {reader.isLoading && (
            <LoadingState
              className="absolute inset-0 z-10 min-h-full bg-canvas"
              message="Opening book..."
            />
          )}
          {reader.error ? (
            <div className="flex h-full items-center justify-center p-6 text-content-muted">
              {reader.error}
            </div>
          ) : (
            <div ref={reader.viewerRef} className="size-full bg-canvas" />
          )}
        </div>

        <div
          className={`absolute inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur transition-transform duration-200 ${
            isBottomBarOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-content-muted sm:text-sm">
              <div>
                <span className="text-content-subtle">Chapter:</span> {reader.stats.chapterName}
              </div>
              <div>
                <span className="text-content-subtle">Chapter Pages:</span>{' '}
                {reader.stats.sectionPage} / {reader.stats.sectionTotalPages}
              </div>
              <div>
                <span className="text-content-subtle">Progress:</span>{' '}
                {reader.stats.percentage.toFixed(2)}%
              </div>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-surface-strong">
              <div
                className="h-full bg-tertiary-500 transition-all"
                style={{ width: `${reader.stats.percentage}%` }}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto] lg:items-start">
              <div className="min-w-0">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-content-subtle">
                  Theme
                </p>
                <SegmentedControl<ReaderColorScheme>
                  className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5"
                  ariaLabel="Reader theme"
                  value={colorScheme}
                  onChange={setColorScheme}
                  buttonClassName={`${READER_SEGMENT_BUTTON} capitalize`}
                  activeClassName={READER_SEGMENT_ACTIVE}
                  inactiveClassName={READER_SEGMENT_INACTIVE}
                  options={READER_COLOR_SCHEMES.map(value => ({ value, label: value }))}
                />
              </div>

              <div className="min-w-0">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-content-subtle">Font</p>
                <SegmentedControl<ReaderFontFamily>
                  className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4"
                  ariaLabel="Reader font"
                  value={fontFamily}
                  onChange={setFontFamily}
                  buttonClassName={READER_SEGMENT_BUTTON}
                  activeClassName={READER_SEGMENT_ACTIVE}
                  inactiveClassName={READER_SEGMENT_INACTIVE}
                  options={READER_FONT_FAMILIES.map(value => ({ value, label: value }))}
                />
              </div>

              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-content-subtle">
                  Font Size
                </p>
                <div className="flex items-center gap-1.5 lg:justify-end">
                  <button
                    type="button"
                    onClick={() => setFontSize(Math.max(0.8, Number((fontSize - 0.1).toFixed(2))))}
                    className="rounded border border-border px-2.5 py-1.5 text-sm text-content-muted hover:bg-surface-muted hover:text-content"
                  >
                    -
                  </button>
                  <div className="min-w-12 text-center text-xs text-content sm:text-sm">
                    {fontSize.toFixed(1)}x
                  </div>
                  <button
                    type="button"
                    onClick={() => setFontSize(Math.min(2.2, Number((fontSize + 0.1).toFixed(2))))}
                    className="rounded border border-border px-2.5 py-1.5 text-sm text-content-muted hover:bg-surface-muted hover:text-content"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
