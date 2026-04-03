import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetDocument,
  useEditDocument,
  getGetDocumentQueryKey,
} from '../generated/anthoLumeAPIV1';
import { Document } from '../generated/model/document';
import { Progress } from '../generated/model/progress';
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
import { Field, FieldLabel, FieldValue, FieldActions } from '../components';

const iconButtonClassName = 'cursor-pointer text-content-muted hover:text-content';
const popupClassName = 'rounded bg-surface-strong p-3 text-content shadow-lg transition-all duration-200';
const popupInputClassName = 'rounded bg-surface p-2 text-content';
const editInputClassName =
  'w-full rounded border border-secondary-200 bg-secondary-50 p-2 text-lg font-medium text-content focus:outline-none focus:ring-2 focus:ring-secondary-400 dark:border-secondary-700 dark:bg-secondary-900/20 dark:focus:ring-secondary-500';

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

  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editDescription, setEditDescription] = useState('');

  if (docLoading) {
    return <div className="text-content-muted">Loading...</div>;
  }

  if (!docData || docData.status !== 200) {
    return <div className="text-content-muted">Document not found</div>;
  }

  const document = docData.data.document as Document;
  const progress =
    docData?.status === 200 ? (docData.data.progress as Progress | undefined) : undefined;

  if (!document) {
    return <div className="text-content-muted">Document not found</div>;
  }

  const percentage =
    document.percentage ?? (progress?.percentage ? progress.percentage * 100 : 0) ?? 0;
  const secondsPerPercent = document.seconds_per_percent || 0;
  const totalTimeLeftSeconds = Math.round((100 - percentage) * secondsPerPercent);

  const startEditing = (field: 'title' | 'author' | 'description') => {
    if (field === 'title') setEditTitle(document.title);
    if (field === 'author') setEditAuthor(document.author);
    if (field === 'description') setEditDescription(document.description || '');
  };

  const saveTitle = () => {
    editMutation.mutate(
      { id: document.id, data: { title: editTitle } },
      {
        onSuccess: response => {
          setIsEditingTitle(false);
          queryClient.setQueryData(getGetDocumentQueryKey(document.id), response);
        },
        onError: () => setIsEditingTitle(false),
      }
    );
  };

  const saveAuthor = () => {
    editMutation.mutate(
      { id: document.id, data: { author: editAuthor } },
      {
        onSuccess: response => {
          setIsEditingAuthor(false);
          queryClient.setQueryData(getGetDocumentQueryKey(document.id), response);
        },
        onError: () => setIsEditingAuthor(false),
      }
    );
  };

  const saveDescription = () => {
    editMutation.mutate(
      { id: document.id, data: { description: editDescription } },
      {
        onSuccess: response => {
          setIsEditingDescription(false);
          queryClient.setQueryData(getGetDocumentQueryKey(document.id), response);
        },
        onError: () => setIsEditingDescription(false),
      }
    );
  };

  return (
    <div className="relative size-full">
      <div className="size-full overflow-scroll rounded bg-surface p-4 text-content shadow-lg">
        <div className="relative float-left mb-2 mr-4 flex w-44 flex-col gap-2 md:w-60 lg:w-80">
          <label className="z-10 cursor-pointer" htmlFor="edit-cover-checkbox">
            <img
              className="w-full rounded object-fill"
              src={`/api/v1/documents/${document.id}/cover`}
              alt={`${document.title} cover`}
            />
          </label>

          {document.filepath && (
            <a
              href={`/reader/${document.id}`}
              className="z-10 mt-2 w-full rounded bg-secondary-700 py-1 text-center text-sm font-medium text-white hover:bg-secondary-800 focus:outline-none focus:ring-4 focus:ring-secondary-300 dark:bg-secondary-600 dark:hover:bg-secondary-700"
            >
              Read
            </a>
          )}

          <div className="relative z-20 flex flex-wrap-reverse justify-between gap-2">
            <div className="min-w-[50%] md:mr-2">
              <div className="flex gap-1 text-sm">
                <p className="text-content-muted">ISBN-10:</p>
                <p className="font-medium">{document.isbn10 || 'N/A'}</p>
              </div>
              <div className="flex gap-1 text-sm">
                <p className="text-content-muted">ISBN-13:</p>
                <p className="font-medium">{document.isbn13 || 'N/A'}</p>
              </div>
            </div>

            <div className="relative">
              <input
                type="checkbox"
                id="edit-cover-checkbox"
                className="hidden"
                checked={showEditCover}
                onChange={e => setShowEditCover(e.target.checked)}
              />
              <div
                className={`absolute left-0 top-0 z-30 flex flex-col gap-2 ${popupClassName} ${
                  showEditCover ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <form className="flex w-72 flex-col gap-2 text-sm">
                  <input type="file" id="cover_file" name="cover_file" className={popupInputClassName} />
                  <button
                    type="submit"
                    className="rounded bg-secondary-700 px-2 py-1 text-sm font-medium text-white hover:bg-secondary-800 dark:bg-secondary-600"
                  >
                    Upload Cover
                  </button>
                </form>
                <form className="flex w-72 flex-col gap-2 text-sm">
                  <input type="checkbox" checked id="remove_cover" name="remove_cover" className="hidden" />
                  <button
                    type="submit"
                    className="rounded bg-secondary-700 px-2 py-1 text-sm font-medium text-white hover:bg-secondary-800 dark:bg-secondary-600"
                  >
                    Remove Cover
                  </button>
                </form>
              </div>
            </div>

            <div className="relative my-auto flex grow justify-between text-content-muted">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowDelete(!showDelete)}
                  className={iconButtonClassName}
                  aria-label="Delete"
                >
                  <DeleteIcon size={28} />
                </button>
                <div
                  className={`absolute bottom-7 left-5 z-30 ${popupClassName} ${
                    showDelete ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <form className="w-24 text-sm">
                    <button
                      type="submit"
                      className="rounded bg-red-600 px-2 py-1 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </div>

              <a
                href={`/activity?document=${document.id}`}
                aria-label="Activity"
                className={iconButtonClassName}
              >
                <ActivityIcon size={28} />
              </a>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowIdentify(!showIdentify)}
                  aria-label="Identify"
                  className={iconButtonClassName}
                >
                  <SearchIcon size={28} />
                </button>
                <div
                  className={`absolute bottom-7 left-5 z-30 ${popupClassName} ${
                    showIdentify ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <form className="flex flex-col gap-2 text-sm">
                    <input
                      type="text"
                      id="title"
                      name="title"
                      placeholder="Title"
                      defaultValue={document.title}
                      className={popupInputClassName}
                    />
                    <input
                      type="text"
                      id="author"
                      name="author"
                      placeholder="Author"
                      defaultValue={document.author}
                      className={popupInputClassName}
                    />
                    <input
                      type="text"
                      id="isbn"
                      name="isbn"
                      placeholder="ISBN 10 / ISBN 13"
                      defaultValue={document.isbn13 || document.isbn10}
                      className={popupInputClassName}
                    />
                    <button
                      type="submit"
                      className="rounded bg-secondary-700 px-2 py-1 text-sm font-medium text-white hover:bg-secondary-800 dark:bg-secondary-600"
                    >
                      Identify
                    </button>
                  </form>
                </div>
              </div>

              {document.filepath ? (
                <a
                  href={`/api/v1/documents/${document.id}/file`}
                  aria-label="Download"
                  className={iconButtonClassName}
                >
                  <DownloadIcon size={28} />
                </a>
              ) : (
                <span className="text-content-subtle">
                  <DownloadIcon size={28} disabled />
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid justify-between gap-4 pb-4 sm:grid-cols-2">
          <Field
            isEditing={isEditingTitle}
            label={
              <>
                <FieldLabel>Title</FieldLabel>
                <FieldActions>
                  {isEditingTitle ? (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setIsEditingTitle(false)} className={iconButtonClassName} aria-label="Cancel edit">
                        <CloseIcon size={18} />
                      </button>
                      <button type="button" onClick={saveTitle} className={iconButtonClassName} aria-label="Confirm edit">
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
                      className={iconButtonClassName}
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
                <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className={editInputClassName} />
              </div>
            ) : (
              <FieldValue>{document.title}</FieldValue>
            )}
          </Field>

          <Field
            isEditing={isEditingAuthor}
            label={
              <>
                <FieldLabel>Author</FieldLabel>
                <FieldActions>
                  {isEditingAuthor ? (
                    <>
                      <button type="button" onClick={() => setIsEditingAuthor(false)} className={iconButtonClassName} aria-label="Cancel edit">
                        <CloseIcon size={18} />
                      </button>
                      <button type="button" onClick={saveAuthor} className={iconButtonClassName} aria-label="Confirm edit">
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
                      className={iconButtonClassName}
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
                <input type="text" value={editAuthor} onChange={e => setEditAuthor(e.target.value)} className={editInputClassName} />
              </div>
            ) : (
              <FieldValue>{document.author}</FieldValue>
            )}
          </Field>

          <Field
            label={
              <>
                <FieldLabel>Time Read</FieldLabel>
                <button
                  type="button"
                  onClick={() => setShowTimeReadInfo(!showTimeReadInfo)}
                  className={`${iconButtonClassName} my-auto`}
                  aria-label="Show time read info"
                >
                  <InfoIcon size={18} />
                </button>
                <div
                  className={`absolute right-0 top-7 z-30 ${popupClassName} ${
                    showTimeReadInfo ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <div className="flex text-xs">
                    <p className="w-32 text-content-subtle">Seconds / Percent</p>
                    <p className="font-medium">{secondsPerPercent !== 0 ? secondsPerPercent : 'N/A'}</p>
                  </div>
                  <div className="flex text-xs">
                    <p className="w-32 text-content-subtle">Words / Minute</p>
                    <p className="font-medium">{document.wpm && document.wpm > 0 ? document.wpm : 'N/A'}</p>
                  </div>
                  <div className="flex text-xs">
                    <p className="w-32 text-content-subtle">Est. Time Left</p>
                    <p className="whitespace-nowrap font-medium">
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

          <Field label={<FieldLabel>Progress</FieldLabel>}>
            <FieldValue>{`${percentage.toFixed(2)}%`}</FieldValue>
          </Field>
        </div>

        <Field
          isEditing={isEditingDescription}
          label={
            <>
              <FieldLabel>Description</FieldLabel>
              <FieldActions>
                {isEditingDescription ? (
                  <>
                    <button type="button" onClick={() => setIsEditingDescription(false)} className={iconButtonClassName} aria-label="Cancel edit">
                      <CloseIcon size={18} />
                    </button>
                    <button type="button" onClick={saveDescription} className={iconButtonClassName} aria-label="Confirm edit">
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
                    className={iconButtonClassName}
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
                className="h-32 w-full grow rounded border border-secondary-200 bg-secondary-50 p-2 font-medium text-content focus:outline-none focus:ring-2 focus:ring-secondary-400 dark:border-secondary-700 dark:bg-secondary-900/20 dark:focus:ring-secondary-500"
                rows={5}
              />
            </div>
          ) : (
            <FieldValue className="hyphens-auto text-justify">{document.description || 'N/A'}</FieldValue>
          )}
        </Field>
      </div>
    </div>
  );
}
