import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Account } from '../reading';
import type { components } from '../api/schema.gen';
import {
  ActionRow,
  Card,
  CardHeader,
  Disclosure,
  JoinedAction,
  JoinedActions,
  SegmentedControl,
  Button,
  Dropdown,
} from '../Controls';
import { SkeletonRows } from '../Skeleton';
import { ReadingHTTPError } from '../reading';
import { session } from '../session';
import { adminJobsKey, adminJobsOptions, autoImportRulesKey } from '../adminQueries';
import { Dialog, ErrorNotice } from '../ui';
import styles from '../App.module.css';
import layout from './AdminImport.module.css';
import type { StorageRoot } from './AdminStorage';

type Context = { account: Account; roots: StorageRoot[] };
type Rule = components['schemas']['AdminAutoImport'];
type Fields = { source: string; mode: 'copy' | 'reference' };
const modes = [
  ['copy', 'Copy'],
  ['reference', 'Reference'],
] as const;
const statusLabels = {
  idle: 'Waiting for scan',
  complete: 'Scan Complete',
  errors: 'Some files failed',
  unavailable: 'Source or destination unavailable',
};
const formatScanTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const initialFields = (rule?: Rule): Fields => ({
  source: rule?.settings.root_id ?? 'imports',
  mode: rule?.settings.reference ? 'reference' : 'copy',
});
const mappedSource = (roots: StorageRoot[], id: string) =>
  roots.find((root) => root.id === id && !root.managed && root.path);
const validFields = (roots: StorageRoot[], fields: Fields) =>
  !!mappedSource(roots, fields.source) &&
  (fields.mode === 'reference' || roots.some((root) => root.id === 'library' && root.path));

function defaultRoots(roots: StorageRoot[], fields: Fields): Fields {
  if (mappedSource(roots, fields.source)) return fields;
  return { ...fields, source: roots.find((root) => !root.managed && root.path)?.id ?? fields.source };
}

function RootField({
  label,
  roots,
  value,
  onChange,
  disabled,
}: {
  label: string;
  roots: StorageRoot[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const eligible = roots.filter((root) => root.path);
  const selected = eligible.find((root) => root.id === value);
  const unavailable = roots.find((root) => root.id === value)?.label;
  if (!eligible.length || (eligible.length === 1 && selected)) {
    return (
      <dl className={styles.fixedImportRoot}>
        <dt>{label}</dt>
        <dd>{selected?.label ?? (unavailable ? `${unavailable} (unavailable)` : 'No available roots')}</dd>
      </dl>
    );
  }
  return (
    <label className={layout.setting}>
      {label}
      <Dropdown
        size="slim"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {!selected && (
          <option value={value} disabled>
            {unavailable ? `${unavailable} (unavailable)` : 'Choose a root'}
          </option>
        )}
        {eligible.map((root) => (
          <option key={root.id} value={root.id}>
            {root.label}
          </option>
        ))}
      </Dropdown>
    </label>
  );
}

function ImportFields({
  roots,
  value,
  onChange,
  busy,
}: {
  roots: StorageRoot[];
  value: Fields;
  onChange: (value: Fields) => void;
  busy: boolean;
}) {
  return (
    <>
      <RootField
        label="Source"
        roots={roots.filter((root) => !root.managed)}
        value={value.source}
        disabled={busy}
        onChange={(source) => onChange({ ...value, source })}
      />
      <fieldset className={layout.method} disabled={busy}>
        <legend>Import method</legend>
        <SegmentedControl
          label="Import mode"
          options={modes}
          value={value.mode}
          onChange={(mode) => onChange({ ...value, mode })}
        />
        <p>{value.mode === 'copy' ? 'Copy books into the Library folder.' : 'Keep book files in the source folder.'}</p>
      </fieldset>
    </>
  );
}

export function AdminImport({ account, roots }: Context) {
  const [editor, setEditor] = useState<'manual' | 'new' | Rule | null>(null);
  const rules = useQuery({
    queryKey: autoImportRulesKey(account),
    queryFn: ({ signal }) => session.api.adminAutoImports(account, signal),
    refetchInterval: 3000,
  });
  const jobs = useQuery({
    ...adminJobsOptions(account, 'import'),
    refetchInterval: (query) => (query.state.data?.[0]?.status === 'running' ? 1000 : false),
  });
  const latest = jobs.data?.[0];
  const results = useQuery({
    queryKey: ['admin-import-results', account, latest?.id],
    enabled: latest?.status === 'succeeded',
    queryFn: ({ signal }) => session.api.adminImportResults(account, latest!.id, signal),
  });
  return (
    <Card density="compact" aria-labelledby="admin-import-heading">
      <CardHeader
        id="admin-import-heading"
        title="Import"
        action={
          <JoinedActions label="Import actions" size="slim">
            <JoinedAction onClick={() => setEditor('manual')}>Manual</JoinedAction>
            <JoinedAction onClick={() => setEditor('new')}>Auto</JoinedAction>
          </JoinedActions>
        }
      />
      <ErrorNotice error={rules.error || jobs.error || results.error} />
      {rules.isPending && <SkeletonRows label="Loading import rules…" />}
      {rules.data?.length === 0 && <p>No auto-import rules yet.</p>}
      {rules.data?.map((rule) => {
        const source = roots.find((root) => root.id === rule.settings.root_id)?.label ?? rule.settings.root_id;
        return (
          <ActionRow
            key={rule.id}
            divider
            label={rule.settings.name}
            subtitle={source}
            value={
              <>
                {rule.settings.enabled ? statusLabels[rule.status] : 'Paused'}
                <span className={layout.rowScanTime}>
                  {rule.last_scan ? <time dateTime={rule.last_scan}>{formatScanTime(rule.last_scan)}</time> : 'Never'}
                </span>
              </>
            }
            onClick={() => setEditor(rule)}
          />
        );
      })}
      {latest && (
        <div className={styles.adminCardDetails}>
          <p role="status">
            {latest.status === 'running'
              ? 'Import running…'
              : latest.status === 'succeeded'
                ? 'Import finished'
                : `Import ${latest.status}`}
          </p>
          {results.data && (
            <Disclosure
              inset
              title={results.data.length === 1 ? '1 File Result' : `${results.data.length} File Results`}
            >
              <ul>
                {results.data.map((row) => (
                  <li key={row.file}>
                    <span>{row.file}</span>
                    <strong>{row.status}</strong>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      )}
      {editor === 'manual' && (
        <ManualImport
          account={account}
          roots={roots}
          running={latest?.status === 'running'}
          close={() => setEditor(null)}
        />
      )}
      {editor && editor !== 'manual' && (
        <RuleEditor
          key={editor === 'new' ? 'new' : editor.id}
          account={account}
          roots={roots}
          rule={editor === 'new' ? undefined : (rules.data?.find((rule) => rule.id === editor.id) ?? editor)}
          close={() => setEditor(null)}
        />
      )}
    </Card>
  );
}

function ManualImport({ account, roots, running, close }: Context & { running: boolean; close: () => void }) {
  const formId = useId();
  const client = useQueryClient();
  const [draft, setFields] = useState(() => initialFields());
  const fields = defaultRoots(roots, draft);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [relink, setRelink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  function change(value: Fields) {
    setFields(value);
    setPreview(null);
    setError(null);
  }
  async function run(start: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (start) {
        await session.api.startAdminJob(account, 'import', {
          reference: fields.mode === 'reference',
          relink_missing: relink,
          root_id: fields.source,
        });
        await client.invalidateQueries({ queryKey: adminJobsKey(account, 'import') });
        close();
      } else setPreview(await session.api.previewAdminImport(account, fields.source));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Manual Import"
      dismissDisabled={busy}
      onClose={close}
      footer={
        <>
          <Button
            size="slim"
            form={formId}
            type="submit"
            tone={preview?.length ? undefined : 'primary'}
            disabled={busy || !mappedSource(roots, fields.source)}
          >
            Preview
          </Button>
          {!!preview?.length && (
            <Button
              size="slim"
              tone="primary"
              disabled={!validFields(roots, fields) || busy || running}
              onClick={() => void run(true)}
            >
              Start Import
            </Button>
          )}
          <Button size="slim" disabled={busy} onClick={close}>
            Cancel
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={layout.form}
        onSubmit={(event) => {
          event.preventDefault();
          void run(false);
        }}
      >
        <ImportFields roots={roots} value={fields} onChange={change} busy={busy} />
        <Disclosure inset title="Import Options">
          <label className={styles.settingsCheck}>
            <input type="checkbox" checked={relink} onChange={(event) => setRelink(event.target.checked)} /> Relink
            missing copies when the file matches exactly
          </label>
        </Disclosure>
        <ErrorNotice error={error} />
        {preview?.length === 0 && <p>No EPUBs found.</p>}
        {!!preview?.length && (
          <Disclosure
            inset
            title={preview.length === 1 ? '1 EPUB Ready to Review' : `${preview.length} EPUBs Ready to Review`}
          >
            <ul>
              {preview.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          </Disclosure>
        )}
      </form>
    </Dialog>
  );
}

const scanTriggers = {
  on_change: 'On Change',
  scheduled: 'Scheduled',
  manual: 'Manual',
  initial: 'Initial',
} satisfies Record<components['schemas']['AutoImportScanTrigger'], string>;

const cadences = [
  { id: 'changes', label: scanTriggers.on_change, watch: true, minutes: null },
  { id: 'hourly', label: 'Every hour', watch: false, minutes: 60 },
  { id: 'six-hourly', label: 'Every 6 hours', watch: false, minutes: 360 },
  { id: 'twelve-hourly', label: 'Every 12 hours', watch: false, minutes: 720 },
  { id: 'daily', label: 'Daily', watch: false, minutes: 1440 },
] as const;

function RuleEditor({ account, roots, rule, close }: Context & { rule?: Rule; close: () => void }) {
  const formId = useId();
  const client = useQueryClient();
  const [draft, setFields] = useState<Fields>(() =>
    rule ? initialFields(rule) : { ...initialFields(), mode: 'reference' },
  );
  const fields = rule ? draft : defaultRoots(roots, draft);
  const [name, setName] = useState(rule?.settings.name ?? '');
  const [enabled, setEnabled] = useState(rule?.settings.enabled ?? true);
  const savedCadence =
    rule &&
    cadences.find(
      (item) => item.watch === rule.settings.watch && (item.watch || item.minutes === rule.settings.interval_minutes),
    );
  const [cadence, setCadence] = useState(() => (rule ? (savedCadence?.id ?? 'custom') : 'changes'));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [scanRequest, setScanRequest] = useState<{ lastScan: Rule['last_scan'] } | null>(null);
  const summary = rule?.scan_summary;
  const scanQueued = scanRequest !== null && scanRequest.lastScan === rule?.last_scan;
  const before = rule?.settings;
  const selectedCadence = cadences.find((item) => item.id === cadence);
  const body = {
    name: name.trim(),
    root_id: fields.source,
    enabled,
    watch: selectedCadence?.watch ?? before?.watch ?? true,
    interval_minutes: selectedCadence?.minutes ?? before?.interval_minutes ?? 1,
    reference: fields.mode === 'reference',
  };
  const dirty = !before || Object.entries(body).some(([key, value]) => before[key as keyof typeof before] !== value);
  const valid = !!name.trim() && (!enabled || validFields(roots, fields));
  async function run(action: 'save' | 'scan' | 'delete') {
    setBusy(true);
    setError(null);
    setScanRequest(null);
    try {
      if (action === 'save') await session.api.saveAdminAutoImport(account, body, rule?.id);
      else if (rule && action === 'scan') {
        await session.api.queueAdminAutoImport(account, rule.id);
        setScanRequest({ lastScan: rule.last_scan });
      } else if (rule) await session.api.deleteAdminAutoImport(account, rule.id);
      await client.invalidateQueries({ queryKey: autoImportRulesKey(account) });
      if (action !== 'scan') close();
    } catch (err) {
      setError(
        err instanceof ReadingHTTPError && err.problem.code === 'auto_import_overlap'
          ? new Error('This source already has an enabled rule.')
          : err,
      );
    } finally {
      setBusy(false);
    }
  }
  if (confirmDelete)
    return (
      <Dialog
        title="Delete import rule?"
        dismissDisabled={busy}
        onClose={close}
        footer={
          <>
            <Button tone="danger" size="slim" disabled={busy} onClick={() => void run('delete')}>
              Delete Rule
            </Button>
            <Button size="slim" disabled={busy} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <p>Imported books will stay in the library.</p>
        <ErrorNotice error={error} />
      </Dialog>
    );
  return (
    <Dialog
      title={rule ? 'Edit Auto Import Rule' : 'Add Auto Import Rule'}
      dismissDisabled={busy}
      onClose={close}
      footer={
        <>
          <Button size="slim" form={formId} type="submit" tone="primary" disabled={busy || !dirty || !valid}>
            Save
          </Button>
          {rule?.settings.enabled && (
            <Button size="slim" disabled={busy || dirty} onClick={() => void run('scan')}>
              Scan
            </Button>
          )}
          <Button size="slim" disabled={busy} onClick={close}>
            Cancel
          </Button>
          {rule && (
            <Button size="slim" tone="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </>
      }
    >
      <form
        id={formId}
        className={layout.form}
        onSubmit={(event) => {
          event.preventDefault();
          void run('save');
        }}
      >
        <label>
          Name
          <input required value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </label>
        <ImportFields roots={roots} value={fields} onChange={setFields} busy={busy} />
        <label className={layout.setting}>
          Schedule
          <Dropdown
            size="slim"
            aria-label="Schedule"
            value={cadence}
            disabled={busy}
            onChange={(event) => {
              const value = cadences.find((item) => item.id === event.target.value)?.id;
              if (value) setCadence(value);
            }}
          >
            {before && !savedCadence && (
              <option value="custom" disabled>
                Custom ({before.interval_minutes} min)
              </option>
            )}
            {cadences.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Dropdown>
        </label>
        <div className={layout.ruleStatus}>
          <label className={layout.enabled}>
            <span>Enable</span>
            <span className={layout.toggle}>
              <input
                type="checkbox"
                role="switch"
                checked={enabled}
                disabled={busy}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span aria-hidden="true" />
            </span>
          </label>
          {rule && (
            <dl className={layout.scanTimes}>
              <dt>Last scan</dt>
              <dd>
                {rule.last_scan ? <time dateTime={rule.last_scan}>{formatScanTime(rule.last_scan)}</time> : 'Never'}
              </dd>
              <dt>Next scan</dt>
              <dd>
                {rule.next_scan ? (
                  <time dateTime={rule.next_scan}>{formatScanTime(rule.next_scan)}</time>
                ) : (
                  'Not scheduled'
                )}
              </dd>
            </dl>
          )}
        </div>
        {rule && (scanQueued || rule.last_scan) && (
          <div className={layout.scanResult} role="status">
            <div className={layout.resultHeader}>
              <p className={layout.resultHeading}>{scanQueued ? 'Scan Queued' : 'Last Scan'}</p>
              {!scanQueued && rule.last_scan_trigger && (
                <span className={layout.resultTrigger}>{scanTriggers[rule.last_scan_trigger]}</span>
              )}
            </div>
            {scanQueued ? (
              <p className={layout.resultNote}>Waiting for the import worker.</p>
            ) : summary ? (
              <>
                <dl className={layout.resultMetrics}>
                  <div>
                    <dt>Found</dt>
                    <dd>{summary.source_total.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Added</dt>
                    <dd>{summary.books_added.toLocaleString()}</dd>
                  </div>
                </dl>
                {rule.status === 'errors' && <p className={layout.resultNote}>Some files failed to import.</p>}
              </>
            ) : (
              <p className={layout.resultNote}>{statusLabels[rule.status]}</p>
            )}
          </div>
        )}
        <ErrorNotice error={error} />
      </form>
    </Dialog>
  );
}
