import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../Icon';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, type Account } from '../reading';
import { session } from '../session';
import { Dialog, ErrorNotice } from '../ui';
import { ActionRow, ActionRows, Card, CardHeader, CompactPill, Pager, PillSelect } from '../Controls';
import styles from '../App.module.css';

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
  return <label>Time zone<PillSelect stretch name="timezone" required defaultValue={current}>
    {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
  </PillSelect></label>;
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
    <div className={styles.actions}><button className={styles.filledPill} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button><button type="button" className={styles.pillAction} disabled={busy} onClick={onClose}>Cancel</button></div>
  </form>;
}

export function AccountSettings({ account, timezone, readOnly, syncStatus, syncDetails, onSignOut, children }: { account: Account; timezone: string; readOnly: boolean; syncStatus: string; syncDetails: ReactNode; onSignOut(): void; children?: ReactNode }) {
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
      <CardHeader id="account-heading" title="Account" subtitle={account.userId}
        leading={<span className={styles.accountAvatar}><Icon name="user" size={18} /></span>}
        action={<CompactPill onClick={onSignOut}>Sign out</CompactPill>} />
      <ActionRows>
        <ActionRow divider label="Time zone" value={timezoneLabel} disabled={readOnly} onClick={() => setModal('timezone')} />
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
      {devices.isPending && <p className={styles.settingsCardFeedback} role="status">Loading devices…</p>}
      {devices.data && (visibleDevices.length ? deviceRows(visibleDevices) : <p className={styles.settingsCardFeedback}>No devices yet.</p>)}
      {devicePages > 1 && <Pager label="Device pages" page={currentPage + 1} total={devicePages}
        hasNext={currentPage + 1 < devicePages} onPageChange={page => setDevicePage(page - 1)} />}
    </Card>
    {children}
    </div>
    {modal === 'timezone' && <Dialog title="Change time zone" onClose={close}><SettingsForm onClose={close} action={async data => {
      try { await session.updateTimezone(account, String(data.get('timezone'))); }
      catch (err) { if (err instanceof ReadingHTTPError && err.problem.code === 'invalid_timezone') throw new Error('Choose a time zone supported by this server.'); throw err; }
      setFeedback('Timezone updated.');
    }}>
      <TimeZonePicker current={timezone} />
    </SettingsForm></Dialog>}
    {modal === 'password' && <Dialog title="Change password" onClose={close}><SettingsForm onClose={close} action={async data => {
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
    {modal && typeof modal !== 'string' && <Dialog title="Manage reading device" onClose={close}><SettingsForm onClose={close} action={async data => {
      const saved = await session.api.updateDevice(account, modal.id, { label: String(data.get('label')), archived: data.has('archived') });
      client.setQueryData<Device[]>(['managed-devices', account], old => old?.map(device => device.id === saved.id ? saved : device));
      setFeedback(saved.archived ? 'Device archived.' : 'Device settings updated.');
    }}>
      <p>Last synced <time dateTime={modal.last_synced}>{format(modal.last_synced, true)}</time></p>
      <label>Custom name<input name="label" defaultValue={modal.label} placeholder={modal.name} maxLength={128} /></label>
      <label className={styles.settingsCheck}><input name="archived" type="checkbox" defaultChecked={modal.archived} /> Archive this device</label>
      <p>Archived devices are listed last. Sync and reading history are unchanged.</p>
    </SettingsForm></Dialog>}
  </>;
}
