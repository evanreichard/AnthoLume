import { useState, SyntheticEvent } from 'react';
import { usePostAdminAction } from '../generated/anthoLumeAPIV1';
import { Button } from '../components/Button';
import { useToasts } from '../components/ToastContext';
import { useMutationWithToast } from '../hooks/useMutationWithToast';
import { getErrorMessage } from '../utils/errors';
import { streamResponseToFile, backupFilename } from '../utils/download';

interface BackupTypes {
  covers: boolean;
  documents: boolean;
}

export default function AdminPage() {
  const postAdminAction = usePostAdminAction();
  const { showInfo, showError, updateToast } = useToasts();
  const toastMutationOptions = useMutationWithToast();

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

    // Progress Toast - Restore is long-running; a persistent 'started' toast resolves in place into the result toast on completion.
    const toastId = showInfo('Restore started', 0);

    try {
      await postAdminAction.mutateAsync({
        data: {
          action: 'RESTORE',
          restore_file: restoreFile,
        },
      });

      updateToast(toastId, { message: 'Restore completed successfully', duration: 5000 });
    } catch (error) {
      updateToast(toastId, {
        type: 'error',
        message: `Restore failed: ${getErrorMessage(error)}`,
        duration: 5000,
      });
    }
  };

  const handleMetadataMatch = () => {
    postAdminAction.mutate(
      { data: { action: 'METADATA_MATCH' } },
      toastMutationOptions({
        success: 'Metadata matching started',
        error: 'Failed to start metadata matching',
      })
    );
  };

  const handleCacheTables = () => {
    postAdminAction.mutate(
      { data: { action: 'CACHE_TABLES' } },
      toastMutationOptions({
        success: 'Cache tables started',
        error: 'Failed to start cache tables',
      })
    );
  };

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
            <div className="w-40">
              <Button variant="secondary" type="submit" className="w-full">
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
            <div className="w-40">
              <Button variant="secondary" type="submit" className="w-full" disabled={!restoreFile}>
                Restore
              </Button>
            </div>
          </form>
        </div>
      </div>

      <div className="flex grow flex-col rounded bg-surface p-4 text-content-muted shadow-lg">
        <p className="mb-4 text-lg font-semibold text-content">Tasks</p>
        <ul className="flex flex-col gap-3 text-sm text-content">
          <li className="flex items-center justify-between gap-4">
            <p>Metadata Matching</p>
            <Button variant="secondary" onClick={handleMetadataMatch}>
              Run
            </Button>
          </li>
          <li className="flex items-center justify-between gap-4">
            <p>Cache Tables</p>
            <Button variant="secondary" onClick={handleCacheTables}>
              Run
            </Button>
          </li>
        </ul>
      </div>
    </div>
  );
}
