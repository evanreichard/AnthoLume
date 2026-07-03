import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingState, Table, type Column } from '../components';
import { useGetImportDirectory, usePostImport } from '../generated/anthoLumeAPIV1';
import type { DirectoryItem } from '../generated/model';
import { Button } from '../components/Button';
import { FolderOpenIcon } from '../icons';
import { useMutationWithToast } from '../hooks/useMutationWithToast';

export default function AdminImportPage() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selectedDirectory, setSelectedDirectory] = useState<string>('');
  const [importType, setImportType] = useState<'DIRECT' | 'COPY'>('DIRECT');
  const navigate = useNavigate();
  const toastMutationOptions = useMutationWithToast();

  const { data: directoryData, isLoading } = useGetImportDirectory(
    currentPath ? { directory: currentPath } : {}
  );

  const postImport = usePostImport();

  const directoryResponse = directoryData?.status === 200 ? directoryData.data : null;
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

  const handleImport = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!selectedDirectory) return;

    postImport.mutate(
      {
        data: {
          directory: selectedDirectory,
          type: importType,
        },
      },
      toastMutationOptions({
        success: 'Import completed successfully',
        error: 'Import failed',
        onSuccess: () => navigate('/admin/import-results'),
      })
    );
  };

  const handleCancel = () => {
    setSelectedDirectory('');
  };

  if (isLoading && !currentPath) {
    return <LoadingState />;
  }

  if (selectedDirectory) {
    return (
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
    );
  }

  const directoryColumns: Column<DirectoryItem>[] = [
    {
      id: 'select',
      header: '',
      className: 'w-12',
      render: item => (
        <button onClick={() => item.name && handleSelectDirectory(item.name)}>
          <FolderOpenIcon size={20} />
        </button>
      ),
    },
    { id: 'name', header: currentPathDisplay, render: item => item.name ?? '' },
  ];

  return (
    <div className="flex flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
      {currentPathDisplay !== '/' && (
        <button
          onClick={handleNavigateUp}
          className="self-start text-content hover:text-primary-600"
        >
          ../
        </button>
      )}
      <Table
        columns={directoryColumns}
        data={directories}
        emptyMessage="No Folders"
        rowKey={item => item.name ?? ''}
      />
    </div>
  );
}
