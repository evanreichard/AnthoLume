import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, type Account } from '../reading';
import { session } from '../session';
import { Dialog, ErrorNotice } from '../ui';
import styles from '../App.module.css';

type Device = components['schemas']['ManagedDevice'];
const zones = ['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])];

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
    <div className={styles.actions}><button className={styles.primary} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button><button type="button" disabled={busy} onClick={onClose}>Cancel</button></div>
  </form>;
}

export function AccountSettings({ account, timezone, readOnly }: { account: Account; timezone: string; readOnly: boolean }) {
  const [modal, setModal] = useState<'timezone' | 'password' | Device | null>(null);
  const [feedback, setFeedback] = useState('');
  const close = () => setModal(null);
  const [showArchived, setShowArchived] = useState(false);
  const client = useQueryClient();
  const devices = useQuery({ queryKey: ['managed-devices', account], queryFn: ({ signal }) => session.api.devices(account, signal) });
  const visible = devices.data?.filter(device => showArchived || !device.archived);
  const archivedCount = devices.data?.filter(device => device.archived).length ?? 0;
  const format = (date: string) => {
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(date)); }
    catch { return new Date(date).toLocaleString(); }
  };
  return <>
    <section className={styles.panel} aria-labelledby="preferences-heading">
      <h2 id="preferences-heading">Preferences</h2>
      <div className={styles.settingsRow}><div><strong>Timezone</strong><p>{timezone} · Used for Insights and streaks.</p></div><button disabled={readOnly} onClick={() => setModal('timezone')}>Change timezone</button></div>
      <div className={styles.settingsRow}><div><strong>Password</strong><p>Changing your password signs out other sessions.</p></div><button disabled={readOnly} onClick={() => setModal('password')}>Change password</button></div>
      {feedback && <p role="status">{feedback}</p>}
    </section>
    <section className={styles.panel} aria-labelledby="devices-heading">
      <h2 id="devices-heading">Reading devices</h2>
      <p>Rename devices or archive old entries. Archiving hides a device from this list without affecting sync or reading history.</p>
      <ErrorNotice error={devices.error} />
      {devices.isPending && <p role="status">Loading devices…</p>}
      {visible && !visible.length && <p>No {archivedCount ? 'active ' : ''}reading devices yet.</p>}
      {visible?.map(device => <div className={styles.settingsRow} key={device.id}>
        <div><strong>{device.label || device.name}{device.archived ? ' · Archived' : ''}</strong><p>Last synced {format(device.last_synced)}</p></div>
        <button aria-label={`Manage ${device.label || device.name}`} disabled={readOnly} onClick={() => setModal(device)}>Manage</button>
      </div>)}
      {archivedCount > 0 && <button aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide archived devices' : `Show archived devices (${archivedCount})`}</button>}
    </section>
    {modal === 'timezone' && <Dialog title="Change timezone" onClose={close}><SettingsForm onClose={close} action={async data => {
      try { await session.updateTimezone(account, String(data.get('timezone'))); }
      catch (err) { if (err instanceof ReadingHTTPError && err.problem.code === 'invalid_timezone') throw new Error('Enter a valid timezone, such as America/New_York.'); throw err; }
      setFeedback('Timezone updated.');
    }}>
      <label>Timezone<input name="timezone" list="settings-timezones" defaultValue={timezone} maxLength={128} required autoComplete="off" /></label>
      <datalist id="settings-timezones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist>
    </SettingsForm></Dialog>}
    {modal === 'password' && <Dialog title="Change password" onClose={close}><SettingsForm onClose={close} action={async data => {
      const newPassword = String(data.get('new'));
      if (newPassword !== data.get('confirm')) throw new Error('New passwords do not match.');
      try { await session.changePassword(account, { current_password: String(data.get('current')), new_password: newPassword }); }
      catch (err) { if (err instanceof ReadingHTTPError && err.problem.code === 'incorrect_password') throw new Error('Current password is incorrect.'); throw err; }
      setFeedback('Password changed. Other sessions were signed out.');
    }}>
      <label>Current password<input name="current" type="password" autoComplete="current-password" required maxLength={256} /></label>
      <label>New password<input name="new" type="password" autoComplete="new-password" required maxLength={256} /></label>
      <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required maxLength={256} /></label>
    </SettingsForm></Dialog>}
    {modal && typeof modal !== 'string' && <Dialog title="Manage reading device" onClose={close}><SettingsForm onClose={close} action={async data => {
      const saved = await session.api.updateDevice(account, modal.id, { label: String(data.get('label')), archived: data.has('archived') });
      client.setQueryData<Device[]>(['managed-devices', account], old => old?.map(device => device.id === saved.id ? saved : device));
      setFeedback(saved.archived ? 'Device archived.' : 'Device settings updated.');
    }}>
      <label>Custom name<input name="label" defaultValue={modal.label} placeholder={modal.name} maxLength={128} /></label>
      <label className={styles.settingsCheck}><input name="archived" type="checkbox" defaultChecked={modal.archived} /> Archive this device</label>
    </SettingsForm></Dialog>}
  </>;
}
