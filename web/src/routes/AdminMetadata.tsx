import { useState } from 'react';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '../api/schema.gen';
import { Card, CardHeader, RadioChoices } from '../Controls';
import type { Account } from '../reading';
import { session } from '../session';
import { SkeletonRows } from '../Skeleton';
import { ErrorNotice } from '../ui';
import styles from '../App.module.css';

type Provider = components['schemas']['MetadataProvider'];
const tokenHint = 'Set HARDCOVER_CATALOG_TOKEN and restart the server to enable Hardcover.';

export function AdminMetadata({ account }: { account: Account }) {
  const options = queryOptions({ queryKey: ['metadata-providers', account], queryFn: ({ signal }) => session.api.metadataProviders(account, signal) });
  const { queryKey } = options;
  const client = useQueryClient();
  const query = useQuery(options);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const current = query.data;
  async function choose(provider: Provider) {
    if (!current || saving || provider === current.selected || (provider === 'hardcover' && !current.hardcover_available)) return;
    setSaving(true); setError(null);
    try {
      const saved = await session.api.setAdminMetadataProvider(account, provider);
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, saved);
    } catch (failure) { setError(failure); }
    finally { setSaving(false); }
  }
  return <Card density="compact" aria-labelledby="admin-metadata-heading">
    <CardHeader id="admin-metadata-heading" title="Metadata Provider" />
    <ErrorNotice error={error ?? query.error} />
    {query.isPending && <SkeletonRows label="Loading metadata provider…" count={1} secondary={false} />}
    {current && <>
      <RadioChoices<Provider> labelledBy="admin-metadata-heading" value={current.selected} onChange={choose} options={[
        { value: 'openlibrary', label: 'Open Library', description: 'Default provider for Identify Book.', disabled: saving },
        { value: 'hardcover', label: 'Hardcover', description: current.hardcover_available ? 'Use the Hardcover catalog for all readers.' : tokenHint, disabled: saving || !current.hardcover_available },
      ]} />
      {current.selected !== current.effective && <p role="status" className={styles.settingsCardFeedback}>Open Library is active because the saved Hardcover provider no longer has a catalog token.</p>}
      {saving && <p role="status" className={styles.settingsCardFeedback}>Saving provider…</p>}
    </>}
  </Card>;
}
