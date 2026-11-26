import { useId, useState } from 'react';
import type { MatcherProvider } from '../api/bookMatcher';
import { candidateProviders as providers } from '../CandidatePicker';
import { ChoicePopover, type ChoiceDisclosure } from '../ChoicePopover';
import { JoinedActions } from '../Controls';
import { Icon } from '../Icon';
import styles from './BookMatcher.module.css';

const linkModes = [
  { value: 'link', label: 'Link Only', description: 'Save the provider link without editing the book.' },
  { value: 'fill', label: 'Fill Missing', description: 'Fill blank fields and keep existing values.' },
  { value: 'replace', label: 'Replace Fields', description: 'Update fields when the provider has a value.' },
] as const;
const providerOptions = ['openlibrary', 'hardcover'] as const;

export function MatcherLinkControls({
  provider,
  hardcoverAvailable,
  onProviderChange,
}: {
  provider?: MatcherProvider;
  hardcoverAvailable: boolean;
  onProviderChange: (provider: MatcherProvider) => void;
}) {
  const [mode, setMode] = useState<(typeof linkModes)[number]['value']>('link');
  const [open, setOpen] = useState<'provider' | 'mode' | null>(null);
  const previewId = useId();
  const preview = mode !== 'link';
  const modeLabel = linkModes.find((option) => option.value === mode)?.label;
  function disclosure(name: NonNullable<typeof open>): ChoiceDisclosure {
    return {
      open: open === name,
      onOpen: () => setOpen(name),
      onClose: () => setOpen((current) => (current === name ? null : current)),
    };
  }

  return (
    <div className={styles.linkControls}>
      <JoinedActions label="Matcher Options" size="slim" className={styles.linkTriggers}>
        <ChoicePopover
          presentation="joined"
          label="Provider Options"
          triggerLabel={provider ? `Provider: ${providers[provider].name}` : 'Provider'}
          disabled={!provider}
          trigger={
            <>
              {provider ? (
                <img src={providers[provider].icon} width={18} height={18} alt="" />
              ) : (
                <Icon name="search" size={18} />
              )}
              <Icon name="down" size={14} />
            </>
          }
          options={providerOptions.map((value) => {
            const unavailable = value === 'hardcover' && !hardcoverAvailable;
            return {
              value,
              label: providers[value].name,
              icon: <img src={providers[value].icon} width={18} height={18} alt="" />,
              disabled: unavailable,
              description: unavailable ? 'Not Configured' : undefined,
            };
          })}
          value={provider}
          onChange={(value) => {
            setOpen(null);
            if (value !== provider) onProviderChange(value);
          }}
          disclosure={disclosure('provider')}
        />
        <ChoicePopover
          presentation="joined"
          label="Linking Options"
          triggerLabel={`When Linking: ${modeLabel}`}
          descriptionId={preview ? previewId : undefined}
          trigger={
            <>
              <Icon name="link" size={17} />
              {modeLabel}
              <Icon name="down" size={14} />
            </>
          }
          options={linkModes}
          value={mode}
          onChange={(value) => {
            setMode(value);
            setOpen(null);
          }}
          disclosure={disclosure('mode')}
        />
      </JoinedActions>
      {preview && (
        <small className={styles.linkPreview} id={previewId} role="status">
          Preview only: confirming a link won’t change book metadata.
        </small>
      )}
    </div>
  );
}
