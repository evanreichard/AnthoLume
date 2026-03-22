import { useParams } from 'react-router-dom';
import { useGetDocument, useGetProgress, useEditDocument } from '../generated/anthoLumeAPIV1';
import { formatDuration } from '../utils/formatters';
import { DeleteIcon, ActivityIcon, SearchIcon, DownloadIcon, EditIcon, InfoIcon } from '../icons';
import { X, Check } from 'lucide-react';
import { useState } from 'react';

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
  const editMutation = useEditDocument();

  const [showEditCover, setShowEditCover] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showIdentify, setShowIdentify] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingAuthor, setIsEditingAuthor] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [showTimeReadInfo, setShowTimeReadInfo] = useState(false);

  // Edit values - initialized after document is loaded
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editDescription, setEditDescription] = useState('');

  if (docLoading || progressLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  // Check for successful response (status 200)
  if (!docData || docData.status !== 200) {
    return <div className="text-gray-500 dark:text-white">Document not found</div>;
  }

  const document = docData.data.document as Document;
  const progress =
    progressData?.status === 200 ? (progressData.data.progress as Progress | undefined) : undefined;

  if (!document) {
    return <div className="text-gray-500 dark:text-white">Document not found</div>;
  }

  // Calculate total time left (mirroring legacy template logic)
  const percentage = progress?.percentage || document.percentage || 0;
  const secondsPerPercent = document.seconds_per_percent || 0;
  const totalTimeLeftSeconds = Math.round((100 - percentage) * secondsPerPercent);

  // Helper to start editing
  const startEditing = (field: 'title' | 'author' | 'description') => {
    if (field === 'title') setEditTitle(document.title);
    if (field === 'author') setEditAuthor(document.author);
    if (field === 'description') setEditDescription(document.description || '');
  };

  // Save edit handlers
  const saveTitle = () => {
    editMutation.mutate(
      {
        id: document.id,
        data: { title: editTitle },
      },
      {
        onSuccess: () => setIsEditingTitle(false),
        onError: () => setIsEditingTitle(false),
      }
    );
  };

  const saveAuthor = () => {
    editMutation.mutate(
      {
        id: document.id,
        data: { author: editAuthor },
      },
      {
        onSuccess: () => setIsEditingAuthor(false),
        onError: () => setIsEditingAuthor(false),
      }
    );
  };

  const saveDescription = () => {
    editMutation.mutate(
      {
        id: document.id,
        data: { description: editDescription },
      },
      {
        onSuccess: () => setIsEditingDescription(false),
        onError: () => setIsEditingDescription(false),
      }
    );
  };

  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full overflow-scroll rounded bg-white p-4 shadow-lg dark:bg-gray-700 dark:text-white">
        {/* Document Info - Left Column */}
        <div className="relative float-left mb-2 mr-4 flex w-44 flex-col gap-2 md:w-60 lg:w-80">
          {/* Cover Image with Edit Label */}
          <label className="z-10 cursor-pointer" htmlFor="edit-cover-checkbox">
            <img
              className="rounded object-fill w-full"
              src={`/api/v1/documents/${document.id}/cover`}
              alt={`${document.title} cover`}
            />
          </label>

          {/* Read Button - Only if file exists */}
          {document.filepath && (
            <a
              href={`/reader#id=${document.id}&type=REMOTE`}
              className="z-10 mt-2 w-full rounded bg-blue-700 py-1 text-center text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              Read
            </a>
          )}

          {/* Action Buttons Container */}
          <div className="relative z-20 flex flex-wrap-reverse justify-between gap-2">
            {/* ISBN Info */}
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

            {/* Icons Container */}
            <div className="relative grow flex justify-between my-auto text-gray-500 dark:text-gray-500">
              {/* Edit Cover Dropdown */}
              <div className="relative">
                <input
                  type="checkbox"
                  id="edit-cover-checkbox"
                  className="hidden"
                  checked={showEditCover}
                  onChange={e => setShowEditCover(e.target.checked)}
                />
                <div
                  className={`absolute z-30 flex flex-col gap-2 top-0 left-0 p-3 transition-all duration-200 bg-gray-200 rounded shadow-lg dark:bg-gray-600 ${
                    showEditCover ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <form className="flex flex-col gap-2 w-72 text-black dark:text-white text-sm">
                    <input
                      type="file"
                      id="cover_file"
                      name="cover_file"
                      className="p-2 bg-gray-300"
                    />
                    <button
                      type="submit"
                      className="rounded bg-blue-700 py-1 px-2 text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600"
                    >
                      Upload Cover
                    </button>
                  </form>
                  <form className="flex flex-col gap-2 w-72 text-black dark:text-white text-sm">
                    <input
                      type="checkbox"
                      checked
                      id="remove_cover"
                      name="remove_cover"
                      className="hidden"
                    />
                    <button
                      type="submit"
                      className="rounded bg-blue-700 py-1 px-2 text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600"
                    >
                      Remove Cover
                    </button>
                  </form>
                </div>
              </div>

              {/* Delete Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowDelete(!showDelete)}
                  className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                  aria-label="Delete"
                >
                  <DeleteIcon size={28} />
                </button>
                <div
                  className={`absolute z-30 bottom-7 left-5 p-3 transition-all duration-200 bg-gray-200 rounded shadow-lg dark:bg-gray-600 ${
                    showDelete ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <form className="text-black dark:text-white text-sm w-24">
                    <button
                      type="submit"
                      className="rounded bg-red-600 py-1 px-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </div>

              {/* Activity Button */}
              <a
                href={`/activity?document=${document.id}`}
                aria-label="Activity"
                className="hover:text-gray-800 dark:hover:text-gray-100"
              >
                <ActivityIcon size={28} />
              </a>

              {/* Identify/Search Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowIdentify(!showIdentify)}
                  aria-label="Identify"
                  className="hover:text-gray-800 dark:hover:text-gray-100"
                >
                  <SearchIcon size={28} />
                </button>
                <div
                  className={`absolute z-30 bottom-7 left-5 p-3 transition-all duration-200 bg-gray-200 rounded shadow-lg dark:bg-gray-600 ${
                    showIdentify ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <form className="flex flex-col gap-2 text-black dark:text-white text-sm">
                    <input
                      type="text"
                      id="title"
                      name="title"
                      placeholder="Title"
                      defaultValue={document.title}
                      className="p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white rounded"
                    />
                    <input
                      type="text"
                      id="author"
                      name="author"
                      placeholder="Author"
                      defaultValue={document.author}
                      className="p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white rounded"
                    />
                    <input
                      type="text"
                      id="isbn"
                      name="isbn"
                      placeholder="ISBN 10 / ISBN 13"
                      defaultValue={document.isbn13 || document.isbn10}
                      className="p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white rounded"
                    />
                    <button
                      type="submit"
                      className="rounded bg-blue-700 py-1 px-2 text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600"
                    >
                      Identify
                    </button>
                  </form>
                </div>
              </div>

              {/* Download Button */}
              {document.filepath ? (
                <a
                  href={`/api/v1/documents/${document.id}/file`}
                  aria-label="Download"
                  className="hover:text-gray-800 dark:hover:text-gray-100"
                >
                  <DownloadIcon size={28} />
                </a>
              ) : (
                <span className="text-gray-200 dark:text-gray-600">
                  <DownloadIcon size={28} disabled />
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Document Details Grid */}
        <div className="grid justify-between gap-4 pb-4 sm:grid-cols-2">
          {/* Title - Editable */}
          <div
            className={`relative rounded p-2 ${isEditingTitle ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700' : ''}`}
          >
            <div className="relative inline-flex gap-2 text-gray-500">
              <p>Title</p>
              {isEditingTitle ? (
                <div className="inline-flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingTitle(false)}
                    className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                    aria-label="Cancel edit"
                  >
                    <X size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={saveTitle}
                    className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                    aria-label="Confirm edit"
                  >
                    <Check size={18} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    startEditing('title');
                    setIsEditingTitle(true);
                  }}
                  className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                  aria-label="Edit title"
                >
                  <EditIcon size={18} />
                </button>
              )}
            </div>
            {isEditingTitle ? (
              <div className="relative flex gap-2 mt-1">
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white rounded font-medium text-lg flex-grow"
                />
              </div>
            ) : (
              <p className="font-medium text-lg">{document.title}</p>
            )}
          </div>

          {/* Author - Editable */}
          <div
            className={`relative rounded p-2 ${isEditingAuthor ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700' : ''}`}
          >
            <div className="relative inline-flex gap-2 text-gray-500">
              <p>Author</p>
              {isEditingAuthor ? (
                <div className="inline-flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingAuthor(false)}
                    className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                    aria-label="Cancel edit"
                  >
                    <X size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={saveAuthor}
                    className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                    aria-label="Confirm edit"
                  >
                    <Check size={18} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    startEditing('author');
                    setIsEditingAuthor(true);
                  }}
                  className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                  aria-label="Edit author"
                >
                  <EditIcon size={18} />
                </button>
              )}
            </div>
            {isEditingAuthor ? (
              <div className="relative flex gap-2 mt-1">
                <input
                  type="text"
                  value={editAuthor}
                  onChange={e => setEditAuthor(e.target.value)}
                  className="p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white rounded font-medium text-lg flex-grow"
                />
              </div>
            ) : (
              <p className="font-medium text-lg">{document.author}</p>
            )}
          </div>

          {/* Time Read with Info Dropdown */}
          <div className="relative">
            <div className="relative inline-flex gap-2 text-gray-500">
              <p>Time Read</p>
              <button
                type="button"
                onClick={() => setShowTimeReadInfo(!showTimeReadInfo)}
                className="my-auto cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                aria-label="Show time read info"
              >
                <InfoIcon size={18} />
              </button>
              <div
                className={`absolute z-30 top-7 right-0 p-3 transition-all duration-200 bg-gray-200 rounded shadow-lg dark:bg-gray-600 ${
                  showTimeReadInfo ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              >
                <div className="text-xs flex">
                  <p className="text-gray-400 w-32">Seconds / Percent</p>
                  <p className="font-medium dark:text-white">
                    {secondsPerPercent !== 0 ? secondsPerPercent : 'N/A'}
                  </p>
                </div>
                <div className="text-xs flex">
                  <p className="text-gray-400 w-32">Words / Minute</p>
                  <p className="font-medium dark:text-white">
                    {document.wpm && document.wpm > 0 ? document.wpm : 'N/A'}
                  </p>
                </div>
                <div className="text-xs flex">
                  <p className="text-gray-400 w-32">Est. Time Left</p>
                  <p className="font-medium dark:text-white whitespace-nowrap">
                    {totalTimeLeftSeconds > 0 ? formatDuration(totalTimeLeftSeconds) : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
            <p className="font-medium text-lg">
              {document.total_time_seconds && document.total_time_seconds > 0
                ? formatDuration(document.total_time_seconds)
                : 'N/A'}
            </p>
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
        <div
          className={`relative rounded p-2 ${isEditingDescription ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700' : ''}`}
        >
          <div className="relative inline-flex gap-2 text-gray-500">
            <p>Description</p>
            {isEditingDescription ? (
              <div className="inline-flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingDescription(false)}
                  className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                  aria-label="Cancel edit"
                >
                  <X size={18} />
                </button>
                <button
                  type="button"
                  onClick={saveDescription}
                  className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                  aria-label="Confirm edit"
                >
                  <Check size={18} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  startEditing('description');
                  setIsEditingDescription(true);
                }}
                className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                aria-label="Edit description"
              >
                <EditIcon size={18} />
              </button>
            )}
          </div>
          {isEditingDescription ? (
            <div className="relative flex gap-2 mt-1">
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                className="h-32 w-full p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white rounded font-medium flex-grow"
                rows={5}
              />
            </div>
          ) : (
            <div className="relative font-medium text-justify hyphens-auto mt-1">
              <p>{document.description || 'N/A'}</p>
            </div>
          )}
        </div>

        {/* Metadata Section */}
        {/* TODO: Add metadata component when available */}
      </div>
    </div>
  );
}
