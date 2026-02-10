import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Search } from './Search';
import { useKnowledgeStore } from '@/stores/knowledge';
import type { Knowledge } from '@/types/knowledge';

const mockKnowledge: Knowledge[] = [
  {
    id: 'k-1',
    software: 'nginx',
    platform: 'ubuntu-22.04',
    content: {
      commands: ['sudo apt update', 'sudo apt install nginx -y'],
      verification: 'nginx -v',
      notes: ['Nginx is a web server'],
    },
    source: 'builtin',
    successCount: 10,
    lastUsed: '2026-02-09T12:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-09T12:00:00Z',
  },
  {
    id: 'k-2',
    software: 'nginx',
    platform: 'centos-8',
    content: {
      commands: ['sudo yum install nginx -y'],
      verification: 'nginx -v',
    },
    source: 'auto_learn',
    successCount: 5,
    lastUsed: '2026-02-08T10:00:00Z',
    createdAt: '2026-01-05T00:00:00Z',
    updatedAt: '2026-02-08T10:00:00Z',
  },
];

vi.mock('@/stores/knowledge');

describe('Search', () => {
  const mockSearch = vi.fn();
  const mockSetQuery = vi.fn();
  const mockSetSelectedSource = vi.fn();
  const mockSelectKnowledge = vi.fn();
  const mockClearError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: '',
      results: [],
      isSearching: false,
      error: null,
      selectedSource: 'all',
      selectedKnowledge: null,
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });
  });

  it('should render search page', () => {
    render(<Search />);
    expect(screen.getByTestId('search-page')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Base')).toBeInTheDocument();
  });

  it('should render search input', () => {
    render(<Search />);
    const input = screen.getByTestId('search-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Search software, commands, or platforms...');
  });

  it('should render source filters', () => {
    render(<Search />);
    expect(screen.getByTestId('filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('filter-builtin')).toBeInTheDocument();
    expect(screen.getByTestId('filter-auto_learn')).toBeInTheDocument();
    expect(screen.getByTestId('filter-scrape')).toBeInTheDocument();
    expect(screen.getByTestId('filter-community')).toBeInTheDocument();
  });

  it('should handle search input change', () => {
    render(<Search />);
    const input = screen.getByTestId('search-input');
    fireEvent.change(input, { target: { value: 'nginx' } });
    expect(input).toHaveValue('nginx');
  });

  it('should call search when button clicked', () => {
    render(<Search />);
    const input = screen.getByTestId('search-input');
    const button = screen.getByTestId('search-button');

    fireEvent.change(input, { target: { value: 'nginx' } });
    fireEvent.click(button);

    expect(mockSearch).toHaveBeenCalledWith('nginx');
  });

  it('should call search on Enter key', () => {
    render(<Search />);
    const input = screen.getByTestId('search-input');

    fireEvent.change(input, { target: { value: 'nginx' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockSearch).toHaveBeenCalledWith('nginx');
  });

  it('should disable search button when input is empty', () => {
    render(<Search />);
    const button = screen.getByTestId('search-button');
    expect(button).toBeDisabled();
  });

  it('should disable search button when searching', () => {
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: 'nginx',
      results: [],
      isSearching: true,
      error: null,
      selectedSource: 'all',
      selectedKnowledge: null,
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });

    render(<Search />);
    const button = screen.getByTestId('search-button');
    expect(button).toBeDisabled();
  });

  it('should show loading state', () => {
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: 'nginx',
      results: [],
      isSearching: true,
      error: null,
      selectedSource: 'all',
      selectedKnowledge: null,
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });

    render(<Search />);
    const loader = document.querySelector('.animate-spin');
    expect(loader).toBeInTheDocument();
  });

  it('should display error message', () => {
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: 'nginx',
      results: [],
      isSearching: false,
      error: 'Search failed',
      selectedSource: 'all',
      selectedKnowledge: null,
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });

    render(<Search />);
    expect(screen.getByText('Search failed')).toBeInTheDocument();
  });

  it('should clear error when X button clicked', () => {
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: 'nginx',
      results: [],
      isSearching: false,
      error: 'Search failed',
      selectedSource: 'all',
      selectedKnowledge: null,
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });

    render(<Search />);
    const errorCard = screen.getByText('Search failed').closest('div');
    const closeButton = errorCard?.querySelector('button');
    if (closeButton) {
      fireEvent.click(closeButton);
      expect(mockClearError).toHaveBeenCalled();
    }
  });

  it('should display search results', () => {
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: 'nginx',
      results: mockKnowledge,
      isSearching: false,
      error: null,
      selectedSource: 'all',
      selectedKnowledge: null,
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });

    render(<Search />);
    expect(screen.getByText('Found 2 results for "nginx"')).toBeInTheDocument();
    expect(screen.getByTestId('knowledge-card-k-1')).toBeInTheDocument();
    expect(screen.getByTestId('knowledge-card-k-2')).toBeInTheDocument();
  });

  it('should display no results message', () => {
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: 'nonexistent',
      results: [],
      isSearching: false,
      error: null,
      selectedSource: 'all',
      selectedKnowledge: null,
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });

    render(<Search />);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('should open knowledge detail dialog when card clicked', () => {
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: 'nginx',
      results: mockKnowledge,
      isSearching: false,
      error: null,
      selectedSource: 'all',
      selectedKnowledge: null,
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });

    render(<Search />);
    const card = screen.getByTestId('knowledge-card-k-1');
    fireEvent.click(card);
    expect(mockSelectKnowledge).toHaveBeenCalledWith(mockKnowledge[0]);
  });

  it('should display knowledge detail dialog', () => {
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: 'nginx',
      results: mockKnowledge,
      isSearching: false,
      error: null,
      selectedSource: 'all',
      selectedKnowledge: mockKnowledge[0],
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });

    render(<Search />);
    expect(screen.getByTestId('knowledge-detail-dialog')).toBeInTheDocument();
    expect(screen.getByText('Installation Commands')).toBeInTheDocument();
    const commands = screen.getAllByText('sudo apt update');
    expect(commands.length).toBeGreaterThan(0);
  });

  it('should handle source filter click', () => {
    render(<Search />);
    const builtinFilter = screen.getByTestId('filter-builtin');
    fireEvent.click(builtinFilter);
    expect(mockSetSelectedSource).toHaveBeenCalledWith('builtin');
  });

  it('should clear input when X button clicked', () => {
    vi.mocked(useKnowledgeStore).mockReturnValue({
      query: 'nginx',
      results: mockKnowledge,
      isSearching: false,
      error: null,
      selectedSource: 'all',
      selectedKnowledge: null,
      setQuery: mockSetQuery,
      setSelectedSource: mockSetSelectedSource,
      search: mockSearch,
      selectKnowledge: mockSelectKnowledge,
      clearError: mockClearError,
      reset: vi.fn(),
    });

    render(<Search />);
    const input = screen.getByTestId('search-input');
    fireEvent.change(input, { target: { value: 'test' } });

    const clearButton = screen.getByLabelText('Clear search');
    fireEvent.click(clearButton);

    expect(mockSetQuery).toHaveBeenCalledWith('');
  });
});
