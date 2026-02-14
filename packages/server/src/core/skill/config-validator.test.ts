// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for config-validator — validates user config against manifest input definitions.
 */

import { describe, it, expect } from "vitest";
import type { SkillInput } from "@aiinstaller/shared";
import {
  validateConfigAgainstManifest,
  SkillConfigValidationError,
} from "./config-validator.js";

// ============================================================================
// Helpers
// ============================================================================

function makeInput(
  overrides: Partial<SkillInput> & {
    name: string;
    type: SkillInput["type"];
    description: string;
  },
): SkillInput {
  return { required: false, ...overrides };
}

// ============================================================================
// Tests
// ============================================================================

describe("validateConfigAgainstManifest", () => {
  // ---------- Skip validation ----------

  it("should skip validation when inputs is null", () => {
    expect(() =>
      validateConfigAgainstManifest({ anything: 123 }, null),
    ).not.toThrow();
  });

  it("should skip validation when inputs is undefined", () => {
    expect(() =>
      validateConfigAgainstManifest({ anything: 123 }, undefined),
    ).not.toThrow();
  });

  it("should skip validation when inputs is empty array", () => {
    expect(() =>
      validateConfigAgainstManifest({ anything: 123 }, []),
    ).not.toThrow();
  });

  // ---------- Valid configs ----------

  it("should accept valid config matching all input types", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "host", type: "string", description: "Host" }),
      makeInput({ name: "port", type: "number", description: "Port" }),
      makeInput({ name: "verbose", type: "boolean", description: "Verbose" }),
      makeInput({ name: "tags", type: "string[]", description: "Tags" }),
      makeInput({
        name: "env",
        type: "enum",
        description: "Environment",
        options: ["dev", "staging", "prod"],
      }),
    ];
    const config = {
      host: "localhost",
      port: 8080,
      verbose: true,
      tags: ["web", "api"],
      env: "prod",
    };
    expect(() => validateConfigAgainstManifest(config, inputs)).not.toThrow();
  });

  it("should accept empty config when all inputs are optional", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "host", type: "string", description: "Host" }),
      makeInput({ name: "port", type: "number", description: "Port" }),
    ];
    expect(() => validateConfigAgainstManifest({}, inputs)).not.toThrow();
  });

  it("should accept partial config with only some optional inputs", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "host", type: "string", description: "Host" }),
      makeInput({ name: "port", type: "number", description: "Port" }),
    ];
    expect(() =>
      validateConfigAgainstManifest({ host: "example.com" }, inputs),
    ).not.toThrow();
  });

  // ---------- Unknown keys ----------

  it("should reject unknown input keys", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "host", type: "string", description: "Host" }),
    ];
    const config = { host: "localhost", unknown_key: "bad" };

    expect(() => validateConfigAgainstManifest(config, inputs)).toThrow(
      SkillConfigValidationError,
    );

    try {
      validateConfigAgainstManifest(config, inputs);
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors).toHaveLength(1);
      expect(e.fieldErrors[0]).toEqual({
        field: "unknown_key",
        message: "Unknown input 'unknown_key'",
      });
    }
  });

  it("should report multiple unknown keys", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "host", type: "string", description: "Host" }),
    ];
    const config = { host: "localhost", foo: 1, bar: 2 };

    try {
      validateConfigAgainstManifest(config, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors).toHaveLength(2);
      expect(e.fieldErrors.map((f) => f.field)).toContain("foo");
      expect(e.fieldErrors.map((f) => f.field)).toContain("bar");
    }
  });

  // ---------- Required inputs ----------

  it("should reject missing required input", () => {
    const inputs: SkillInput[] = [
      makeInput({
        name: "api_key",
        type: "string",
        description: "Key",
        required: true,
      }),
    ];

    try {
      validateConfigAgainstManifest({}, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors).toHaveLength(1);
      expect(e.fieldErrors[0]).toEqual({
        field: "api_key",
        message: "Required input is missing",
      });
    }
  });

  it("should accept missing required input when it has a default", () => {
    const inputs: SkillInput[] = [
      makeInput({
        name: "port",
        type: "number",
        description: "Port",
        required: true,
        default: 3000,
      }),
    ];
    expect(() => validateConfigAgainstManifest({}, inputs)).not.toThrow();
  });

  // ---------- Type: string ----------

  it("should reject non-string value for string input", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "host", type: "string", description: "Host" }),
    ];

    try {
      validateConfigAgainstManifest({ host: 123 }, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors).toHaveLength(1);
      expect(e.fieldErrors[0].field).toBe("host");
      expect(e.fieldErrors[0].message).toContain("Expected type 'string'");
      expect(e.fieldErrors[0].message).toContain("got 'number'");
    }
  });

  // ---------- Type: number ----------

  it("should reject non-number value for number input", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "port", type: "number", description: "Port" }),
    ];

    try {
      validateConfigAgainstManifest({ port: "8080" }, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors[0].field).toBe("port");
      expect(e.fieldErrors[0].message).toContain("Expected type 'number'");
    }
  });

  it("should reject NaN for number input", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "port", type: "number", description: "Port" }),
    ];

    try {
      validateConfigAgainstManifest({ port: NaN }, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors[0].field).toBe("port");
      expect(e.fieldErrors[0].message).toContain("Expected type 'number'");
    }
  });

  // ---------- Type: boolean ----------

  it("should reject non-boolean value for boolean input", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "verbose", type: "boolean", description: "Verbose" }),
    ];

    try {
      validateConfigAgainstManifest({ verbose: "true" }, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors[0].field).toBe("verbose");
      expect(e.fieldErrors[0].message).toContain("Expected type 'boolean'");
    }
  });

  // ---------- Type: string[] ----------

  it("should reject non-array value for string[] input", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "tags", type: "string[]", description: "Tags" }),
    ];

    try {
      validateConfigAgainstManifest({ tags: "not-an-array" }, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors[0].field).toBe("tags");
      expect(e.fieldErrors[0].message).toContain("Expected type 'string[]'");
    }
  });

  it("should reject array with non-string elements for string[] input", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "tags", type: "string[]", description: "Tags" }),
    ];

    try {
      validateConfigAgainstManifest(
        { tags: ["valid", 42, "also-valid"] },
        inputs,
      );
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors[0].field).toBe("tags");
      expect(e.fieldErrors[0].message).toContain("element [1]");
      expect(e.fieldErrors[0].message).toContain("'number'");
    }
  });

  it("should accept empty array for string[] input", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "tags", type: "string[]", description: "Tags" }),
    ];
    expect(() =>
      validateConfigAgainstManifest({ tags: [] }, inputs),
    ).not.toThrow();
  });

  // ---------- Type: enum ----------

  it("should reject value not in enum options", () => {
    const inputs: SkillInput[] = [
      makeInput({
        name: "env",
        type: "enum",
        description: "Env",
        options: ["dev", "staging", "prod"],
      }),
    ];

    try {
      validateConfigAgainstManifest({ env: "test" }, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors[0].field).toBe("env");
      expect(e.fieldErrors[0].message).toContain("'test'");
      expect(e.fieldErrors[0].message).toContain("dev, staging, prod");
    }
  });

  it("should reject non-string value for enum input", () => {
    const inputs: SkillInput[] = [
      makeInput({
        name: "env",
        type: "enum",
        description: "Env",
        options: ["dev", "prod"],
      }),
    ];

    try {
      validateConfigAgainstManifest({ env: 0 }, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors[0].field).toBe("env");
      expect(e.fieldErrors[0].message).toContain("Expected type 'enum'");
    }
  });

  it("should accept valid enum value", () => {
    const inputs: SkillInput[] = [
      makeInput({
        name: "env",
        type: "enum",
        description: "Env",
        options: ["dev", "staging", "prod"],
      }),
    ];
    expect(() =>
      validateConfigAgainstManifest({ env: "staging" }, inputs),
    ).not.toThrow();
  });

  // ---------- Multiple errors ----------

  it("should collect all errors from multiple fields", () => {
    const inputs: SkillInput[] = [
      makeInput({
        name: "host",
        type: "string",
        description: "Host",
        required: true,
      }),
      makeInput({ name: "port", type: "number", description: "Port" }),
      makeInput({
        name: "env",
        type: "enum",
        description: "Env",
        options: ["dev", "prod"],
      }),
    ];
    const config = {
      // host is missing (required)
      port: "not-a-number", // wrong type
      env: "invalid", // not in options
      extra: true, // unknown key
    };

    try {
      validateConfigAgainstManifest(config, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as SkillConfigValidationError;
      expect(e.fieldErrors.length).toBe(4);
      const fields = e.fieldErrors.map((f) => f.field);
      expect(fields).toContain("extra"); // unknown key
      expect(fields).toContain("host"); // required missing
      expect(fields).toContain("port"); // type mismatch
      expect(fields).toContain("env"); // enum out of range
    }
  });

  // ---------- Error structure ----------

  it("should produce SkillConfigValidationError with correct name and message", () => {
    const inputs: SkillInput[] = [
      makeInput({
        name: "host",
        type: "string",
        description: "Host",
        required: true,
      }),
    ];

    try {
      validateConfigAgainstManifest({}, inputs);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillConfigValidationError);
      const e = err as SkillConfigValidationError;
      expect(e.name).toBe("SkillConfigValidationError");
      expect(e.message).toContain("Skill config validation failed");
      expect(e.message).toContain("host");
      expect(e.fieldErrors).toBeInstanceOf(Array);
    }
  });

  // ---------- Edge cases ----------

  it("should treat undefined value as missing", () => {
    const inputs: SkillInput[] = [
      makeInput({
        name: "host",
        type: "string",
        description: "Host",
        required: true,
      }),
    ];
    // Key exists but value is undefined — treated as missing
    expect(() =>
      validateConfigAgainstManifest({ host: undefined }, inputs),
    ).toThrow(SkillConfigValidationError);
  });

  it("should accept null-like falsy values that match the type", () => {
    const inputs: SkillInput[] = [
      makeInput({ name: "name", type: "string", description: "Name" }),
      makeInput({ name: "count", type: "number", description: "Count" }),
      makeInput({ name: "flag", type: "boolean", description: "Flag" }),
    ];
    // Empty string, zero, and false are valid values of their respective types
    expect(() =>
      validateConfigAgainstManifest(
        { name: "", count: 0, flag: false },
        inputs,
      ),
    ).not.toThrow();
  });
});
