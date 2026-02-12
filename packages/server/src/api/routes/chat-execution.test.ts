// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Unit tests for chat-execution.ts public helpers.
 *
 * Validates active execution tracking, including the edge case where
 * executionId has not yet been assigned (empty string initial value).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveExecution,
  hasActiveExecution,
  removeActiveExecution,
  _setActiveExecution,
  _resetActiveExecutions,
} from './chat-execution.js';

beforeEach(() => {
  _resetActiveExecutions();
});

describe('getActiveExecution', () => {
  it('should return undefined when no execution is tracked', () => {
    expect(getActiveExecution('plan-1')).toBeUndefined();
  });

  it('should return the executionId when a real ID is set', () => {
    _setActiveExecution('plan-1', 'exec-abc');
    expect(getActiveExecution('plan-1')).toBe('exec-abc');
  });

  it('should return undefined when executionId is empty string', () => {
    _setActiveExecution('plan-1', '');
    expect(getActiveExecution('plan-1')).toBeUndefined();
  });
});

describe('hasActiveExecution', () => {
  it('should return false when no execution is tracked', () => {
    expect(hasActiveExecution('plan-1')).toBe(false);
  });

  it('should return true when a real executionId is set', () => {
    _setActiveExecution('plan-1', 'exec-abc');
    expect(hasActiveExecution('plan-1')).toBe(true);
  });

  it('should return true when executionId is empty string (just started)', () => {
    _setActiveExecution('plan-1', '');
    expect(hasActiveExecution('plan-1')).toBe(true);
  });
});

describe('removeActiveExecution', () => {
  it('should return false when no execution exists', () => {
    expect(removeActiveExecution('plan-1')).toBe(false);
  });

  it('should return true and remove the entry', () => {
    _setActiveExecution('plan-1', 'exec-abc');
    expect(removeActiveExecution('plan-1')).toBe(true);
    expect(hasActiveExecution('plan-1')).toBe(false);
  });

  it('should remove entry even with empty executionId', () => {
    _setActiveExecution('plan-1', '');
    expect(removeActiveExecution('plan-1')).toBe(true);
    expect(hasActiveExecution('plan-1')).toBe(false);
  });
});
