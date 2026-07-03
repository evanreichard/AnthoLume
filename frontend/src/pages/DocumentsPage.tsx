import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetDocuments, useCreateDocument } from '../generated/anthoLumeAPIV1';
import type { Document } from '../generated/model';
import { ActivityIcon, DownloadIcon, Search2Icon, UploadIcon } from '../icons';
import { LoadingState, Pagination, TextInput } from '../components';
import { useToasts } from '../components/ToastContext';
import { useMutationWithToast } from '../hooks/useMutationWithToast';
import { formatDuration } from '../utils/formatters';
import { useDebouncedState } from '../hooks/useDebouncedState';
import {
  getDocumentsViewMode,
  setDocumentsViewMode,
  type DocumentsViewMode,
} from '../utils/localSettings';

const DOCUMENTS_PAGE_SIZE = 9;

interface DocumentItemProps {
  doc: Document;
  layout: 'grid' | 'list';
}

function DocumentItem({ doc, layout }: DocumentItemProps) {
  const navigate = useNavigate();
  const percentage = doc.percentage || 0;
  const totalTimeSeconds = doc.total_time_seconds || 0;

  const open = () => navigate(`/documents/${doc.id}`);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };

  const icons = (
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
  );

  const fields = [
    { label: 'Title', value: doc.title || 'Unknown' },
    { label: 'Author', value: doc.author || 'Unknown' },
    { label: 'Progress', value: `${percentage}%` },
    { label: 'Time Read', value: formatDuration(totalTimeSeconds) },
  ];

  if (layout === 'grid') {
    return (
      <div className="relative w-full">
        <div
          role="link"
          tabIndex={0}
          className="flex size-full cursor-pointer gap-4 rounded bg-surface p-4 shadow-lg transition-colors hover:bg-surface-muted focus:outline-hidden"
          onClick={open}
          onKeyDown={onKeyDown}
        >
          <div className="relative my-auto h-48 min-w-fit">
            <img
              className="h-full rounded object-cover"
              src={`/api/v1/documents/${doc.id}/cover`}
              alt={doc.title}
            />
          </div>
          <div className="flex w-full flex-col justify-around text-sm text-content">
            {fields.map(f => (
              <div key={f.label} className="inline-flex shrink-0 items-center">
                <div>
                  <p className="text-content-subtle">{f.label}</p>
                  <p className="font-medium">{f.value}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="absolute bottom-4 right-4 flex flex-col gap-2 text-content-muted">
            {icons}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="link"
      tabIndex={0}
      className="block cursor-pointer rounded bg-surface p-4 text-content shadow-lg transition-colors hover:bg-surface-muted focus:outline-hidden"
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="grid flex-1 grid-cols-1 gap-3 text-sm md:grid-cols-4">
          {fields.map(f => (
            <div key={f.label}>
              <p className="text-content-subtle">{f.label}</p>
              <p className="font-medium">{f.value}</p>
            </div>
          ))}
        </div>
        {icons}
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const [search, setSearch, debouncedSearch] = useDebouncedState('', 300);
  const [page, setPage] = useState(1);
  const limit = DOCUMENTS_PAGE_SIZE;
  const [uploadMode, setUploadMode] = useState(false);
  const [viewMode, setViewMode] = useState<DocumentsViewMode>(getDocumentsViewMode);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showWarning } = useToasts();
  const toastMutationOptions = useMutationWithToast();

  useEffect(() => {
    setDocumentsViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, refetch } = useGetDocuments({ page, limit, search: debouncedSearch });
  const createMutation = useCreateDocument();
  const documentsResponse = data?.status === 200 ? data.data : undefined;
  const docs = documentsResponse?.documents;
  const previousPage = documentsResponse?.previous_page;
  const nextPage = documentsResponse?.next_page;

  const uploadDocument = (file: File | undefined) => {
    if (!file) return;

    if (!file.name.endsWith('.epub')) {
      showWarning('Please upload an EPUB file');
      return;
    }

    createMutation.mutate(
      { data: { document_file: file } },
      toastMutationOptions({
        success: 'Document uploaded successfully!',
        error: 'Failed to upload document',
        onSuccess: () => {
          setUploadMode(false);
          refetch();
        },
      })
    );
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
              <span className="inline-flex items-center border-y border-l border-border bg-surface px-3 text-sm text-content-muted shadow-xs">
                <Search2Icon size={15} hoverable={false} />
              </span>
              <TextInput
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
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
            docs.map(doc => <DocumentItem key={doc.id} doc={doc} layout="grid" />)
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
            docs.map(doc => <DocumentItem key={doc.id} doc={doc} layout="list" />)
          ) : (
            <div className="rounded bg-surface p-6 text-center text-content-muted shadow-lg">
              No documents found.
            </div>
          )}
        </div>
      )}

      <Pagination
        page={page}
        previousPage={previousPage}
        nextPage={nextPage}
        total={documentsResponse?.total}
        limit={limit}
        onPageChange={setPage}
      />

      <div className="fixed bottom-6 right-6 flex items-center justify-center rounded-full">
        {uploadMode && (
          <div className="absolute bottom-0 right-0 z-10 flex w-72 flex-col gap-2 rounded bg-content p-4 text-sm text-content-inverse transition-opacity duration-200">
            <div className="flex flex-col gap-2">
              <input
                type="file"
                accept=".epub"
                id="document_file"
                name="document_file"
                ref={fileInputRef}
              />
              <button
                className="bg-surface-strong px-2 py-1 font-medium text-content hover:bg-surface"
                type="button"
                onClick={() => uploadDocument(fileInputRef.current?.files?.[0])}
              >
                Upload File
              </button>
            </div>
            <button
              type="button"
              className="mt-2 w-full cursor-pointer bg-surface-strong px-2 py-1 text-center font-medium text-content hover:bg-surface"
              onClick={handleCancelUpload}
            >
              Cancel Upload
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setUploadMode(!uploadMode)}
          className="flex size-16 cursor-pointer items-center justify-center rounded-full bg-content opacity-30 transition-all duration-200 hover:opacity-100"
          aria-label="Upload document"
        >
          <UploadIcon size={34} className="text-content-inverse" />
        </button>
      </div>
    </div>
  );
}
