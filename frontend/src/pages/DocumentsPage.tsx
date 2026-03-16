import { useState, FormEvent, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useGetDocuments, useCreateDocument } from '../generated/anthoLumeAPIV1';
import { Activity, Download, Search, Upload } from 'lucide-react';
import { Button } from '../components/Button';

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
    <div className="w-full relative">
      <div
        className="flex gap-4 w-full h-full p-4 shadow-lg bg-white dark:bg-gray-700 rounded"
      >
        <div className="min-w-fit my-auto h-48 relative">
          <Link to={`/documents/${doc.id}`}>
            <img
              className="rounded object-cover h-full"
              src={`/api/v1/documents/${doc.id}/cover`}
              alt={doc.title}
            />
          </Link>
        </div>
        <div className="flex flex-col justify-around dark:text-white w-full text-sm">
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
          className="absolute flex flex-col gap-2 right-4 bottom-4 text-gray-500 dark:text-gray-400"
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
      alert('Please upload an EPUB file');
      return;
    }

    try {
      await createMutation.mutateAsync({
        data: {
          document_file: file,
        },
      });
      alert('Document uploaded successfully!');
      setUploadMode(false);
      refetch();
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload document');
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
        className="flex flex-col gap-2 grow p-4 mb-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
      >
        <form className="flex gap-4 flex-col lg:flex-row" onSubmit={handleSubmit}>
          <div className="flex flex-col w-full grow">
            <div className="flex relative">
              <span
                className="inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"
              >
                <Search size={15} />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-2 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
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
      <div className="w-full flex gap-4 justify-center mt-4 text-black dark:text-white">
        {previousPage && previousPage > 0 && (
          <button
            onClick={() => setPage(page - 1)}
            className="bg-white shadow-lg dark:bg-gray-600 hover:bg-gray-400 font-medium rounded text-sm text-center p-2 w-24 dark:hover:bg-gray-700 focus:outline-none"
          >
            ◄
          </button>
        )}
        {nextPage && nextPage > 0 && (
          <button
            onClick={() => setPage(page + 1)}
            className="bg-white shadow-lg dark:bg-gray-600 hover:bg-gray-400 font-medium rounded text-sm text-center p-2 w-24 dark:hover:bg-gray-700 focus:outline-none"
          >
            ►
          </button>
        )}
      </div>

      {/* Upload Button */}
      <div
        className="fixed bottom-6 right-6 rounded-full flex items-center justify-center"
      >
        <input 
          type="checkbox" 
          id="upload-file-button" 
          className="hidden"
          checked={uploadMode}
          onChange={() => setUploadMode(!uploadMode)}
        />
        <div
          className={`absolute right-0 z-10 bottom-0 rounded p-4 bg-gray-800 dark:bg-gray-200 text-white dark:text-black w-72 text-sm flex flex-col gap-2 transition-opacity duration-200 ${uploadMode ? 'visible opacity-100' : 'invisible opacity-0'}`}
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
              className="font-medium px-2 py-1 text-gray-800 bg-gray-500 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
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
              className="w-full text-center cursor-pointer font-medium mt-2 px-2 py-1 text-gray-800 bg-gray-500 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={handleCancelUpload}
            >
              Cancel Upload
            </div>
          </label>
        </div>
        <label
          className="w-16 h-16 bg-gray-800 dark:bg-gray-200 rounded-full flex items-center justify-center opacity-30 hover:opacity-100 transition-all duration-200 cursor-pointer"
          htmlFor="upload-file-button"
        >
          <Upload size={34} />
        </label>
      </div>
    </div>
  );
}