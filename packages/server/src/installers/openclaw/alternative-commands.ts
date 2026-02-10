/**
 * Alternative commands module for OpenClaw installation steps.
 *
 * Each installation step has a primary command. When that command fails,
 * this module provides ordered alternative commands that can be tried
 * instead. Alternatives are ranked by confidence (expected success rate)
 * and filtered based on the target environment.
 *
 * @module installers/openclaw/alternative-commands
 */

import type { EnvironmentInfo, InstallStep } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** A single alternative command that can replace a step's primary command. */
export interface AlternativeCommand {
  /** Unique identifier for this alternative */
  id: string;
  /** Human-readable description */
  description: string;
  /** The shell command to execute */
  command: string;
  /** Estimated confidence that this command will succeed (0.0 - 1.0) */
  confidence: number;
  /** Platforms this alternative applies to (empty = all platforms) */
  platforms: Array<'darwin' | 'linux' | 'win32'>;
  /** Whether this command requires sudo/admin privileges */
  requiresSudo: boolean;
}

/** Result of generating alternatives for a single step. */
export interface StepAlternatives {
  /** The step ID this applies to */
  stepId: string;
  /** The primary command (from the original step) */
  primaryCommand: string;
  /** Ordered list of alternative commands (highest confidence first) */
  alternatives: AlternativeCommand[];
}

// ============================================================================
// Alternative command registry
// ============================================================================

/**
 * Registry of alternative commands, keyed by step ID.
 *
 * Each step has zero or more alternatives. Alternatives are defined
 * statically and filtered at runtime based on the target environment.
 */
const ALTERNATIVES_REGISTRY: Record<string, AlternativeCommand[]> = {
  'check-node': [
    {
      id: 'check-node-nvm',
      description: '通过 nvm 检查 Node.js 版本',
      command: 'nvm current',
      confidence: 0.7,
      platforms: ['darwin', 'linux'],
      requiresSudo: false,
    },
    {
      id: 'check-node-which',
      description: '通过 which 定位 Node.js',
      command: 'which node && node --version',
      confidence: 0.6,
      platforms: ['darwin', 'linux'],
      requiresSudo: false,
    },
    {
      id: 'check-node-where',
      description: '通过 where 定位 Node.js (Windows)',
      command: 'where node && node --version',
      confidence: 0.6,
      platforms: ['win32'],
      requiresSudo: false,
    },
  ],

  'install-pnpm': [
    {
      id: 'install-pnpm-corepack',
      description: '通过 corepack 启用 pnpm',
      command: 'corepack enable && corepack prepare pnpm@latest --activate',
      confidence: 0.85,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    },
    {
      id: 'install-pnpm-curl',
      description: '通过官方安装脚本安装 pnpm',
      command: 'curl -fsSL https://get.pnpm.io/install.sh | sh -',
      confidence: 0.8,
      platforms: ['darwin', 'linux'],
      requiresSudo: false,
    },
    {
      id: 'install-pnpm-brew',
      description: '通过 Homebrew 安装 pnpm',
      command: 'brew install pnpm',
      confidence: 0.75,
      platforms: ['darwin'],
      requiresSudo: false,
    },
    {
      id: 'install-pnpm-npm-sudo',
      description: '通过 npm 安装 pnpm (sudo)',
      command: 'sudo npm install -g pnpm',
      confidence: 0.7,
      platforms: ['darwin', 'linux'],
      requiresSudo: true,
    },
    {
      id: 'install-pnpm-powershell',
      description: '通过 PowerShell 安装 pnpm (Windows)',
      command: 'iwr https://get.pnpm.io/install.ps1 -useb | iex',
      confidence: 0.7,
      platforms: ['win32'],
      requiresSudo: false,
    },
  ],

  'install-openclaw': [
    {
      id: 'install-openclaw-npm',
      description: '通过 npm 全局安装 OpenClaw',
      command: 'npm install -g openclaw',
      confidence: 0.8,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    },
    {
      id: 'install-openclaw-npx',
      description: '通过 npx 直接运行 OpenClaw',
      command: 'npx openclaw',
      confidence: 0.7,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    },
    {
      id: 'install-openclaw-pnpm-mirror',
      description: '通过 pnpm 安装 OpenClaw (使用镜像源)',
      command: 'pnpm install -g openclaw --registry https://registry.npmmirror.com',
      confidence: 0.75,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    },
    {
      id: 'install-openclaw-npm-sudo',
      description: '通过 npm 安装 OpenClaw (sudo)',
      command: 'sudo npm install -g openclaw',
      confidence: 0.65,
      platforms: ['darwin', 'linux'],
      requiresSudo: true,
    },
    {
      id: 'install-openclaw-yarn',
      description: '通过 yarn 全局安装 OpenClaw',
      command: 'yarn global add openclaw',
      confidence: 0.6,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    },
  ],

  'configure-openclaw': [
    {
      id: 'configure-openclaw-token',
      description: '使用 API Token 配置 OpenClaw',
      command: 'openclaw auth --token',
      confidence: 0.75,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    },
    {
      id: 'configure-openclaw-env',
      description: '通过环境变量配置 OpenClaw',
      command: 'echo "请设置 OPENCLAW_API_KEY 环境变量" && openclaw whoami',
      confidence: 0.6,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    },
  ],

  'verify-installation': [
    {
      id: 'verify-openclaw-help',
      description: '通过 help 命令验证 OpenClaw 安装',
      command: 'openclaw --help',
      confidence: 0.85,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    },
    {
      id: 'verify-openclaw-which',
      description: '通过 which 确认 OpenClaw 安装位置',
      command: 'which openclaw && openclaw --version',
      confidence: 0.7,
      platforms: ['darwin', 'linux'],
      requiresSudo: false,
    },
    {
      id: 'verify-openclaw-where',
      description: '通过 where 确认 OpenClaw 安装位置 (Windows)',
      command: 'where openclaw && openclaw --version',
      confidence: 0.7,
      platforms: ['win32'],
      requiresSudo: false,
    },
  ],
};

// ============================================================================
// Filtering
// ============================================================================

/**
 * Filter alternatives based on the target environment.
 *
 * Removes alternatives that:
 * - Are not available on the current platform
 * - Require sudo when the user does not have it
 * - Duplicate the primary command
 *
 * @param alternatives - Raw list of alternatives from the registry
 * @param env - Target environment info
 * @param primaryCommand - The step's primary command (to exclude duplicates)
 * @returns Filtered and sorted alternatives
 */
export function filterAlternatives(
  alternatives: AlternativeCommand[],
  env: EnvironmentInfo,
  primaryCommand: string,
): AlternativeCommand[] {
  const platform = env.os.platform;
  const hasSudo = env.permissions.hasSudo;

  return alternatives
    .filter((alt) => {
      // Filter by platform
      if (alt.platforms.length > 0 && !alt.platforms.includes(platform)) {
        return false;
      }
      // Filter by sudo availability
      if (alt.requiresSudo && !hasSudo) {
        return false;
      }
      // Exclude if command is identical to primary
      if (normalizeCommand(alt.command) === normalizeCommand(primaryCommand)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Normalize a command string for comparison purposes.
 * Trims whitespace and collapses consecutive spaces.
 */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

// ============================================================================
// Confidence boosting
// ============================================================================

/**
 * Boost or penalize the confidence of alternatives based on the environment.
 *
 * For example, if Homebrew is available on macOS, boost the confidence of
 * brew-based alternatives. If a mirror registry is appropriate (e.g. China),
 * boost mirror-based alternatives.
 *
 * @param alternatives - Alternatives to adjust
 * @param env - Target environment info
 * @returns New array with adjusted confidence scores (clamped to [0, 1])
 */
export function adjustConfidence(
  alternatives: AlternativeCommand[],
  env: EnvironmentInfo,
): AlternativeCommand[] {
  return alternatives.map((alt) => {
    let confidence = alt.confidence;

    // Boost brew alternatives on macOS with Homebrew
    if (alt.id.includes('brew') && env.packageManagers.brew) {
      confidence = Math.min(1, confidence + 0.1);
    }

    // Boost mirror alternatives when npm is unreachable
    if (alt.id.includes('mirror') && !env.network.canAccessNpm) {
      confidence = Math.min(1, confidence + 0.15);
    }

    // Boost corepack alternatives when Node.js >= 16 is available
    if (alt.id.includes('corepack') && env.runtime.node) {
      confidence = Math.min(1, confidence + 0.05);
    }

    // Penalize sudo alternatives slightly (user experience cost)
    if (alt.requiresSudo) {
      confidence = Math.max(0, confidence - 0.05);
    }

    // Boost yarn alternatives when yarn is already installed
    if (alt.id.includes('yarn') && env.packageManagers.yarn) {
      confidence = Math.min(1, confidence + 0.15);
    }

    return { ...alt, confidence };
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate alternative commands for a single install step.
 *
 * Looks up the step ID in the registry, filters by environment, adjusts
 * confidence scores, and returns the result sorted by confidence (descending).
 *
 * @param step - The install step to generate alternatives for
 * @param env - Target environment info
 * @returns StepAlternatives with the primary command and ordered alternatives
 */
export function generateAlternatives(
  step: InstallStep,
  env: EnvironmentInfo,
): StepAlternatives {
  const rawAlternatives = ALTERNATIVES_REGISTRY[step.id] ?? [];

  // Filter, adjust confidence, and re-sort
  const filtered = filterAlternatives(rawAlternatives, env, step.command);
  const adjusted = adjustConfidence(filtered, env);
  const sorted = adjusted.sort((a, b) => b.confidence - a.confidence);

  return {
    stepId: step.id,
    primaryCommand: step.command,
    alternatives: sorted,
  };
}

/**
 * Generate alternative commands for all steps in a plan.
 *
 * @param steps - Ordered list of install steps
 * @param env - Target environment info
 * @returns Array of StepAlternatives for each step
 */
export function generateAllAlternatives(
  steps: readonly InstallStep[],
  env: EnvironmentInfo,
): StepAlternatives[] {
  return steps.map((step) => generateAlternatives(step, env));
}

/**
 * Get the best alternative command for a step (highest confidence).
 *
 * Returns null if no alternatives are available.
 *
 * @param step - The install step
 * @param env - Target environment info
 * @returns The best alternative, or null if none available
 */
export function getBestAlternative(
  step: InstallStep,
  env: EnvironmentInfo,
): AlternativeCommand | null {
  const result = generateAlternatives(step, env);
  return result.alternatives.length > 0 ? result.alternatives[0] : null;
}

/**
 * Get a specific alternative by its ID.
 *
 * @param stepId - The step ID to look up
 * @param alternativeId - The alternative command ID
 * @returns The alternative command, or null if not found
 */
export function getAlternativeById(
  stepId: string,
  alternativeId: string,
): AlternativeCommand | null {
  const alternatives = ALTERNATIVES_REGISTRY[stepId] ?? [];
  return alternatives.find((alt) => alt.id === alternativeId) ?? null;
}

/**
 * Register a custom alternative command for a step.
 *
 * This allows external code (e.g. AI suggestions) to add alternatives
 * at runtime.
 *
 * @param stepId - The step ID to add the alternative to
 * @param alternative - The alternative command to register
 */
export function registerAlternative(
  stepId: string,
  alternative: AlternativeCommand,
): void {
  if (!ALTERNATIVES_REGISTRY[stepId]) {
    ALTERNATIVES_REGISTRY[stepId] = [];
  }
  // Avoid duplicates by ID
  const existing = ALTERNATIVES_REGISTRY[stepId].findIndex(
    (a) => a.id === alternative.id,
  );
  if (existing >= 0) {
    ALTERNATIVES_REGISTRY[stepId][existing] = alternative;
  } else {
    ALTERNATIVES_REGISTRY[stepId].push(alternative);
  }
}

/**
 * Get the count of registered alternatives for a step (before filtering).
 *
 * @param stepId - The step ID
 * @returns Number of registered alternatives
 */
export function getAlternativeCount(stepId: string): number {
  return (ALTERNATIVES_REGISTRY[stepId] ?? []).length;
}
