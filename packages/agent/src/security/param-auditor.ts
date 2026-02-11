// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Parameter auditor module for ServerPilot Agent.
 *
 * Re-exports all audit logic from @aiinstaller/shared (single source of truth).
 *
 * @module security/param-auditor
 */

export {
  type DangerousParam,
  DANGEROUS_PARAMS,
  DANGEROUS_FLAGS,
  type ProtectedPath,
  PROTECTED_PATHS,
  PROTECTED_PATH_LIST,
  type AuditResult,
  AuditResultSchema,
  parseAuditResult,
  safeParseAuditResult,
  auditCommand,
  hasDangerousParams,
  hasProtectedPaths,
  getParamWarnings,
  getPathBlockers,
  requiresExtraConfirmation,
  hasBlockers,
} from '@aiinstaller/shared';
