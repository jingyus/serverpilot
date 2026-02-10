/**
 * API key validation for the Anthropic Claude API.
 *
 * Provides format validation, placeholder detection, and optional live
 * verification against the Anthropic API. Used during server startup to
 * ensure the API key is correctly configured before accepting connections.
 *
 * @module ai/api-key-validator
 */

// ============================================================================
// Types
// ============================================================================

/** Result of an API key validation */
export interface ApiKeyValidationResult {
  /** Whether the key passed validation */
  valid: boolean;
  /** Error message when validation fails */
  error?: string;
}

/** Options for API key validation */
export interface ValidateApiKeyOptions {
  /** Whether to perform a live API call to verify the key (default: false) */
  liveCheck?: boolean;
  /** Timeout for live check in milliseconds (default: 10000) */
  timeoutMs?: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Known placeholder values that should be rejected.
 * These are values commonly seen in .env.example files or documentation.
 */
const PLACEHOLDER_VALUES = [
  'your_anthropic_api_key_here',
  'your_api_key_here',
  'sk-ant-xxxx',
  'sk-ant-xxx',
  'your-api-key',
  'your_api_key',
  'CHANGE_ME',
  'changeme',
  'placeholder',
  'TODO',
  'xxx',
  'test',
];

/**
 * Valid Anthropic API key prefixes.
 * Anthropic keys start with "sk-ant-" followed by a type indicator.
 */
const VALID_KEY_PREFIXES = ['sk-ant-api03-', 'sk-ant-'];

/** Minimum length for a valid Anthropic API key */
const MIN_KEY_LENGTH = 20;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate the format of an Anthropic API key without making API calls.
 *
 * Checks:
 * - Key is present and non-empty
 * - Key is not a known placeholder value
 * - Key has a valid prefix (sk-ant-)
 * - Key meets minimum length requirements
 *
 * @param apiKey - The API key to validate
 * @returns Validation result with error message if invalid
 */
export function validateApiKeyFormat(apiKey: string | undefined): ApiKeyValidationResult {
  // Check presence
  if (!apiKey || apiKey.trim().length === 0) {
    return {
      valid: false,
      error: 'ANTHROPIC_API_KEY is not set. Please set it in your .env file or environment variables.',
    };
  }

  const trimmedKey = apiKey.trim();

  // Check for placeholder values
  if (isPlaceholder(trimmedKey)) {
    return {
      valid: false,
      error: 'ANTHROPIC_API_KEY contains a placeholder value. Please replace it with your actual API key.',
    };
  }

  // Check prefix
  if (!hasValidPrefix(trimmedKey)) {
    return {
      valid: false,
      error: 'ANTHROPIC_API_KEY has an invalid format. Anthropic API keys start with "sk-ant-".',
    };
  }

  // Check minimum length
  if (trimmedKey.length < MIN_KEY_LENGTH) {
    return {
      valid: false,
      error: `ANTHROPIC_API_KEY is too short (${trimmedKey.length} chars). API keys should be at least ${MIN_KEY_LENGTH} characters.`,
    };
  }

  return { valid: true };
}

/**
 * Validate an API key by making a lightweight call to the Anthropic API.
 *
 * Sends a minimal request to verify the key is accepted by the API.
 * This catches keys that have correct format but are revoked or invalid.
 *
 * @param apiKey - The API key to verify
 * @param timeoutMs - Request timeout in milliseconds (default: 10000)
 * @returns Validation result with error message if invalid
 */
export async function validateApiKeyLive(
  apiKey: string,
  timeoutMs: number = 10000,
): Promise<ApiKeyValidationResult> {
  // First check format
  const formatResult = validateApiKeyFormat(apiKey);
  if (!formatResult.valid) {
    return formatResult;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: controller.signal,
      });

      if (response.status === 401) {
        return {
          valid: false,
          error: 'ANTHROPIC_API_KEY is invalid or has been revoked. Please check your API key.',
        };
      }

      if (response.status === 403) {
        return {
          valid: false,
          error: 'ANTHROPIC_API_KEY does not have permission to access the API. Check your account status.',
        };
      }

      // 200 or 429 (rate limited) means the key is valid
      // 400 is also acceptable (means auth passed but request was bad)
      if (response.status === 200 || response.status === 429 || response.status === 400) {
        return { valid: true };
      }

      // Other statuses are unexpected
      return {
        valid: false,
        error: `Unexpected API response (status ${response.status}). The API key may be invalid.`,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        valid: false,
        error: `API key validation timed out after ${timeoutMs}ms. Check your network connection.`,
      };
    }

    return {
      valid: false,
      error: `Failed to validate API key: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Validate an API key with configurable options.
 *
 * By default performs only format validation. Set `liveCheck: true`
 * to also verify the key against the Anthropic API.
 *
 * @param apiKey - The API key to validate
 * @param options - Validation options
 * @returns Validation result
 */
export async function validateApiKey(
  apiKey: string | undefined,
  options: ValidateApiKeyOptions = {},
): Promise<ApiKeyValidationResult> {
  const formatResult = validateApiKeyFormat(apiKey);
  if (!formatResult.valid) {
    return formatResult;
  }

  if (options.liveCheck) {
    return validateApiKeyLive(apiKey!, options.timeoutMs);
  }

  return formatResult;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a value is a known placeholder.
 */
function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_VALUES.some((p) => lower === p.toLowerCase());
}

/**
 * Check if a key has a valid Anthropic prefix.
 */
function hasValidPrefix(key: string): boolean {
  return VALID_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}
