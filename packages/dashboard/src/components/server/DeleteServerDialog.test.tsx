// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteServerDialog } from './DeleteServerDialog';

const mockOnConfirm = vi.fn();
const mockOnCancel = vi.fn();

const defaultProps = {
  open: true,
  serverName: 'web-prod-01',
  onConfirm: mockOnConfirm,
  onCancel: mockOnCancel,
};

function renderDialog(props = {}) {
  return render(<DeleteServerDialog {...defaultProps} {...props} />);
}

describe('DeleteServerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders dialog title', () => {
      renderDialog();
      expect(screen.getByText('Delete Server')).toBeInTheDocument();
    });

    it('renders server name in description', () => {
      renderDialog();
      expect(screen.getByText('web-prod-01')).toBeInTheDocument();
    });

    it('renders warning about irreversible action', () => {
      renderDialog();
      expect(
        screen.getByText(/This action cannot be undone/)
      ).toBeInTheDocument();
    });

    it('renders Cancel button', () => {
      renderDialog();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('renders Delete button', () => {
      renderDialog();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      renderDialog({ open: false });
      expect(screen.queryByText('Delete Server')).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onConfirm when Delete button is clicked', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when Cancel button is clicked', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });
  });
});
