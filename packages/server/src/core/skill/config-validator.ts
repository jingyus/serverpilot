// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Validates user-supplied skill configuration values against manifest input definitions.
 *
 * Pure function — no side effects, no I/O. Throws a `SkillConfigValidationError`
 * containing per-field error details when validation fails.
 *
 * @module core/skill/config-validator
 */

import type { SkillInput } from "@aiinstaller/shared";

// ============================================================================
// Error type
// ============================================================================

export interface FieldError {
  field: string;
  message: string;
}

export class SkillConfigValidationError extends Error {
  public readonly fieldErrors: FieldError[];

  constructor(fieldErrors: FieldError[]) {
    const summary = fieldErrors
      .map((e) => `${e.field}: ${e.message}`)
      .join("; ");
    super(`Skill config validation failed: ${summary}`);
    this.name = "SkillConfigValidationError";
    this.fieldErrors = fieldErrors;
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a user-supplied config object against the skill's manifest input definitions.
 *
 * @param config  - The user-supplied key-value config to validate.
 * @param inputs  - The manifest `inputs` array (from `InstalledSkill.manifestInputs`).
 *                  Pass `null` or `undefined` to skip validation entirely.
 * @throws {SkillConfigValidationError} if one or more fields are invalid.
 */
export function validateConfigAgainstManifest(
  config: Record<string, unknown>,
  inputs: SkillInput[] | null | undefined,
): void {
  if (!inputs || inputs.length === 0) return;

  const errors: FieldError[] = [];
  const knownNames = new Set(inputs.map((i) => i.name));

  // 1. Check for unknown keys
  for (const key of Object.keys(config)) {
    if (!knownNames.has(key)) {
      errors.push({ field: key, message: `Unknown input '${key}'` });
    }
  }

  // 2. Validate each declared input
  for (const input of inputs) {
    const value = config[input.name];
    const isPresent = input.name in config && value !== undefined;

    // Required check (missing value with no default)
    if (input.required && !isPresent && input.default === undefined) {
      errors.push({ field: input.name, message: "Required input is missing" });
      continue;
    }

    // If not present and not required (or has default), nothing to validate
    if (!isPresent) continue;

    // Type-specific validation
    const typeError = validateType(input, value);
    if (typeError) {
      errors.push({ field: input.name, message: typeError });
    }
  }

  if (errors.length > 0) {
    throw new SkillConfigValidationError(errors);
  }
}

// ============================================================================
// Type validators
// ============================================================================

function validateType(input: SkillInput, value: unknown): string | null {
  switch (input.type) {
    case "string":
      if (typeof value !== "string") {
        return `Expected type 'string', got '${typeof value}'`;
      }
      return null;

    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return `Expected type 'number', got '${typeof value}'`;
      }
      return null;

    case "boolean":
      if (typeof value !== "boolean") {
        return `Expected type 'boolean', got '${typeof value}'`;
      }
      return null;

    case "string[]":
      if (!Array.isArray(value)) {
        return `Expected type 'string[]', got '${typeof value}'`;
      }
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== "string") {
          return `Expected all elements of 'string[]' to be strings, but element [${i}] is '${typeof value[i]}'`;
        }
      }
      return null;

    case "enum":
      if (typeof value !== "string") {
        return `Expected type 'enum' (string), got '${typeof value}'`;
      }
      if (input.options && !input.options.includes(value)) {
        return `Value '${value}' is not in allowed options: ${input.options.join(", ")}`;
      }
      return null;

    default:
      return null;
  }
}
