// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill output parser — extracts and validates structured outputs from AI text.
 *
 * When a skill manifest declares `outputs`, this module:
 * 1. Extracts JSON from the AI's raw text (fenced blocks or bare JSON)
 * 2. Validates each declared output field against the extracted data
 * 3. Coerces values to the declared types where possible
 *
 * Design: graceful degradation — parsing failures never block skill completion.
 *
 * @module core/skill/output-parser
 */

import type { SkillOutput } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** Result of parsing AI output against manifest declarations. */
export interface ParsedOutputs {
  /** Successfully extracted and validated values, keyed by output name. */
  values: Record<string, unknown>;
  /** Validation warnings (e.g. type mismatch, missing field). */
  warnings: string[];
}

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract JSON object(s) from AI text output.
 *
 * Attempts in order:
 * 1. Fenced ```json ... ``` blocks
 * 2. Fenced ``` ... ``` blocks containing JSON objects
 * 3. Bare top-level JSON objects `{ ... }`
 *
 * Returns the first successfully parsed JSON object, or null.
 */
export function extractJsonFromText(text: string): Record<string, unknown> | null {
  // Strategy 1: ```json ... ``` blocks
  const jsonFenceRe = /```json\s*\n?([\s\S]*?)\n?\s*```/g;
  let match = jsonFenceRe.exec(text);
  while (match) {
    const parsed = tryParseJson(match[1].trim());
    if (parsed) return parsed;
    match = jsonFenceRe.exec(text);
  }

  // Strategy 2: ``` ... ``` blocks that contain JSON
  const fenceRe = /```\s*\n?([\s\S]*?)\n?\s*```/g;
  match = fenceRe.exec(text);
  while (match) {
    const content = match[1].trim();
    if (content.startsWith('{')) {
      const parsed = tryParseJson(content);
      if (parsed) return parsed;
    }
    match = fenceRe.exec(text);
  }

  // Strategy 3: bare JSON objects — find all { positions and try to parse
  for (let i = text.lastIndexOf('}'); i >= 0; i = text.lastIndexOf('}', i - 1)) {
    // Find matching opening brace by scanning backward
    const openIdx = text.lastIndexOf('{', i);
    if (openIdx < 0) break;
    const candidate = text.slice(openIdx, i + 1);
    const parsed = tryParseJson(candidate);
    if (parsed) return parsed;
  }

  return null;
}

/** Safely parse JSON, returning null on failure. Only accepts objects. */
function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

// ============================================================================
// Type Coercion & Validation
// ============================================================================

/**
 * Coerce a value to the declared output type.
 *
 * Returns `{ value, ok }` — ok=false if coercion is not possible.
 */
export function coerceValue(
  value: unknown,
  declaredType: SkillOutput['type'],
): { value: unknown; ok: boolean } {
  if (value === undefined || value === null) {
    return { value: null, ok: false };
  }

  switch (declaredType) {
    case 'string': {
      if (typeof value === 'string') return { value, ok: true };
      // Coerce primitives to string
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { value: String(value), ok: true };
      }
      return { value: null, ok: false };
    }
    case 'number': {
      if (typeof value === 'number' && !Number.isNaN(value)) return { value, ok: true };
      if (typeof value === 'string') {
        const num = Number(value);
        if (!Number.isNaN(num)) return { value: num, ok: true };
      }
      return { value: null, ok: false };
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { value, ok: true };
      if (value === 'true') return { value: true, ok: true };
      if (value === 'false') return { value: false, ok: true };
      return { value: null, ok: false };
    }
    case 'object': {
      if (typeof value === 'object' && !Array.isArray(value)) return { value, ok: true };
      if (typeof value === 'string') {
        const parsed = tryParseJson(value);
        if (parsed) return { value: parsed, ok: true };
      }
      return { value: null, ok: false };
    }
    default:
      return { value: null, ok: false };
  }
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse and validate AI output against the manifest's declared outputs.
 *
 * @param rawOutput - Raw text output from the AI agentic loop
 * @param declaredOutputs - Output declarations from the skill manifest
 * @returns Parsed values and validation warnings
 */
export function parseSkillOutputs(
  rawOutput: string,
  declaredOutputs: SkillOutput[],
): ParsedOutputs {
  if (declaredOutputs.length === 0) {
    return { values: {}, warnings: [] };
  }

  const warnings: string[] = [];
  const values: Record<string, unknown> = {};

  // Extract JSON from AI text
  const extracted = extractJsonFromText(rawOutput);

  if (!extracted) {
    warnings.push('No JSON object found in AI output — structured outputs could not be parsed');
    return { values, warnings };
  }

  // Validate each declared output
  for (const decl of declaredOutputs) {
    const raw = extracted[decl.name];

    if (raw === undefined) {
      warnings.push(`Missing output "${decl.name}" (type: ${decl.type})`);
      continue;
    }

    const coerced = coerceValue(raw, decl.type);

    if (!coerced.ok) {
      warnings.push(
        `Output "${decl.name}": expected ${decl.type}, got ${typeof raw}`,
      );
      continue;
    }

    values[decl.name] = coerced.value;
  }

  return { values, warnings };
}

/**
 * Build a prompt suffix instructing the AI to format structured output.
 *
 * Appended to the system prompt when the manifest declares outputs.
 */
export function buildOutputInstructions(declaredOutputs: SkillOutput[]): string {
  if (declaredOutputs.length === 0) return '';

  const fields = declaredOutputs
    .map((o) => `  "${o.name}": <${o.type}> // ${o.description}`)
    .join('\n');

  return `\n\nIMPORTANT: When the task is complete, include a JSON block with the structured output:
\`\`\`json
{
${fields}
}
\`\`\``;
}
