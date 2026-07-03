import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetDocument,
  useEditDocument,
  getGetDocumentQueryKey,
} from '../generated/anthoLumeAPIV1';
import type { EditDocumentBody } from '../generated/model';
import { formatDuration } from '../utils/formatters';
import { getErrorMessage, getResponseError } from '../utils/errors';
import { ActivityIcon, DownloadIcon, EditIcon, InfoIcon, CloseIcon, CheckIcon } from '../icons';
import { Field, FieldLabel, FieldValue, FieldActions, LoadingState } from '../components';
import { useToasts } from '../components/ToastContext';

const iconButtonClassName = 'cursor-pointer text-content-muted hover:text-content';
const popupClassName =
  'rounded bg-surface-strong p-3 text-content shadow-lg transition-all duration-200';
const editInputClassName =
  'w-full rounded border border-border bg-surface-muted p-2 text-lg font-medium text-content focus:outline-hidden focus:ring-2 focus:ring-primary-600';

interface EditableFieldProps {
  label: string;
  value: string;
  multiline?: boolean;
  valueClassName?: string;
  onSave: (value: string) => Promise<boolean>;
}

function EditableField({
  label,
  value,
  multiline = false,
  valueClassName,
  onSave,
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const startEdit = () => {
    setDraft(value);
    setIsEditing(true);
  };

  // Keep Editor Open On Failure - Only close once the save actually succeeds so a failed edit isn't silently lost.
  const confirm = async () => {
    if (await onSave(draft)) setIsEditing(false);
  };

  return (
    <Field
      label={
        <>
          <FieldLabel>{label}</FieldLabel>
          <FieldActions>
            {isEditing ? (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className={iconButtonClassName}
                  aria-label="Cancel edit"
                >
                  <CloseIcon size={18} />
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  className={iconButtonClassName}
                  aria-label="Confirm edit"
                >
                  <CheckIcon size={18} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startEdit}
                className={iconButtonClassName}
                aria-label={`Edit ${label.toLowerCase()}`}
              >
                <EditIcon size={18} />
              </button>
            )}
          </FieldActions>
        </>
      }
    >
      {isEditing ? (
        <div className="relative mt-1 flex gap-2">
          {multiline ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="h-32 w-full grow rounded border border-border bg-surface-muted p-2 font-medium text-content focus:outline-hidden focus:ring-2 focus:ring-primary-600"
              rows={5}
            />
          ) : (
            <input
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className={editInputClassName}
            />
          )}
        </div>
      ) : (
        <FieldValue className={valueClassName}>{value || 'N/A'}</FieldValue>
      )}
    </Field>
  );
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: docData, isLoading: docLoading } = useGetDocument(id || '');
  const editMutation = useEditDocument();
  const { showError } = useToasts();

  const [showTimeReadInfo, setShowTimeReadInfo] = useState(false);

  if (docLoading) {
    return <LoadingState />;
  }

  if (!docData || docData.status !== 200) {
    return <div className="text-content-muted">Document not found</div>;
  }

  const document = docData.data.document;

  const percentage = document.percentage ?? 0;
  const secondsPerPercent = document.seconds_per_percent || 0;
  const totalTimeLeftSeconds = Math.round((100 - percentage) * secondsPerPercent);

  const save = async (data: EditDocumentBody): Promise<boolean> => {
    try {
      const response = await editMutation.mutateAsync({ id: document.id, data });
      const message = getResponseError(response);
      if (message) {
        showError('Failed to save: ' + message);
        return false;
      }
      queryClient.setQueryData(getGetDocumentQueryKey(document.id), response);
      return true;
    } catch (err) {
      showError('Failed to save: ' + getErrorMessage(err));
      return false;
    }
  };

  return (
    <div className="relative size-full">
      <div className="size-full overflow-scroll rounded bg-surface p-4 text-content shadow-lg">
        <div className="relative float-left mb-2 mr-4 flex w-44 flex-col gap-2 md:w-60 lg:w-80">
          <img
            className="w-full rounded object-fill"
            src={`/api/v1/documents/${document.id}/cover`}
            alt={`${document.title} cover`}
          />

          {document.filepath && (
            <a
              href={`/reader/${document.id}`}
              className="z-10 mt-2 w-full rounded bg-secondary-700 py-1 text-center text-sm font-medium text-secondary-foreground hover:bg-secondary-800 focus:outline-hidden focus:ring-4 focus:ring-secondary-500"
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

            <div className="relative my-auto flex grow justify-between text-content-muted">
              <a
                href={`/activity?document=${document.id}`}
                aria-label="Activity"
                className={iconButtonClassName}
              >
                <ActivityIcon size={28} />
              </a>

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
          <EditableField
            label="Title"
            value={document.title}
            onSave={value => save({ title: value })}
          />

          <EditableField
            label="Author"
            value={document.author}
            onSave={value => save({ author: value })}
          />

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
                    <p className="font-medium">
                      {secondsPerPercent !== 0 ? secondsPerPercent : 'N/A'}
                    </p>
                  </div>
                  <div className="flex text-xs">
                    <p className="w-32 text-content-subtle">Words / Minute</p>
                    <p className="font-medium">
                      {document.wpm && document.wpm > 0 ? document.wpm : 'N/A'}
                    </p>
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

        <EditableField
          label="Description"
          value={document.description || ''}
          multiline
          valueClassName="hyphens-auto text-justify"
          onSave={value => save({ description: value })}
        />
      </div>
    </div>
  );
}
