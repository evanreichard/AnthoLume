import { useState, FormEvent, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useGetDocuments, useCreateDocument } from '../generated/anthoLumeAPIV1';
import { Activity, Download, Search, Upload } from 'lucide-react';
import { Button } from '../components/Button';
import { useToasts } from '../components/ToastContext';

interface DocumentCardProps {
  doc: {
    id: string;
    title: string;
    author: string;
    created_at: string;
    deleted: boolean;
    words?: number;
    filepath?: string;
    percentage?: number;
    total_time_seconds?: number;
  };
}

function DocumentCard({ doc }: DocumentCardProps) {
  const percentage = doc.percentage || 0;
  const totalTimeSeconds = doc.total_time_seconds || 0;
  
  // Convert seconds to nice format (e.g., "2h 30m")
  const niceSeconds = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <div className="relative w-full">
      <div
        className="flex size-full gap-4 rounded bg-white p-4 shadow-lg dark:bg-gray-700"
      >
        <div className="relative my-auto h-48 min-w-fit">
          <Link to={`/documents/${doc.id}`}>
            <img
              className="h-full rounded object-cover"
              src={`/api/v1/documents/${doc.id}/cover`}
              alt={doc.title}
            />
          </Link>
        </div>
        <div className="flex w-full flex-col justify-around text-sm dark:text-white">
          <div className="inline-flex shrink-0 items-center">
            <div>
              <p className="text-gray-400">Title</p>
              <p className="font-medium">{doc.title || "Unknown"}</p>
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center">
            <div>
              <p className="text-gray-400">Author</p>
              <p className="font-medium">{doc.author || "Unknown"}</p>
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center">
            <div>
              <p className="text-gray-400">Progress</p>
              <p className="font-medium">{percentage}%</p>
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center">
            <div>
              <p className="text-gray-400">Time Read</p>
              <p className="font-medium">{niceSeconds(totalTimeSeconds)}</p>
            </div>
          </div>
        </div>
        <div
          className="absolute bottom-4 right-4 flex flex-col gap-2 text-gray-500 dark:text-gray-400"
        >
          <Link to={`/activity?document=${doc.id}`}>
            <Activity size={20} />
          </Link>
          {doc.filepath ? (
            <Link to={`/documents/${doc.id}/file`}>
              <Download size={20} />
            </Link>
          ) : (
            <Download size={20} className="text-gray-400" />
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showInfo, showWarning, showError } = useToasts();

  const { data, isLoading, refetch } = useGetDocuments({ page, limit, search });
  const createMutation = useCreateDocument();
  const docs = data?.data?.documents;
  const previousPage = data?.data?.previous_page;
  const nextPage = data?.data?.next_page;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    refetch();
  };

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
    } catch (error: any) {
      showError('Failed to upload document: ' + error.message);
    }
  };

  const handleCancelUpload = () => {
    setUploadMode(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search Form */}
      <div
        className="mb-4 flex grow flex-col gap-2 rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white"
      >
        <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handleSubmit}>
          <div className="flex w-full grow flex-col">
            <div className="relative flex">
              <span
                className="inline-flex items-center border-y border-l border-gray-300 bg-white px-3 text-sm text-gray-500 shadow-sm"
              >
                <Search size={15} />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full flex-1 appearance-none rounded-none border border-gray-300 bg-white p-2 text-base text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-600"
                placeholder="Search Author / Title"
                name="search"
              />
            </div>
          </div>
          <div className="lg:w-60">
            <Button variant="secondary" type="submit">Search</Button>
          </div>
        </form>
      </div>

      {/* Document Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {docs?.map((doc: any) => (
          <DocumentCard key={doc.id} doc={doc} />
        ))}
      </div>

      {/* Pagination */}
      <div className="mt-4 flex w-full justify-center gap-4 text-black dark:text-white">
        {previousPage && previousPage > 0 && (
          <button
            onClick={() => setPage(page - 1)}
            className="w-24 rounded bg-white p-2 text-center text-sm font-medium shadow-lg hover:bg-gray-400 focus:outline-none dark:bg-gray-600 dark:hover:bg-gray-700"
          >
            ◄
          </button>
        )}
        {nextPage && nextPage > 0 && (
          <button
            onClick={() => setPage(page + 1)}
            className="w-24 rounded bg-white p-2 text-center text-sm font-medium shadow-lg hover:bg-gray-400 focus:outline-none dark:bg-gray-600 dark:hover:bg-gray-700"
          >
            ►
          </button>
        )}
      </div>

      {/* Upload Button */}
      <div
        className="fixed bottom-6 right-6 flex items-center justify-center rounded-full"
      >
        <input 
          type="checkbox" 
          id="upload-file-button" 
          className="hidden"
          checked={uploadMode}
          onChange={() => setUploadMode(!uploadMode)}
        />
        <div
          className={`absolute bottom-0 right-0 z-10 flex w-72 flex-col gap-2 rounded bg-gray-800 p-4 text-sm text-white transition-opacity duration-200 dark:bg-gray-200 dark:text-black ${uploadMode ? 'visible opacity-100' : 'invisible opacity-0'}`}
        >
          <form
            method="POST"
            encType="multipart/form-data"
            className="flex flex-col gap-2"
          >
            <input
              type="file"
              accept=".epub"
              id="document_file"
              name="document_file"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <button
              className="bg-gray-500 px-2 py-1 font-medium text-gray-800 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-800"
              type="submit"
              onClick={(e) => {
                e.preventDefault();
                handleFileChange({ target: { files: fileInputRef.current?.files } } as any);
              }}
            >
              Upload File
            </button>
          </form>
          <label htmlFor="upload-file-button">
            <div
              className="mt-2 w-full cursor-pointer bg-gray-500 px-2 py-1 text-center font-medium text-gray-800 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-800"
              onClick={handleCancelUpload}
            >
              Cancel Upload
            </div>
          </label>
        </div>
        <label
          className="flex size-16 cursor-pointer items-center justify-center rounded-full bg-gray-800 opacity-30 transition-all duration-200 hover:opacity-100 dark:bg-gray-200"
          htmlFor="upload-file-button"
        >
          <Upload size={34} />
        </label>
      </div>
    </div>
  );
}