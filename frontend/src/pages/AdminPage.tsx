import { useState, SyntheticEvent } from 'react';
import { LoadingState } from '../components';
import { useGetAdmin, usePostAdminAction } from '../generated/anthoLumeAPIV1';
import { Button } from '../components/Button';
import { useToasts } from '../components/ToastContext';
import { getErrorMessage } from '../utils/errors';
import { streamResponseToFile, backupFilename } from '../utils/download';

interface BackupTypes {
  covers: boolean;
  documents: boolean;
}

export default function AdminPage() {
  const { isLoading } = useGetAdmin();
  const postAdminAction = usePostAdminAction();
  const { showInfo, showError, removeToast } = useToasts();

  const [backupTypes, setBackupTypes] = useState<BackupTypes>({
    covers: false,
    documents: false,
  });
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  const handleBackupSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    const backupTypesList: string[] = [];
    if (backupTypes.covers) backupTypesList.push('COVERS');
    if (backupTypes.documents) backupTypesList.push('DOCUMENTS');

    try {
      const formData = new FormData();
      formData.append('action', 'BACKUP');
      backupTypesList.forEach(value => formData.append('backup_types', value));

      // Streaming Fetch - The generated client buffers; the backup can be large, so this endpoint intentionally uses a raw streaming download.
      const response = await fetch('/api/v1/admin', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Backup failed: ' + response.statusText);
      }

      const completed = await streamResponseToFile(response, {
        suggestedName: backupFilename(),
        mimeType: 'application/zip',
        extension: '.zip',
      });

      if (completed) {
        showInfo('Backup completed successfully');
      }
    } catch (error) {
      showError('Backup failed: ' + getErrorMessage(error));
    }
  };

  const handleRestoreSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!restoreFile) return;

    const startedToastId = showInfo('Restore started', 0);

    try {
      const response = await postAdminAction.mutateAsync({
        data: {
          action: 'RESTORE',
          restore_file: restoreFile,
        },
      });

      removeToast(startedToastId);

      if (response.status >= 200 && response.status < 300) {
        showInfo('Restore completed successfully');
        return;
      }

      showError('Restore failed: ' + getErrorMessage(response.data));
    } catch (error) {
      removeToast(startedToastId);
      showError('Restore failed: ' + getErrorMessage(error));
    }
  };

  const handleMetadataMatch = () => {
    postAdminAction.mutate(
      { data: { action: 'METADATA_MATCH' } },
      {
        onSuccess: () => showInfo('Metadata matching started'),
        onError: error => showError('Metadata matching failed: ' + getErrorMessage(error)),
      }
    );
  };

  const handleCacheTables = () => {
    postAdminAction.mutate(
      { data: { action: 'CACHE_TABLES' } },
      {
        onSuccess: () => showInfo('Cache tables started'),
        onError: error => showError('Cache tables failed: ' + getErrorMessage(error)),
      }
    );
  };

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="flex w-full grow flex-col gap-4">
      <div className="flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
        <p className="mb-2 text-lg font-semibold text-content">Backup & Restore</p>
        <div className="flex flex-col gap-4">
          <form className="flex justify-between text-content" onSubmit={handleBackupSubmit}>
            <div className="flex items-center gap-8">
              <div>
                <input
                  type="checkbox"
                  id="backup_covers"
                  checked={backupTypes.covers}
                  onChange={e => setBackupTypes({ ...backupTypes, covers: e.target.checked })}
                />
                <label htmlFor="backup_covers">Covers</label>
              </div>
              <div>
                <input
                  type="checkbox"
                  id="backup_documents"
                  checked={backupTypes.documents}
                  onChange={e => setBackupTypes({ ...backupTypes, documents: e.target.checked })}
                />
                <label htmlFor="backup_documents">Documents</label>
              </div>
            </div>
            <div className="h-10 w-40">
              <Button variant="secondary" type="submit">
                Backup
              </Button>
            </div>
          </form>

          <form onSubmit={handleRestoreSubmit} className="flex grow justify-between text-content">
            <div className="flex w-1/2 items-center">
              <input
                type="file"
                accept=".zip"
                onChange={e => setRestoreFile(e.target.files?.[0] || null)}
                className="w-full"
              />
            </div>
            <div className="h-10 w-40">
              <Button variant="secondary" type="submit" disabled={!restoreFile}>
                Restore
              </Button>
            </div>
          </form>
        </div>
      </div>

      <div className="flex grow flex-col rounded bg-surface p-4 text-content-muted shadow-lg">
        <p className="text-lg font-semibold text-content">Tasks</p>
        <table className="min-w-full bg-surface text-sm text-content">
          <tbody>
            <tr>
              <td className="pl-0">
                <p>Metadata Matching</p>
              </td>
              <td className="float-right py-2">
                <div className="h-10 w-40 text-base">
                  <Button variant="secondary" onClick={handleMetadataMatch}>
                    Run
                  </Button>
                </div>
              </td>
            </tr>
            <tr>
              <td>
                <p>Cache Tables</p>
              </td>
              <td className="float-right py-2">
                <div className="h-10 w-40 text-base">
                  <Button variant="secondary" onClick={handleCacheTables}>
                    Run
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
