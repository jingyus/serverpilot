// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WelcomeWizard,
  isOnboardingCompleted,
  markOnboardingCompleted,
} from './WelcomeWizard';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderWizard(onComplete = vi.fn()) {
  const result = render(
    <MemoryRouter>
      <WelcomeWizard onComplete={onComplete} />
    </MemoryRouter>,
  );
  return { ...result, onComplete };
}

describe('WelcomeWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('rendering', () => {
    it('renders the wizard card with title and subtitle', () => {
      renderWizard();
      expect(screen.getByTestId('welcome-wizard')).toBeInTheDocument();
      expect(screen.getByText('Welcome to ServerPilot')).toBeInTheDocument();
      expect(
        screen.getByText("Let's get you started in 3 quick steps."),
      ).toBeInTheDocument();
    });

    it('renders step 1 by default with correct content', () => {
      renderWizard();
      expect(screen.getByTestId('wizard-step-0')).toBeInTheDocument();
      expect(screen.getByText('Configure AI Provider')).toBeInTheDocument();
      expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
      expect(screen.getByText('Go to Settings')).toBeInTheDocument();
    });

    it('renders 3 progress dots', () => {
      renderWizard();
      expect(screen.getByTestId('wizard-dot-0')).toBeInTheDocument();
      expect(screen.getByTestId('wizard-dot-1')).toBeInTheDocument();
      expect(screen.getByTestId('wizard-dot-2')).toBeInTheDocument();
    });

    it('disables prev button on first step', () => {
      renderWizard();
      expect(screen.getByTestId('wizard-prev')).toBeDisabled();
    });

    it('shows next button on non-final steps', () => {
      renderWizard();
      expect(screen.getByTestId('wizard-next')).toBeInTheDocument();
      expect(screen.queryByTestId('wizard-finish')).not.toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('advances to step 2 on next click', async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByTestId('wizard-next'));

      expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
      expect(screen.getByText('Add Your First Server')).toBeInTheDocument();
      expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
      expect(screen.getByText('Add Server')).toBeInTheDocument();
    });

    it('goes back to step 1 from step 2', async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByTestId('wizard-next'));
      expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();

      await user.click(screen.getByTestId('wizard-prev'));
      expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    });

    it('advances to step 3 and shows finish button', async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByTestId('wizard-next'));
      await user.click(screen.getByTestId('wizard-next'));

      expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument();
      expect(screen.getByText('Start a Conversation')).toBeInTheDocument();
      expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
      expect(screen.getByTestId('wizard-finish')).toBeInTheDocument();
      expect(screen.queryByTestId('wizard-next')).not.toBeInTheDocument();
    });

    it('jumps to a step when clicking progress dot', async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByTestId('wizard-dot-2'));
      expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
      expect(screen.getByText('Start a Conversation')).toBeInTheDocument();
    });
  });

  describe('completion', () => {
    it('calls onComplete and sets localStorage on skip', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      renderWizard(onComplete);

      await user.click(screen.getByTestId('wizard-skip'));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('onboarding_completed')).toBe('true');
    });

    it('calls onComplete, sets localStorage, and navigates on finish', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      renderWizard(onComplete);

      // Go to last step
      await user.click(screen.getByTestId('wizard-next'));
      await user.click(screen.getByTestId('wizard-next'));

      await user.click(screen.getByTestId('wizard-finish'));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('onboarding_completed')).toBe('true');
      expect(mockNavigate).toHaveBeenCalledWith('/chat');
    });

    it('navigates to step route on step action button click', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      renderWizard(onComplete);

      // Click action button on step 1 (Go to Settings)
      await user.click(screen.getByTestId('wizard-action-0'));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('onboarding_completed')).toBe('true');
      expect(mockNavigate).toHaveBeenCalledWith('/settings');
    });

    it('navigates to /servers when clicking step 2 action', async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByTestId('wizard-next'));
      await user.click(screen.getByTestId('wizard-action-1'));

      expect(mockNavigate).toHaveBeenCalledWith('/servers');
    });
  });

  describe('localStorage helpers', () => {
    it('isOnboardingCompleted returns false when not set', () => {
      expect(isOnboardingCompleted()).toBe(false);
    });

    it('isOnboardingCompleted returns true after markOnboardingCompleted', () => {
      markOnboardingCompleted();
      expect(isOnboardingCompleted()).toBe(true);
    });

    it('isOnboardingCompleted returns false for non-true values', () => {
      localStorage.setItem('onboarding_completed', 'false');
      expect(isOnboardingCompleted()).toBe(false);
    });
  });
});
