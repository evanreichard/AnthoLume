import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import SearchPage from './SearchPage';
import { useGetSearch } from '../generated/anthoLumeAPIV1';
import { GetSearchSource } from '../generated/model/getSearchSource';

vi.mock('../generated/anthoLumeAPIV1', () => ({
  useGetSearch: vi.fn(),
}));

const mockedUseGetSearch = vi.mocked(useGetSearch);

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseGetSearch.mockReturnValue({
      data: {
        status: 200,
        data: {
          results: [],
        },
      },
      isLoading: false,
    } as ReturnType<typeof useGetSearch>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the search disabled until a non-empty query is entered', () => {
    render(<SearchPage />);

    expect(mockedUseGetSearch).toHaveBeenLastCalledWith(
      {
        query: '',
        source: GetSearchSource.LibGen,
      },
      {
        query: {
          enabled: false,
        },
      },
    );
  });

  it('shows a loading state while results are being fetched', () => {
    mockedUseGetSearch.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useGetSearch>);

    render(<SearchPage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows an empty state when there are no results', () => {
    render(<SearchPage />);

    expect(screen.getByText('No Results')).toBeInTheDocument();
  });

  it('renders search results from the generated hook response', () => {
    mockedUseGetSearch.mockReturnValue({
      data: {
        status: 200,
        data: {
          results: [
            {
              id: 'doc-1',
              author: 'Ursula Le Guin',
              title: 'A Wizard of Earthsea',
              series: 'Earthsea',
              file_type: 'epub',
              file_size: '1 MB',
              upload_date: '2025-01-01',
            },
          ],
        },
      },
      isLoading: false,
    } as ReturnType<typeof useGetSearch>);

    render(<SearchPage />);

    expect(screen.getByText('Ursula Le Guin - A Wizard of Earthsea')).toBeInTheDocument();
    expect(screen.getByText('Earthsea')).toBeInTheDocument();
    expect(screen.getByText('epub')).toBeInTheDocument();
    expect(screen.getByText('1 MB')).toBeInTheDocument();
  });

  it('updates the generated hook args after the query debounce and source change', () => {
    vi.useFakeTimers();

    render(<SearchPage />);

    fireEvent.change(screen.getByPlaceholderText('Query'), { target: { value: 'dune' } });
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: GetSearchSource.Annas_Archive },
    });

    expect(mockedUseGetSearch).toHaveBeenLastCalledWith(
      {
        query: '',
        source: GetSearchSource.Annas_Archive,
      },
      {
        query: {
          enabled: false,
        },
      },
    );

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockedUseGetSearch).toHaveBeenLastCalledWith(
      {
        query: 'dune',
        source: GetSearchSource.Annas_Archive,
      },
      {
        query: {
          enabled: true,
        },
      },
    );
  });
});
