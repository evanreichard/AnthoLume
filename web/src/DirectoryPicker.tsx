import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Account } from './reading';
import { session } from './session';
import { Button } from './Controls';
import { Icon } from './Icon';
import { Dialog, ErrorNotice } from './ui';
import { SkeletonRows } from './Skeleton';
import styles from './App.module.css';
import picker from './DirectoryPicker.module.css';

export function DirectoryPicker({ account, initialPath, onChoose, onCancel }: { account: Account; initialPath: string; onChoose: (path: string) => void; onCancel: () => void }) {
  const [directory, setDirectory] = useState(initialPath.startsWith('/') ? initialPath : '/');
  const [filter, setFilter] = useState('');
  const listing = useQuery({ queryKey: ['admin-storage-directories', account, directory], staleTime: 0, queryFn: ({ signal }) => session.api.adminStorageDirectories(account, directory, signal) });
  const folder = listing.data;
  const pathBar = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const path = folder?.path ?? directory;
  const parent = folder?.parent ?? (directory.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/');
  const entries = folder?.entries.filter(entry => entry.toLowerCase().includes(filter.trim().toLowerCase())) ?? [];
  function browse(path: string, focusPath = false) {
    setDirectory(path);
    setFilter('');
    if (focusPath) pathBar.current?.focus();
  }
  return <Dialog title="Select Folder" layout="scroll-body" onClose={onCancel} toolbar={
    <div className={picker.navigation}>
      <div className={picker.toolbar}>
        <button type="button" className={styles.icon} aria-label="Up one level" title="Up one level" disabled={parent === path} onClick={() => browse(parent, parent === '/')}><Icon name="up" /></button>
        <div className={picker.path}>
          <Icon name="folder" size={17} />
          <div ref={pathBar} tabIndex={0} role="status" title={path} className={picker.pathText}><bdi dir="ltr">{path}</bdi></div>
        </div>
      </div>
      {folder && folder.entries.length >= 10 && <div className={picker.search}>
        <Icon name="search" size={17} />
        <input ref={searchInput} type="search" aria-label="Filter folders" placeholder="Filter folders" value={filter} onChange={event => setFilter(event.target.value)} />
        {filter && <button type="button" aria-label="Clear folder filter" title="Clear folder filter" onClick={() => {
          setFilter('');
          searchInput.current?.focus();
        }}>×</button>}
      </div>}
    </div>
    } footer={<>
      <Button size="slim" tone="primary" disabled={!folder || listing.isError} onClick={() => { if (folder) onChoose(folder.path); }}>Select</Button>
      <Button size="slim" onClick={onCancel}>Cancel</Button>
    </>}>
      <section aria-label="Directory browser" key={path}>
        <ErrorNotice error={listing.error} />
        {listing.isPending && <SkeletonRows label="Loading folders…" secondary={false} />}
        {folder && <>
          {entries.length > 0 ? <ul className={picker.folders}>
            {entries.map(entry => <li key={entry}><button type="button" onClick={() => browse(`${folder.path.replace(/\/$/, '')}/${entry}`, true)}><Icon name="folder" size={17} /><bdi>{entry}</bdi><Icon name="forward" size={15} /></button></li>)}
          </ul> : <p className={picker.hint}>{filter.trim() ? 'No matching folders.' : 'No subfolders.'}</p>}
        </>}
      </section>
    </Dialog>;
}
