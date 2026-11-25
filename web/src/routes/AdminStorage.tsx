import { useId, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '../api/schema.gen';
import type { Account } from '../reading';
import { session } from '../session';
import { ActionRow, CircleAction, Card, CardHeader, Button } from '../Controls';
import { Dialog, ErrorNotice } from '../ui';
import { DirectoryPicker } from '../DirectoryPicker';
import { Icon } from '../Icon';
import { SkeletonRows } from '../Skeleton';
import { ReadingHTTPError } from '../reading';
import styles from '../App.module.css';
import storage from './AdminStorage.module.css';

export type StorageRoot = components['schemas']['AdminStorageRoot'];
export const storageRootsKey = (account: Account) => ['admin-storage-roots', account] as const;

export function StorageRoots({ account, roots, error }: { account: Account; roots: StorageRoot[]; error: unknown }) {
  const [editing, setEditing] = useState<StorageRoot | 'new' | null>(null);
  return <Card className={storage.rootCard} density="compact" aria-labelledby="storage-roots">
    <CardHeader id="storage-roots" title="Storage Roots" action={<CircleAction icon="add" label="Add Root" onClick={() => setEditing('new')} />} />
    <ErrorNotice error={error} />
    <div className={storage.rootList}>{roots.map(root => <ActionRow key={root.id} label={root.label} onClick={() => setEditing(root)} value={<span className={storage.rootValue}>
      <span className={storage.rootStatus}>
        {!root.directory_available && <span className={storage.rootWarning} role="img" aria-label="Directory unavailable on the server" title="Directory unavailable on the server">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 4.9a2 2 0 0 1 3.4 0l7.4 13.2a2 2 0 0 1-1.7 2.9H4.6a2 2 0 0 1-1.7-2.9zM12 9v4m0 4h.01" />
          </svg>
        </span>}
        {root.managed ? 'Managed' : 'Referenced'}
      </span>
      <span className={storage.rootPath} title={root.path || root.legacy_path}><bdi dir="ltr">{root.path || root.legacy_path || 'Not mapped'}</bdi></span>
    </span>} />)}</div>
    {editing && <RootEditor account={account} current={editing === 'new' ? undefined : editing} libraryPath={roots.find(root => root.managed)?.path} close={() => setEditing(null)} />}
  </Card>;
}

function RootEditor({ account, current, libraryPath, close }: { account: Account; current?: StorageRoot; libraryPath?: string; close: () => void }) {
  const formId = useId();
  const directoryId = useId();
  const client = useQueryClient();
  const [label, setLabel] = useState(current?.label ?? '');
  const [path, setPath] = useState(current?.path ?? '');
  const [browsing, setBrowsing] = useState<'edit' | 'library' | null>(null);
  const [confirmLibrary, setConfirmLibrary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const id = current?.id ?? `root-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`;
      await session.api.saveAdminStorageRoot(account, { id, label: label.trim(), path: path.trim() });
      await client.invalidateQueries({ queryKey: storageRootsKey(account) });
      await client.invalidateQueries({ queryKey: ['admin-backup-preview', account] });
      close();
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  if (confirmLibrary && current) return <MakeLibraryDialog account={account} root={current} path={path.trim()} cancel={() => setConfirmLibrary(false)} close={close} />;
  if (browsing) return <DirectoryPicker key="picker" account={account} initialPath={path.trim() || (browsing === 'library' ? libraryPath : undefined) || '/'} onCancel={() => setBrowsing(null)} onChoose={directory => {
    setPath(directory);
    if (browsing === 'library') setConfirmLibrary(true);
    setBrowsing(null);
  }} />;

  return <Dialog key="editor" title={current ? 'Edit Root' : 'Add Root'} onClose={() => { if (!busy) close(); }} footer={<>
    <Button size="slim" form={formId} tone="primary" type="submit" disabled={busy || !label.trim() || !path.trim()}>Save</Button>
    {current && !current.managed && <Button size="slim" disabled={busy} onClick={() => {
      if (path.trim()) setConfirmLibrary(true);
      else setBrowsing('library');
    }}>Make Library</Button>}
    <Button size="slim" disabled={busy} onClick={close}>Cancel</Button>
  </>}>
    <form id={formId} className={styles.manageForm} onSubmit={save}>
      {current && <p className={storage.hint}>{current.book_count.toLocaleString()} {current.book_count === 1 ? 'book' : 'books'} in catalog</p>}
      <label>Name<input required value={label} maxLength={128} onChange={event => setLabel(event.target.value)} /></label>
      <div className={storage.directoryField}>
        <label htmlFor={directoryId}>Directory</label>
        <div className={storage.directoryRow}>
          <input id={directoryId} required value={path} maxLength={4096} placeholder="/books" onChange={event => setPath(event.target.value)} />
          <button type="button" className={styles.icon} aria-label="Browse Directories" title="Browse Directories" aria-haspopup="dialog" disabled={busy} onClick={() => setBrowsing('edit')}><Icon name="folder" /></button>
        </div>
      </div>
      {current && <p className={storage.hint}>Changing the folder does not move files.</p>}
      <ErrorNotice error={error} />
    </form>
  </Dialog>;
}

function MakeLibraryDialog({ account, root, path, cancel, close }: { account: Account; root: StorageRoot; path: string; cancel: () => void; close: () => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['make-library', account, root.id, path], staleTime: 0,
    queryFn: ({ signal }) => session.api.previewMakeLibrary(account, root.id, path, signal) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const plan = query.data;
  async function apply() {
    if (!plan) return;
    setBusy(true); setError(null);
    try {
      await session.api.makeLibrary(account, plan);
      for (const queryKey of [storageRootsKey(account), ['admin-backup-preview', account], ['auto-import-rules', account], ['documents'], ['document'], ['library-resume']]) {
        void client.invalidateQueries({ queryKey });
      }
      close();
    } catch (failure) {
      if (failure instanceof ReadingHTTPError && failure.problem.code === 'library_plan_changed') {
        setError(new Error('The Library or source changed. Review the updated details before confirming again.'));
        await query.refetch();
      } else setError(failure);
    } finally { setBusy(false); }
  }
  const sameFolder = plan?.same_folder === true;
  return <Dialog key="make-library" title={sameFolder ? 'Merge into Library?' : 'Make this folder Library?'} onClose={() => { if (!busy) cancel(); }} footer={<>
    <Button size="slim" tone="primary" disabled={busy || query.isFetching || !plan} onClick={() => void apply()}>{sameFolder ? 'Merge into Library' : 'Make Library'}</Button>
    <Button size="slim" disabled={busy} onClick={cancel}>Cancel</Button>
  </>}>
    <div className={styles.manageForm}>
      {query.isPending && <SkeletonRows label="Checking Library change…" count={2} />}
      <ErrorNotice error={error || query.error} />
      {plan && <>
        {sameFolder
          ? <p>Library already points at this folder. Its path will stay the same.</p>
          : <p><strong>{root.label}</strong> will become the destination for copies and restored files.</p>}
        <p className={storage.hint}>{plan.source_path}</p>
        <p>{plan.incoming} {plan.incoming === 1 ? 'book' : 'books'} will join Library. {sameFolder
          ? 'These books will be included in Library file backups.'
          : `The former Library becomes a source; its ${plan.outgoing} books won’t be included in Library file backups.`}</p>
        {plan.paused_rules > 0 && <p>{plan.paused_rules} auto-import rules will be paused.</p>}
        <p>No files will move. Reading history stays intact.</p>
      </>}
    </div>
  </Dialog>;
}
