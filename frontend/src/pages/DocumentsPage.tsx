import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetDocuments, useCreateDocument } from '../generated/anthoLumeAPIV1';
import type { Document, DocumentsResponse } from '../generated/model';
import { ActivityIcon, DownloadIcon, Search2Icon, UploadIcon } from '../icons';
import { LoadingState } from '../components';
import { useToasts } from '../components/ToastContext';
import { formatDuration } from '../utils/formatters';
import { useDebounce } from '../hooks/useDebounce';
import { getErrorMessage } from '../utils/errors';
import {
  getDocumentsViewMode,
  setDocumentsViewMode,
  type DocumentsViewMode,
} from '../utils/localSettings';

interface DocumentCardProps {
  doc: Document;
}

function DocumentCard({ doc }: DocumentCardProps) {
  const navigate = useNavigate();
  const percentage = doc.percentage || 0;
  const totalTimeSeconds = doc.total_time_seconds || 0;

  return (
    <div className="relative w-full">
      <div
        role="link"
        tabIndex={0}
        className="flex size-full cursor-pointer gap-4 rounded bg-surface p-4 shadow-lg transition-colors hover:bg-surface-muted focus:outline-none"
        onClick={() => navigate(`/documents/${doc.id}`)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            navigate(`/documents/${doc.id}`);
          }
        }}
      >
        <div className="relative my-auto h-48 min-w-fit">
          <img
            className="h-full rounded object-cover"
            src={`/api/v1/documents/${doc.id}/cover`}
            alt={doc.title}
          />
        </div>
        <div className="flex w-full flex-col justify-around text-sm text-content">
          <div className="inline-flex shrink-0 items-center">
            <div>
              <p className="text-content-subtle">Title</p>
              <p className="font-medium">{doc.title || 'Unknown'}</p>
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center">
            <div>
              <p className="text-content-subtle">Author</p>
              <p className="font-medium">{doc.author || 'Unknown'}</p>
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center">
            <div>
              <p className="text-content-subtle">Progress</p>
              <p className="font-medium">{percentage}%</p>
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center">
            <div>
              <p className="text-content-subtle">Time Read</p>
              <p className="font-medium">{formatDuration(totalTimeSeconds)}</p>
            </div>
          </div>
        </div>
        <div className="absolute bottom-4 right-4 flex flex-col gap-2 text-content-muted">
          <Link to={`/activity?document=${doc.id}`} onClick={e => e.stopPropagation()}>
            <ActivityIcon size={20} />
          </Link>
          {doc.filepath ? (
            <a href={`/api/v1/documents/${doc.id}/file`} onClick={e => e.stopPropagation()}>
              <DownloadIcon size={20} />
            </a>
          ) : (
            <DownloadIcon size={20} disabled />
          )}
        </div>
      </div>
    </div>
  );
}

interface DocumentListItemProps {
  doc: Document;
}

function DocumentListItem({ doc }: DocumentListItemProps) {
  const navigate = useNavigate();
  const percentage = doc.percentage || 0;
  const totalTimeSeconds = doc.total_time_seconds || 0;

  return (
    <div
      role="link"
      tabIndex={0}
      className="block cursor-pointer rounded bg-surface p-4 text-content shadow-lg transition-colors hover:bg-surface-muted focus:outline-none"
      onClick={() => navigate(`/documents/${doc.id}`)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(`/documents/${doc.id}`);
        }
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="grid flex-1 grid-cols-1 gap-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-content-subtle">Title</p>
            <p className="font-medium">{doc.title || 'Unknown'}</p>
          </div>
          <div>
            <p className="text-content-subtle">Author</p>
            <p className="font-medium">{doc.author || 'Unknown'}</p>
          </div>
          <div>
            <p className="text-content-subtle">Progress</p>
            <p className="font-medium">{percentage}%</p>
          </div>
          <div>
            <p className="text-content-subtle">Time Read</p>
            <p className="font-medium">{formatDuration(totalTimeSeconds)}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-4 text-content-muted">
          <Link to={`/activity?document=${doc.id}`} onClick={e => e.stopPropagation()}>
            <ActivityIcon size={20} />
          </Link>
          {doc.filepath ? (
            <a href={`/api/v1/documents/${doc.id}/file`} onClick={e => e.stopPropagation()}>
              <DownloadIcon size={20} />
            </a>
          ) : (
            <DownloadIcon size={20} disabled />
          )}
        </div>
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(9);
  const [uploadMode, setUploadMode] = useState(false);
  const [viewMode, setViewMode] = useState<DocumentsViewMode>(getDocumentsViewMode);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showInfo, showWarning, showError } = useToasts();

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setDocumentsViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, refetch } = useGetDocuments({ page, limit, search: debouncedSearch });
  const createMutation = useCreateDocument();
  const docs = (data?.data as DocumentsResponse | undefined)?.documents;
  const previousPage = (data?.data as DocumentsResponse | undefined)?.previous_page;
  const nextPage = (data?.data as DocumentsResponse | undefined)?.next_page;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.epub')) {
      showWarning('Please upload an EPUB file');
      return;
    }

    try {
      await createMutation.mutateAsync({
        data: {
          document_file: file,
        },
      });
      showInfo('Document uploaded successfully!');
      setUploadMode(false);
      refetch();
    } catch (error) {
      showError('Failed to upload document: ' + getErrorMessage(error));
    }
  };

  const handleCancelUpload = () => {
    setUploadMode(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getViewModeButtonClasses = (mode: DocumentsViewMode) =>
    `rounded px-3 py-1 text-sm font-medium transition-colors ${
      viewMode === mode
        ? 'bg-content text-content-inverse'
        : 'text-content-muted hover:bg-surface-muted'
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex grow flex-col gap-4 rounded bg-surface p-4 text-content-muted shadow-lg">
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex w-full grow flex-col">
            <div className="relative flex">
              <span className="inline-flex items-center border-y border-l border-border bg-surface px-3 text-sm text-content-muted shadow-sm">
                <Search2Icon size={15} hoverable={false} />
              </span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full flex-1 appearance-none rounded-none border border-border bg-surface px-4 py-2 text-base text-content shadow-sm placeholder:text-content-subtle focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
                placeholder="Search Author / Title"
                name="search"
              />
            </div>
          </div>
          <div className="inline-flex rounded border border-border bg-surface p-1">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={getViewModeButtonClasses('grid')}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={getViewModeButtonClasses('list')}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <LoadingState className="col-span-full min-h-48" />
          ) : docs && docs.length > 0 ? (
            docs.map(doc => <DocumentCard key={doc.id} doc={doc} />)
          ) : (
            <div className="col-span-full rounded bg-surface p-6 text-center text-content-muted shadow-lg">
              No documents found.
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <LoadingState className="min-h-48" />
          ) : docs && docs.length > 0 ? (
            docs.map(doc => <DocumentListItem key={doc.id} doc={doc} />)
          ) : (
            <div className="rounded bg-surface p-6 text-center text-content-muted shadow-lg">
              No documents found.
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex w-full justify-center gap-4 text-content">
        {previousPage && previousPage > 0 && (
          <button
            onClick={() => setPage(page - 1)}
            className="w-24 rounded bg-surface p-2 text-center text-sm font-medium shadow-lg hover:bg-surface-strong focus:outline-none"
          >
            ◄
          </button>
        )}
        {nextPage && nextPage > 0 && (
          <button
            onClick={() => setPage(page + 1)}
            className="w-24 rounded bg-surface p-2 text-center text-sm font-medium shadow-lg hover:bg-surface-strong focus:outline-none"
          >
            ►
          </button>
        )}
      </div>

      <div className="fixed bottom-6 right-6 flex items-center justify-center rounded-full">
        <input
          type="checkbox"
          id="upload-file-button"
          className="hidden"
          checked={uploadMode}
          onChange={() => setUploadMode(!uploadMode)}
        />
        <div
          className={`absolute bottom-0 right-0 z-10 flex w-72 flex-col gap-2 rounded bg-content p-4 text-sm text-content-inverse transition-opacity duration-200 ${uploadMode ? 'visible opacity-100' : 'invisible opacity-0'}`}
        >
          <form method="POST" encType="multipart/form-data" className="flex flex-col gap-2">
            <input
              type="file"
              accept=".epub"
              id="document_file"
              name="document_file"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <button
              className="bg-surface-strong px-2 py-1 font-medium text-content hover:bg-surface"
              type="submit"
              onClick={e => {
                e.preventDefault();
                handleFileChange({
                  target: { files: fileInputRef.current?.files },
                } as React.ChangeEvent<HTMLInputElement>);
              }}
            >
              Upload File
            </button>
          </form>
          <label htmlFor="upload-file-button">
            <div
              className="mt-2 w-full cursor-pointer bg-surface-strong px-2 py-1 text-center font-medium text-content hover:bg-surface"
              onClick={handleCancelUpload}
            >
              Cancel Upload
            </div>
          </label>
        </div>
        <label
          className="flex size-16 cursor-pointer items-center justify-center rounded-full bg-content opacity-30 transition-all duration-200 hover:opacity-100"
          htmlFor="upload-file-button"
        >
          <UploadIcon size={34} className="text-content-inverse" />
        </label>
      </div>
    </div>
  );
}
