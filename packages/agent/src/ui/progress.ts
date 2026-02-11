// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Progress display module for AI Installer agent.
 *
 * Provides progress reporting for installation steps with support for
 * indeterminate spinners, percent-based progress, and step-tracking.
 * Inspired by openclaw-modules/cli/progress.ts.
 *
 * @module ui/progress
 */

import { spinner } from '@clack/prompts';

// ============================================================================
// Spinner Animation
// ============================================================================

/** Definition of a spinner animation with frames and interval. */
export interface SpinnerStyle {
  /** Array of animation frames displayed in sequence */
  frames: readonly string[];
  /** Time in milliseconds between frames */
  intervalMs: number;
}

/** Built-in spinner animation styles. */
export const SPINNER_STYLES = {
  /** Classic dots animation (default) */
  dots: {
    frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const,
    intervalMs: 80,
  },
  /** Braille pattern animation - smoother appearance */
  braille: {
    frames: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'] as const,
    intervalMs: 100,
  },
  /** Bouncing bar animation */
  bouncingBar: {
    frames: [
      '[    ]', '[=   ]', '[==  ]', '[=== ]', '[ ===]', '[  ==]', '[   =]', '[    ]',
      '[   =]', '[  ==]', '[ ===]', '[=== ]', '[==  ]', '[=   ]',
    ] as const,
    intervalMs: 80,
  },
  /** Arrow rotation animation */
  arrow: {
    frames: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'] as const,
    intervalMs: 100,
  },
  /** Simple line animation */
  line: {
    frames: ['-', '\\', '|', '/'] as const,
    intervalMs: 120,
  },
  /** Growing dots animation */
  growDots: {
    frames: ['.  ', '.. ', '...', ' ..', '  .', '   '] as const,
    intervalMs: 150,
  },
  /** Block-based progress animation */
  blocks: {
    frames: ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█', '▉', '▊', '▋', '▌', '▍', '▎'] as const,
    intervalMs: 100,
  },
} as const satisfies Record<string, SpinnerStyle>;

export type SpinnerStyleName = keyof typeof SPINNER_STYLES;

/** Options for creating a custom Spinner instance. */
export interface SpinnerOptions {
  /** Animation style name or custom SpinnerStyle definition */
  style?: SpinnerStyleName | SpinnerStyle;
  /** Output stream (default: process.stderr) */
  stream?: NodeJS.WriteStream;
  /** Color function applied to each frame (e.g. chalk.cyan) */
  color?: (frame: string) => string;
  /** Whether to hide the cursor while spinning (default: true) */
  hideCursor?: boolean;
}

/**
 * Custom spinner with configurable animation styles.
 *
 * Renders animated spinner frames directly to a TTY stream, supporting
 * multiple built-in styles and custom frame definitions.
 *
 * @example
 * ```ts
 * const spin = new Spinner({ style: 'braille' });
 * spin.start('Loading...');
 * spin.update('Still loading...');
 * spin.stop('Done!');
 * ```
 */
export class Spinner {
  private readonly style: SpinnerStyle;
  private readonly stream: NodeJS.WriteStream;
  private readonly colorFn: ((frame: string) => string) | null;
  private readonly hideCursor: boolean;

  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private message = '';
  private running = false;

  constructor(options: SpinnerOptions = {}) {
    const styleOption = options.style ?? 'dots';
    this.style =
      typeof styleOption === 'string' ? SPINNER_STYLES[styleOption] : styleOption;
    this.stream = options.stream ?? process.stderr;
    this.colorFn = options.color ?? null;
    this.hideCursor = options.hideCursor ?? true;
  }

  /** Start the spinner with an initial message. */
  start(message: string): void {
    if (this.running) return;
    this.running = true;
    this.message = message;
    this.frameIndex = 0;

    if (this.hideCursor) {
      this.stream.write('\x1B[?25l'); // hide cursor
    }
    this.render();
    this.timer = setInterval(() => this.render(), this.style.intervalMs);
  }

  /** Update the displayed message without restarting the animation. */
  update(message: string): void {
    this.message = message;
  }

  /** Stop the spinner and optionally display a final message. */
  stop(finalMessage?: string): void {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Clear the current line
    this.clearLine();

    if (finalMessage) {
      this.stream.write(`${finalMessage}\n`);
    }

    if (this.hideCursor) {
      this.stream.write('\x1B[?25h'); // show cursor
    }
  }

  /** Whether the spinner is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** The current animation frame (for testing). */
  get currentFrame(): string {
    const frame = this.style.frames[this.frameIndex % this.style.frames.length];
    return this.colorFn ? this.colorFn(frame) : frame;
  }

  private render(): void {
    const frame = this.style.frames[this.frameIndex % this.style.frames.length];
    const coloredFrame = this.colorFn ? this.colorFn(frame) : frame;
    this.clearLine();
    this.stream.write(`${coloredFrame} ${this.message}`);
    this.frameIndex = (this.frameIndex + 1) % this.style.frames.length;
  }

  private clearLine(): void {
    this.stream.write('\r\x1B[K');
  }
}

/**
 * Create a Spinner instance from a style name or custom style.
 *
 * @param style - Built-in style name or custom SpinnerStyle
 * @param options - Additional spinner options
 * @returns A new Spinner instance
 */
export function createSpinner(
  style?: SpinnerStyleName | SpinnerStyle,
  options?: Omit<SpinnerOptions, 'style'>,
): Spinner {
  return new Spinner({ ...options, style });
}

/**
 * Build a text-based progress bar string.
 *
 * @param percent - Progress percentage (0-100)
 * @param width - Total width of the progress bar in characters (default: 20)
 * @returns Formatted progress bar string like "[████████░░░░]"
 */
export function buildProgressBar(percent: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

// ============================================================================
// Types
// ============================================================================

/** Options for creating a progress reporter. */
export interface ProgressOptions {
  /** Label displayed alongside the progress indicator */
  label: string;
  /** When true, shows an indeterminate spinner instead of percent */
  indeterminate?: boolean;
  /** Total number of discrete items to track */
  total?: number;
  /** Set to false to disable all output (returns a noop reporter) */
  enabled?: boolean;
  /** Delay in milliseconds before showing the indicator */
  delayMs?: number;
  /** Output stream (default: process.stderr) */
  stream?: NodeJS.WriteStream;
  /** Custom spinner style; when set, uses the custom Spinner instead of @clack/prompts spinner */
  spinnerStyle?: SpinnerStyleName | SpinnerStyle;
  /** Color function applied to spinner frames */
  spinnerColor?: (frame: string) => string;
  /** Whether to show a text-based progress bar alongside percent */
  showProgressBar?: boolean;
}

/** Reporter interface for updating progress state. */
export interface ProgressReporter {
  /** Update the display label */
  setLabel: (label: string) => void;
  /** Set progress to an explicit percent (0–100) */
  setPercent: (percent: number) => void;
  /** Advance progress by delta items (requires total to be set) */
  tick: (delta?: number) => void;
  /** Set remaining time in milliseconds to display alongside progress */
  setRemainingMs: (ms: number | null) => void;
  /** Finish and clean up the progress indicator */
  done: () => void;
}

/** Data passed to the totals update callback. */
export interface ProgressTotalsUpdate {
  completed: number;
  total: number;
  label?: string;
}

/** Result of installWithProgress describing the outcome. */
export interface InstallProgressResult {
  /** Whether all steps completed successfully */
  success: boolean;
  /** Number of steps completed */
  completedSteps: number;
  /** Total number of steps */
  totalSteps: number;
  /** Total duration in milliseconds */
  duration: number;
  /** Per-step results */
  steps: StepProgressResult[];
}

/** Result of a single install step within progress tracking. */
export interface StepProgressResult {
  /** Step identifier */
  id: string;
  /** Step description */
  description: string;
  /** Whether the step succeeded */
  success: boolean;
  /** Duration of this step in ms */
  duration: number;
  /** Error message if the step failed */
  error?: string;
}

// ============================================================================
// Internal state
// ============================================================================

/** Tracks the number of active progress reporters to prevent nesting. */
let activeProgress = 0;

// ============================================================================
// Noop reporter
// ============================================================================

const noopReporter: ProgressReporter = {
  setLabel: () => {},
  setPercent: () => {},
  tick: () => {},
  setRemainingMs: () => {},
  done: () => {},
};

// ============================================================================
// createProgress
// ============================================================================

/**
 * Create a progress reporter.
 *
 * When running in a TTY environment, shows a @clack/prompts spinner.
 * Otherwise (or when disabled / nested), returns a noop reporter.
 *
 * @param options - Progress display options
 * @returns A ProgressReporter to drive the indicator
 *
 * @example
 * ```ts
 * const progress = createProgress({ label: 'Installing...' });
 * progress.setPercent(50);
 * progress.done();
 * ```
 */
export function createProgress(options: ProgressOptions): ProgressReporter {
  if (options.enabled === false) {
    return noopReporter;
  }

  // Prevent nesting – only one progress indicator at a time
  if (activeProgress > 0) {
    return noopReporter;
  }

  const stream = options.stream ?? process.stderr;
  const isTty = stream.isTTY ?? false;
  if (!isTty) {
    return noopReporter;
  }

  const delayMs = typeof options.delayMs === 'number' ? options.delayMs : 0;
  const total = options.total ?? null;
  const showBar = options.showProgressBar ?? false;
  let completed = 0;
  let percent = 0;
  let label = options.label;
  let remainingMs: number | null = null;
  let indeterminate =
    options.indeterminate ?? (options.total === undefined || options.total === null);
  let started = false;

  activeProgress += 1;

  // Use custom Spinner when spinnerStyle is specified, otherwise fall back to @clack/prompts
  const useCustomSpinner = options.spinnerStyle !== undefined;
  const customSpinner = useCustomSpinner
    ? new Spinner({ style: options.spinnerStyle, stream, color: options.spinnerColor })
    : null;
  const spin = useCustomSpinner ? null : spinner();

  const buildMessage = (): string => {
    const barSuffix = (!indeterminate && showBar) ? ` ${buildProgressBar(percent)}` : '';
    const percentSuffix = indeterminate ? '' : ` ${percent}%`;
    const timeSuffix = remainingMs !== null ? ` (${formatRemainingTime(remainingMs)})` : '';
    return `${label}${barSuffix}${percentSuffix}${timeSuffix}`;
  };

  const applyState = () => {
    if (!started) return;
    if (customSpinner) {
      customSpinner.update(buildMessage());
    } else if (spin) {
      spin.message(buildMessage());
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    if (customSpinner) {
      customSpinner.start(buildMessage());
    } else if (spin) {
      spin.start(buildMessage());
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (delayMs === 0) {
    start();
  } else {
    timer = setTimeout(start, delayMs);
  }

  const setLabel = (next: string) => {
    label = next;
    applyState();
  };

  const setPercent = (nextPercent: number) => {
    percent = Math.max(0, Math.min(100, Math.round(nextPercent)));
    indeterminate = false;
    applyState();
  };

  const tick = (delta = 1) => {
    if (!total) return;
    completed = Math.min(total, completed + delta);
    const nextPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    setPercent(nextPercent);
  };

  const setRemainingMsFn = (ms: number | null) => {
    remainingMs = ms !== null ? Math.max(0, ms) : null;
    applyState();
  };

  const done = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (started) {
      if (customSpinner) {
        customSpinner.stop();
      } else if (spin) {
        spin.stop();
      }
    }
    activeProgress = Math.max(0, activeProgress - 1);
  };

  return { setLabel, setPercent, tick, setRemainingMs: setRemainingMsFn, done };
}

// ============================================================================
// withProgress
// ============================================================================

/**
 * Run an async task wrapped in a progress indicator.
 *
 * The indicator is automatically cleaned up when the task finishes or throws.
 *
 * @param options - Progress display options
 * @param work - Async function that receives the progress reporter
 * @returns The result of the work function
 *
 * @example
 * ```ts
 * const result = await withProgress({ label: 'Building' }, async (p) => {
 *   p.setPercent(50);
 *   return await build();
 * });
 * ```
 */
export async function withProgress<T>(
  options: ProgressOptions,
  work: (progress: ProgressReporter) => Promise<T>,
): Promise<T> {
  const progress = createProgress(options);
  try {
    return await work(progress);
  } finally {
    progress.done();
  }
}

// ============================================================================
// withProgressTotals
// ============================================================================

/**
 * Run an async task with a totals-based progress update callback.
 *
 * Provides a convenience `update` function that accepts `{ completed, total }`
 * and translates it into percent-based progress.
 *
 * @param options - Progress display options
 * @param work - Async function receiving an update callback and the reporter
 * @returns The result of the work function
 */
export async function withProgressTotals<T>(
  options: ProgressOptions,
  work: (
    update: (u: ProgressTotalsUpdate) => void,
    progress: ProgressReporter,
  ) => Promise<T>,
): Promise<T> {
  return await withProgress(options, async (progress) => {
    const update = ({ completed, total, label }: ProgressTotalsUpdate) => {
      if (label) {
        progress.setLabel(label);
      }
      if (!Number.isFinite(total) || total <= 0) {
        return;
      }
      progress.setPercent((completed / total) * 100);
    };
    return await work(update, progress);
  });
}

// ============================================================================
// Phase Notifications
// ============================================================================

/** Descriptor for an installation phase that groups multiple steps. */
export interface PhaseDescriptor {
  /** Unique phase identifier */
  id: string;
  /** Human-readable phase title */
  title: string;
  /** Optional emoji or icon prefix for the phase banner */
  icon?: string;
}

/** Information passed to the onPhaseChange callback. */
export interface PhaseChangeEvent {
  /** The phase being entered */
  phase: PhaseDescriptor;
  /** Index of the phase (0-based) among all unique phases */
  phaseIndex: number;
  /** Total number of unique phases */
  totalPhases: number;
  /** Number of steps in this phase */
  stepsInPhase: number;
}

/**
 * Manages phase transitions during multi-step installations.
 *
 * Tracks which phase is currently active and emits change events when
 * a step belongs to a different phase than the previous one.
 *
 * @example
 * ```ts
 * const notifier = new PhaseNotifier(
 *   [
 *     { id: 'check', description: 'Check Node', phase: 'prerequisites' },
 *     { id: 'install', description: 'Install app', phase: 'installation' },
 *   ],
 *   { prerequisites: { id: 'prerequisites', title: 'Checking prerequisites', icon: '🔍' } },
 * );
 * notifier.onPhaseChange((event) => console.log(event.phase.title));
 * notifier.stepStarted('check');   // emits change to 'prerequisites'
 * notifier.stepStarted('install'); // emits change to 'installation'
 * ```
 */
export class PhaseNotifier {
  private readonly stepPhaseMap: Map<string, string>;
  private readonly phases: Map<string, PhaseDescriptor>;
  private readonly orderedPhaseIds: string[];
  private readonly phaseStepCounts: Map<string, number>;
  private currentPhaseId: string | null = null;
  private listener: ((event: PhaseChangeEvent) => void) | null = null;

  constructor(
    steps: Array<{ id: string; phase?: string }>,
    phaseDescriptors?: Record<string, PhaseDescriptor>,
  ) {
    this.stepPhaseMap = new Map();
    this.phases = new Map();
    this.phaseStepCounts = new Map();
    const seenPhaseIds: string[] = [];

    for (const step of steps) {
      const phaseId = step.phase;
      if (!phaseId) continue;
      this.stepPhaseMap.set(step.id, phaseId);
      this.phaseStepCounts.set(phaseId, (this.phaseStepCounts.get(phaseId) ?? 0) + 1);
      if (!seenPhaseIds.includes(phaseId)) {
        seenPhaseIds.push(phaseId);
        const descriptor = phaseDescriptors?.[phaseId] ?? { id: phaseId, title: phaseId };
        this.phases.set(phaseId, descriptor);
      }
    }
    this.orderedPhaseIds = seenPhaseIds;
  }

  /** Register a callback for phase changes. Only one listener is supported. */
  onPhaseChange(listener: (event: PhaseChangeEvent) => void): void {
    this.listener = listener;
  }

  /** Notify that a step has started; emits a phase change event if the phase differs. */
  stepStarted(stepId: string): void {
    const phaseId = this.stepPhaseMap.get(stepId);
    if (!phaseId) return;
    if (phaseId === this.currentPhaseId) return;

    this.currentPhaseId = phaseId;
    const phase = this.phases.get(phaseId);
    if (!phase) return;

    this.listener?.({
      phase,
      phaseIndex: this.orderedPhaseIds.indexOf(phaseId),
      totalPhases: this.orderedPhaseIds.length,
      stepsInPhase: this.phaseStepCounts.get(phaseId) ?? 0,
    });
  }

  /** Get the current phase ID, or null if no phase has started. */
  get currentPhase(): string | null {
    return this.currentPhaseId;
  }

  /** Get all ordered phase IDs. */
  get allPhaseIds(): readonly string[] {
    return this.orderedPhaseIds;
  }

  /** Reset the notifier to its initial state. */
  reset(): void {
    this.currentPhaseId = null;
  }
}

/**
 * Format a phase change event into a visual banner string.
 *
 * @param event - The phase change event
 * @returns A formatted banner string like "── 🔍 Phase 1/3: Checking prerequisites ──"
 */
export function formatPhaseBanner(event: PhaseChangeEvent): string {
  const icon = event.phase.icon ? `${event.phase.icon} ` : '';
  const phaseNum = `Phase ${event.phaseIndex + 1}/${event.totalPhases}`;
  return `── ${icon}${phaseNum}: ${event.phase.title} ──`;
}

// ============================================================================
// installWithProgress
// ============================================================================

/** Options for installWithProgress. */
export interface InstallWithProgressOptions {
  /** Label shown during the installation */
  label?: string;
  /** Set to false to disable the progress indicator */
  enabled?: boolean;
  /** Output stream */
  stream?: NodeJS.WriteStream;
  /** Callback invoked before each step starts */
  onStepStart?: (step: { id: string; description: string }, index: number) => void;
  /** Callback invoked after each step completes */
  onStepComplete?: (result: StepProgressResult, index: number) => void;
  /** Callback invoked with progress estimation updates */
  onProgress?: (estimate: ProgressEstimate) => void;
  /** Callback invoked when the installation transitions to a new phase */
  onPhaseChange?: (event: PhaseChangeEvent) => void;
  /** Phase descriptors keyed by phase ID; used to provide titles and icons for phases */
  phases?: Record<string, PhaseDescriptor>;
}

/** A single step descriptor for installWithProgress. */
export interface InstallStepDescriptor {
  /** Unique step identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Async function that performs the step's work; throw to indicate failure */
  execute: () => Promise<void>;
  /** Estimated duration in milliseconds (used for weighted progress estimation) */
  estimatedMs?: number;
  /** Phase identifier this step belongs to (used for phase notifications) */
  phase?: string;
}

/**
 * Run a series of install steps with progress tracking.
 *
 * Each step is executed sequentially. Progress is updated after each step.
 * If a step throws, the remaining steps are skipped and the result
 * indicates partial completion.
 *
 * @param steps - Ordered list of step descriptors
 * @param options - Display and callback options
 * @returns Summary of the installation progress
 *
 * @example
 * ```ts
 * const result = await installWithProgress([
 *   { id: 'check', description: 'Checking Node.js', execute: async () => { ... } },
 *   { id: 'install', description: 'Installing package', execute: async () => { ... } },
 * ]);
 * console.log(result.success); // true if all steps passed
 * ```
 */
export async function installWithProgress(
  steps: InstallStepDescriptor[],
  options: InstallWithProgressOptions = {},
): Promise<InstallProgressResult> {
  const startTime = Date.now();
  const stepResults: StepProgressResult[] = [];
  const totalSteps = steps.length;
  let completedSteps = 0;

  // Build estimator if any step has estimatedMs
  const hasEstimates = steps.some((s) => typeof s.estimatedMs === 'number' && s.estimatedMs > 0);
  const defaultEstimateMs = 5000;
  const estimator = hasEstimates
    ? new ProgressEstimator(
        steps.map((s) => ({
          id: s.id,
          estimatedMs: s.estimatedMs ?? defaultEstimateMs,
        })),
      )
    : null;

  // Build phase notifier if any step has a phase
  const hasPhases = steps.some((s) => typeof s.phase === 'string');
  const phaseNotifier = hasPhases ? new PhaseNotifier(steps, options.phases) : null;
  if (phaseNotifier && options.onPhaseChange) {
    phaseNotifier.onPhaseChange(options.onPhaseChange);
  }

  const progress = createProgress({
    label: options.label ?? 'Installing...',
    total: totalSteps,
    enabled: options.enabled,
    stream: options.stream,
  });

  estimator?.start();

  // Periodic timer to update remaining time display during step execution
  let etaTimer: ReturnType<typeof setInterval> | null = null;
  if (estimator) {
    etaTimer = setInterval(() => {
      const est = estimator.getEstimate();
      progress.setRemainingMs(est.remainingMs);
    }, 1000);
  }

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      options.onStepStart?.(step, i);
      estimator?.stepStart(step.id);
      phaseNotifier?.stepStarted(step.id);

      const estimate = estimator?.getEstimate();
      progress.setLabel(`[${i + 1}/${totalSteps}] ${step.description}`);
      if (estimate) {
        progress.setPercent(estimate.percent);
        progress.setRemainingMs(estimate.remainingMs);
        options.onProgress?.(estimate);
      }

      const stepStart = Date.now();
      try {
        await step.execute();
        const duration = Date.now() - stepStart;
        estimator?.stepComplete(step.id, duration);
        const result: StepProgressResult = {
          id: step.id,
          description: step.description,
          success: true,
          duration,
        };
        stepResults.push(result);
        completedSteps += 1;
        if (!estimator) {
          progress.tick();
        } else {
          const est = estimator.getEstimate();
          progress.setPercent(est.percent);
          progress.setRemainingMs(est.remainingMs);
          options.onProgress?.(est);
        }
        options.onStepComplete?.(result, i);
      } catch (err) {
        const duration = Date.now() - stepStart;
        estimator?.stepComplete(step.id, duration);
        const error = err instanceof Error ? err.message : String(err);
        const result: StepProgressResult = {
          id: step.id,
          description: step.description,
          success: false,
          duration,
          error,
        };
        stepResults.push(result);
        options.onStepComplete?.(result, i);
        break; // Stop on first failure
      }
    }
  } finally {
    if (etaTimer) {
      clearInterval(etaTimer);
      etaTimer = null;
    }
    progress.done();
  }

  return {
    success: completedSteps === totalSteps,
    completedSteps,
    totalSteps,
    duration: Date.now() - startTime,
    steps: stepResults,
  };
}

// ============================================================================
// ProgressEstimator
// ============================================================================

/** Configuration for a single step in the estimator. */
export interface EstimatorStepConfig {
  /** Unique step identifier */
  id: string;
  /** Estimated duration in milliseconds (e.g. from InstallStep.timeout or historical data) */
  estimatedMs: number;
}

/** Snapshot of current progress estimation. */
export interface ProgressEstimate {
  /** Overall progress as a fraction 0–1 */
  fraction: number;
  /** Overall progress as a percentage 0–100 */
  percent: number;
  /** Estimated remaining time in milliseconds, or null if unknown */
  remainingMs: number | null;
  /** Estimated total time in milliseconds, or null if unknown */
  totalMs: number | null;
  /** Elapsed time in milliseconds since start */
  elapsedMs: number;
  /** Number of completed steps */
  completedSteps: number;
  /** Total number of steps */
  totalSteps: number;
  /** Human-readable remaining time string, e.g. "2m 30s" */
  remainingText: string;
}

/**
 * Provides accurate progress estimation for multi-step installations.
 *
 * Uses weighted step durations to calculate overall progress and ETA.
 * Steps with longer estimated durations contribute proportionally more
 * to the overall progress. In-progress step progress is interpolated
 * based on elapsed time vs estimated duration.
 *
 * @example
 * ```ts
 * const estimator = new ProgressEstimator([
 *   { id: 'check-node', estimatedMs: 2000 },
 *   { id: 'install-pnpm', estimatedMs: 30000 },
 *   { id: 'install-app', estimatedMs: 60000 },
 * ]);
 *
 * estimator.start();
 * estimator.stepStart('check-node');
 * // ... step executes ...
 * estimator.stepComplete('check-node');
 *
 * const estimate = estimator.getEstimate();
 * console.log(estimate.percent);        // ~2% (2000 / 92000)
 * console.log(estimate.remainingText);  // "1m 30s"
 * ```
 */
export class ProgressEstimator {
  private readonly steps: EstimatorStepConfig[];
  private readonly stepMap: Map<string, EstimatorStepConfig>;
  private readonly totalEstimatedMs: number;
  private readonly completedStepIds: Set<string> = new Set();
  private readonly actualDurations: Map<string, number> = new Map();
  private currentStepId: string | null = null;
  private currentStepStartTime: number | null = null;
  private startTime: number | null = null;

  constructor(steps: EstimatorStepConfig[]) {
    this.steps = [...steps];
    this.stepMap = new Map(steps.map((s) => [s.id, s]));
    this.totalEstimatedMs = steps.reduce((sum, s) => sum + s.estimatedMs, 0);
  }

  /** Mark the overall process as started. */
  start(): void {
    this.startTime = Date.now();
  }

  /** Mark a step as starting execution. */
  stepStart(stepId: string): void {
    this.currentStepId = stepId;
    this.currentStepStartTime = Date.now();
  }

  /** Mark a step as completed with its actual duration in ms. */
  stepComplete(stepId: string, actualDurationMs?: number): void {
    const duration =
      actualDurationMs ??
      (this.currentStepStartTime !== null ? Date.now() - this.currentStepStartTime : 0);
    this.actualDurations.set(stepId, duration);
    this.completedStepIds.add(stepId);
    if (this.currentStepId === stepId) {
      this.currentStepId = null;
      this.currentStepStartTime = null;
    }
  }

  /** Get a snapshot of the current progress estimation. */
  getEstimate(): ProgressEstimate {
    const now = Date.now();
    const elapsedMs = this.startTime !== null ? now - this.startTime : 0;
    const totalSteps = this.steps.length;
    const completedSteps = this.completedStepIds.size;

    if (totalSteps === 0 || this.totalEstimatedMs === 0) {
      return {
        fraction: completedSteps > 0 ? 1 : 0,
        percent: completedSteps > 0 ? 100 : 0,
        remainingMs: 0,
        totalMs: 0,
        elapsedMs,
        completedSteps,
        totalSteps,
        remainingText: '0s',
      };
    }

    // Calculate weighted completed fraction
    let completedWeight = 0;
    for (const stepId of this.completedStepIds) {
      const step = this.stepMap.get(stepId);
      if (step) {
        completedWeight += step.estimatedMs;
      }
    }

    // Add partial progress for the in-progress step
    let inProgressWeight = 0;
    if (this.currentStepId && this.currentStepStartTime !== null) {
      const step = this.stepMap.get(this.currentStepId);
      if (step && step.estimatedMs > 0) {
        const stepElapsed = now - this.currentStepStartTime;
        // Use asymptotic approach: never reaches 100% of estimated weight
        // This prevents the progress from jumping backwards if a step takes longer than estimated
        const ratio = Math.min(stepElapsed / step.estimatedMs, 0.95);
        inProgressWeight = step.estimatedMs * ratio;
      }
    }

    const fraction = Math.min((completedWeight + inProgressWeight) / this.totalEstimatedMs, 1);
    const percent = Math.round(fraction * 100);

    // Estimate remaining time
    let remainingMs: number | null = null;
    let totalMs: number | null = null;

    if (fraction > 0 && elapsedMs > 0) {
      // Use elapsed time and completed fraction to extrapolate total time
      totalMs = Math.round(elapsedMs / fraction);
      remainingMs = Math.max(0, totalMs - elapsedMs);
    } else if (this.totalEstimatedMs > 0) {
      // Fallback to the sum of estimated durations
      remainingMs = this.totalEstimatedMs;
      totalMs = this.totalEstimatedMs;
    }

    return {
      fraction,
      percent,
      remainingMs,
      totalMs,
      elapsedMs,
      completedSteps,
      totalSteps,
      remainingText: formatRemainingTime(remainingMs),
    };
  }

  /** Reset the estimator to its initial state. */
  reset(): void {
    this.completedStepIds.clear();
    this.actualDurations.clear();
    this.currentStepId = null;
    this.currentStepStartTime = null;
    this.startTime = null;
  }
}

/**
 * Format a duration in milliseconds into a human-readable remaining time string.
 *
 * @param ms - Duration in milliseconds, or null
 * @returns Formatted string like "2m 30s", "45s", "< 1s", or "calculating..."
 */
export function formatRemainingTime(ms: number | null): string {
  if (ms === null) {
    return 'calculating...';
  }
  if (ms < 1000) {
    return '< 1s';
  }
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

// ============================================================================
// Utility: resetActiveProgress (for testing)
// ============================================================================

/**
 * Reset the internal active progress counter.
 * Exposed only for testing purposes.
 * @internal
 */
export function _resetActiveProgress(): void {
  activeProgress = 0;
}
