import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { sameAccount } from '../api/client';
import { ActionRow, ActionRows, Button, Card, CardHeader } from '../Controls';
import { ReadingHTTPError, type Account } from '../reading';
import { session } from '../session';
import { SkeletonRows } from '../Skeleton';
import { Dialog, ErrorNotice } from '../ui';
import hardcoverMark from '../assets/hardcover.svg';
import styles from '../App.module.css';

export function HardcoverSettings({ account }: { account: Account }) {
  const [params, setParams] = useSearchParams();
  const [callbackError, setCallbackError] = useState(() => params.get('hardcover') === 'error');
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [dialog, setDialog] = useState<'preview' | 'disconnect' | null>(null);
  const operation = useRef<AbortController | null>(null);
  const client = useQueryClient();
  const statusKey = ['hardcover', account, 'status'];
  const link = useQuery({ queryKey: statusKey, queryFn: ({ signal }) => session.api.hardcover(account, signal), gcTime: 0, staleTime: 0, retry: false });
  const { refetch } = link;
  const shelfConnectionLost = useCallback((problem: ShelfConnectionProblem) => {
    const { access } = session.getSnapshot();
    if (access.kind !== 'authenticated' || !sameAccount(access.account, account)) return;
    setDialog(null);
    client.setQueryData<typeof link.data>(['hardcover', account, 'status'], status => status && (problem === 'disconnected'
      ? { ...status, username: null, reconnect_required: false }
      : { ...status, reconnect_required: true }));
    void refetch();
  }, [account, client, refetch]);

  const username = link.data?.username;
  const reconnectRequired = !!username && link.data?.reconnect_required;
  const disconnected = !!link.data && (!link.data.enabled || !username);
  useEffect(() => {
    if (disconnected) {
      setDialog(null);
      setError(null);
    } else if (reconnectRequired) {
      setDialog(current => current === 'preview' ? null : current);
    }
  }, [disconnected, reconnectRequired]);

  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!params.has('hardcover')) return;
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('hardcover');
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [params, setParams]);

  async function change(action: 'connect' | 'disconnect') {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(action);
    setCallbackError(false);
    setError(null);
    const active = () => {
      const { access } = session.getSnapshot();
      return !controller.signal.aborted && access.kind === 'authenticated' && sameAccount(access.account, account);
    };
    let navigating = false;
    try {
      if (action === 'connect') {
        const result = await session.api.connectHardcover(account, controller.signal);
        if (!active()) return;
        window.location.assign(result.authorization_url);
        navigating = true;
      } else {
        await session.api.disconnectHardcover(account, controller.signal);
        if (!active()) return;
        await client.cancelQueries({ queryKey: statusKey });
        if (!active()) return;
        client.setQueryData(statusKey, { enabled: true, username: null, reconnect_required: false });
        setDialog(null);
      }
    } catch {
      if (!active()) return;
      if (action === 'connect') {
        setError(new Error('Could not start the Hardcover connection. Try again.'));
      } else {
        const status = await refetch();
        if (!active()) return;
        setDialog(null);
        if (status.isSuccess && status.data?.username) setError(new Error('Could not disconnect Hardcover. Try again.'));
      }
    } finally {
      if (!navigating) {
        operation.current = null;
        if (active()) setBusy(null);
      }
    }
  }

  const statusFailed = link.isError || (!link.data && link.errorUpdatedAt > 0);
  if (link.data?.enabled === false || (!link.data && !statusFailed)) return null;
  const actionLabel = reconnectRequired ? 'Reconnect Hardcover' : username ? 'Hardcover' : 'Connect Hardcover';
  return <Card aria-labelledby="connections-heading" density="compact">
    <CardHeader id="connections-heading" title="Connections" />
    {link.data?.enabled && <ActionRows><ActionRow label={reconnectRequired ? actionLabel : 'Hardcover'}
      subtitle={reconnectRequired ? `Access needs renewal for ${username}` : username ? `Connected as ${username}` : 'Connect your Want to Read shelf'}
      leading={<img src={hardcoverMark} alt="" width="30" height="30" />} disabled={busy !== null}
      aria-label={actionLabel}
      onClick={() => username && !reconnectRequired ? setDialog('preview') : void change('connect')} /></ActionRows>}
    {reconnectRequired && <Button size="slim" disabled={busy !== null} onClick={() => { setError(null); setDialog('disconnect'); }}>Disconnect</Button>}
    {callbackError && <ErrorNotice error={new Error('Hardcover was not connected. Try connecting again.')} />}
    {statusFailed && <div className={styles.form}>
      <ErrorNotice error={new Error('Could not check your Hardcover connection.')} />
      <div className={styles.actions}><Button size="slim" disabled={link.isFetching} onClick={() => void link.refetch()}>{link.isFetching ? 'Checking…' : 'Retry Connection Check'}</Button></div>
    </div>}
    <ErrorNotice error={error} />
    {username && !reconnectRequired && dialog === 'preview' && <Dialog title="Want to Read" layout="scroll-body" onClose={() => setDialog(null)}
      footer={<Button size="slim" onClick={() => { setError(null); setDialog('disconnect'); }}>Disconnect</Button>}>
      <WantToRead key={username} account={account} onConnectionLost={shelfConnectionLost} />
    </Dialog>}
    {username && dialog === 'disconnect' && <Dialog title="Disconnect?" dismissDisabled={!!busy} onClose={() => setDialog(null)} footer={<>
      <Button size="slim" tone="danger" disabled={busy !== null} onClick={() => void change('disconnect')}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</Button>
      <Button size="slim" disabled={busy !== null} onClick={() => setDialog(null)}>Cancel</Button>
    </>}>
      <p>Your books will not change.</p>
    </Dialog>}
  </Card>;
}

type ShelfConnectionProblem = 'disconnected' | 'reconnect';

function WantToRead({ account, onConnectionLost }: { account: Account; onConnectionLost: (problem: ShelfConnectionProblem) => void }) {
  const shelf = useInfiniteQuery({
    queryKey: ['hardcover', account, 'shelf'],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => session.api.hardcoverShelf(account, pageParam, signal),
    getNextPageParam: page => page.next_offset ?? undefined,
    gcTime: 0,
    retry: false,
  });
  const error = shelf.error;
  let connectionProblem: ShelfConnectionProblem | undefined;
  if (error instanceof ReadingHTTPError && error.status === 409) {
    if (error.problem.code === 'hardcover_not_connected') connectionProblem = 'disconnected';
    if (error.problem.code === 'hardcover_reconnect') connectionProblem = 'reconnect';
  }
  useEffect(() => {
    if (connectionProblem) onConnectionLost(connectionProblem);
  }, [connectionProblem, onConnectionLost]);
  if (connectionProblem) return null;
  const books = [...new Map(shelf.data?.pages.flatMap(page => page.books.map(book => [book.id, book] as const))).values()];
  return <div className={styles.form}>
    {shelf.isPending && <SkeletonRows label="Loading your Want to Read shelf…" count={2} />}
    {shelf.isError && <ErrorNotice error={new Error(shelf.isFetchNextPageError ? 'Could not load more books from Hardcover.' : 'Could not load your Want to Read shelf.')} />}
    {shelf.data && !books.length && <p className={styles.hardcoverDescription}>Your Want to Read shelf is empty.</p>}
    {!!books.length && <ul className={styles.hardcoverShelf}>
      {books.map(book => <li key={book.id}><strong>{book.title}</strong>{book.author && <span>{book.author}</span>}</li>)}
    </ul>}
    {(shelf.hasNextPage || (shelf.isError && !shelf.isPending)) && <div className={styles.actions}>
      <Button size="slim" disabled={shelf.isFetching} onClick={() => {
        if (shelf.hasNextPage && (!shelf.isError || shelf.isFetchNextPageError)) void shelf.fetchNextPage();
        else void shelf.refetch();
      }}>{shelf.isFetching ? 'Loading Books…' : shelf.isError ? 'Retry Loading Books' : 'Load More Books'}</Button>
    </div>}
  </div>;
}
