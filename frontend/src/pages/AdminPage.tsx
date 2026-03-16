import { useState, FormEvent } from 'react';
import { useGetAdmin, usePostAdminAction } from '../generated/anthoLumeAPIV1';
import { Button } from '../components/Button';

interface BackupTypes {
  covers: boolean;
  documents: boolean;
}

export default function AdminPage() {
  const { isLoading } = useGetAdmin();
  const postAdminAction = usePostAdminAction();

  const [backupTypes, setBackupTypes] = useState<BackupTypes>({
    covers: false,
    documents: false,
  });
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleBackupSubmit = (e: FormEvent) => {
    e.preventDefault();
    const backupTypesList: string[] = [];
    if (backupTypes.covers) backupTypesList.push('COVERS');
    if (backupTypes.documents) backupTypesList.push('DOCUMENTS');

    postAdminAction.mutate(
      {
        data: {
          action: 'BACKUP',
          backup_types: backupTypesList as any,
        },
      },
      {
        onSuccess: (response) => {
          // Handle file download
          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `AnthoLumeBackup_${new Date().toISOString().replace(/[:.]/g, '')}.zip`);
          document.body.appendChild(link);
          link.click();
          link.remove();
          setMessage('Backup completed successfully');
          setErrorMessage(null);
        },
        onError: (error) => {
          setErrorMessage('Backup failed: ' + (error as any).message);
          setMessage(null);
        },
      }
    );
  };

  const handleRestoreSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!restoreFile) return;

    const formData = new FormData();
    formData.append('restore_file', restoreFile);
    formData.append('action', 'RESTORE');

    postAdminAction.mutate(
      {
        data: formData as any,
      },
      {
        onSuccess: () => {
          setMessage('Restore completed successfully');
          setErrorMessage(null);
        },
        onError: (error) => {
          setErrorMessage('Restore failed: ' + (error as any).message);
          setMessage(null);
        },
      }
    );
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
          setMessage('Metadata matching started');
          setErrorMessage(null);
        },
        onError: (error) => {
          setErrorMessage('Metadata matching failed: ' + (error as any).message);
          setMessage(null);
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
          setMessage('Cache tables started');
          setErrorMessage(null);
        },
        onError: (error) => {
          setErrorMessage('Cache tables failed: ' + (error as any).message);
          setMessage(null);
        },
      }
    );
  };

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="w-full flex flex-col gap-4 grow">
      {/* Backup & Restore Card */}
      <div
        className="flex flex-col gap-2 grow p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
      >
        <p className="text-lg font-semibold mb-2">Backup & Restore</p>
        <div className="flex flex-col gap-4">
          {/* Backup Form */}
          <form className="flex justify-between" onSubmit={handleBackupSubmit}>
            <div className="flex gap-8 items-center">
              <div>
                <input
                  type="checkbox"
                  id="backup_covers"
                  checked={backupTypes.covers}
                  onChange={(e) => setBackupTypes({ ...backupTypes, covers: e.target.checked })}
                />
                <label htmlFor="backup_covers">Covers</label>
              </div>
              <div>
                <input
                  type="checkbox"
                  id="backup_documents"
                  checked={backupTypes.documents}
                  onChange={(e) => setBackupTypes({ ...backupTypes, documents: e.target.checked })}
                />
                <label htmlFor="backup_documents">Documents</label>
              </div>
            </div>
            <div className="w-40 h-10">
              <Button variant="secondary" type="submit">Backup</Button>
            </div>
          </form>

          {/* Restore Form */}
          <form
            onSubmit={handleRestoreSubmit}
            className="flex justify-between grow"
          >
            <div className="flex items-center w-1/2">
              <input
                type="file"
                accept=".zip"
                onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                className="w-full"
              />
            </div>
            <div className="w-40 h-10">
              <Button variant="secondary" type="submit">Restore</Button>
            </div>
          </form>
        </div>
        {errorMessage && (
          <span className="text-red-400 text-xs">{errorMessage}</span>
        )}
        {message && (
          <span className="text-green-400 text-xs">{message}</span>
        )}
      </div>

      {/* Tasks Card */}
      <div
        className="flex flex-col grow p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
      >
        <p className="text-lg font-semibold">Tasks</p>
        <table className="min-w-full bg-white dark:bg-gray-700 text-sm">
          <tbody className="text-black dark:text-white">
            <tr>
              <td className="pl-0">
                <p>Metadata Matching</p>
              </td>
              <td className="py-2 float-right">
                <div className="w-40 h-10 text-base">
                  <Button variant="secondary" onClick={handleMetadataMatch}>Run</Button>
                </div>
              </td>
            </tr>
            <tr>
              <td>
                <p>Cache Tables</p>
              </td>
              <td className="py-2 float-right">
                <div className="w-40 h-10 text-base">
                  <Button variant="secondary" onClick={handleCacheTables}>Run</Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}