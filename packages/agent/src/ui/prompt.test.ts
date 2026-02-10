import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  confirmStep,
  promptText,
  promptSelect,
  _setPromptBackend,
  _resetPromptBackend,
} from './prompt.js';
import type { PromptBackend } from './prompt.js';

// ============================================================================
// Mock backend factory
// ============================================================================

function createMockBackend(overrides?: Partial<PromptBackend>): PromptBackend {
  return {
    confirm: vi.fn().mockResolvedValue(true),
    text: vi.fn().mockResolvedValue('user input'),
    select: vi.fn().mockResolvedValue('option1'),
    isCancel: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

// ============================================================================
// Setup / Teardown
// ============================================================================

describe('prompt module', () => {
  afterEach(() => {
    _resetPromptBackend();
  });

  // ============================================================================
  // confirmStep
  // ============================================================================

  describe('confirmStep', () => {
    it('returns confirmed: true when user confirms', async () => {
      const backend = createMockBackend({ confirm: vi.fn().mockResolvedValue(true) });
      _setPromptBackend(backend);

      const result = await confirmStep({ message: 'Proceed?' });
      expect(result.confirmed).toBe(true);
      expect(result.wasAutoConfirmed).toBe(false);
    });

    it('returns confirmed: false when user declines', async () => {
      const backend = createMockBackend({ confirm: vi.fn().mockResolvedValue(false) });
      _setPromptBackend(backend);

      const result = await confirmStep({ message: 'Proceed?' });
      expect(result.confirmed).toBe(false);
      expect(result.wasAutoConfirmed).toBe(false);
    });

    it('auto-confirms when autoConfirm is true', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      const result = await confirmStep({ message: 'Proceed?', autoConfirm: true });
      expect(result.confirmed).toBe(true);
      expect(result.wasAutoConfirmed).toBe(true);
      expect(backend.confirm).not.toHaveBeenCalled();
    });

    it('returns confirmed: false on cancel', async () => {
      const cancelSymbol = Symbol('cancel');
      const backend = createMockBackend({
        confirm: vi.fn().mockResolvedValue(cancelSymbol),
        isCancel: vi.fn().mockImplementation((val) => val === cancelSymbol),
      });
      _setPromptBackend(backend);

      const result = await confirmStep({ message: 'Proceed?' });
      expect(result.confirmed).toBe(false);
      expect(result.wasAutoConfirmed).toBe(false);
    });

    it('passes message to backend', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      await confirmStep({ message: 'Install pnpm?' });
      expect(backend.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Install pnpm?' }),
      );
    });

    it('passes defaultYes as initialValue', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      await confirmStep({ message: 'Proceed?', defaultYes: true });
      expect(backend.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ initialValue: true }),
      );
    });

    it('defaults to initialValue true when defaultYes not specified', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      await confirmStep({ message: 'Proceed?' });
      expect(backend.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ initialValue: true }),
      );
    });

    it('sets initialValue false when defaultYes is false', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      await confirmStep({ message: 'Proceed?', defaultYes: false });
      expect(backend.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ initialValue: false }),
      );
    });
  });

  // ============================================================================
  // promptText
  // ============================================================================

  describe('promptText', () => {
    it('returns user input', async () => {
      const backend = createMockBackend({ text: vi.fn().mockResolvedValue('my input') });
      _setPromptBackend(backend);

      const result = await promptText({ message: 'Enter value:' });
      expect(result).toBe('my input');
    });

    it('returns defaultValue when autoConfirm is true', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      const result = await promptText({
        message: 'Enter value:',
        defaultValue: 'default',
        autoConfirm: true,
      });
      expect(result).toBe('default');
      expect(backend.text).not.toHaveBeenCalled();
    });

    it('still prompts when autoConfirm is true but no defaultValue', async () => {
      const backend = createMockBackend({ text: vi.fn().mockResolvedValue('typed') });
      _setPromptBackend(backend);

      const result = await promptText({ message: 'Enter value:', autoConfirm: true });
      expect(result).toBe('typed');
      expect(backend.text).toHaveBeenCalled();
    });

    it('returns undefined on cancel', async () => {
      const cancelSymbol = Symbol('cancel');
      const backend = createMockBackend({
        text: vi.fn().mockResolvedValue(cancelSymbol),
        isCancel: vi.fn().mockImplementation((val) => val === cancelSymbol),
      });
      _setPromptBackend(backend);

      const result = await promptText({ message: 'Enter value:' });
      expect(result).toBeUndefined();
    });

    it('passes message and placeholder to backend', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      await promptText({
        message: 'Server URL:',
        placeholder: 'https://example.com',
        defaultValue: 'http://localhost',
      });
      expect(backend.text).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Server URL:',
          placeholder: 'https://example.com',
          defaultValue: 'http://localhost',
        }),
      );
    });
  });

  // ============================================================================
  // promptSelect
  // ============================================================================

  describe('promptSelect', () => {
    const options = [
      { value: 'pnpm' as const, label: 'pnpm' },
      { value: 'npm' as const, label: 'npm' },
      { value: 'yarn' as const, label: 'yarn' },
    ];

    it('returns selected value', async () => {
      const backend = createMockBackend({ select: vi.fn().mockResolvedValue('npm') });
      _setPromptBackend(backend);

      const result = await promptSelect({ message: 'Choose:', options });
      expect(result).toBe('npm');
    });

    it('auto-selects first option when autoConfirm is true', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      const result = await promptSelect({
        message: 'Choose:',
        options,
        autoConfirm: true,
      });
      expect(result).toBe('pnpm');
      expect(backend.select).not.toHaveBeenCalled();
    });

    it('returns undefined on cancel', async () => {
      const cancelSymbol = Symbol('cancel');
      const backend = createMockBackend({
        select: vi.fn().mockResolvedValue(cancelSymbol),
        isCancel: vi.fn().mockImplementation((val) => val === cancelSymbol),
      });
      _setPromptBackend(backend);

      const result = await promptSelect({ message: 'Choose:', options });
      expect(result).toBeUndefined();
    });

    it('passes message and options to backend', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      await promptSelect({ message: 'Pick one:', options });
      expect(backend.select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Pick one:',
          options,
        }),
      );
    });

    it('handles empty options with autoConfirm', async () => {
      const backend = createMockBackend();
      _setPromptBackend(backend);

      // autoConfirm with no options should fall through to backend
      const result = await promptSelect({
        message: 'Choose:',
        options: [],
        autoConfirm: true,
      });
      // Should call backend since options.length === 0
      expect(backend.select).toHaveBeenCalled();
    });

    it('supports options with hints', async () => {
      const optionsWithHints = [
        { value: 'pnpm' as const, label: 'pnpm', hint: 'Recommended' },
        { value: 'npm' as const, label: 'npm', hint: 'Default' },
      ];
      const backend = createMockBackend({ select: vi.fn().mockResolvedValue('pnpm') });
      _setPromptBackend(backend);

      const result = await promptSelect({ message: 'Choose:', options: optionsWithHints });
      expect(result).toBe('pnpm');
    });
  });

  // ============================================================================
  // _setPromptBackend / _resetPromptBackend
  // ============================================================================

  describe('backend injection', () => {
    it('_setPromptBackend replaces the backend', async () => {
      const customBackend = createMockBackend({
        confirm: vi.fn().mockResolvedValue(false),
      });
      _setPromptBackend(customBackend);

      const result = await confirmStep({ message: 'Test' });
      expect(result.confirmed).toBe(false);
      expect(customBackend.confirm).toHaveBeenCalled();
    });

    it('_resetPromptBackend restores default', () => {
      const customBackend = createMockBackend();
      _setPromptBackend(customBackend);
      _resetPromptBackend();
      // After reset, the default @clack/prompts backend is active
      // We can't easily test this without actually calling clack,
      // but we verify the function doesn't throw
    });
  });
});
