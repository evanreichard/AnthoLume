import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGetDocument, useGetProgress } from '../generated/anthoLumeAPIV1';
import { LoadingState } from '../components/LoadingState';
import { CloseIcon } from '../icons';
import {
  getReaderColorScheme,
  getReaderDevice,
  getReaderFontFamily,
  getReaderFontSize,
  setReaderColorScheme,
  setReaderFontFamily,
  setReaderFontSize,
  type ReaderColorScheme,
  type ReaderFontFamily,
} from '../utils/localSettings';
import { useEpubReader } from '../hooks/useEpubReader';

const colorSchemes: ReaderColorScheme[] = ['light', 'tan', 'blue', 'gray', 'black'];
const fontFamilies: ReaderFontFamily[] = ['Serif', 'Open Sans', 'Arbutus Slab', 'Lato'];

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const [isTopBarOpen, setIsTopBarOpen] = useState(false);
  const [isBottomBarOpen, setIsBottomBarOpen] = useState(true);
  const [colorScheme, setColorSchemeState] = useState<ReaderColorScheme>(getReaderColorScheme());
  const [fontFamily, setFontFamilyState] = useState<ReaderFontFamily>(getReaderFontFamily());
  const [fontSize, setFontSizeState] = useState<number>(getReaderFontSize());

  const { id: defaultDeviceId, name: defaultDeviceName } = useMemo(() => getReaderDevice(), []);

  const { data: documentResponse, isLoading: isDocumentLoading } = useGetDocument(id || '');
  const { data: progressResponse, isLoading: isProgressLoading } = useGetProgress(id || '', {
    query: {
      retry: false,
    },
  });
  const document = documentResponse?.status === 200 ? documentResponse.data.document : null;
  const progress = progressResponse?.status === 200 ? progressResponse.data.progress : undefined;

  const deviceId = defaultDeviceId;
  const deviceName = defaultDeviceName;

  const reader = useEpubReader({
    documentId: id || '',
    initialProgress: progress?.progress,
    deviceId,
    deviceName,
    colorScheme,
    fontFamily,
    fontSize,
  });

  useEffect(() => {
    if (document?.title) {
      window.document.title = `AnthoLume - Reader - ${document.title}`;
    }
  }, [document?.title]);

  useEffect(() => {
    reader.setTheme({ colorScheme, fontFamily, fontSize });
  }, [colorScheme, fontFamily, fontSize, reader.setTheme]);

  if (isDocumentLoading || isProgressLoading) {
    return <LoadingState className="min-h-screen bg-canvas" message="Loading reader..." />;
  }

  if (!id || !document || documentResponse?.status !== 200) {
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
          <div className="mx-auto flex max-h-[70vh] w-full max-w-6xl flex-col gap-4 overflow-auto p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <Link to={`/documents/${document.id}`} className="block shrink-0">
                  <img
                    className="h-28 w-20 rounded object-cover shadow"
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

            <div className="grid gap-2 pb-2 sm:grid-cols-2 lg:grid-cols-3">
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

        <div className="absolute left-4 top-4 z-10 flex gap-2">
          <button
            type="button"
            onClick={() => setIsTopBarOpen(open => !open)}
            className="rounded bg-surface/90 px-3 py-2 text-sm font-medium text-content shadow backdrop-blur hover:bg-surface"
          >
            Contents
          </button>
          <button
            type="button"
            onClick={() => setIsBottomBarOpen(open => !open)}
            className="rounded bg-surface/90 px-3 py-2 text-sm font-medium text-content shadow backdrop-blur hover:bg-surface"
          >
            Controls
          </button>
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
          <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-content-muted">
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

            <div className="h-2 overflow-hidden rounded-full bg-surface-strong">
              <div
                className="h-full bg-tertiary-500 transition-all"
                style={{ width: `${reader.stats.percentage}%` }}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto]">
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-content-subtle">Theme</p>
                <div className="flex flex-wrap gap-2">
                  {colorSchemes.map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setColorSchemeState(option);
                        setReaderColorScheme(option);
                      }}
                      className={`rounded border px-3 py-2 text-sm capitalize ${
                        colorScheme === option
                          ? 'border-primary-500 bg-primary-500/10 text-content'
                          : 'border-border text-content-muted hover:bg-surface-muted hover:text-content'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-content-subtle">Font</p>
                <div className="flex flex-wrap gap-2">
                  {fontFamilies.map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setFontFamilyState(option);
                        setReaderFontFamily(option);
                      }}
                      className={`rounded border px-3 py-2 text-sm ${
                        fontFamily === option
                          ? 'border-primary-500 bg-primary-500/10 text-content'
                          : 'border-border text-content-muted hover:bg-surface-muted hover:text-content'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-content-subtle">
                  Font Size
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextSize = Math.max(0.8, Number((fontSize - 0.1).toFixed(2)));
                      setFontSizeState(nextSize);
                      setReaderFontSize(nextSize);
                    }}
                    className="rounded border border-border px-3 py-2 text-content-muted hover:bg-surface-muted hover:text-content"
                  >
                    -
                  </button>
                  <div className="min-w-16 text-center text-sm text-content">
                    {fontSize.toFixed(1)}x
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextSize = Math.min(2.2, Number((fontSize + 0.1).toFixed(2)));
                      setFontSizeState(nextSize);
                      setReaderFontSize(nextSize);
                    }}
                    className="rounded border border-border px-3 py-2 text-content-muted hover:bg-surface-muted hover:text-content"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => void reader.prevPage()}
                  disabled={!reader.isReady}
                  className="rounded bg-secondary-700 px-4 py-2 text-sm font-medium text-white hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => void reader.nextPage()}
                  disabled={!reader.isReady}
                  className="rounded bg-secondary-700 px-4 py-2 text-sm font-medium text-white hover:bg-secondary-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
