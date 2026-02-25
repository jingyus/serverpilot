// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Environment pre-flight checks for production readiness.
 *
 * Validates critical configuration before server startup:
 * - JWT secret not using default/weak values
 * - AI provider API keys present
 * - Database directory writable
 * - CORS origin not wildcard in production
 * - Port availability
 *
 * All checks log warnings by default; only fatal issues (unwritable DB dir,
 * port conflict) cause process exit.
 *
 * @module env-check
 */

import { accessSync, constants, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer, type Server } from "node:net";
import { getLogger } from "./utils/logger.js";
import type { ServerConfig } from "./index.js";

// ============================================================================
// Types
// ============================================================================

/** Result of a single environment check */
export interface CheckResult {
  /** Check identifier */
  name: string;
  /** 'pass' | 'warn' | 'error' */
  level: "pass" | "warn" | "error";
  /** Human-readable message */
  message: string;
}

/** Options for validateEnvironment() */
export interface ValidateEnvOptions {
  /** Current NODE_ENV value */
  nodeEnv?: string;
  /** Skip port check (useful in tests) */
  skipPortCheck?: boolean;
  /** Exit function override (for testing — defaults to process.exit) */
  exitFn?: (code: number) => void;
}

// ============================================================================
// Provider → API key mapping
// ============================================================================

/** Maps AI_PROVIDER values to their expected environment variable names */
const PROVIDER_API_KEY_MAP: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  "custom-openai": "CUSTOM_OPENAI_API_KEY",
  // ollama does not require an API key
};

// ============================================================================
// Individual Check Functions
// ============================================================================

/**
 * Check that JWT_SECRET is not a well-known default in production.
 */
export function checkJwtSecret(
  config: ServerConfig,
  nodeEnv?: string,
): CheckResult {
  if (nodeEnv !== "production") {
    return {
      name: "jwt-secret",
      level: "pass",
      message: "Non-production — JWT secret check skipped",
    };
  }

  const secret = config.jwtSecret;

  // Weak / default patterns
  const weakPatterns = [
    "change-me",
    "secret",
    "default",
    "your-secret",
    "jwt-secret",
    "supersecret",
    "password",
  ];

  if (secret.length < 32) {
    return {
      name: "jwt-secret",
      level: "warn",
      message: `JWT_SECRET is only ${secret.length} chars — use at least 32 characters in production`,
    };
  }

  const lower = secret.toLowerCase();
  for (const pattern of weakPatterns) {
    if (lower === pattern || lower === pattern.replace(/-/g, "")) {
      return {
        name: "jwt-secret",
        level: "warn",
        message: `JWT_SECRET appears to be a default/weak value ("${pattern}") — generate a strong random secret for production`,
      };
    }
  }

  return {
    name: "jwt-secret",
    level: "pass",
    message: "JWT secret is configured",
  };
}

/**
 * Check that the AI provider's required API key is set.
 */
export function checkAiProviderKey(config: ServerConfig): CheckResult {
  const provider = config.aiProvider ?? "claude";

  // Ollama doesn't need an API key
  if (provider === "ollama") {
    return {
      name: "ai-api-key",
      level: "pass",
      message: "Ollama provider — no API key required",
    };
  }

  const envVar = PROVIDER_API_KEY_MAP[provider];
  if (!envVar) {
    return {
      name: "ai-api-key",
      level: "warn",
      message: `Unknown AI provider "${provider}" — cannot verify API key`,
    };
  }

  const value = process.env[envVar];
  if (!value || value.trim().length === 0) {
    return {
      name: "ai-api-key",
      level: "warn",
      message: `${envVar} is not set — AI features (chat, auto-diagnosis) will not work. Set ${envVar} to enable AI provider "${provider}"`,
    };
  }

  return {
    name: "ai-api-key",
    level: "pass",
    message: `AI provider "${provider}" API key is configured`,
  };
}

/**
 * Check that the database directory exists and is writable.
 * For :memory: databases, always passes.
 */
export function checkDatabaseWritable(config: ServerConfig): CheckResult {
  if (config.databasePath === ":memory:") {
    return {
      name: "database-writable",
      level: "pass",
      message: "In-memory database — no directory check needed",
    };
  }

  const dbDir = dirname(resolve(config.databasePath));

  try {
    // Ensure directory exists
    mkdirSync(dbDir, { recursive: true });
    // Check write permission
    accessSync(dbDir, constants.W_OK);
    return {
      name: "database-writable",
      level: "pass",
      message: `Database directory "${dbDir}" is writable`,
    };
  } catch {
    return {
      name: "database-writable",
      level: "error",
      message: `Database directory "${dbDir}" is not writable — server cannot persist data. Check permissions or set DATABASE_PATH to a writable location`,
    };
  }
}

/**
 * Check that CORS_ORIGIN is not wildcard in production.
 */
export function checkCorsOrigin(nodeEnv?: string): CheckResult {
  if (nodeEnv !== "production") {
    return {
      name: "cors-origin",
      level: "pass",
      message: "Non-production — CORS wildcard check skipped",
    };
  }

  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin || corsOrigin.trim() === "*" || corsOrigin.trim() === "") {
    return {
      name: "cors-origin",
      level: "warn",
      message:
        'CORS_ORIGIN is "*" (wildcard) in production — set it to your dashboard domain for better security',
    };
  }

  return {
    name: "cors-origin",
    level: "pass",
    message: "CORS origin is configured",
  };
}

/**
 * Check if the configured port is available by briefly binding to it.
 * Returns a promise because net.createServer().listen() is async.
 */
export function checkPortAvailable(
  port: number,
  host: string,
): Promise<CheckResult> {
  return new Promise((resolve) => {
    const tester: Server = createServer();

    tester.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({
          name: "port-available",
          level: "error",
          message: `Port ${port} on ${host} is already in use — choose a different SERVER_PORT or stop the conflicting process`,
        });
      } else {
        resolve({
          name: "port-available",
          level: "error",
          message: `Cannot bind to ${host}:${port} — ${err.message}`,
        });
      }
    });

    // Safety timeout: resolve even if close() callback never fires (Linux edge case)
    const timeout = setTimeout(() => {
      try {
        tester.close();
      } catch {
        /* ignore */
      }
      resolve({
        name: "port-available",
        level: "pass",
        message: `Port ${port} on ${host} is available`,
      });
    }, 3000);
    timeout.unref();

    tester.listen(port, host, () => {
      tester.close(() => {
        clearTimeout(timeout);
        resolve({
          name: "port-available",
          level: "pass",
          message: `Port ${port} on ${host} is available`,
        });
      });
    });
  });
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Run all environment pre-flight checks before server startup.
 *
 * Logs warnings for non-critical issues and exits for fatal errors
 * (unwritable database directory, port conflict).
 *
 * @param config - The loaded server configuration
 * @param options - Validation options
 * @returns Array of check results
 */
export async function validateEnvironment(
  config: ServerConfig,
  options: ValidateEnvOptions = {},
): Promise<CheckResult[]> {
  const logger = getLogger();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const exitFn = options.exitFn ?? ((code: number) => process.exit(code));

  // Run synchronous checks
  const results: CheckResult[] = [
    checkJwtSecret(config, nodeEnv),
    checkAiProviderKey(config),
    checkDatabaseWritable(config),
    checkCorsOrigin(nodeEnv),
  ];

  // Run async port check
  if (!options.skipPortCheck) {
    const portResult = await checkPortAvailable(config.port, config.host);
    results.push(portResult);
  }

  // Log results
  let hasFatal = false;
  for (const result of results) {
    if (result.level === "warn") {
      logger.warn(
        { operation: "env-check", check: result.name },
        result.message,
      );
    } else if (result.level === "error") {
      logger.error(
        { operation: "env-check", check: result.name },
        result.message,
      );
      hasFatal = true;
    }
  }

  if (hasFatal) {
    logger.error(
      { operation: "env-check" },
      "Fatal environment check(s) failed — server cannot start",
    );
    exitFn(1);
  }

  return results;
}
