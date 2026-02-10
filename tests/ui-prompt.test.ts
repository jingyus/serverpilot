/**
 * Tests for packages/agent/src/ui/prompt.ts
 *
 * Prompt module — confirmStep, promptText, promptSelect.
 * Uses the injectable _setPromptBackend to avoid vi.mock issues with pnpm.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

import {
  confirmStep,
  promptText,
  promptSelect,
  _setPromptBackend,
  _resetPromptBackend,
} from '../packages/agent/src/ui/prompt.js';
import type {
  ConfirmStepOptions,
  ConfirmStepResult,
  PromptTextOptions,
  PromptSelectOptions,
  PromptBackend,
} from '../packages/agent/src/ui/prompt.js';

// ============================================================================
// Test helpers
// ============================================================================

/** Cancel sentinel used to simulate user pressing Ctrl+C */
const CANCEL = Symbol.for('cancel');

/** Create a mock backend for testing */
function createMockBackend() {
  const mockConfirm = vi.fn();
  const mockText = vi.fn();
  const mockSelect = vi.fn();
  const mockIsCancel = vi.fn().mockReturnValue(false);

  const backend: PromptBackend = {
    confirm: mockConfirm as unknown as PromptBackend['confirm'],
    text: mockText as unknown as PromptBackend['text'],
    select: mockSelect as unknown as PromptBackend['select'],
    isCancel: mockIsCancel as unknown as PromptBackend['isCancel'],
  };

  return { backend, mockConfirm, mockText, mockSelect, mockIsCancel };
}

// ============================================================================
// File Existence
// ============================================================================

describe('ui/prompt.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/ui/prompt.ts');

  it('should exist', () => {
    expect(existsSync(filePath)).toBe(true);
  });

  it('should not be empty', () => {
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Exports
// ============================================================================

describe('ui/prompt.ts - exports', () => {
  it('should export confirmStep function', () => {
    expect(typeof confirmStep).toBe('function');
  });

  it('should export promptText function', () => {
    expect(typeof promptText).toBe('function');
  });

  it('should export promptSelect function', () => {
    expect(typeof promptSelect).toBe('function');
  });

  it('should export _setPromptBackend function', () => {
    expect(typeof _setPromptBackend).toBe('function');
  });

  it('should export _resetPromptBackend function', () => {
    expect(typeof _resetPromptBackend).toBe('function');
  });
});

// ============================================================================
// confirmStep - autoConfirm
// ============================================================================

describe('confirmStep - autoConfirm', () => {
  let mockConfirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const m = createMockBackend();
    _setPromptBackend(m.backend);
    mockConfirm = m.mockConfirm;
  });

  afterAll(() => {
    _resetPromptBackend();
  });

  it('should return confirmed=true when autoConfirm is true', async () => {
    const result = await confirmStep({
      message: 'Install pnpm?',
      autoConfirm: true,
    });
    expect(result.confirmed).toBe(true);
    expect(result.wasAutoConfirmed).toBe(true);
  });

  it('should not call backend confirm when autoConfirm is true', async () => {
    await confirmStep({
      message: 'Test',
      autoConfirm: true,
    });
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});

// ============================================================================
// confirmStep - user interaction
// ============================================================================

describe('confirmStep - user interaction', () => {
  let mockConfirm: ReturnType<typeof vi.fn>;
  let mockIsCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const m = createMockBackend();
    _setPromptBackend(m.backend);
    mockConfirm = m.mockConfirm;
    mockIsCancel = m.mockIsCancel;
  });

  afterAll(() => {
    _resetPromptBackend();
  });

  it('should return confirmed=true when user confirms', async () => {
    mockConfirm.mockResolvedValue(true);
    mockIsCancel.mockReturnValue(false);

    const result = await confirmStep({ message: 'Proceed?' });
    expect(result.confirmed).toBe(true);
    expect(result.wasAutoConfirmed).toBe(false);
  });

  it('should return confirmed=false when user declines', async () => {
    mockConfirm.mockResolvedValue(false);
    mockIsCancel.mockReturnValue(false);

    const result = await confirmStep({ message: 'Proceed?' });
    expect(result.confirmed).toBe(false);
    expect(result.wasAutoConfirmed).toBe(false);
  });

  it('should return confirmed=false when user cancels', async () => {
    mockConfirm.mockResolvedValue(CANCEL);
    mockIsCancel.mockReturnValue(true);

    const result = await confirmStep({ message: 'Proceed?' });
    expect(result.confirmed).toBe(false);
    expect(result.wasAutoConfirmed).toBe(false);
  });

  it('should pass defaultYes=true as initialValue by default', async () => {
    mockConfirm.mockResolvedValue(true);
    mockIsCancel.mockReturnValue(false);

    await confirmStep({ message: 'Proceed?' });
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ initialValue: true }),
    );
  });

  it('should pass defaultYes=false as initialValue when specified', async () => {
    mockConfirm.mockResolvedValue(false);
    mockIsCancel.mockReturnValue(false);

    await confirmStep({ message: 'Delete?', defaultYes: false });
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ initialValue: false }),
    );
  });

  it('should pass the message to backend confirm', async () => {
    mockConfirm.mockResolvedValue(true);
    mockIsCancel.mockReturnValue(false);

    await confirmStep({ message: 'Install npm dependencies?' });
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Install npm dependencies?' }),
    );
  });
});

// ============================================================================
// promptText - autoConfirm
// ============================================================================

describe('promptText - autoConfirm', () => {
  let mockText: ReturnType<typeof vi.fn>;
  let mockIsCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const m = createMockBackend();
    _setPromptBackend(m.backend);
    mockText = m.mockText;
    mockIsCancel = m.mockIsCancel;
  });

  afterAll(() => {
    _resetPromptBackend();
  });

  it('should return defaultValue when autoConfirm is true and defaultValue set', async () => {
    const result = await promptText({
      message: 'Enter URL:',
      defaultValue: 'http://localhost:3000',
      autoConfirm: true,
    });
    expect(result).toBe('http://localhost:3000');
  });

  it('should not call backend text when autoConfirm with defaultValue', async () => {
    await promptText({
      message: 'URL',
      defaultValue: 'default',
      autoConfirm: true,
    });
    expect(mockText).not.toHaveBeenCalled();
  });

  it('should call backend text when autoConfirm is true but no defaultValue', async () => {
    mockText.mockResolvedValue('typed');
    mockIsCancel.mockReturnValue(false);

    const result = await promptText({
      message: 'Enter value:',
      autoConfirm: true,
    });
    expect(mockText).toHaveBeenCalled();
    expect(result).toBe('typed');
  });
});

// ============================================================================
// promptText - user interaction
// ============================================================================

describe('promptText - user interaction', () => {
  let mockText: ReturnType<typeof vi.fn>;
  let mockIsCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const m = createMockBackend();
    _setPromptBackend(m.backend);
    mockText = m.mockText;
    mockIsCancel = m.mockIsCancel;
  });

  afterAll(() => {
    _resetPromptBackend();
  });

  it('should return user input text', async () => {
    mockText.mockResolvedValue('user-input');
    mockIsCancel.mockReturnValue(false);

    const result = await promptText({ message: 'Enter name:' });
    expect(result).toBe('user-input');
  });

  it('should return undefined when user cancels', async () => {
    mockText.mockResolvedValue(CANCEL);
    mockIsCancel.mockReturnValue(true);

    const result = await promptText({ message: 'Enter name:' });
    expect(result).toBeUndefined();
  });

  it('should pass placeholder to backend text', async () => {
    mockText.mockResolvedValue('value');
    mockIsCancel.mockReturnValue(false);

    await promptText({
      message: 'URL:',
      placeholder: 'https://example.com',
    });
    expect(mockText).toHaveBeenCalledWith(
      expect.objectContaining({ placeholder: 'https://example.com' }),
    );
  });

  it('should pass defaultValue to backend text', async () => {
    mockText.mockResolvedValue('custom');
    mockIsCancel.mockReturnValue(false);

    await promptText({
      message: 'Path:',
      defaultValue: '/usr/local',
    });
    expect(mockText).toHaveBeenCalledWith(
      expect.objectContaining({ defaultValue: '/usr/local' }),
    );
  });

  it('should pass message to backend text', async () => {
    mockText.mockResolvedValue('val');
    mockIsCancel.mockReturnValue(false);

    await promptText({ message: 'What is your name?' });
    expect(mockText).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'What is your name?' }),
    );
  });
});

// ============================================================================
// promptSelect - autoConfirm
// ============================================================================

describe('promptSelect - autoConfirm', () => {
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockIsCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const m = createMockBackend();
    _setPromptBackend(m.backend);
    mockSelect = m.mockSelect;
    mockIsCancel = m.mockIsCancel;
  });

  afterAll(() => {
    _resetPromptBackend();
  });

  it('should return first option when autoConfirm is true', async () => {
    const result = await promptSelect({
      message: 'Choose:',
      options: [
        { value: 'pnpm', label: 'pnpm' },
        { value: 'npm', label: 'npm' },
      ],
      autoConfirm: true,
    });
    expect(result).toBe('pnpm');
  });

  it('should not call backend select when autoConfirm is true', async () => {
    await promptSelect({
      message: 'Choose:',
      options: [{ value: 'a', label: 'A' }],
      autoConfirm: true,
    });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('should call backend select when autoConfirm with empty options', async () => {
    mockSelect.mockResolvedValue('fallback');
    mockIsCancel.mockReturnValue(false);

    await promptSelect({
      message: 'Choose:',
      options: [],
      autoConfirm: true,
    });
    expect(mockSelect).toHaveBeenCalled();
  });
});

// ============================================================================
// promptSelect - user interaction
// ============================================================================

describe('promptSelect - user interaction', () => {
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockIsCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const m = createMockBackend();
    _setPromptBackend(m.backend);
    mockSelect = m.mockSelect;
    mockIsCancel = m.mockIsCancel;
  });

  afterAll(() => {
    _resetPromptBackend();
  });

  it('should return selected value', async () => {
    mockSelect.mockResolvedValue('npm');
    mockIsCancel.mockReturnValue(false);

    const result = await promptSelect({
      message: 'Choose manager:',
      options: [
        { value: 'pnpm', label: 'pnpm' },
        { value: 'npm', label: 'npm' },
      ],
    });
    expect(result).toBe('npm');
  });

  it('should return undefined when user cancels', async () => {
    mockSelect.mockResolvedValue(CANCEL);
    mockIsCancel.mockReturnValue(true);

    const result = await promptSelect({
      message: 'Choose:',
      options: [{ value: 'a', label: 'A' }],
    });
    expect(result).toBeUndefined();
  });

  it('should pass message to backend select', async () => {
    mockSelect.mockResolvedValue('x');
    mockIsCancel.mockReturnValue(false);

    await promptSelect({
      message: 'Pick one:',
      options: [{ value: 'x', label: 'X' }],
    });
    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Pick one:' }),
    );
  });

  it('should pass options to backend select', async () => {
    mockSelect.mockResolvedValue('b');
    mockIsCancel.mockReturnValue(false);

    const opts = [
      { value: 'a', label: 'Alpha', hint: 'first' },
      { value: 'b', label: 'Beta' },
    ];
    await promptSelect({
      message: 'Choose:',
      options: opts,
    });
    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({ options: opts }),
    );
  });
});

// ============================================================================
// Type exports
// ============================================================================

describe('ui/prompt.ts - type exports', () => {
  it('should export ConfirmStepOptions type', () => {
    const opts: ConfirmStepOptions = { message: 'test' };
    expect(opts.message).toBe('test');
  });

  it('should export ConfirmStepResult type', () => {
    const result: ConfirmStepResult = { confirmed: true, wasAutoConfirmed: false };
    expect(result.confirmed).toBe(true);
  });

  it('should export PromptTextOptions type', () => {
    const opts: PromptTextOptions = { message: 'enter value' };
    expect(opts.message).toBe('enter value');
  });

  it('should export PromptSelectOptions type', () => {
    const opts: PromptSelectOptions = {
      message: 'choose',
      options: [{ value: 'a', label: 'A' }],
    };
    expect(opts.options).toHaveLength(1);
  });
});
