import { useParams } from 'react-router-dom';
import { useGetDocument, useGetProgress } from '../generated/anthoLumeAPIV1';

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  
  const { data: docData, isLoading: docLoading } = useGetDocument(id || '');
  
  const { data: progressData, isLoading: progressLoading } = useGetProgress(id || '');

  if (docLoading || progressLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  const document = docData?.data?.document;
  const progress = progressData?.data;

  if (!document) {
    return <div className="text-gray-500 dark:text-white">Document not found</div>;
  }

  return (
    <div className="h-full w-full relative">
      <div
        className="h-full w-full overflow-scroll bg-white shadow-lg dark:bg-gray-700 rounded dark:text-white p-4"
      >
        {/* Document Info */}
        <div
          className="flex flex-col gap-2 float-left w-44 md:w-60 lg:w-80 mr-4 mb-2 relative"
        >
          <div className="rounded object-fill w-full bg-gray-200 dark:bg-gray-600 h-60">
            {/* Cover image placeholder */}
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              No Cover
            </div>
          </div>
          
          <a
            href={`/reader#id=${document.id}&type=REMOTE`}
            className="text-white bg-blue-700 hover:bg-blue-800 font-medium rounded text-sm text-center py-1 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            Read
          </a>
          
          <div className="flex flex-wrap-reverse justify-between gap-2">
            <div className="min-w-[50%] md:mr-2">
              <div className="flex gap-1 text-sm">
                <p className="text-gray-500">Words:</p>
                <p className="font-medium">{document.words || 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Document Details Grid */}
        <div className="grid sm:grid-cols-2 justify-between gap-4 pb-4">
          <div>
            <p className="text-gray-500">Title</p>
            <p className="font-medium text-lg">{document.title}</p>
          </div>
          <div>
            <p className="text-gray-500">Author</p>
            <p className="font-medium text-lg">{document.author}</p>
          </div>
          <div>
            <p className="text-gray-500">Time Read</p>
            <p className="font-medium text-lg">
              {progress?.progress?.percentage ? `${Math.round(progress.progress.percentage)}%` : '0%'}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Progress</p>
            <p className="font-medium text-lg">
              {progress?.progress?.percentage ? `${Math.round(progress.progress.percentage)}%` : '0%'}
            </p>
          </div>
        </div>

        {/* Description */}
        <div className="relative">
          <div className="text-gray-500 inline-flex gap-2 relative">
            <p>Description</p>
          </div>
          <div className="relative font-medium text-justify hyphens-auto">
            <p>N/A</p>
          </div>
        </div>

        {/* Stats */}
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
      </div>
    </div>
  );
}