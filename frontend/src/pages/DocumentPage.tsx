import { useParams } from 'react-router-dom';
import { useGetDocument, useGetProgress } from '../generated/anthoLumeAPIV1';
import { formatDuration, formatNumber } from '../utils/formatters';

interface Document {
  id: string;
  title: string;
  author: string;
  description?: string;
  isbn10?: string;
  isbn13?: string;
  words?: number;
  filepath?: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  percentage?: number;
  total_time_seconds?: number;
  wpm?: number;
  seconds_per_percent?: number;
  last_read?: string;
}

interface Progress {
  document_id?: string;
  percentage?: number;
  created_at?: string;
  user_id?: string;
  device_name?: string;
  title?: string;
  author?: string;
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const { data: docData, isLoading: docLoading } = useGetDocument(id || '');

  const { data: progressData, isLoading: progressLoading } = useGetProgress(id || '');

  if (docLoading || progressLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  const document = docData?.data?.document as Document;
  const progressDataArray = progressData?.data?.progress;
  const progress = Array.isArray(progressDataArray)
    ? (progressDataArray[0] as Progress)
    : undefined;

  if (!document) {
    return <div className="text-gray-500 dark:text-white">Document not found</div>;
  }

  // Calculate total time left (mirroring legacy template logic)
  const percentage = progress?.percentage || document.percentage || 0;
  const secondsPerPercent = document.seconds_per_percent || 0;
  const totalTimeLeftSeconds = Math.round((100 - percentage) * secondsPerPercent);

  return (
    <div className="relative size-full">
      <div className="size-full overflow-scroll rounded bg-white p-4 shadow-lg dark:bg-gray-700 dark:text-white">
        {/* Document Info - Left Column */}
        <div className="relative float-left mb-2 mr-4 flex w-44 flex-col gap-2 md:w-60 lg:w-80">
          {/* Cover Image */}
          {document.filepath && (
            <div className="h-60 w-full rounded bg-gray-200 object-fill dark:bg-gray-600">
              <img
                className="h-full rounded object-cover"
                src={`/api/v1/documents/${document.id}/cover`}
                alt={`${document.title} cover`}
              />
            </div>
          )}

          {/* Read Button - Only if file exists */}
          {document.filepath && (
            <a
              href={`/reader#id=${document.id}&type=REMOTE`}
              className="z-10 mt-2 w-full rounded bg-blue-700 py-1 text-center text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              Read
            </a>
          )}

          {/* Action Buttons */}
          <div className="relative z-20 my-2 flex flex-wrap-reverse justify-between gap-2">
            <div className="min-w-[50%] md:mr-2">
              <div className="flex gap-1 text-sm">
                <p className="text-gray-500">ISBN-10:</p>
                <p className="font-medium">{document.isbn10 || 'N/A'}</p>
              </div>
              <div className="flex gap-1 text-sm">
                <p className="text-gray-500">ISBN-13:</p>
                <p className="font-medium">{document.isbn13 || 'N/A'}</p>
              </div>
            </div>

            {/* Download Button - Only if file exists */}
            {document.filepath && (
              <a
                href={`/api/v1/documents/${document.id}/file`}
                className="z-10 text-gray-500 dark:text-gray-400"
                title="Download"
              >
                <svg className="size-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003-3h4a3 3 0 003 3v1m0-3l-3 3m0 0L4 20"
                  />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* Document Details Grid */}
        <div className="grid justify-between gap-4 pb-4 sm:grid-cols-2">
          {/* Title - Editable */}
          <div className="relative">
            <div className="relative inline-flex gap-2 text-gray-500">
              <p>Title</p>
            </div>
            <div className="relative hyphens-auto text-justify font-medium">
              <p>{document.title}</p>
            </div>
          </div>

          {/* Author - Editable */}
          <div className="relative">
            <div className="relative inline-flex gap-2 text-gray-500">
              <p>Author</p>
            </div>
            <div className="relative hyphens-auto text-justify font-medium">
              <p>{document.author}</p>
            </div>
          </div>

          {/* Time Read */}
          <div className="relative">
            <div className="relative inline-flex gap-2 text-gray-500">
              <p>Time Read</p>
            </div>
            <div className="relative">
              <p className="text-lg font-medium">
                {document.total_time_seconds ? formatDuration(document.total_time_seconds) : 'N/A'}
              </p>
            </div>
          </div>

          {/* Progress */}
          <div>
            <p className="text-gray-500">Progress</p>
            <p className="text-lg font-medium">
              {percentage ? `${Math.round(percentage)}%` : '0%'}
            </p>
          </div>
        </div>

        {/* Description - Editable */}
        <div className="relative">
          <div className="relative inline-flex gap-2 text-gray-500">
            <p>Description</p>
          </div>
          <div className="relative hyphens-auto text-justify font-medium">
            <p>{document.description || 'N/A'}</p>
          </div>
        </div>

        {/* Reading Statistics */}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-gray-500">Words</p>
            <p className="font-medium">
              {document.words != null ? formatNumber(document.words) : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Created</p>
            <p className="font-medium">{new Date(document.created_at).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-gray-500">Updated</p>
            <p className="font-medium">{new Date(document.updated_at).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Additional Reading Stats - Matching Legacy Template */}
        {progress && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <p className="text-gray-500">Words / Minute:</p>
              <p className="font-medium">{document.wpm || 'N/A'}</p>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-gray-500">Est. Time Left:</p>
              <p className="whitespace-nowrap font-medium">
                {formatDuration(totalTimeLeftSeconds)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
