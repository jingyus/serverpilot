// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    render(<MarkdownRenderer content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders bold text', () => {
    render(<MarkdownRenderer content="This is **bold** text" />);
    const bold = screen.getByText('bold');
    expect(bold.tagName).toBe('STRONG');
  });

  it('renders italic text', () => {
    render(<MarkdownRenderer content="This is *italic* text" />);
    const italic = screen.getByText('italic');
    expect(italic.tagName).toBe('EM');
  });

  it('renders headings', () => {
    render(<MarkdownRenderer content={'# Heading 1\n## Heading 2\n### Heading 3'} />);
    expect(screen.getByText('Heading 1').tagName).toBe('H1');
    expect(screen.getByText('Heading 2').tagName).toBe('H2');
    expect(screen.getByText('Heading 3').tagName).toBe('H3');
  });

  it('renders unordered lists', () => {
    render(<MarkdownRenderer content={'- Item 1\n- Item 2\n- Item 3'} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Item 1');
  });

  it('renders ordered lists', () => {
    render(<MarkdownRenderer content={'1. First\n2. Second\n3. Third'} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('First');
  });

  it('renders links with target="_blank"', () => {
    render(<MarkdownRenderer content="[Click here](https://example.com)" />);
    const link = screen.getByText('Click here');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders inline code', () => {
    render(<MarkdownRenderer content="Use `npm install` to install" />);
    const code = screen.getByText('npm install');
    expect(code.tagName).toBe('CODE');
  });

  it('renders fenced code blocks with language label', () => {
    render(<MarkdownRenderer content={'```bash\necho "hello"\n```'} />);
    const codeBlock = screen.getByTestId('code-block');
    expect(codeBlock).toBeInTheDocument();
    expect(screen.getByText('bash')).toBeInTheDocument();
  });

  it('renders code block with copy button', () => {
    render(<MarkdownRenderer content={'```js\nconsole.log("hi")\n```'} />);
    const copyBtn = screen.getByTestId('copy-code-button');
    expect(copyBtn).toBeInTheDocument();
    expect(copyBtn).toHaveTextContent('Copy');
  });

  it('copy button copies code to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MarkdownRenderer content={'```python\nprint("hello")\n```'} />);
    const copyBtn = screen.getByTestId('copy-code-button');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('print("hello")');
    });
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('renders tables', () => {
    const table = '| Col A | Col B |\n|-------|-------|\n| val1 | val2 |';
    render(<MarkdownRenderer content={table} />);
    expect(screen.getByText('Col A').tagName).toBe('TH');
    expect(screen.getByText('val1').tagName).toBe('TD');
  });

  it('renders GFM strikethrough', () => {
    render(<MarkdownRenderer content="This is ~~deleted~~ text" />);
    const del = screen.getByText('deleted');
    expect(del.tagName).toBe('DEL');
  });

  it('has markdown-content test id', () => {
    render(<MarkdownRenderer content="test" />);
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
  });

  it('renders multiple code blocks independently', () => {
    const content = '```js\nconst a = 1;\n```\n\nSome text\n\n```bash\necho hello\n```';
    render(<MarkdownRenderer content={content} />);
    const codeBlocks = screen.getAllByTestId('code-block');
    expect(codeBlocks).toHaveLength(2);
  });

  it('handles clipboard rejection without unhandled promise rejection', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Not allowed'));
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MarkdownRenderer content={'```js\nconst x = 1;\n```'} />);
    const copyBtn = screen.getByTestId('copy-code-button');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('const x = 1;');
    });
    // Should remain in "Copy" state, not "Copied"
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('clears timeout on unmount to prevent state update on unmounted component', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { unmount } = render(<MarkdownRenderer content={'```js\nlet a = 1;\n```'} />);
    const copyBtn = screen.getByTestId('copy-code-button');
    fireEvent.click(copyBtn);

    // Wait for clipboard promise to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Copied')).toBeInTheDocument();

    // Unmount before the 2000ms timer fires
    unmount();

    // Advance past the timer — should NOT cause "state update on unmounted component"
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    vi.useRealTimers();
  });

  it('resets copied state after 2 seconds', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MarkdownRenderer content={'```js\nlet b = 2;\n```'} />);
    const copyBtn = screen.getByTestId('copy-code-button');
    fireEvent.click(copyBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Copied')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('Copy')).toBeInTheDocument();

    vi.useRealTimers();
  });
});
