import { ChoicePopover, type ChoiceDisclosure } from './ChoicePopover';
import { Icon } from './Icon';
import { sortOptions, type LibrarySort } from './library';

const choices = sortOptions.map(([value, label]) => ({ value, label }));

export function BookSortControl({
  sort,
  onChange,
  disclosure,
}: {
  sort: LibrarySort;
  onChange: (value: LibrarySort) => void;
  disclosure?: ChoiceDisclosure;
}) {
  return (
    <ChoicePopover
      label="Sort Books"
      trigger={<Icon name="sort" />}
      options={choices}
      value={sort}
      onChange={onChange}
      disclosure={disclosure}
    />
  );
}
