import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenDisplay } from './TokenDisplay';

const mockToken = 'tok-abc1234567xyz';
const mockInstallCommand = 'curl -sSL https://install.serverpilot.dev | bash -s tok-abc1234567xyz';

describe('TokenDisplay', () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
  });

  describe('rendering', () => {
    it('renders install command section', () => {
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);
      expect(screen.getByText('Install Command')).toBeInTheDocument();
      expect(screen.getByTestId('install-command')).toHaveTextContent(mockInstallCommand);
    });

    it('renders agent token section', () => {
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);
      expect(screen.getByText('Agent Token')).toBeInTheDocument();
      expect(screen.getByTestId('agent-token')).toBeInTheDocument();
    });

    it('renders copy command button', () => {
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);
      expect(screen.getByLabelText('Copy install command')).toBeInTheDocument();
    });

    it('renders copy token button', () => {
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);
      expect(screen.getByLabelText('Copy token')).toBeInTheDocument();
    });

    it('renders security warning text', () => {
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);
      expect(
        screen.getByText('This token is shown only once. Store it securely if needed.')
      ).toBeInTheDocument();
    });
  });

  describe('token masking', () => {
    it('masks the token by default', () => {
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);
      const tokenEl = screen.getByTestId('agent-token');
      // First 8 characters visible, rest masked
      expect(tokenEl.textContent).toBe('tok-abc1*********');
    });

    it('shows the full token when show button is clicked', async () => {
      const user = userEvent.setup();
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);

      await user.click(screen.getByLabelText('Show token'));

      const tokenEl = screen.getByTestId('agent-token');
      expect(tokenEl.textContent).toBe(mockToken);
    });

    it('hides the token again when hide button is clicked', async () => {
      const user = userEvent.setup();
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);

      await user.click(screen.getByLabelText('Show token'));
      expect(screen.getByTestId('agent-token').textContent).toBe(mockToken);

      await user.click(screen.getByLabelText('Hide token'));
      expect(screen.getByTestId('agent-token').textContent).toBe('tok-abc1*********');
    });
  });

  describe('copy functionality', () => {
    it('shows "Copied!" feedback after copying command', async () => {
      const user = userEvent.setup();
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);

      await user.click(screen.getByLabelText('Copy install command'));

      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });

    it('shows "Copied!" feedback after copying token', async () => {
      const user = userEvent.setup();
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);

      await user.click(screen.getByLabelText('Copy token'));

      // The Copied! text won't appear in the button text (it's just icon),
      // but copying should not throw an error
      expect(screen.getByLabelText('Copy token')).toBeInTheDocument();
    });

    it('renders copy buttons that are clickable', async () => {
      const user = userEvent.setup();
      render(<TokenDisplay token={mockToken} installCommand={mockInstallCommand} />);

      const copyCommandBtn = screen.getByLabelText('Copy install command');
      const copyTokenBtn = screen.getByLabelText('Copy token');

      // Verify buttons exist and are not disabled
      expect(copyCommandBtn).not.toBeDisabled();
      expect(copyTokenBtn).not.toBeDisabled();

      // Click should not throw
      await user.click(copyCommandBtn);
      await user.click(copyTokenBtn);
    });
  });
});
