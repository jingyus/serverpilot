// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddServerDialog } from './AddServerDialog';

const mockOnAdd = vi.fn();
const mockOnOpenChange = vi.fn();

const defaultProps = {
  open: true,
  onOpenChange: mockOnOpenChange,
  onAdd: mockOnAdd,
};

function renderDialog(props = {}) {
  return render(<AddServerDialog {...defaultProps} {...props} />);
}

describe('AddServerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  describe('initial rendering', () => {
    it('renders dialog title', () => {
      renderDialog();
      expect(screen.getByRole('heading', { name: 'Add Server' })).toBeInTheDocument();
    });

    it('renders dialog description', () => {
      renderDialog();
      expect(
        screen.getByText('Enter a name and optional tags for your new server.')
      ).toBeInTheDocument();
    });

    it('renders server name input', () => {
      renderDialog();
      expect(screen.getByLabelText('Server Name')).toBeInTheDocument();
    });

    it('renders tags input', () => {
      renderDialog();
      expect(screen.getByLabelText('Tags (optional)')).toBeInTheDocument();
    });

    it('renders submit button', () => {
      renderDialog();
      expect(
        screen.getByRole('button', { name: /Add Server/i })
      ).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      renderDialog({ open: false });
      expect(screen.queryByRole('heading', { name: 'Add Server' })).not.toBeInTheDocument();
    });
  });

  describe('name validation', () => {
    it('shows error for empty name', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(screen.getByTestId('name-error')).toHaveTextContent('Server name is required');
      expect(mockOnAdd).not.toHaveBeenCalled();
    });

    it('shows error for invalid name characters', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(screen.getByLabelText('Server Name'), '-invalid');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(screen.getByTestId('name-error')).toBeInTheDocument();
      expect(mockOnAdd).not.toHaveBeenCalled();
    });

    it('clears error after correcting name', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockResolvedValue({
        token: 'tok-123',
        installCommand: 'curl ...',
      });
      renderDialog();

      // Trigger error first
      await user.click(screen.getByRole('button', { name: /Add Server/i }));
      expect(screen.getByTestId('name-error')).toBeInTheDocument();

      // Now type a valid name and submit
      await user.type(screen.getByLabelText('Server Name'), 'valid-server');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(screen.queryByTestId('name-error')).not.toBeInTheDocument();
    });
  });

  describe('tag management', () => {
    it('adds a tag when pressing Enter in tag input', async () => {
      const user = userEvent.setup();
      renderDialog();

      const tagInput = screen.getByLabelText('Tags (optional)');
      await user.type(tagInput, 'production{Enter}');

      expect(screen.getByTestId('tag-list')).toBeInTheDocument();
      expect(screen.getByText('production')).toBeInTheDocument();
    });

    it('adds a tag when clicking Add button', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(screen.getByLabelText('Tags (optional)'), 'staging');
      await user.click(screen.getByLabelText('Add tag'));

      expect(screen.getByText('staging')).toBeInTheDocument();
    });

    it('removes a tag when clicking remove button', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(screen.getByLabelText('Tags (optional)'), 'production{Enter}');
      expect(screen.getByText('production')).toBeInTheDocument();

      await user.click(screen.getByLabelText('Remove tag production'));
      expect(screen.queryByTestId('tag-list')).not.toBeInTheDocument();
    });

    it('does not add duplicate tags', async () => {
      const user = userEvent.setup();
      renderDialog();

      const tagInput = screen.getByLabelText('Tags (optional)');
      await user.type(tagInput, 'production{Enter}');
      await user.type(tagInput, 'production{Enter}');

      const tagList = screen.getByTestId('tag-list');
      // Should only have one remove button (one tag entry total)
      const removeButtons = tagList.querySelectorAll('button');
      expect(removeButtons).toHaveLength(1);
    });

    it('does not add empty tags', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(screen.getByLabelText('Tags (optional)'), '   {Enter}');
      expect(screen.queryByTestId('tag-list')).not.toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('calls onAdd with name only when no tags', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockResolvedValue({
        token: 'tok-123',
        installCommand: 'curl -sSL https://install.serverpilot.dev | bash -s tok-123',
      });
      renderDialog();

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(mockOnAdd).toHaveBeenCalledWith('my-server', undefined, undefined);
    });

    it('calls onAdd with name and tags', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockResolvedValue({
        token: 'tok-123',
        installCommand: 'curl ...',
      });
      renderDialog();

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      await user.type(screen.getByLabelText('Tags (optional)'), 'production{Enter}');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(mockOnAdd).toHaveBeenCalledWith('my-server', ['production'], undefined);
    });

    it('submits on Enter key in name field', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockResolvedValue({
        token: 'tok-123',
        installCommand: 'curl ...',
      });
      renderDialog();

      await user.type(screen.getByLabelText('Server Name'), 'my-server{Enter}');

      expect(mockOnAdd).toHaveBeenCalledWith('my-server', undefined, undefined);
    });

    it('calls onAdd with name, tags, and group', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockResolvedValue({
        token: 'tok-123',
        installCommand: 'curl ...',
      });
      renderDialog({ availableGroups: ['production', 'staging'] });

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      await user.type(screen.getByLabelText('Tags (optional)'), 'web{Enter}');
      await user.type(screen.getByLabelText('Group (optional)'), 'production');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(mockOnAdd).toHaveBeenCalledWith('my-server', ['web'], 'production');
    });
  });

  describe('result display', () => {
    it('shows install command after successful add', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockResolvedValue({
        token: 'tok-abc123',
        installCommand: 'curl -sSL https://install.serverpilot.dev | bash -s tok-abc123',
      });
      renderDialog();

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(screen.getByTestId('install-command')).toHaveTextContent(
        'curl -sSL https://install.serverpilot.dev | bash -s tok-abc123'
      );
    });

    it('shows description for install step', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockResolvedValue({
        token: 'tok-123',
        installCommand: 'curl ...',
      });
      renderDialog();

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(
        screen.getByText('Run this command on your server to install the agent.')
      ).toBeInTheDocument();
    });

    it('shows Done button after successful add', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockResolvedValue({
        token: 'tok-123',
        installCommand: 'curl ...',
      });
      renderDialog();

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });

    it('calls onOpenChange(false) when Done is clicked', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockResolvedValue({
        token: 'tok-123',
        installCommand: 'curl ...',
      });
      renderDialog();

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));
      await user.click(screen.getByRole('button', { name: 'Done' }));

      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('error handling', () => {
    it('does not show result on add failure', async () => {
      const user = userEvent.setup();
      mockOnAdd.mockRejectedValue(new Error('Network error'));
      renderDialog();

      await user.type(screen.getByLabelText('Server Name'), 'my-server');
      await user.click(screen.getByRole('button', { name: /Add Server/i }));

      expect(screen.queryByTestId('install-command')).not.toBeInTheDocument();
      // Should still show name input
      expect(screen.getByLabelText('Server Name')).toBeInTheDocument();
    });
  });
});
