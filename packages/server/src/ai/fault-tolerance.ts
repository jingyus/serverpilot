/**
 * Fault tolerance utilities for AI API calls.
 *
 * Provides exponential backoff retry logic, fallback provider chain,
 * and preset template fallback for graceful degradation when all AI
 * providers fail or are unavailable.
 *
 * @module ai/fault-tolerance
 */

import type { EnvironmentInfo, InstallPlan, ErrorContext, FixStrategy } from '@aiinstaller/shared';
import type { EnvironmentAnalysis, ErrorDiagnosis } from './agent.js';

// ============================================================================
// Types
// ============================================================================

/** AI provider types supported by the fallback system */
export type AIProvider = 'claude' | 'deepseek' | 'gpt' | 'ollama' | 'preset';

/** Configuration for AI provider */
export interface ProviderConfig {
  /** Provider type */
  type: AIProvider;
  /** API key for the provider */
  apiKey?: string;
  /** Model name to use */
  model?: string;
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Base URL for the API (for custom endpoints) */
  baseUrl?: string;
}

/** Retry configuration */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Exponential backoff multiplier */
  backoffMultiplier: number;
}

/** Result of a retryable operation */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The result data (present when success is true) */
  data?: T;
  /** Error message (present when success is false) */
  error?: string;
  /** Number of attempts made */
  attempts: number;
  /** The provider that succeeded (if any) */
  provider?: AIProvider;
}

// ============================================================================
// Default Configurations
// ============================================================================

/** Default retry configuration with exponential backoff */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 second
  maxDelayMs: 30000, // 30 seconds
  backoffMultiplier: 2,
};

// ============================================================================
// Exponential Backoff
// ============================================================================

/**
 * Calculate the delay for the next retry attempt using exponential backoff.
 *
 * The delay doubles with each attempt up to a maximum value.
 *
 * @param attempt - The current attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds before the next attempt
 *
 * @example
 * ```ts
 * // Attempt 0: 1000ms
 * // Attempt 1: 2000ms
 * // Attempt 2: 4000ms
 * // Attempt 3: 8000ms
 * const delay = calculateBackoffDelay(2, DEFAULT_RETRY_CONFIG);
 * ```
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Sleep for the specified duration.
 *
 * @param ms - Duration in milliseconds
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an operation with exponential backoff retry.
 *
 * Retries the operation on failure with increasing delays between attempts.
 * Stops retrying on permanent errors (authentication, validation).
 *
 * @param operation - The async operation to execute
 * @param config - Retry configuration
 * @param shouldRetry - Optional function to determine if an error is retryable
 * @returns The result of the operation with retry metadata
 *
 * @example
 * ```ts
 * const result = await retryWithBackoff(
 *   async () => await callAI(prompt),
 *   DEFAULT_RETRY_CONFIG,
 *   (error) => !error.message.includes('authentication')
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  shouldRetry?: (error: Error) => boolean,
): Promise<RetryResult<T>> {
  let lastError: string | undefined;
  let attempts = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    attempts++;

    try {
      const data = await operation();
      return { success: true, data, attempts };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error.message;

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(error)) {
        return {
          success: false,
          error: `Permanent error (not retrying): ${lastError}`,
          attempts,
        };
      }

      // If this is not the last attempt, sleep before retrying
      if (attempt < config.maxRetries) {
        const delay = calculateBackoffDelay(attempt, config);
        await sleep(delay);
      }
    }
  }

  return {
    success: false,
    error: `Operation failed after ${attempts} attempts: ${lastError}`,
    attempts,
  };
}

// ============================================================================
// Provider Fallback Chain
// ============================================================================

/**
 * Execute an operation with provider fallback.
 *
 * Attempts to use providers in order: Claude → DeepSeek → GPT → Preset.
 * Each provider is tried with exponential backoff retry before falling back
 * to the next provider.
 *
 * @param operations - Map of provider operations to try
 * @param config - Retry configuration for each provider
 * @returns The result with the successful provider
 *
 * @example
 * ```ts
 * const result = await fallbackChain({
 *   claude: async () => claudeAgent.analyze(env),
 *   deepseek: async () => deepseekAgent.analyze(env),
 *   preset: async () => getPresetAnalysis(env),
 * });
 * ```
 */
export async function fallbackChain<T>(
  operations: Partial<Record<AIProvider, () => Promise<T>>>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<RetryResult<T>> {
  const providers: AIProvider[] = ['claude', 'deepseek', 'gpt', 'ollama', 'preset'];
  let totalAttempts = 0;
  const errors: string[] = [];

  for (const provider of providers) {
    const operation = operations[provider];
    if (!operation) {
      continue;
    }

    const result = await retryWithBackoff(
      operation,
      config,
      (error) => {
        // Don't retry authentication errors
        if (error.message.includes('authentication') || error.message.includes('401')) {
          return false;
        }
        // Don't retry validation errors
        if (error.message.includes('validation')) {
          return false;
        }
        return true;
      },
    );

    totalAttempts += result.attempts;

    if (result.success) {
      return {
        ...result,
        provider,
        attempts: totalAttempts,
      };
    }

    errors.push(`${provider}: ${result.error}`);
  }

  return {
    success: false,
    error: `All providers failed:\n${errors.join('\n')}`,
    attempts: totalAttempts,
  };
}

// ============================================================================
// Preset Templates (Fallback for Total Failure)
// ============================================================================

/**
 * Generate a preset environment analysis when AI is unavailable.
 *
 * Provides basic environment readiness assessment based on simple rules.
 *
 * @param environment - The client's environment information
 * @param software - The software to analyze
 * @returns A basic environment analysis
 */
export function getPresetEnvironmentAnalysis(
  environment: EnvironmentInfo,
  software: string,
): EnvironmentAnalysis {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check runtime availability
  const hasNode = !!environment.runtime.node;
  const hasPython = !!environment.runtime.python;

  if (!hasNode && software.toLowerCase().includes('node')) {
    issues.push('Node.js is not installed');
    recommendations.push('Install Node.js from https://nodejs.org/');
  }

  if (!hasPython && software.toLowerCase().includes('python')) {
    issues.push('Python is not installed');
    recommendations.push('Install Python from https://python.org/');
  }

  // Check package managers
  const hasPackageManager =
    environment.packageManagers.npm ||
    environment.packageManagers.pnpm ||
    environment.packageManagers.yarn ||
    environment.packageManagers.brew ||
    environment.packageManagers.apt;

  if (!hasPackageManager) {
    issues.push('No package manager detected');
    recommendations.push('Install a package manager (npm, homebrew, apt, etc.)');
  }

  // Check network access
  if (!environment.network.canAccessNpm && !environment.network.canAccessGithub) {
    issues.push('Network connectivity issues detected');
    recommendations.push('Check your internet connection and firewall settings');
  }

  // Check permissions
  if (!environment.permissions.hasSudo && environment.permissions.canWriteTo.length === 0) {
    issues.push('Limited permissions detected');
    recommendations.push('You may need administrator/sudo access for installation');
  }

  const ready = issues.length === 0;

  return {
    summary: ready
      ? `Environment appears ready for ${software} installation`
      : `Environment may need configuration before installing ${software}`,
    ready,
    issues,
    recommendations,
    detectedCapabilities: {
      hasRequiredRuntime: hasNode || hasPython,
      hasPackageManager: !!hasPackageManager,
      hasNetworkAccess: environment.network.canAccessNpm || environment.network.canAccessGithub,
      hasSufficientPermissions: environment.permissions.hasSudo || environment.permissions.canWriteTo.length > 0,
    },
  };
}

/**
 * Generate a preset install plan when AI is unavailable.
 *
 * Creates a basic installation plan based on detected environment characteristics.
 *
 * @param environment - The client's environment information
 * @param software - The software to install
 * @returns A basic installation plan
 */
export function getPresetInstallPlan(
  environment: EnvironmentInfo,
  software: string,
): InstallPlan {
  const steps: InstallPlan['steps'] = [];
  const os = environment.os.platform;

  // Detect appropriate package manager
  let packageManager = 'npm';
  if (environment.packageManagers.pnpm) {
    packageManager = 'pnpm';
  } else if (environment.packageManagers.yarn) {
    packageManager = 'yarn';
  } else if (environment.packageManagers.brew) {
    packageManager = 'brew';
  } else if (environment.packageManagers.apt) {
    packageManager = 'apt-get';
  }

  // Generate basic install command based on OS and package manager
  let installCommand = '';
  if (os === 'darwin' && packageManager === 'brew') {
    installCommand = `brew install ${software}`;
  } else if (os === 'linux' && packageManager === 'apt-get') {
    installCommand = `sudo apt-get update && sudo apt-get install -y ${software}`;
  } else {
    // Default to npm/pnpm/yarn for node packages
    installCommand = `${packageManager} install ${software}`;
  }

  // Step 1: Check prerequisites
  steps.push({
    id: 'check-prerequisites',
    description: 'Check system prerequisites',
    command: os === 'win32'
      ? 'node --version && npm --version'
      : 'node --version && npm --version',
    expectedOutput: 'v',
    timeout: 5000,
    canRollback: false,
    onError: 'abort',
  });

  // Step 2: Install software
  steps.push({
    id: 'install',
    description: `Install ${software} using ${packageManager}`,
    command: installCommand,
    timeout: 120000,
    canRollback: false,
    onError: 'abort',
  });

  // Step 3: Verify installation
  steps.push({
    id: 'verify',
    description: `Verify ${software} installation`,
    command: `${software} --version`,
    timeout: 10000,
    canRollback: false,
    onError: 'skip',
  });

  return {
    steps,
    estimatedTime: 135000,
    risks: [
      {
        level: 'medium',
        description: 'This is a generic installation plan. AI-generated plans are more accurate.',
      },
    ],
  };
}

/**
 * Generate preset error diagnosis when AI is unavailable.
 *
 * Provides basic error categorization based on common patterns.
 *
 * @param errorContext - The error context from a failed step
 * @returns A basic error diagnosis
 */
export function getPresetErrorDiagnosis(errorContext: ErrorContext): ErrorDiagnosis {
  const combined = `${errorContext.stdout}\n${errorContext.stderr}`;

  // Simple pattern matching for common errors
  let category: ErrorDiagnosis['category'] = 'unknown';
  let rootCause = 'An error occurred during installation';
  let severity: ErrorDiagnosis['severity'] = 'medium';

  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network/i.test(combined)) {
    category = 'network';
    rootCause = 'Network connectivity issue';
    severity = 'medium';
  } else if (/EACCES|EPERM|permission denied/i.test(combined)) {
    category = 'permission';
    rootCause = 'Permission denied';
    severity = 'high';
  } else if (/command not found|Cannot find module|404/i.test(combined)) {
    category = 'dependency';
    rootCause = 'Missing dependency or package';
    severity = 'high';
  } else if (/engine.*incompatible|Unsupported/i.test(combined)) {
    category = 'version';
    rootCause = 'Version incompatibility';
    severity = 'high';
  } else if (/Invalid configuration|EJSONPARSE/i.test(combined)) {
    category = 'configuration';
    rootCause = 'Configuration error';
    severity = 'medium';
  }

  return {
    rootCause,
    category,
    explanation: `The installation failed with exit code ${errorContext.exitCode}. ${rootCause}.`,
    severity,
    affectedComponent: errorContext.stepId,
    suggestedNextSteps: [
      'Check the error output for more details',
      'Try running the command manually to diagnose the issue',
      'Search online for the specific error message',
    ],
  };
}

/**
 * Generate preset fix strategies when AI is unavailable.
 *
 * Provides basic fix suggestions based on error patterns.
 *
 * @param errorContext - The error context from a failed step
 * @returns Array of basic fix strategies
 */
export function getPresetFixStrategies(errorContext: ErrorContext): FixStrategy[] {
  const combined = `${errorContext.stdout}\n${errorContext.stderr}`;
  const strategies: FixStrategy[] = [];

  // Network errors
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(combined)) {
    strategies.push({
      id: 'retry-with-timeout',
      description: 'Retry the operation with increased timeout',
      commands: [errorContext.command],
      confidence: 0.6,
      risk: 'low',
      requiresSudo: false,
    });
    strategies.push({
      id: 'use-mirror',
      description: 'Try using a mirror or alternative registry',
      commands: ['npm config set registry https://registry.npmmirror.com', errorContext.command],
      confidence: 0.5,
      risk: 'low',
      requiresSudo: false,
    });
  }

  // Permission errors
  if (/EACCES|EPERM|permission denied/i.test(combined)) {
    strategies.push({
      id: 'use-sudo',
      description: 'Run the command with elevated privileges',
      commands: [`sudo ${errorContext.command}`],
      confidence: 0.8,
      risk: 'medium',
      requiresSudo: true,
    });
  }

  // Dependency errors
  if (/command not found/i.test(combined)) {
    // Try multiple patterns to extract the missing command
    let missing = 'missing-command';

    // Pattern 1: "bash: pnpm: command not found"
    const bashMatch = /bash:\s+(\w+):\s+command not found/i.exec(combined);
    if (bashMatch) {
      missing = bashMatch[1];
    } else {
      // Pattern 2: "command not found: pnpm"
      const cmdMatch = /command not found:\s*(\w+)/i.exec(combined);
      if (cmdMatch) {
        missing = cmdMatch[1];
      }
    }

    strategies.push({
      id: 'install-dependency',
      description: `Install the missing command: ${missing}`,
      commands: [`brew install ${missing} || sudo apt-get install -y ${missing}`, errorContext.command],
      confidence: 0.7,
      risk: 'low',
      requiresSudo: false,
    });
  }

  // Default fallback strategy
  if (strategies.length === 0) {
    strategies.push({
      id: 'manual-intervention',
      description: 'Manual intervention required. Check the error output and fix manually.',
      commands: [],
      confidence: 0.3,
      risk: 'low',
      requiresSudo: false,
    });
  }

  return strategies;
}
