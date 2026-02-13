// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Prompt module for AI Installer agent.
 *
 * Provides interactive prompts for user confirmation during installation steps.
 * Inspired by openclaw-modules/cli/prompt.ts.
 *
 * @module ui/prompt
 */

import * as clack from '@clack/prompts';

// ============================================================================
// Types
// ============================================================================

/** Options for confirmStep. */
export interface ConfirmStepOptions {
  /** The step description to display */
  message: string;
  /** Default value when user presses Enter (default: true) */
  defaultYes?: boolean;
  /** When true, automatically confirm without prompting */
  autoConfirm?: boolean;
}

/** Result of a confirm step prompt. */
export interface ConfirmStepResult {
  /** Whether the user confirmed the step */
  confirmed: boolean;
  /** Whether confirmation was automatic (via autoConfirm) */
  wasAutoConfirmed: boolean;
}

/** Options for promptText. */
export interface PromptTextOptions {
  /** The prompt message */
  message: string;
  /** Placeholder text shown in the input */
  placeholder?: string;
  /** Default value */
  defaultValue?: string;
  /** When true, skip prompt and return defaultValue */
  autoConfirm?: boolean;
}

/** Options for promptSelect. */
export interface PromptSelectOptions<T extends string = string> {
  /** The prompt message */
  message: string;
  /** Available options */
  options: Array<{ value: T; label: string; hint?: string }>;
  /** When true, auto-select first option */
  autoConfirm?: boolean;
}

// ============================================================================
// Prompt backend (injectable for testing)
// ============================================================================

/** @internal Interface for the underlying prompt functions. */
export interface PromptBackend {
  confirm: typeof clack.confirm;
  text: typeof clack.text;
  select: typeof clack.select;
  isCancel: typeof clack.isCancel;
}

/** @internal The active prompt backend. Defaults to @clack/prompts. */
let _backend: PromptBackend = {
  confirm: clack.confirm,
  text: clack.text,
  select: clack.select,
  isCancel: clack.isCancel,
};

/**
 * Replace the prompt backend. For testing only.
 * @internal
 */
export function _setPromptBackend(backend: PromptBackend): void {
  _backend = backend;
}

/**
 * Reset the prompt backend to the default (@clack/prompts).
 * @internal
 */
export function _resetPromptBackend(): void {
  _backend = {
    confirm: clack.confirm,
    text: clack.text,
    select: clack.select,
    isCancel: clack.isCancel,
  };
}

// ============================================================================
// confirmStep
// ============================================================================

/**
 * Prompt the user to confirm an installation step before execution.
 *
 * If `autoConfirm` is true, returns immediately with confirmed=true.
 * If the user cancels (Ctrl+C), returns confirmed=false.
 *
 * @param options - Confirmation options
 * @returns The confirmation result
 *
 * @example
 * ```ts
 * const result = await confirmStep({
 *   message: 'Install pnpm globally?',
 *   defaultYes: true,
 * });
 * if (result.confirmed) {
 *   // proceed with installation
 * }
 * ```
 */
export async function confirmStep(options: ConfirmStepOptions): Promise<ConfirmStepResult> {
  if (options.autoConfirm) {
    return { confirmed: true, wasAutoConfirmed: true };
  }

  const result = await _backend.confirm({
    message: options.message,
    initialValue: options.defaultYes !== false,
  });

  if (_backend.isCancel(result)) {
    return { confirmed: false, wasAutoConfirmed: false };
  }

  return { confirmed: result as boolean, wasAutoConfirmed: false };
}

// ============================================================================
// promptText
// ============================================================================

/**
 * Prompt the user for text input.
 *
 * If `autoConfirm` is true and a defaultValue is set, returns the default
 * immediately. If the user cancels, returns undefined.
 *
 * @param options - Text prompt options
 * @returns The user's input string, or undefined if cancelled
 *
 * @example
 * ```ts
 * const input = await promptText({
 *   message: 'Enter the server URL:',
 *   placeholder: 'https://example.com',
 *   defaultValue: 'http://localhost:3000',
 * });
 * ```
 */
export async function promptText(options: PromptTextOptions): Promise<string | undefined> {
  if (options.autoConfirm && options.defaultValue !== undefined) {
    return options.defaultValue;
  }

  const result = await _backend.text({
    message: options.message,
    placeholder: options.placeholder,
    defaultValue: options.defaultValue,
  });

  if (_backend.isCancel(result)) {
    return undefined;
  }

  return result as string;
}

// ============================================================================
// promptSelect
// ============================================================================

/**
 * Prompt the user to select from a list of options.
 *
 * If `autoConfirm` is true, returns the first option's value immediately.
 * If the user cancels, returns undefined.
 *
 * @param options - Select prompt options
 * @returns The selected value, or undefined if cancelled
 *
 * @example
 * ```ts
 * const choice = await promptSelect({
 *   message: 'Choose a package manager:',
 *   options: [
 *     { value: 'pnpm', label: 'pnpm' },
 *     { value: 'npm', label: 'npm' },
 *   ],
 * });
 * ```
 */
export async function promptSelect<T extends string = string>(
  options: PromptSelectOptions<T>,
): Promise<T | undefined> {
  if (options.autoConfirm && options.options.length > 0) {
    return options.options[0].value;
  }

  const result = await _backend.select({
    message: options.message,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- clack select generic mismatch
    options: options.options as any,
  });

  if (_backend.isCancel(result)) {
    return undefined;
  }

  return result as T;
}
