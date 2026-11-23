import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../Icon';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, useReading, type Account } from '../reading';
import { session } from '../session';
import { Dialog, ErrorNotice } from '../ui';
import { ActionRow, ActionRows, Card, CardHeader, Pager, Button, Dropdown, IconButton } from '../Controls';
import styles from '../App.module.css';
import { SkeletonRows } from '../Skeleton';

type Device = components['schemas']['ManagedDevice'];
const zones = ['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])];

function zoneName(zone: string) {
  if (zone.startsWith('Etc/')) return zone.slice(4).replaceAll('_', ' ');
  return zone.split('/').at(-1)!.replaceAll('_', ' ');
}

function zoneOption(zone: string) {
  const region = zone.split('/')[0];
  return zone.includes('/') && region !== 'Etc' ? `${zoneName(zone)} · ${region.replaceAll('_', ' ')}` : zoneName(zone);
}

function TimeZonePicker({ current }: { current: string }) {
  const options = [...new Set([...zones, current, Intl.DateTimeFormat().resolvedOptions().timeZone].filter(Boolean))]
    .map(id => ({ id, label: zoneOption(id) })).sort((a, b) => a.label.localeCompare(b.label));
  return <label>Time zone<Dropdown stretch name="timezone" required defaultValue={current}>
    {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
  </Dropdown></label>;
}

function SettingsForm({ action, children, onClose }: { action(data: FormData): Promise<void>; children: ReactNode; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try { await action(data); onClose(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}>
    <fieldset className={styles.settingsFields} disabled={busy}>{children}</fieldset>
    <ErrorNotice error={error} />
    <div className={styles.actions}><Button type="submit" tone="primary" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</Button><Button type="button" disabled={busy} onClick={onClose}>Cancel</Button></div>
  </form>;
}

function cacheSize(bytes: number) {
  const unit = bytes >= 1024 ** 3 ? 'GiB' : bytes >= 1024 ** 2 ? 'MiB' : bytes >= 1024 ? 'KiB' : 'B';
  const divisor = { GiB: 1024 ** 3, MiB: 1024 ** 2, KiB: 1024, B: 1 }[unit];
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / divisor)} ${unit}`;
}

function ReaderCacheSettings() {
  const { ready, readerCacheSummary, clearReaderCache } = useReading();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [cleared, setCleared] = useState(false);
  const summary = useQuery({ queryKey: ['reader-cache-summary'], queryFn: readerCacheSummary, enabled: open && ready, retry: false });
  function close() {
    if (busy) return;
    if (confirm) { setConfirm(false); setError(null); }
    else setOpen(false);
  }
  async function clear() {
    setBusy(true); setError(null); setCleared(false);
    try { await clearReaderCache(); await summary.refetch(); setConfirm(false); setCleared(true); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <Card aria-labelledby="debug-heading">
    <CardHeader id="debug-heading" title="Debug" />
    <ActionRows>
      <ActionRow label="Reader Cache" disabled={!ready} onClick={() => { setError(null); setCleared(false); setOpen(true); }} />
    </ActionRows>
    {open && <Dialog title={confirm ? 'Clear Reader Cache?' : 'Reader Cache'} onClose={close} footer={<>
      <Button type="button" tone="primary" disabled={!ready || busy} onClick={() => {
        if (confirm) void clear();
        else { setCleared(false); setConfirm(true); }
      }}>{busy ? 'Clearing…' : 'Clear'}</Button>
      <Button type="button" disabled={busy} onClick={close}>{confirm ? 'Cancel' : 'Done'}</Button>
    </>}>
      {confirm ? <>
        <p>This removes all cached EPUBs on this device, including pinned offline copies. Books can download again when online. Local books, reading progress, and settings are kept.</p>
        <ErrorNotice error={error} />
      </> : <>
        {summary.isPending && <SkeletonRows label="Checking reader cache…" count={2} secondary={false} />}
        {summary.data && <dl className={styles.readerCacheStats}>
          <div><dt>Books</dt><dd>{summary.data.books.toLocaleString()} ({cacheSize(summary.data.epubBytes)})</dd></div>
          <div><dt>Metadata</dt><dd>{cacheSize(summary.data.metadataBytes)}</dd></div>
        </dl>}
        <ErrorNotice error={summary.error} />
        {cleared && <p className={styles.settingsCardFeedback} role="status">Reader cache cleared.</p>}
      </>}
    </Dialog>}
  </Card>;
}

export function AccountSettings({ account, username, timezone, readOnly, syncStatus, syncDetails, onSignOut }: { account: Account; username: string; timezone: string; readOnly: boolean; syncStatus: string; syncDetails: ReactNode; onSignOut(): void }) {
  const [modal, setModal] = useState<'timezone' | 'password' | Device | null>(null);
  const [feedback, setFeedback] = useState('');
  const close = () => setModal(null);
  const [devicePage, setDevicePage] = useState(0);
  const [params, setParams] = useSearchParams();
  const showSync = params.get('sync') === 'open';
  function toggleSync() {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (showSync) next.delete('sync'); else next.set('sync', 'open');
      return next;
    }, { replace: true, preventScrollReset: true });
  }
  const client = useQueryClient();
  const devices = useQuery({ queryKey: ['managed-devices', account], queryFn: ({ signal }) => session.api.devices(account, signal) });
  const allDevices = devices.data ?? [];
  const orderedDevices = [...allDevices.filter(device => !device.archived), ...allDevices.filter(device => device.archived)];
  const devicePages = Math.ceil(allDevices.length / 10);
  const currentPage = Math.min(devicePage, Math.max(0, devicePages - 1));
  const visibleDevices = orderedDevices.slice(currentPage * 10, (currentPage + 1) * 10);
  const timezoneLabel = zoneName(timezone);
  const format = (date: string, detailed = false) => {
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', ...(detailed && { timeStyle: 'short' }), timeZone: timezone }).format(new Date(date)); }
    catch { return new Date(date).toLocaleDateString(); }
  };
  const deviceRows = (list: Device[]) => <ul className={styles.deviceList}>{list.map(device => {
    const name = device.label || device.name;
    return <li key={device.id}><ActionRow
      aria-label={`Manage ${name}`} disabled={readOnly} onClick={() => setModal(device)}
      leading={<span className={styles.deviceGlyph}><Icon name="device" size={17} /></span>}
      label={<span className={styles.deviceCopy}><strong>{name}</strong><time dateTime={device.last_synced}>{device.archived ? 'Archived · ' : 'Synced '}{format(device.last_synced)}</time></span>}
    /></li>;
  })}</ul>;
  return <>
    <Card aria-labelledby="account-heading">
      <CardHeader id="account-heading" title="Account" subtitle={username}
        leading={<span className={styles.accountAvatar}><Icon name="user" size={18} /></span>}
        action={<IconButton aria-label="Sign Out" title="Sign Out" onClick={onSignOut}><Icon name="sign-out" size={18} /></IconButton>} />
      <ActionRows>
        <ActionRow divider label="Locale" value={timezoneLabel} disabled={readOnly} onClick={() => setModal('timezone')} />
        <ActionRow divider label="Password" disabled={readOnly} onClick={() => setModal('password')} />
        <ActionRow divider label="Sync" value={syncStatus} aria-expanded={showSync} aria-controls="account-sync-details" onClick={toggleSync} />
        <div id="account-sync-details" hidden={!showSync}>{syncDetails}</div>
      </ActionRows>
      {feedback && <p className={styles.settingsCardFeedback} role="status">{feedback}</p>}
    </Card>
    <div className={styles.settingsStack}>
    <Card aria-labelledby="devices-heading">
      <CardHeader id="devices-heading" title="Devices" />
      <ErrorNotice error={devices.error} />
      {devices.isPending && <SkeletonRows label="Loading devices…" />}
      {devices.data && (visibleDevices.length ? deviceRows(visibleDevices) : <p className={styles.settingsCardFeedback}>No devices yet.</p>)}
      {devicePages > 1 && <Pager label="Device pages" page={currentPage + 1} total={devicePages}
        hasNext={currentPage + 1 < devicePages} onPageChange={page => setDevicePage(page - 1)} />}
    </Card>
    <ReaderCacheSettings />
    </div>
    {modal === 'timezone' && <Dialog title="Change Locale" onClose={close}><SettingsForm onClose={close} action={async data => {
      try { await session.updateTimezone(account, String(data.get('timezone'))); }
      catch (err) { if (err instanceof ReadingHTTPError && err.problem.code === 'invalid_timezone') throw new Error('Choose a time zone supported by this server.'); throw err; }
      setFeedback('Timezone updated.');
    }}>
      <TimeZonePicker current={timezone} />
    </SettingsForm></Dialog>}
    {modal === 'password' && <Dialog title="Change Password" onClose={close}><SettingsForm onClose={close} action={async data => {
      const newPassword = String(data.get('new'));
      if (newPassword !== data.get('confirm')) throw new Error('New passwords do not match.');
      try { await session.changePassword(account, { current_password: String(data.get('current')), new_password: newPassword }); }
      catch (err) { if (err instanceof ReadingHTTPError && err.problem.code === 'incorrect_password') throw new Error('Current password is incorrect.'); throw err; }
      setFeedback('Password changed. Other sessions were signed out.');
    }}>
      <p>Changing your password signs out other sessions.</p>
      <label>Current password<input name="current" type="password" autoComplete="current-password" required maxLength={256} /></label>
      <label>New password<input name="new" type="password" autoComplete="new-password" required maxLength={256} /></label>
      <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required maxLength={256} /></label>
    </SettingsForm></Dialog>}
    {modal && typeof modal !== 'string' && <DeviceEditor key={modal.id} device={modal} lastSynced={format(modal.last_synced, true)} close={close}
      update={async (changes, message) => {
        const saved = await session.api.updateDevice(account, modal.id, changes);
        client.setQueryData<Device[]>(['managed-devices', account], old => old?.map(device => device.id === saved.id ? saved : device));
        setFeedback(message);
      }} />}
  </>;
}

function DeviceEditor({ device, lastSynced, close, update }: {
  device: Device;
  lastSynced: string;
  close(): void;
  update(changes: components['schemas']['DevicePreferences'], message: string): Promise<void>;
}) {
  const formId = useId();
  const [name, setName] = useState(device.label);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const archiveAction = device.archived ? 'Unarchive' : 'Archive';
  function dismiss() {
    if (busy) return;
    if (confirm) { setConfirm(false); setError(null); }
    else close();
  }
  async function apply(archive: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (archive) await update({ label: device.label, archived: !device.archived }, device.archived ? 'Device unarchived.' : 'Device archived.');
      else await update({ label: name, archived: device.archived }, 'Device settings updated.');
      close();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return <Dialog title={confirm ? `${archiveAction} Device?` : 'Manage Device'} onClose={dismiss} footer={<>
    {confirm
      ? <Button size="slim" tone="primary" disabled={busy} onClick={() => void apply(true)}>{archiveAction}</Button>
      : <>
        <Button size="slim" form={formId} type="submit" tone="primary" disabled={busy || name === device.label}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button size="slim" disabled={busy} onClick={() => { setError(null); setConfirm(true); }}>{archiveAction}</Button>
      </>}
    <Button size="slim" disabled={busy} onClick={dismiss}>Cancel</Button>
  </>}>
    <div className={styles.manageForm}>
      {confirm
        ? <p>{archiveAction} <strong>{device.label || device.name}</strong>?{name !== device.label && ' The unsaved name change will be discarded.'}</p>
        : <form id={formId} className={styles.manageForm} onSubmit={event => { event.preventDefault(); if (name !== device.label) void apply(false); }}>
          <label>Name<input value={name} placeholder={device.name} maxLength={128} disabled={busy} onChange={event => setName(event.target.value)} /></label>
          <small className={styles.deviceLastSynced}>Last synced <time dateTime={device.last_synced}>{lastSynced}</time></small>
        </form>}
      <ErrorNotice error={error} />
    </div>
  </Dialog>;
}
