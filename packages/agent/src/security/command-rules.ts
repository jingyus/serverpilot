// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Command classification rule definitions for ServerPilot Agent.
 *
 * Re-exports all rules from @aiinstaller/shared (single source of truth).
 *
 * @module security/command-rules
 */

export {
  type PatternRule,
  FORBIDDEN_PATTERNS,
  CRITICAL_PATTERNS,
  GREEN_PATTERNS,
  YELLOW_PATTERNS,
  RED_PATTERNS,
} from '@aiinstaller/shared';
