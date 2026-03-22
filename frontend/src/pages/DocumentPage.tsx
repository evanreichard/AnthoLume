import { useParams } from 'react-router-dom';
import {
  useGetDocument,
  useEditDocument,
  getGetDocumentQueryKey,
} from '../generated/anthoLumeAPIV1';
import { Document } from '../generated/model/document';
import { Progress } from '../generated/model/progress';
import { useQueryClient } from '@tanstack/react-query';
import { formatDuration } from '../utils/formatters';
import {
  DeleteIcon,
  ActivityIcon,
  SearchIcon,
  DownloadIcon,
  EditIcon,
  InfoIcon,
  CloseIcon,
  CheckIcon,
} from '../icons';
import { useState } from 'react';
import { Field, FieldLabel, FieldValue, FieldActions } from '../components';

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: docData, isLoading: docLoading } = useGetDocument(id || '');
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

  if (docLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  // Check for successful response (status 200)
  if (!docData || docData.status !== 200) {
    return <div className="text-gray-500 dark:text-white">Document not found</div>;
  }

  const document = docData.data.document as Document;
  const progress =
    docData?.status === 200 ? (docData.data.progress as Progress | undefined) : undefined;

  if (!document) {
    return <div className="text-gray-500 dark:text-white">Document not found</div>;
  }

  const percentage =
    document.percentage ?? (progress?.percentage ? progress.percentage * 100 : 0) ?? 0;
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
        onSuccess: response => {
          setIsEditingTitle(false);
          // Update cache with the response data (no refetch needed)
          queryClient.setQueryData(getGetDocumentQueryKey(document.id), response);
        },
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
        onSuccess: response => {
          setIsEditingAuthor(false);
          // Update cache with the response data (no refetch needed)
          queryClient.setQueryData(getGetDocumentQueryKey(document.id), response);
        },
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
        onSuccess: response => {
          setIsEditingDescription(false);
          // Update cache with the response data (no refetch needed)
          queryClient.setQueryData(getGetDocumentQueryKey(document.id), response);
        },
        onError: () => setIsEditingDescription(false),
      }
    );
  };

  return (
    <div className="relative size-full">
      <div className="size-full overflow-scroll rounded bg-white p-4 shadow-lg dark:bg-gray-700 dark:text-white">
        {/* Document Info - Left Column */}
        <div className="relative float-left mb-2 mr-4 flex w-44 flex-col gap-2 md:w-60 lg:w-80">
          {/* Cover Image with Edit Label */}
          <label className="z-10 cursor-pointer" htmlFor="edit-cover-checkbox">
            <img
              className="w-full rounded object-fill"
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
                className={`absolute left-0 top-0 z-30 flex flex-col gap-2 rounded bg-gray-200 p-3 shadow-lg transition-all duration-200 dark:bg-gray-600 ${
                  showEditCover ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <form className="flex w-72 flex-col gap-2 text-sm text-black dark:text-white">
                  <input
                    type="file"
                    id="cover_file"
                    name="cover_file"
                    className="bg-gray-300 p-2"
                  />
                  <button
                    type="submit"
                    className="rounded bg-blue-700 px-2 py-1 text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600"
                  >
                    Upload Cover
                  </button>
                </form>
                <form className="flex w-72 flex-col gap-2 text-sm text-black dark:text-white">
                  <input
                    type="checkbox"
                    checked
                    id="remove_cover"
                    name="remove_cover"
                    className="hidden"
                  />
                  <button
                    type="submit"
                    className="rounded bg-blue-700 px-2 py-1 text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600"
                  >
                    Remove Cover
                  </button>
                </form>
              </div>
            </div>

            {/* Icons Container */}
            <div className="relative my-auto flex grow justify-between text-gray-500 dark:text-gray-500">
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
                  className={`absolute bottom-7 left-5 z-30 rounded bg-gray-200 p-3 shadow-lg transition-all duration-200 dark:bg-gray-600 ${
                    showDelete ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <form className="w-24 text-sm text-black dark:text-white">
                    <button
                      type="submit"
                      className="rounded bg-red-600 px-2 py-1 text-sm font-medium text-white hover:bg-red-700"
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
                  className={`absolute bottom-7 left-5 z-30 rounded bg-gray-200 p-3 shadow-lg transition-all duration-200 dark:bg-gray-600 ${
                    showIdentify ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <form className="flex flex-col gap-2 text-sm text-black dark:text-white">
                    <input
                      type="text"
                      id="title"
                      name="title"
                      placeholder="Title"
                      defaultValue={document.title}
                      className="rounded bg-gray-300 p-2 text-black dark:bg-gray-700 dark:text-white"
                    />
                    <input
                      type="text"
                      id="author"
                      name="author"
                      placeholder="Author"
                      defaultValue={document.author}
                      className="rounded bg-gray-300 p-2 text-black dark:bg-gray-700 dark:text-white"
                    />
                    <input
                      type="text"
                      id="isbn"
                      name="isbn"
                      placeholder="ISBN 10 / ISBN 13"
                      defaultValue={document.isbn13 || document.isbn10}
                      className="rounded bg-gray-300 p-2 text-black dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      type="submit"
                      className="rounded bg-blue-700 px-2 py-1 text-sm font-medium text-white hover:bg-blue-800 dark:bg-blue-600"
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
          <Field
            isEditing={isEditingTitle}
            label={
              <>
                <FieldLabel>Title</FieldLabel>
                <FieldActions>
                  {isEditingTitle ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setIsEditingTitle(false)}
                        className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                        aria-label="Cancel edit"
                      >
                        <CloseIcon size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={saveTitle}
                        className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                        aria-label="Confirm edit"
                      >
                        <CheckIcon size={18} />
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
                </FieldActions>
              </>
            }
          >
            {isEditingTitle ? (
              <div className="relative mt-1 flex gap-2">
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full rounded border border-blue-200 bg-blue-50 p-2 text-lg font-medium text-black focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-blue-700 dark:bg-blue-900/20 dark:text-white dark:focus:ring-blue-500"
                />
              </div>
            ) : (
              <FieldValue>{document.title}</FieldValue>
            )}
          </Field>

          {/* Author - Editable */}
          <Field
            isEditing={isEditingAuthor}
            label={
              <>
                <FieldLabel>Author</FieldLabel>
                <FieldActions>
                  {isEditingAuthor ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsEditingAuthor(false)}
                        className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                        aria-label="Cancel edit"
                      >
                        <CloseIcon size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={saveAuthor}
                        className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                        aria-label="Confirm edit"
                      >
                        <CheckIcon size={18} />
                      </button>
                    </>
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
                </FieldActions>
              </>
            }
          >
            {isEditingAuthor ? (
              <div className="relative mt-1 flex gap-2">
                <input
                  type="text"
                  value={editAuthor}
                  onChange={e => setEditAuthor(e.target.value)}
                  className="w-full rounded border border-blue-200 bg-blue-50 p-2 text-lg font-medium text-black focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-blue-700 dark:bg-blue-900/20 dark:text-white dark:focus:ring-blue-500"
                />
              </div>
            ) : (
              <FieldValue>{document.author}</FieldValue>
            )}
          </Field>

          {/* Time Read with Info Dropdown */}
          <Field
            label={
              <>
                <FieldLabel>Time Read</FieldLabel>
                <button
                  type="button"
                  onClick={() => setShowTimeReadInfo(!showTimeReadInfo)}
                  className="my-auto cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                  aria-label="Show time read info"
                >
                  <InfoIcon size={18} />
                </button>
                <div
                  className={`absolute right-0 top-7 z-30 rounded bg-gray-200 p-3 shadow-lg transition-all duration-200 dark:bg-gray-600 ${
                    showTimeReadInfo ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <div className="flex text-xs">
                    <p className="w-32 text-gray-400">Seconds / Percent</p>
                    <p className="font-medium dark:text-white">
                      {secondsPerPercent !== 0 ? secondsPerPercent : 'N/A'}
                    </p>
                  </div>
                  <div className="flex text-xs">
                    <p className="w-32 text-gray-400">Words / Minute</p>
                    <p className="font-medium dark:text-white">
                      {document.wpm && document.wpm > 0 ? document.wpm : 'N/A'}
                    </p>
                  </div>
                  <div className="flex text-xs">
                    <p className="w-32 text-gray-400">Est. Time Left</p>
                    <p className="whitespace-nowrap font-medium dark:text-white">
                      {totalTimeLeftSeconds > 0 ? formatDuration(totalTimeLeftSeconds) : 'N/A'}
                    </p>
                  </div>
                </div>
              </>
            }
          >
            <FieldValue>
              {document.total_time_seconds && document.total_time_seconds > 0
                ? formatDuration(document.total_time_seconds)
                : 'N/A'}
            </FieldValue>
          </Field>

          {/* Progress */}
          <Field label={<FieldLabel>Progress</FieldLabel>}>
            <FieldValue>{`${percentage.toFixed(2)}%`}</FieldValue>
          </Field>
        </div>

        {/* Description - Editable */}
        <Field
          isEditing={isEditingDescription}
          label={
            <>
              <FieldLabel>Description</FieldLabel>
              <FieldActions>
                {isEditingDescription ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsEditingDescription(false)}
                      className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                      aria-label="Cancel edit"
                    >
                      <CloseIcon size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={saveDescription}
                      className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-100"
                      aria-label="Confirm edit"
                    >
                      <CheckIcon size={18} />
                    </button>
                  </>
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
              </FieldActions>
            </>
          }
        >
          {isEditingDescription ? (
            <div className="relative mt-1 flex gap-2">
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                className="h-32 w-full grow rounded border border-blue-200 bg-blue-50 p-2 font-medium text-black focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-blue-700 dark:bg-blue-900/20 dark:text-white dark:focus:ring-blue-500"
                rows={5}
              />
            </div>
          ) : (
            <FieldValue className="hyphens-auto text-justify">
              {document.description || 'N/A'}
            </FieldValue>
          )}
        </Field>
      </div>
    </div>
  );
}
