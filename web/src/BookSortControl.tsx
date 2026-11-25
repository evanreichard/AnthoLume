import { useState } from 'react';
import { IconButton } from './Controls';
import { Icon } from './Icon';
import { sortOptions, type LibrarySort } from './library';
import { Dialog } from './ui';
import styles from './BookSortControl.module.css';

type BookSortControlProps = {
  sort: LibrarySort;
  onChange: (value: LibrarySort) => void;
  dialog?: { open: boolean; onOpen: () => void; onClose: () => void };
};

export function BookSortControl({ sort, onChange, dialog }: BookSortControlProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = dialog?.open ?? localOpen;
  return (
    <>
      <IconButton
        aria-label="Sort Books"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={dialog?.onOpen ?? (() => setLocalOpen(true))}
      >
        <Icon name="sort" />
      </IconButton>
      {open && (
        <Dialog title="Sort Books" onClose={dialog?.onClose ?? (() => setLocalOpen(false))}>
          <div className={styles.options}>
            {sortOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={sort === value}
                onClick={() => {
                  // URL-Owned Dialog - The caller applies the sort and closes the popup in one navigation.
                  onChange(value);
                  if (!dialog) setLocalOpen(false);
                }}
              >
                {label}
                {sort === value && <Icon name="check" size={17} />}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
