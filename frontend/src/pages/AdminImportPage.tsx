import { useState } from 'react';
import { useGetImportDirectory, usePostImport } from '../generated/anthoLumeAPIV1';
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

  const directories = directoryData?.data?.items || [];
  const currentPathDisplay = directoryData?.data?.current_path ?? currentPath ?? '/data';

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
          // Redirect to import results page after a short delay
          setTimeout(() => {
            window.location.href = '/admin/import-results';
          }, 1500);
        },
        onError: error => {
          showError('Import failed: ' + (error as any).message);
        },
      }
    );
  };

  const handleCancel = () => {
    setSelectedDirectory('');
  };

  if (isLoading && !currentPath) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  if (selectedDirectory) {
    return (
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full overflow-hidden rounded shadow">
          <div className="flex grow flex-col gap-2 rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white">
            <p className="text-lg font-semibold text-gray-500">Selected Import Directory</p>
            <form className="flex flex-col gap-4" onSubmit={handleImport}>
              <div className="flex w-full justify-between gap-4">
                <div className="flex items-center gap-4">
                  <FolderOpenIcon size={20} />
                  <p className="break-all text-lg font-medium">{selectedDirectory}</p>
                </div>
                <div className="mr-4 flex flex-col justify-around gap-2">
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
        <table className="min-w-full bg-white text-sm leading-normal dark:bg-gray-700">
          <thead className="text-gray-800 dark:text-gray-400">
            <tr>
              <th className="w-12 border-b border-gray-200 p-3 text-left font-normal dark:border-gray-800"></th>
              <th className="break-all border-b border-gray-200 p-3 text-left font-normal dark:border-gray-800">
                {currentPath}
              </th>
            </tr>
          </thead>
          <tbody className="text-black dark:text-white">
            {currentPath !== '/' && (
              <tr>
                <td className="border-b border-gray-200 p-3 text-gray-800 dark:text-gray-400"></td>
                <td className="border-b border-gray-200 p-3">
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
              directories.map(item => (
                <tr key={item.name}>
                  <td className="border-b border-gray-200 p-3 text-gray-800 dark:text-gray-400">
                    <button onClick={() => item.name && handleSelectDirectory(item.name)}>
                      <FolderOpenIcon size={20} />
                    </button>
                  </td>
                  <td className="border-b border-gray-200 p-3">
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
