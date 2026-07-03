import { useState } from 'react';
import { useGetImportDirectory, usePostImport } from '../generated/anthoLumeAPIV1';
import type { DirectoryItem, DirectoryListResponse } from '../generated/model';
import { getErrorMessage } from '../utils/errors';
import { Button } from '../components/Button';
import { FolderOpenIcon } from '../icons';
import { useToasts } from '../components/ToastContext';

export default function AdminImportPage() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selectedDirectory, setSelectedDirectory] = useState<string>('');
  const [importType, setImportType] = useState<'DIRECT' | 'COPY'>('DIRECT');
  const { showInfo, showError } = useToasts();

  const { data: directoryData, isLoading } = useGetImportDirectory(
    currentPath ? { directory: currentPath } : {}
  );

  const postImport = usePostImport();

  const directoryResponse =
    directoryData?.status === 200 ? (directoryData.data as DirectoryListResponse) : null;
  const directories = directoryResponse?.items ?? [];
  const currentPathDisplay = directoryResponse?.current_path ?? currentPath ?? '/data';

  const handleSelectDirectory = (directory: string) => {
    setSelectedDirectory(`${currentPath}/${directory}`);
  };

  const handleNavigateUp = () => {
    if (currentPathDisplay !== '/') {
      const parts = currentPathDisplay.split('/');
      parts.pop();
      setCurrentPath(parts.join('/') || '');
    }
  };

  const handleImport = () => {
    if (!selectedDirectory) return;

    postImport.mutate(
      {
        data: {
          directory: selectedDirectory,
          type: importType,
        },
      },
      {
        onSuccess: _response => {
          showInfo('Import completed successfully');
          setTimeout(() => {
            window.location.href = '/admin/import-results';
          }, 1500);
        },
        onError: error => {
          showError('Import failed: ' + getErrorMessage(error));
        },
      }
    );
  };

  const handleCancel = () => {
    setSelectedDirectory('');
  };

  if (isLoading && !currentPath) {
    return <div className="text-content-muted">Loading...</div>;
  }

  if (selectedDirectory) {
    return (
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full overflow-hidden rounded shadow">
          <div className="flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
            <p className="text-lg font-semibold text-content">Selected Import Directory</p>
            <form className="flex flex-col gap-4" onSubmit={handleImport}>
              <div className="flex w-full justify-between gap-4">
                <div className="flex items-center gap-4 text-content">
                  <FolderOpenIcon size={20} />
                  <p className="break-all text-lg font-medium">{selectedDirectory}</p>
                </div>
                <div className="mr-4 flex flex-col justify-around gap-2 text-content">
                  <div className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      id="direct"
                      checked={importType === 'DIRECT'}
                      onChange={() => setImportType('DIRECT')}
                    />
                    <label htmlFor="direct">Direct</label>
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      id="copy"
                      checked={importType === 'COPY'}
                      onChange={() => setImportType('COPY')}
                    />
                    <label htmlFor="copy">Copy</label>
                  </div>
                </div>
              </div>
              <div className="flex gap-4">
                <Button type="submit" className="px-10 py-2 text-base">
                  Import Directory
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCancel}
                  className="px-10 py-2 text-base"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full overflow-hidden rounded shadow">
        <table className="min-w-full bg-surface text-sm leading-normal text-content">
          <thead className="text-content-muted">
            <tr>
              <th className="w-12 border-b border-border p-3 text-left font-normal"></th>
              <th className="break-all border-b border-border p-3 text-left font-normal">
                {currentPath}
              </th>
            </tr>
          </thead>
          <tbody>
            {currentPath !== '/' && (
              <tr>
                <td className="border-b border-border p-3 text-content-muted"></td>
                <td className="border-b border-border p-3">
                  <button onClick={handleNavigateUp}>
                    <p>../</p>
                  </button>
                </td>
              </tr>
            )}
            {directories.length === 0 ? (
              <tr>
                <td className="p-3 text-center" colSpan={2}>
                  No Folders
                </td>
              </tr>
            ) : (
              directories.map((item: DirectoryItem) => (
                <tr key={item.name}>
                  <td className="border-b border-border p-3 text-content-muted">
                    <button onClick={() => item.name && handleSelectDirectory(item.name)}>
                      <FolderOpenIcon size={20} />
                    </button>
                  </td>
                  <td className="border-b border-border p-3">
                    <button onClick={() => item.name && handleSelectDirectory(item.name)}>
                      <p>{item.name ?? ''}</p>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
