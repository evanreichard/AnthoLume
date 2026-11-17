import { useState } from 'react';
import { defaultFilters, type LibraryFilters } from './libraryFilters';
import { Dialog } from './ui';

export function LibraryFilterDialog({
  filters,
  signedIn,
  count,
  onApply,
  onClose,
}: {
  filters: LibraryFilters;
  signedIn: boolean;
  count: (draft: LibraryFilters) => number;
  onApply: (draft: LibraryFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(filters);
  const total = count(draft);
  return (
    <Dialog title="Filter library" onClose={onClose}>
      <div className="filter-sheet stack">
        <p className="muted small">
          Search and filters include both sources. Ownership stays separate; nothing is uploaded.
        </p>
        <fieldset>
          <legend>Source</legend>
          <div className="filter-options">
            {(
              [
                ['all', 'All sources'],
                ['shared', 'Shared library'],
                ['local', 'Local originals'],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="source"
                  value={value}
                  checked={draft.source === value}
                  disabled={!signedIn && value === 'shared'}
                  onChange={() => setDraft({ ...draft, source: value })}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {!signedIn && (
          <p className="small muted">
            Shared records and account downloads are hidden after logout. Local originals need no
            account.
          </p>
        )}
        <fieldset>
          <legend>Availability</legend>
          <div className="filter-options">
            {(
              [
                ['all', 'All availability'],
                ['offline', 'Available offline'],
                ['online', 'Online only'],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="availability"
                  value={value}
                  checked={draft.availability === value}
                  onChange={() => setDraft({ ...draft, availability: value })}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <p role="status" className="filter-count">
          {total} matching {total === 1 ? 'title' : 'titles'}{' '}
          <small>· synthetic availability</small>
        </p>
        <p className="small muted">Reset changes this draft. Choose Apply to update the library.</p>
        <div className="filter-actions">
          <button onClick={() => setDraft(defaultFilters)}>Reset filters</button>
          <button className="primary" onClick={() => onApply(draft)}>
            Apply filters · {total} {total === 1 ? 'title' : 'titles'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
