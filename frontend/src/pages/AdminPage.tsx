import { useState, FormEvent } from 'react';
import { useGetAdmin, usePostAdminAction } from '../generated/anthoLumeAPIV1';
import { Button } from '../components/Button';
import { useToasts } from '../components/ToastContext';
import { getErrorMessage } from '../utils/errors';

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

  const handleBackupSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const backupTypesList: string[] = [];
    if (backupTypes.covers) backupTypesList.push('COVERS');
    if (backupTypes.documents) backupTypesList.push('DOCUMENTS');

    try {
      const formData = new FormData();
      formData.append('action', 'BACKUP');
      backupTypesList.forEach(value => formData.append('backup_types', value));

      const response = await fetch('/api/v1/admin', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Backup failed: ' + response.statusText);
      }

      const filename = `AnthoLumeBackup_${new Date().toISOString().replace(/[:.]/g, '')}.zip`;

      // Stream the response directly to disk using File System Access API
      // This avoids loading multi-GB files into browser memory
      if ('showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function') {
        try {
          // Modern browsers: Use File System Access API for direct disk writes
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
          });

          const writable = await handle.createWritable();

          // Stream response body directly to file without buffering
          const reader = response.body?.getReader();
          if (!reader) throw new Error('Unable to read response');

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
          }

          await writable.close();
          showInfo('Backup completed successfully');
        } catch (err) {
          // User cancelled or error
          if ((err as Error).name !== 'AbortError') {
            showError('Backup failed: ' + (err as Error).message);
          }
        }
      } else {
        // Fallback for older browsers
        showError(
          'Your browser does not support large file downloads. Please use Chrome, Edge, or Safari.'
        );
      }
    } catch (error) {
      showError('Backup failed: ' + getErrorMessage(error));
    }
  };

  const handleRestoreSubmit = async (e: FormEvent) => {
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
      {
        data: {
          action: 'METADATA_MATCH',
        },
      },
      {
        onSuccess: () => {
          showInfo('Metadata matching started');
        },
        onError: error => {
          showError('Metadata matching failed: ' + getErrorMessage(error));
        },
      }
    );
  };

  const handleCacheTables = () => {
    postAdminAction.mutate(
      {
        data: {
          action: 'CACHE_TABLES',
        },
      },
      {
        onSuccess: () => {
          showInfo('Cache tables started');
        },
        onError: error => {
          showError('Cache tables failed: ' + getErrorMessage(error));
        },
      }
    );
  };

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="flex w-full grow flex-col gap-4">
      {/* Backup & Restore Card */}
      <div className="flex grow flex-col gap-2 rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white">
        <p className="mb-2 text-lg font-semibold">Backup & Restore</p>
        <div className="flex flex-col gap-4">
          {/* Backup Form */}
          <form className="flex justify-between" onSubmit={handleBackupSubmit}>
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

          {/* Restore Form */}
          <form onSubmit={handleRestoreSubmit} className="flex grow justify-between">
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

      {/* Tasks Card */}
      <div className="flex grow flex-col rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white">
        <p className="text-lg font-semibold">Tasks</p>
        <table className="min-w-full bg-white text-sm dark:bg-gray-700">
          <tbody className="text-black dark:text-white">
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
