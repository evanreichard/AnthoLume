import { useParams } from 'react-router-dom';
import { useGetDocument, useGetProgress } from '../generated/anthoLumeAPIV1';

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

// Helper function to format seconds nicely (mirroring legacy niceSeconds)
function niceSeconds(seconds: number): string {
  if (seconds === 0) return 'N/A';
  
  const days = Math.floor(seconds / 60 / 60 / 24);
  const remainingSeconds = seconds % (60 * 60 * 24);
  const hours = Math.floor(remainingSeconds / 60 / 60);
  const remainingAfterHours = remainingSeconds % (60 * 60);
  const minutes = Math.floor(remainingAfterHours / 60);
  const remainingSeconds2 = remainingAfterHours % 60;
  
  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (remainingSeconds2 > 0) result += `${remainingSeconds2}s`;
  
  return result || 'N/A';
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
  const progress = Array.isArray(progressDataArray) ? progressDataArray[0] as Progress : undefined;

  if (!document) {
    return <div className="text-gray-500 dark:text-white">Document not found</div>;
  }

  // Calculate total time left (mirroring legacy template logic)
  const percentage = progress?.percentage || document.percentage || 0;
  const secondsPerPercent = document.seconds_per_percent || 0;
  const totalTimeLeftSeconds = Math.round((100 - percentage) * secondsPerPercent);

  return (
    <div className="h-full w-full relative">
      <div
        className="h-full w-full overflow-scroll bg-white shadow-lg dark:bg-gray-700 rounded dark:text-white p-4"
      >
        {/* Document Info - Left Column */}
        <div
          className="flex flex-col gap-2 float-left w-44 md:w-60 lg:w-80 mr-4 mb-2 relative"
        >
          {/* Cover Image */}
          {document.filepath && (
            <div className="rounded object-fill w-full bg-gray-200 dark:bg-gray-600 h-60">
              <img
                className="rounded object-cover h-full"
                src={`/api/v1/documents/${document.id}/cover`}
                alt={`${document.title} cover`}
              />
            </div>
          )}
          
          {/* Read Button - Only if file exists */}
          {document.filepath && (
            <a
              href={`/reader#id=${document.id}&type=REMOTE`}
              className="z-10 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded text-sm text-center py-1 dark:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none w-full mt-2"
            >
              Read
            </a>
          )}
          
          {/* Action Buttons */}
          <div className="flex flex-wrap-reverse justify-between gap-2 z-20 relative my-2">
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
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003-3h4a3 3 0 003 3v1m0-3l-3 3m0 0L4 20" />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* Document Details Grid */}
        <div className="grid sm:grid-cols-2 justify-between gap-4 pb-4">
          {/* Title - Editable */}
          <div className="relative">
            <div className="text-gray-500 inline-flex gap-2 relative">
              <p>Title</p>
            </div>
            <div className="relative font-medium text-justify hyphens-auto">
              <p>{document.title}</p>
            </div>
          </div>

          {/* Author - Editable */}
          <div className="relative">
            <div className="text-gray-500 inline-flex gap-2 relative">
              <p>Author</p>
            </div>
            <div className="relative font-medium text-justify hyphens-auto">
              <p>{document.author}</p>
            </div>
          </div>

          {/* Time Read */}
          <div className="relative">
            <div className="text-gray-500 inline-flex gap-2 relative">
              <p>Time Read</p>
            </div>
            <div className="relative">
              <p className="font-medium text-lg">
                {document.total_time_seconds ? niceSeconds(document.total_time_seconds) : 'N/A'}
              </p>
            </div>
          </div>

          {/* Progress */}
          <div>
            <p className="text-gray-500">Progress</p>
            <p className="font-medium text-lg">
              {percentage ? `${Math.round(percentage)}%` : '0%'}
            </p>
          </div>
        </div>

        {/* Description - Editable */}
        <div className="relative">
          <div className="text-gray-500 inline-flex gap-2 relative">
            <p>Description</p>
          </div>
          <div className="relative font-medium text-justify hyphens-auto">
            <p>{document.description || 'N/A'}</p>
          </div>
        </div>

        {/* Reading Statistics */}
        <div className="mt-4 grid sm:grid-cols-3 gap-4">
          <div>
            <p className="text-gray-500">Words</p>
            <p className="font-medium">{document.words || 'N/A'}</p>
          </div>
          <div>
            <p className="text-gray-500">Created</p>
            <p className="font-medium">
              {new Date(document.created_at).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Updated</p>
            <p className="font-medium">
              {new Date(document.updated_at).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Additional Reading Stats - Matching Legacy Template */}
        {progress && (
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <div className="flex gap-2 items-center">
              <p className="text-gray-500">Words / Minute:</p>
              <p className="font-medium">{document.wpm || 'N/A'}</p>
            </div>
            <div className="flex gap-2 items-center">
              <p className="text-gray-500">Est. Time Left:</p>
              <p className="font-medium whitespace-nowrap">
                {niceSeconds(totalTimeLeftSeconds)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}