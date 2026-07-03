import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table, type Column } from './Table';

interface TestRow {
  id: string;
  name: string;
  role: string;
}

const columns: Column<TestRow>[] = [
  {
    key: 'name',
    header: 'Name',
  },
  {
    key: 'role',
    header: 'Role',
  },
];

const data: TestRow[] = [
  { id: 'user-1', name: 'Ada', role: 'Admin' },
  { id: 'user-2', name: 'Grace', role: 'Reader' },
];

describe('Table', () => {
  it('renders a skeleton table while loading', () => {
    const { container } = render(<Table columns={columns} data={[]} loading />);

    expect(screen.queryByText('No Results')).not.toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  });

  it('renders the empty state message when there is no data', () => {
    render(<Table columns={columns} data={[]} emptyMessage="Nothing here" />);

    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('uses a custom render function for column output', () => {
    const customColumns: Column<TestRow>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (_value, row, index) => `${index + 1}. ${row.name.toUpperCase()}`,
      },
    ];

    render(<Table columns={customColumns} data={data} />);

    expect(screen.getByText('1. ADA')).toBeInTheDocument();
    expect(screen.getByText('2. GRACE')).toBeInTheDocument();
  });

});
