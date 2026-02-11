// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for OpenClaw common errors module.
 */

import { describe, it, expect } from 'vitest';
import {
  COMMON_ERRORS,
  matchCommonErrors,
  matchCommonErrorsForStep,
  getBestSolution,
  getAllSolutions,
} from './common-errors.js';
import type { CommonError, Solution } from './common-errors.js';

// ============================================================================
// COMMON_ERRORS catalogue
// ============================================================================

describe('common-errors (OpenClaw)', () => {
  describe('COMMON_ERRORS catalogue', () => {
    it('should have entries', () => {
      expect(COMMON_ERRORS.length).toBeGreaterThan(0);
    });

    it('should have unique ids for all entries', () => {
      const ids = COMMON_ERRORS.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have at least one solution per entry', () => {
      for (const entry of COMMON_ERRORS) {
        expect(entry.solutions.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should have unique solution ids within each entry', () => {
      for (const entry of COMMON_ERRORS) {
        const ids = entry.solutions.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it('should have confidence values between 0 and 1 for all solutions', () => {
      for (const entry of COMMON_ERRORS) {
        for (const solution of entry.solutions) {
          expect(solution.confidence).toBeGreaterThanOrEqual(0);
          expect(solution.confidence).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should have non-empty stepIds for all entries', () => {
      for (const entry of COMMON_ERRORS) {
        expect(entry.stepIds.length).toBeGreaterThan(0);
      }
    });

    it('should have at least one step in each solution', () => {
      for (const entry of COMMON_ERRORS) {
        for (const solution of entry.solutions) {
          expect(solution.steps.length).toBeGreaterThan(0);
        }
      }
    });

    it('should cover all expected error types', () => {
      const types = new Set(COMMON_ERRORS.map((e) => e.type));
      expect(types.has('permission')).toBe(true);
      expect(types.has('network')).toBe(true);
      expect(types.has('dependency')).toBe(true);
      expect(types.has('version')).toBe(true);
      expect(types.has('configuration')).toBe(true);
    });
  });

  // ============================================================================
  // matchCommonErrors
  // ============================================================================

  describe('matchCommonErrors', () => {
    it('should match EACCES permission error from stderr', () => {
      const matches = matchCommonErrors('npm ERR! Error: EACCES: permission denied, mkdir /usr/local/lib');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].type).toBe('permission');
      expect(matches[0].id).toBe('eacces-permission-denied');
    });

    it('should match EPERM error', () => {
      const matches = matchCommonErrors('npm ERR! EPERM: operation not permitted, rename');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'eperm-operation-not-permitted')).toBe(true);
    });

    it('should match missing write access error', () => {
      const matches = matchCommonErrors('npm WARN Missing write access to /usr/local/lib/node_modules');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'missing-write-access')).toBe(true);
    });

    it('should match ETIMEDOUT network error', () => {
      const matches = matchCommonErrors('npm ERR! code ETIMEDOUT');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].type).toBe('network');
    });

    it('should match network timeout text', () => {
      const matches = matchCommonErrors('npm ERR! network timeout at: https://registry.npmjs.org/openclaw');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'network-timeout')).toBe(true);
    });

    it('should match ERR_SOCKET_TIMEOUT', () => {
      const matches = matchCommonErrors('npm ERR! code ERR_SOCKET_TIMEOUT');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'network-timeout')).toBe(true);
    });

    it('should match ENOTFOUND DNS error', () => {
      const matches = matchCommonErrors('npm ERR! code ENOTFOUND\nnpm ERR! errno ENOTFOUND');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'dns-lookup-failed')).toBe(true);
    });

    it('should match SSL certificate error', () => {
      const matches = matchCommonErrors('npm ERR! unable to get local issuer certificate');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'ssl-certificate-error')).toBe(true);
    });

    it('should match CERT_HAS_EXPIRED', () => {
      const matches = matchCommonErrors('Error: CERT_HAS_EXPIRED');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'ssl-certificate-error')).toBe(true);
    });

    it('should match ECONNREFUSED', () => {
      const matches = matchCommonErrors('npm ERR! code ECONNREFUSED');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'connection-refused')).toBe(true);
    });

    it('should match node command not found', () => {
      const matches = matchCommonErrors('bash: node: command not found');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'command-not-found-node')).toBe(true);
    });

    it('should match pnpm command not found', () => {
      const matches = matchCommonErrors('bash: pnpm: command not found');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'command-not-found-pnpm')).toBe(true);
    });

    it('should match native build error (gyp)', () => {
      const matches = matchCommonErrors('gyp ERR! build error\ngyp ERR! stack Error');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'native-build-error')).toBe(true);
    });

    it('should match ERESOLVE dependency error', () => {
      const matches = matchCommonErrors('npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'eresolve-dependency')).toBe(true);
    });

    it('should match ENOSPC disk space error', () => {
      const matches = matchCommonErrors('npm ERR! ENOSPC: No space left on device');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'disk-space-exhausted')).toBe(true);
    });

    it('should match Node.js version too old for OpenClaw', () => {
      const matches = matchCommonErrors('Error: openclaw requires Node.js >= 22.0.0');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'node-version-too-old')).toBe(true);
    });

    it('should match unsupported engine error', () => {
      const matches = matchCommonErrors('npm ERR! Unsupported engine');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'node-version-too-old')).toBe(true);
    });

    it('should match engine incompatible error', () => {
      const matches = matchCommonErrors('error engine "node" is incompatible with this module');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'node-version-too-old')).toBe(true);
    });

    it('should match modern syntax error in old Node.js', () => {
      const matches = matchCommonErrors("SyntaxError: Unexpected token '??='");
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'syntax-error-old-node')).toBe(true);
    });

    it('should match ESM/CJS conflict (ERR_REQUIRE_ESM)', () => {
      const matches = matchCommonErrors('Error [ERR_REQUIRE_ESM]: require() of ES Module');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'esm-cjs-conflict')).toBe(true);
    });

    it('should match exports not defined in ES module scope', () => {
      const matches = matchCommonErrors('ReferenceError: exports is not defined in ES module scope');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'esm-cjs-conflict')).toBe(true);
    });

    it('should match EJSONPARSE error', () => {
      const matches = matchCommonErrors('npm ERR! code EJSONPARSE');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'json-parse-error')).toBe(true);
    });

    it('should match proxy config error', () => {
      const matches = matchCommonErrors('proxy config error ECONNREFUSED');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'proxy-config-error')).toBe(true);
    });

    it('should return empty array for unrecognized errors', () => {
      const matches = matchCommonErrors('some completely unknown error');
      expect(matches).toEqual([]);
    });

    it('should match from stdout when stderr is empty', () => {
      const matches = matchCommonErrors('', 'EACCES: permission denied');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].type).toBe('permission');
    });

    it('should match multiple errors in the same output', () => {
      const stderr = 'npm ERR! code ETIMEDOUT\nnpm WARN Missing write access to /usr/local';
      const matches = matchCommonErrors(stderr);
      const types = new Set(matches.map((m) => m.type));
      expect(types.size).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // matchCommonErrorsForStep
  // ============================================================================

  describe('matchCommonErrorsForStep', () => {
    it('should filter matches by step id', () => {
      const matches = matchCommonErrorsForStep(
        'install-pnpm',
        'npm ERR! Error: EACCES: permission denied',
      );
      expect(matches.length).toBeGreaterThanOrEqual(1);
      for (const m of matches) {
        expect(m.stepIds).toContain('install-pnpm');
      }
    });

    it('should return empty when error matches but step does not', () => {
      // command-not-found-node only applies to 'check-node'
      const matches = matchCommonErrorsForStep(
        'install-openclaw',
        'bash: node: command not found',
      );
      expect(matches).toEqual([]);
    });

    it('should return matches for check-node step', () => {
      const matches = matchCommonErrorsForStep(
        'check-node',
        'bash: node: command not found',
      );
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].id).toBe('command-not-found-node');
    });

    it('should return matches for install-openclaw step', () => {
      const matches = matchCommonErrorsForStep(
        'install-openclaw',
        'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree',
      );
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((m) => m.id === 'eresolve-dependency')).toBe(true);
    });

    it('should handle stdout parameter', () => {
      const matches = matchCommonErrorsForStep(
        'install-pnpm',
        '',
        'Missing write access to /usr/local',
      );
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty for unknown step id', () => {
      const matches = matchCommonErrorsForStep(
        'unknown-step',
        'npm ERR! Error: EACCES: permission denied',
      );
      expect(matches).toEqual([]);
    });
  });

  // ============================================================================
  // getBestSolution
  // ============================================================================

  describe('getBestSolution', () => {
    it('should return the highest-confidence solution for EACCES', () => {
      const solution = getBestSolution('npm ERR! Error: EACCES: permission denied');
      expect(solution).not.toBeNull();
      expect(solution!.confidence).toBeGreaterThan(0);
    });

    it('should return null for unrecognized errors', () => {
      const solution = getBestSolution('some completely unknown error');
      expect(solution).toBeNull();
    });

    it('should return a solution for network timeout', () => {
      const solution = getBestSolution('npm ERR! code ETIMEDOUT');
      expect(solution).not.toBeNull();
      expect(solution!.id).toBe('use-mirror');
    });

    it('should return a solution with steps', () => {
      const solution = getBestSolution('npm ERR! code EACCES: permission denied');
      expect(solution).not.toBeNull();
      expect(solution!.steps.length).toBeGreaterThan(0);
    });

    it('should pick the highest confidence across multiple matching errors', () => {
      // This stderr matches both network-timeout and dns-lookup-failed
      const solution = getBestSolution('npm ERR! ETIMEDOUT\nnpm ERR! ENOTFOUND');
      expect(solution).not.toBeNull();
      // The highest confidence should win
      expect(solution!.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should return solution for node version too old', () => {
      const solution = getBestSolution('Error: openclaw requires Node.js >= 22.0.0');
      expect(solution).not.toBeNull();
      expect(solution!.id).toBe('upgrade-node-nvm');
      expect(solution!.confidence).toBe(0.9);
    });
  });

  // ============================================================================
  // getAllSolutions
  // ============================================================================

  describe('getAllSolutions', () => {
    it('should return all solutions sorted by confidence descending', () => {
      const solutions = getAllSolutions('npm ERR! Error: EACCES: permission denied');
      expect(solutions.length).toBeGreaterThan(0);

      for (let i = 1; i < solutions.length; i++) {
        expect(solutions[i - 1].confidence).toBeGreaterThanOrEqual(solutions[i].confidence);
      }
    });

    it('should return empty array for unrecognized errors', () => {
      const solutions = getAllSolutions('some completely unknown error');
      expect(solutions).toEqual([]);
    });

    it('should deduplicate solutions by id', () => {
      // Both 'network-timeout' and 'dns-lookup-failed' have 'use-mirror' solution
      const solutions = getAllSolutions('npm ERR! ETIMEDOUT\nnpm ERR! ENOTFOUND');
      const ids = solutions.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should return multiple solutions for EACCES error', () => {
      const solutions = getAllSolutions('npm ERR! Error: EACCES: permission denied');
      expect(solutions.length).toBeGreaterThanOrEqual(3);
    });

    it('should include solutions from multiple matched errors', () => {
      // Matches both EACCES and ETIMEDOUT
      const solutions = getAllSolutions(
        'npm ERR! EACCES: permission denied\nnpm ERR! code ETIMEDOUT',
      );
      const ids = new Set(solutions.map((s) => s.id));
      // Should have permission solutions and network solutions
      expect(ids.has('change-npm-prefix') || ids.has('use-sudo') || ids.has('fix-ownership')).toBe(true);
      expect(ids.has('use-mirror') || ids.has('increase-timeout')).toBe(true);
    });
  });
});
