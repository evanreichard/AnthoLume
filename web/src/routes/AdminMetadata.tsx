import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '../api/schema.gen';
import { Card, CardHeader, RadioChoices } from '../Controls';
import type { Account } from '../reading';
import { session } from '../session';
import { SkeletonRows } from '../Skeleton';
import { ErrorNotice } from '../ui';
import styles from '../App.module.css';

type Provider = components['schemas']['MetadataProvider'];
const tokenHint = 'Set HARDCOVER_CATALOG_TOKEN and restart the server to enable Hardcover.';

export function AdminMetadata({ account, readOnly }: { account: Account; readOnly: boolean }) {
  const queryKey = ['admin-metadata-provider', account] as const;
  const client = useQueryClient();
  const query = useQuery({ queryKey, queryFn: ({ signal }) => session.api.adminMetadataProvider(account, signal) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const current = query.data;
  async function choose(provider: Provider) {
    if (!current || readOnly || saving || provider === current.selected || (provider === 'hardcover' && !current.hardcover_available)) return;
    setSaving(true); setError(null);
    try {
      const saved = await session.api.setAdminMetadataProvider(account, provider);
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, saved);
    } catch (failure) { setError(failure); }
    finally { setSaving(false); }
  }
  return <Card aria-labelledby="admin-metadata-heading">
    <CardHeader id="admin-metadata-heading" title="Book Identification" />
    <ErrorNotice error={error ?? query.error} />
    {query.isPending && <SkeletonRows label="Loading metadata provider…" count={1} secondary={false} />}
    {current && <>
      <RadioChoices<Provider> legend="Metadata provider" value={current.selected} onChange={choose} options={[
        { value: 'openlibrary', label: 'Open Library', description: 'Default provider for Identify Book.', disabled: saving || readOnly },
        { value: 'hardcover', label: 'Hardcover', description: current.hardcover_available ? 'Use the Hardcover catalog for all readers.' : tokenHint, disabled: saving || readOnly || !current.hardcover_available },
      ]} />
      {current.selected !== current.effective && <p role="status" className={styles.settingsCardFeedback}>Open Library is active because the saved Hardcover provider no longer has a catalog token.</p>}
      {saving && <p role="status" className={styles.settingsCardFeedback}>Saving provider…</p>}
    </>}
  </Card>;
}
