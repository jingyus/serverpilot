// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Request retry and error handling for Anthropic API calls.
 *
 * Provides configurable retry logic with exponential backoff, proper error
 * classification, and rate-limit awareness. Designed to wrap API calls
 * and handle transient failures gracefully.
 *
 * @module ai/request-retry
 */

// ============================================================================
// Types
// ============================================================================

/** Configuration for the retry mechanism */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay between retries in milliseconds (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay between retries in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Backoff multiplier for each subsequent retry (default: 2) */
  backoffMultiplier: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs: number;
}

/** Classification of an API error */
export interface ErrorClassification {
  /** Whether the error is retryable */
  retryable: boolean;
  /** Error category */
  category: ErrorCategory;
  /** Human-readable error message */
  message: string;
  /** HTTP status code, if applicable */
  statusCode?: number;
  /** Suggested delay before retry in milliseconds (from rate-limit headers) */
  retryAfterMs?: number;
}

/** Categories of API errors */
export type ErrorCategory =
  | "authentication"
  | "rate_limit"
  | "server_error"
  | "network"
  | "timeout"
  | "invalid_request"
  | "context_length_exceeded"
  | "overloaded"
  | "unknown";

/** Result of a retry operation */
export interface RetryResult<T> {
  /** Whether the operation ultimately succeeded */
  success: boolean;
  /** The result data (present when success is true) */
  data?: T;
  /** Error message (present when success is false) */
  error?: string;
  /** Error classification (present when success is false) */
  errorClassification?: ErrorClassification;
  /** Total number of attempts made */
  attempts: number;
  /** Total time elapsed in milliseconds */
  elapsedMs: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default retry options */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  timeoutMs: 30000,
};

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify an error from an Anthropic API call.
 *
 * Determines whether the error is retryable and categorizes it
 * for appropriate handling. Handles Anthropic SDK errors, network
 * errors, and generic JavaScript errors.
 *
 * @param error - The error thrown during the API call
 * @returns Classification with retryability and category
 */
export function classifyError(error: unknown): ErrorClassification {
  // Handle Anthropic SDK errors (they have a status property)
  if (isAnthropicError(error)) {
    return classifyAnthropicError(error);
  }

  // Handle timeout / abort errors
  if (isAbortError(error)) {
    return {
      retryable: true,
      category: "timeout",
      message: "Request timed out",
    };
  }

  // Handle network errors
  if (isNetworkError(error)) {
    return {
      retryable: true,
      category: "network",
      message: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Unknown errors are not retryable by default
  return {
    retryable: false,
    category: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Calculate the delay before the next retry attempt.
 *
 * Uses exponential backoff with jitter. If the error classification
 * includes a `retryAfterMs` value (from rate-limit headers), that
 * value takes precedence.
 *
 * @param attempt - The current attempt number (0-based)
 * @param options - Retry configuration
 * @param classification - Optional error classification with retry-after hint
 * @returns Delay in milliseconds before the next retry
 */
export function calculateDelay(
  attempt: number,
  options: RetryOptions,
  classification?: ErrorClassification,
): number {
  // Use retry-after from rate-limit response if available
  if (classification?.retryAfterMs && classification.retryAfterMs > 0) {
    return Math.min(classification.retryAfterMs, options.maxDelayMs);
  }

  // Exponential backoff: initialDelay * multiplier^attempt
  const exponentialDelay =
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);

  // Add jitter (±25%) to prevent thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  const delay = exponentialDelay + jitter;

  // Clamp to maxDelay
  return Math.min(Math.max(delay, 0), options.maxDelayMs);
}

/**
 * Execute an async operation with retry logic.
 *
 * Retries the operation on retryable failures using exponential backoff.
 * Non-retryable errors fail immediately. Rate-limit errors respect the
 * retry-after header when available.
 *
 * @param fn - The async function to execute
 * @param options - Partial retry options (merged with defaults)
 * @returns Result with success/failure, attempt count, and timing
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => client.messages.create({ ... }),
 *   { maxRetries: 3, timeoutMs: 60000 }
 * );
 *
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<RetryResult<T>> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const startTime = Date.now();
  let lastClassification: ErrorClassification | undefined;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const data = await fn();
      return {
        success: true,
        data,
        attempts: attempt + 1,
        elapsedMs: Date.now() - startTime,
      };
    } catch (err) {
      const classification = classifyError(err);
      lastClassification = classification;
      lastError = classification.message;

      // Don't retry non-retryable errors
      if (!classification.retryable) {
        return {
          success: false,
          error: classification.message,
          errorClassification: classification,
          attempts: attempt + 1,
          elapsedMs: Date.now() - startTime,
        };
      }

      // Don't delay after the last attempt
      if (attempt < opts.maxRetries) {
        const delay = calculateDelay(attempt, opts, classification);
        await sleep(delay);
      }
    }
  }

  return {
    success: false,
    error: `Request failed after ${opts.maxRetries + 1} attempts: ${lastError}`,
    errorClassification: lastClassification,
    attempts: opts.maxRetries + 1,
    elapsedMs: Date.now() - startTime,
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Check if an error is an Anthropic SDK error (has a status property).
 */
function isAnthropicError(error: unknown): error is {
  status: number;
  message: string;
  headers?: Record<string, string>;
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as Record<string, unknown>).status === "number"
  );
}

/**
 * Classify an Anthropic SDK error by HTTP status code.
 */
function classifyAnthropicError(error: {
  status: number;
  message: string;
  headers?: Record<string, string>;
}): ErrorClassification {
  const retryAfterMs = parseRetryAfter(error.headers);

  switch (error.status) {
    case 401:
      return {
        retryable: false,
        category: "authentication",
        message: "Authentication failed: invalid or expired API key",
        statusCode: 401,
      };

    case 403:
      return {
        retryable: false,
        category: "authentication",
        message: "Access denied: insufficient permissions",
        statusCode: 403,
      };

    case 400: {
      // 仅当明确为上下文/ token 超限时归类为 context_length_exceeded，便于前端显示「对话过长，新建会话」
      const msg = error.message ?? "";
      const isContextLength =
        /context_length_exceeded|context length|token.*limit|maximum context|too many token/i.test(
          msg,
        );
      return {
        retryable: false,
        category: isContextLength
          ? "context_length_exceeded"
          : "invalid_request",
        message: msg || "Invalid request",
        statusCode: 400,
      };
    }

    case 404:
      return {
        retryable: false,
        category: "invalid_request",
        message: `Resource not found: ${error.message}`,
        statusCode: 404,
      };

    case 429:
      return {
        retryable: true,
        category: "rate_limit",
        message: "Rate limited: too many requests",
        statusCode: 429,
        retryAfterMs,
      };

    case 500:
      return {
        retryable: true,
        category: "server_error",
        message: `Server error: ${error.message}`,
        statusCode: 500,
      };

    case 502:
    case 503:
      return {
        retryable: true,
        category: "overloaded",
        message: `Service temporarily unavailable (${error.status})`,
        statusCode: error.status,
      };

    case 504:
      return {
        retryable: true,
        category: "timeout",
        message: "Gateway timeout",
        statusCode: 504,
      };

    default:
      if (error.status >= 500) {
        return {
          retryable: true,
          category: "server_error",
          message: `Server error (${error.status}): ${error.message}`,
          statusCode: error.status,
        };
      }
      return {
        retryable: false,
        category: "unknown",
        message: `Unexpected error (${error.status}): ${error.message}`,
        statusCode: error.status,
      };
  }
}

/**
 * Check if an error is an AbortError (request timeout).
 */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.includes("aborted") ||
      error.message.includes("timeout"))
  );
}

/**
 * Check if an error is a network error.
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const networkPatterns = [
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "EPIPE",
    "EHOSTUNREACH",
    "fetch failed",
    "network",
    "socket hang up",
  ];

  return networkPatterns.some(
    (pattern) =>
      error.message.includes(pattern) ||
      ("code" in error && (error as NodeJS.ErrnoException).code === pattern),
  );
}

/**
 * Parse the retry-after header value to milliseconds.
 */
function parseRetryAfter(headers?: Record<string, string>): number | undefined {
  if (!headers) return undefined;

  // Header names may be lowercase
  const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  if (!retryAfter) return undefined;

  // Try to parse as seconds (integer)
  const seconds = Number(retryAfter);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try to parse as HTTP date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : undefined;
  }

  return undefined;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
