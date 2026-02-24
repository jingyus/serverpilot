// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI Installer Agent - Client entry point.
 *
 * Provides command-line argument parsing, main installation flow orchestration,
 * and error handling. Connects to the AI Installer server via WebSocket,
 * detects the local environment, and executes installation steps.
 *
 * @module index
 */

import process from "node:process";
import os from "node:os";
import { spawn as spawnProcess, type ChildProcess } from "node:child_process";
import type {
  Message,
  InstallPlan,
  InstallStep,
  EnvironmentInfo,
  StepResult,
  ErrorContext,
} from "@aiinstaller/shared";
import { createMessageLite as createMessage } from "./protocol-lite.js";
import { AuthenticatedClient } from "./authenticated-client.js";
import { MessageQueue } from "./message-queue.js";
import { detectEnvironment } from "./detect/index.js";
import { Sandbox } from "./execute/sandbox.js";
import { CommandExecutor } from "./execute/executor.js";
import { installWithProgress } from "./ui/progress.js";
import type { InstallProgressResult } from "./ui/progress.js";
import { confirmStep } from "./ui/prompt.js";
import { displayEnvironmentInfo, displayInstallPlan } from "./ui/table.js";
import { theme } from "./ui/colors.js";
import { VerboseLogger } from "./ui/verbose.js";
import {
  formatPlainErrorFromOutput,
  formatPlainError,
  renderHighlightedError,
} from "./ui/error-messages.js";
import { checkForUpdates, performUpdate } from "./updater/index.js";

// ============================================================================
// Constants
// ============================================================================

export const AGENT_NAME = "@aiinstaller/agent";
export const AGENT_VERSION = "0.1.0";

const DEFAULT_SERVER_URL = "ws://localhost:3000";
const DEFAULT_SOFTWARE = "openclaw";

// ============================================================================
// CLI argument parsing
// ============================================================================

/** Parsed command-line options. */
export interface CLIOptions {
  /** Target software to install (default: "openclaw") */
  software: string;
  /** WebSocket server URL (default: "ws://localhost:3000") */
  serverUrl: string;
  /** Auto-confirm all prompts without user interaction */
  yes: boolean;
  /** Verbose output mode */
  verbose: boolean;
  /** Dry-run mode: preview commands without executing */
  dryRun: boolean;
  /** Offline mode: only perform environment detection, skip server connection */
  offline: boolean;
  /** Check for updates and install if available */
  update: boolean;
  /** Check for updates without installing */
  checkUpdate: boolean;
  /** Show help text and exit */
  help: boolean;
  /** Show version and exit */
  version: boolean;
  /** Agent token for local auth (overrides device fingerprint) */
  token: string;
  /** Server ID for local auth (overrides device fingerprint) */
  serverId: string;
  /** Daemon mode: persistent connection with metrics reporting */
  daemon: boolean;
}

/**
 * Parse command-line arguments into CLIOptions.
 *
 * Supports the following flags:
 * - `--yes` / `-y`: Auto-confirm all prompts
 * - `--verbose` / `-v`: Enable verbose output
 * - `--dry-run`: Preview mode (no actual execution)
 * - `--offline`: Offline mode (environment detection only, no server)
 * - `--server <url>`: Specify server URL
 * - `--help` / `-h`: Show help
 * - `--version`: Show version
 *
 * The first positional argument (if any) is used as the software name.
 *
 * @param argv - Raw process.argv array (includes node and script path)
 * @returns Parsed CLI options
 */
export function parseArgs(argv: string[]): CLIOptions {
  const args = argv.slice(2);

  const options: CLIOptions = {
    software: DEFAULT_SOFTWARE,
    serverUrl: process.env.SP_SERVER_URL || DEFAULT_SERVER_URL,
    yes: false,
    verbose: false,
    dryRun: false,
    offline: false,
    update: false,
    checkUpdate: false,
    help: false,
    version: false,
    token: process.env.SP_AGENT_TOKEN || "",
    serverId: process.env.SP_SERVER_ID || "",
    daemon: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--offline":
        options.offline = true;
        break;
      case "--update":
        options.update = true;
        break;
      case "--check-update":
        options.checkUpdate = true;
        break;
      case "--server": {
        const next = args[i + 1];
        if (!next || next.startsWith("-")) {
          throw new Error("--server requires a URL argument");
        }
        options.serverUrl = next;
        i++;
        break;
      }
      case "--token": {
        const next = args[i + 1];
        if (!next || next.startsWith("-")) {
          throw new Error("--token requires an argument");
        }
        options.token = next;
        i++;
        break;
      }
      case "--server-id": {
        const next = args[i + 1];
        if (!next || next.startsWith("-")) {
          throw new Error("--server-id requires an argument");
        }
        options.serverId = next;
        i++;
        break;
      }
      case "--daemon":
        options.daemon = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
        options.version = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        // Positional argument: software name
        options.software = arg;
        break;
    }
  }

  return options;
}

// ============================================================================
// Help and version output
// ============================================================================

/** Build the help text string. */
export function buildHelpText(): string {
  return `${AGENT_NAME} v${AGENT_VERSION}

Usage: ai-installer [software] [options]

Arguments:
  software              Software to install (default: "${DEFAULT_SOFTWARE}")

Options:
  --server <url>        Server URL (default: "${DEFAULT_SERVER_URL}")
  --yes, -y             Auto-confirm all prompts
  --verbose, -v         Enable verbose output
  --dry-run             Preview commands without executing
  --offline             Offline mode (environment detection only)
  --daemon              Daemon mode (persistent connection + metrics)
  --token <token>       Agent token for authentication
  --server-id <id>      Server ID for authentication
  --update              Check for updates and install if available
  --check-update        Check for updates without installing
  --help, -h            Show this help message
  --version             Show version number

Environment variables:
  SP_SERVER_URL         Server WebSocket URL (overridden by --server)
  SP_AGENT_TOKEN        Agent token (overridden by --token)
  SP_SERVER_ID          Server ID (overridden by --server-id)
`;
}

// ============================================================================
// Main flow orchestration
// ============================================================================

/** Context passed through the installation flow. */
export interface InstallContext {
  options: CLIOptions;
  client: AuthenticatedClient;
  sandbox: Sandbox;
  environment: EnvironmentInfo;
}

/**
 * Run the main installation flow.
 *
 * Flow:
 * 1. Detect local environment
 * 2. Connect to server
 * 3. Create session and report environment
 * 4. Receive and display installation plan
 * 5. Confirm and execute steps
 * 6. Report results and complete session
 *
 * @param options - Parsed CLI options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function runInstall(options: CLIOptions): Promise<number> {
  const verbose = new VerboseLogger({ enabled: options.verbose });

  verbose.log(
    "general",
    `CLI options: software=${options.software}, serverUrl=${options.serverUrl}, yes=${options.yes}, dryRun=${options.dryRun}`,
  );

  // Dry-run banner
  if (options.dryRun) {
    console.log(
      theme.warn(
        "── [DRY-RUN] Preview mode ── No commands will be executed ──",
      ),
    );
    console.log("");
  }

  // Step 1: Detect environment
  console.log(
    theme.info(`${options.dryRun ? "[DRY-RUN] " : ""}Detecting environment...`),
  );
  const envStart = Date.now();
  const environment = detectEnvironment();
  verbose.logTiming("env", "Environment detection", Date.now() - envStart);
  if (options.verbose || options.dryRun) {
    console.log(displayEnvironmentInfo(environment));
  }
  verbose.logData("env", "Detected environment", {
    platform: environment.os.platform,
    arch: environment.os.arch,
    osVersion: environment.os.version,
    shell: environment.shell.type,
    node: environment.runtime.node ?? "N/A",
    packageManagers:
      Object.keys(environment.packageManagers).join(", ") || "none",
    npmReachable: environment.network.canAccessNpm,
    githubReachable: environment.network.canAccessGithub,
  });

  // Offline mode: environment detection only, skip server connection
  if (options.offline) {
    console.log("");
    console.log(
      theme.warn("── [OFFLINE MODE] Environment detection complete ──"),
    );
    console.log("");
    console.log(
      theme.info("To install software, run without the --offline flag:"),
    );
    console.log(theme.muted(`  $ ai-installer ${options.software}`));
    console.log("");
    return 0;
  }

  // Step 2: Connect to server and authenticate
  console.log(
    theme.info(
      `${options.dryRun ? "[DRY-RUN] " : ""}Connecting to server: ${options.serverUrl}`,
    ),
  );
  verbose.log("server", `Server URL: ${options.serverUrl}`);
  const client = new AuthenticatedClient({
    serverUrl: options.serverUrl,
    autoReconnect: true,
    maxReconnectAttempts: 3,
    authTimeoutMs: 10000,
  });

  const executor = new CommandExecutor();
  const sandbox = new Sandbox(
    {
      dryRun: options.dryRun,
      confirmFn: options.yes
        ? undefined
        : async (cmd, args) => {
            const result = await confirmStep({
              message: `Execute: ${cmd} ${args.join(" ")}?`,
              defaultYes: true,
            });
            return result.confirmed;
          },
    },
    executor,
  );

  verbose.log(
    "sandbox",
    `Sandbox config: dryRun=${options.dryRun}, autoConfirm=${options.yes}`,
  );

  try {
    const connectStart = Date.now();
    await client.connectAndAuth();
    verbose.logTiming(
      "ws",
      "WebSocket connection + authentication",
      Date.now() - connectStart,
    );

    const authState = client.getAuthState();
    verbose.log("ws", "Connected and authenticated");
    verbose.log(
      "auth",
      `Device ID: ${authState.deviceInfo?.deviceId.substring(0, 16)}...`,
    );
    if (authState.quota) {
      verbose.log(
        "auth",
        `Quota: ${authState.quota.remaining}/${authState.quota.limit} remaining (Plan: ${authState.plan || "free"})`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    verbose.log("error", `Connection failed: ${msg}`);

    // Format network error with detailed explanation
    const errorMessage = formatNetworkError(msg, options.serverUrl);
    console.log("");
    console.log(renderHighlightedError(errorMessage));
    console.log("");

    // Suggest offline mode
    console.log(
      theme.info("💡 Tip: You can still check your environment with:"),
    );
    console.log(theme.muted(`  $ ai-installer --offline`));
    console.log("");

    return 1;
  }

  try {
    // Step 3: Create session
    console.log(
      theme.info(
        `${options.dryRun ? "[DRY-RUN] " : ""}Creating session for: ${options.software}`,
      ),
    );
    verbose.log("server", `Creating session for software: ${options.software}`);
    const sessionMsg = createMessage("session.create", {
      software: options.software,
    });
    client.send(sessionMsg);
    verbose.log("ws", "Session creation message sent");

    // Step 4: Report environment
    const envMsg = createMessage("env.report", environment);
    client.send(envMsg);
    verbose.log("ws", "Environment report sent to server");

    // Step 5: Wait for install plan (skip empty initial plan from session.create)
    console.log(
      theme.info(
        `${options.dryRun ? "[DRY-RUN] " : ""}Waiting for installation plan...`,
      ),
    );
    verbose.log("plan", "Waiting for server to generate installation plan...");
    const plan: InstallPlan = await waitForNonEmptyPlan(client, verbose, 60000);
    console.log(displayInstallPlan(plan));
    verbose.log(
      "plan",
      `Received plan with ${plan.steps.length} steps, estimated time: ${Math.round(plan.estimatedTime / 1000)}s`,
    );
    for (const step of plan.steps) {
      verbose.log(
        "plan",
        `  Step "${step.id}": ${step.command} (timeout: ${step.timeout}ms, onError: ${step.onError})`,
      );
    }

    // Dry-run: show command preview and exit without executing
    if (options.dryRun) {
      console.log(
        theme.warn("── [DRY-RUN] Commands that would be executed ──"),
      );
      console.log("");
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        console.log(theme.info(`  ${i + 1}. ${step.description}`));
        console.log(theme.muted(`     $ ${step.command}`));
      }
      console.log("");
      console.log(
        theme.warn("── [DRY-RUN] End of preview ── No changes were made ──"),
      );
      client.disconnect();
      return 0;
    }

    // Step 6: Confirm plan
    if (!options.yes) {
      verbose.log("general", "Waiting for user confirmation...");
      const confirmation = await confirmStep({
        message: `Proceed with ${plan.steps.length} installation steps?`,
        defaultYes: true,
      });
      if (!confirmation.confirmed) {
        verbose.log("general", "User cancelled installation");
        console.log(theme.warn("Installation cancelled by user."));
        client.disconnect();
        return 0;
      }
      verbose.log("general", "User confirmed installation plan");
    } else {
      verbose.log("general", "Auto-confirmed installation plan (--yes mode)");
    }

    // Step 7: Execute steps with progress
    console.log(theme.info("Starting installation..."));
    verbose.log("step", `Beginning execution of ${plan.steps.length} steps`);
    const progressResult = await executeSteps(
      plan,
      sandbox,
      client,
      environment,
      options,
      verbose,
    );

    // Step 8: Report completion
    if (progressResult.success) {
      const completeMsg = createMessage("session.complete", {
        success: true,
        summary: `All ${progressResult.totalSteps} steps completed successfully`,
      });
      client.send(completeMsg);
      verbose.logTiming(
        "general",
        "Total installation",
        progressResult.duration,
      );
      verbose.log("ws", "Session completion sent to server");
      console.log(
        theme.success(
          `Installation completed successfully! (${formatDuration(progressResult.duration)})`,
        ),
      );
      client.disconnect();
      return 0;
    } else {
      const failedStep = progressResult.steps.find((s) => !s.success);
      const completeMsg = createMessage("session.complete", {
        success: false,
        summary: `Failed at step: ${failedStep?.description ?? "unknown"}`,
      });
      client.send(completeMsg);
      verbose.log(
        "error",
        `Installation failed at step "${failedStep?.description ?? "unknown"}": ${failedStep?.error ?? "unknown error"}`,
      );
      verbose.logTiming(
        "general",
        "Total installation (failed)",
        progressResult.duration,
      );
      console.error(
        theme.error(
          `Installation failed at step "${failedStep?.description ?? "unknown"}": ${failedStep?.error ?? "unknown error"}`,
        ),
      );
      client.disconnect();
      return 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    verbose.log("error", `Unhandled installation error: ${msg}`);
    console.error(theme.error(`Installation error: ${msg}`));
    client.disconnect();
    return 1;
  }
}

/**
 * Wait for a plan.receive message with actual steps.
 *
 * The server sends an initial empty plan when the session is created,
 * then sends the real plan after analyzing the environment. This helper
 * skips empty plans and waits for one with steps.
 */
async function waitForNonEmptyPlan(
  client: AuthenticatedClient,
  verbose: VerboseLogger,
  timeoutMs: number,
): Promise<InstallPlan> {
  const deadline = Date.now() + timeoutMs;

  return new Promise<InstallPlan>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      client.off("message", onMessage);
      client.off("disconnected", onDisconnect);
      client.off("error", onError);
    };

    const onMessage = (msg: Message) => {
      if (msg.type === "plan.receive") {
        const plan = (msg as Message & { type: "plan.receive" }).payload;
        if (plan.steps.length > 0) {
          cleanup();
          resolve(plan);
        } else {
          verbose.log(
            "plan",
            "Received empty plan (session confirmation), waiting for real plan...",
          );
        }
      }
    };

    const onDisconnect = () => {
      cleanup();
      reject(new Error("Disconnected while waiting for installation plan"));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const remaining = deadline - Date.now();
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for installation plan"));
    }, remaining);

    client.on("message", onMessage);
    client.on("disconnected", onDisconnect);
    client.on("error", onError);
  });
}

/**
 * Execute the steps from an install plan using the sandbox and progress tracking.
 */
async function executeSteps(
  plan: InstallPlan,
  sandbox: Sandbox,
  client: AuthenticatedClient,
  environment: EnvironmentInfo,
  options: CLIOptions,
  verbose?: VerboseLogger,
): Promise<InstallProgressResult> {
  const totalSteps = plan.steps.length;
  const previousSteps: StepResult[] = [];

  const stepDescriptors = plan.steps.map(
    (step: InstallStep, stepIndex: number) => ({
      id: step.id,
      description: step.description,
      execute: async () => {
        verbose?.logStep(stepIndex, totalSteps, step.description);

        // Notify server that step is starting
        const execMsg = createMessage("step.execute", step);
        client.send(execMsg);
        verbose?.log("ws", `Sent step.execute for "${step.id}"`);

        // Parse command into executable parts
        const parts = step.command.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);

        verbose?.logCommand(cmd, args);

        const stepStart = Date.now();
        const result = await sandbox.execute(cmd, args, {
          timeoutMs: step.timeout,
          onStdout: options.verbose
            ? (data) => process.stdout.write(data)
            : undefined,
          onStderr: options.verbose
            ? (data) => process.stderr.write(data)
            : undefined,
        });

        verbose?.logTiming(
          "exec",
          `Command "${result.command}"`,
          Date.now() - stepStart,
        );
        verbose?.log("exec", `Exit code: ${result.exitCode}`);

        // Send step output to server
        const outputMsg = createMessage("step.output", {
          stepId: step.id,
          output: result.stdout,
        });
        client.send(outputMsg);

        // Check result
        if (result.exitCode !== 0) {
          verbose?.log(
            "error",
            `Step "${step.id}" failed: exit code ${result.exitCode}`,
          );
          if (result.stderr) {
            verbose?.log("error", `stderr: ${result.stderr.trim()}`);
          }

          // Report error to server
          const errorMsg = createMessage("error.occurred", {
            stepId: step.id,
            command: result.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            environment,
            previousSteps,
          });
          client.send(errorMsg);

          // Display user-friendly error message with actionable suggestions
          const errorContext: ErrorContext = {
            stepId: step.id,
            command: result.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            environment,
            previousSteps,
          };
          const plainError = formatPlainError(errorContext);
          console.log("");
          console.log(renderHighlightedError(plainError));
          console.log("");

          throw new Error(
            `Command "${result.command}" failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`,
          );
        }

        verbose?.log("step", `Step "${step.id}" completed successfully`);

        // Report step completion
        const stepResult: StepResult = {
          stepId: step.id,
          success: true,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          duration: result.duration,
        };
        previousSteps.push(stepResult);
        const completeMsg = createMessage("step.complete", stepResult);
        client.send(completeMsg);
      },
    }),
  );

  return installWithProgress(stepDescriptors, {
    label: `Installing ${options.software}`,
    enabled: !options.verbose,
  });
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// ============================================================================
// Dry-run preview formatting
// ============================================================================

/** A step descriptor for dry-run preview rendering. */
export interface DryRunStep {
  /** Step description */
  description: string;
  /** Command that would be executed */
  command: string;
}

/**
 * Build a text preview of the commands that would be executed in dry-run mode.
 *
 * @param steps - Steps to preview
 * @returns Multi-line string listing all steps and commands
 */
export function formatDryRunPreview(steps: DryRunStep[]): string {
  const lines: string[] = [];
  lines.push("[DRY-RUN] Commands that would be executed:");
  lines.push("");
  for (let i = 0; i < steps.length; i++) {
    lines.push(`  ${i + 1}. ${steps[i].description}`);
    lines.push(`     $ ${steps[i].command}`);
  }
  lines.push("");
  lines.push("[DRY-RUN] End of preview. No changes were made.");
  return lines.join("\n");
}

// ============================================================================
// Network error formatting
// ============================================================================

/**
 * Format a network connection error into a user-friendly message.
 *
 * Maps common connection error patterns to plain-language explanations
 * and actionable next steps.
 *
 * @param errorMessage - The raw error message from the connection attempt
 * @param serverUrl - The server URL that failed to connect
 * @returns A formatted plain error message
 */
function formatNetworkError(
  errorMessage: string,
  serverUrl: string,
): ReturnType<typeof formatPlainErrorFromOutput> {
  // Map connection errors to network error patterns
  const stderr = errorMessage;

  // Check for specific connection error patterns
  if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
    return formatPlainErrorFromOutput(
      `ETIMEDOUT: Connection timeout while connecting to ${serverUrl}`,
      "",
      "WebSocket connect",
    );
  }

  if (
    errorMessage.includes("ENOTFOUND") ||
    errorMessage.includes("getaddrinfo")
  ) {
    return formatPlainErrorFromOutput(
      `ENOTFOUND: Server address not found: ${serverUrl}`,
      "",
      "WebSocket connect",
    );
  }

  if (errorMessage.includes("ECONNREFUSED")) {
    return formatPlainErrorFromOutput(
      `ECONNREFUSED: Connection refused by ${serverUrl}`,
      "",
      "WebSocket connect",
    );
  }

  if (errorMessage.includes("ECONNRESET")) {
    return formatPlainErrorFromOutput(
      `ECONNRESET: Connection reset while connecting to ${serverUrl}`,
      "",
      "WebSocket connect",
    );
  }

  if (
    errorMessage.includes("certificate") ||
    errorMessage.includes("SSL") ||
    errorMessage.includes("TLS")
  ) {
    return formatPlainErrorFromOutput(
      `SSL certificate error: unable to verify certificate for ${serverUrl}`,
      "",
      "WebSocket connect",
    );
  }

  // Fallback: generic connection failure
  return formatPlainErrorFromOutput(
    `Failed to connect to server: ${errorMessage}`,
    `Server URL: ${serverUrl}`,
    "WebSocket connect",
  );
}

// ============================================================================
// Update commands
// ============================================================================

/**
 * Check for available updates and display info.
 */
async function runCheckUpdate(serverUrl: string): Promise<number> {
  try {
    console.log(theme.info("Checking for updates..."));
    const result = await checkForUpdates(serverUrl);

    console.log("");
    console.log(`Current version: ${theme.muted(result.current)}`);
    console.log(`Latest version:  ${theme.info(result.latest)}`);
    console.log("");

    if (result.updateAvailable) {
      console.log(theme.success("✓ Update available!"));
      console.log("");
      console.log(`Release date: ${result.releaseDate}`);
      console.log("Release notes:");
      console.log(theme.muted(result.releaseNotes));
      console.log("");
      console.log(theme.info("Run with --update to install the update."));
    } else {
      console.log(theme.success("✓ You are running the latest version."));
    }

    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(theme.error(`Failed to check for updates: ${msg}`));
    return 1;
  }
}

/**
 * Download and install the latest version.
 */
async function runUpdate(serverUrl: string): Promise<number> {
  try {
    console.log(theme.info("Checking for updates..."));
    const result = await checkForUpdates(serverUrl);

    if (!result.updateAvailable) {
      console.log(
        theme.success("✓ You are already running the latest version."),
      );
      return 0;
    }

    console.log(`Update available: ${result.current} → ${result.latest}`);
    console.log("");

    const updated = await performUpdate({
      serverUrl,
      onProgress: (progress) => {
        switch (progress.phase) {
          case "downloading":
            if (progress.totalBytes && progress.downloadedBytes) {
              const mb = (progress.downloadedBytes / 1024 / 1024).toFixed(2);
              const totalMb = (progress.totalBytes / 1024 / 1024).toFixed(2);
              process.stdout.write(
                `\rDownloading... ${mb}/${totalMb} MB (${progress.percent}%)`,
              );
            } else {
              process.stdout.write(`\rDownloading... ${progress.percent}%`);
            }
            break;
          case "verifying":
            console.log("\nVerifying download...");
            break;
          case "installing":
            console.log("Installing update...");
            break;
          case "complete":
            console.log("");
            break;
          case "error":
            console.error(theme.error(`\nUpdate failed: ${progress.error}`));
            break;
        }
      },
    });

    if (updated) {
      console.log(
        theme.success(`✓ Successfully updated to version ${result.latest}`),
      );
      console.log(
        theme.info("Please restart the agent to use the new version."),
      );
      return 0;
    }

    return 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(theme.error(`Update failed: ${msg}`));
    return 1;
  }
}

// ============================================================================
// Daemon mode
// ============================================================================

/**
 * Run the agent in daemon mode: persistent connection + periodic metrics.
 *
 * Used for self-hosted deployments where the agent sits alongside the server.
 * Reads token from CLI args, env vars, or the shared token file.
 */
export async function runDaemon(options: CLIOptions): Promise<number> {
  const { loadLocalAgentToken } = await import("./detect/token-file.js");

  // Resolve serverId/agentToken: CLI > env > token file
  let serverId = options.serverId;
  let agentToken = options.token;

  if (!serverId || !agentToken) {
    const fileToken = loadLocalAgentToken();
    if (fileToken) {
      serverId = serverId || fileToken.serverId;
      agentToken = agentToken || fileToken.agentToken;
    }
  }

  if (!serverId || !agentToken) {
    console.error(theme.error("Daemon mode requires serverId and agentToken."));
    console.error(
      theme.muted(
        "Provide via --server-id/--token, SP_SERVER_ID/SP_AGENT_TOKEN env, or token file.",
      ),
    );
    return 1;
  }

  console.log(theme.info(`[daemon] Connecting to ${options.serverUrl} ...`));

  const messageQueue = new MessageQueue({
    onOverflow: () => {
      console.warn(
        theme.muted("[daemon] Message queue full — oldest message discarded"),
      );
    },
  });

  const client = new AuthenticatedClient({
    serverUrl: options.serverUrl,
    autoReconnect: true,
    maxReconnectAttempts: Infinity,
    authTimeoutMs: 15000,
    serverId,
    agentToken,
    messageQueue,
  });

  // Graceful shutdown
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log(theme.muted("\n[daemon] Shutting down..."));
    client.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  try {
    await client.connectAndAuth();
    console.log(theme.success("[daemon] Connected and authenticated"));

    // Report environment once
    const environment = detectEnvironment();
    const envMsg = createMessage("env.report", environment);
    client.send(envMsg);
    console.log(theme.muted("[daemon] Environment report sent"));

    // Periodic metrics reporting
    const metricsInterval = setInterval(() => {
      if (!client.isAuthenticated() || stopping) return;

      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();

      const cpuUsage =
        cpus.reduce((acc, cpu) => {
          const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
          return acc + (1 - cpu.times.idle / total);
        }, 0) / cpus.length;

      const metricsMsg = createMessage("metrics.report", {
        serverId,
        cpuUsage: Math.round(cpuUsage * 100),
        memoryUsage: totalMem - freeMem,
        memoryTotal: totalMem,
        diskUsage: 0,
        diskTotal: 1,
        networkIn: 0,
        networkOut: 0,
      });
      client.trySend(metricsMsg);
    }, 15_000);

    if (metricsInterval.unref) metricsInterval.unref();

    // Handle incoming step.execute commands from server
    client.on("message", (msg: Message) => {
      if (msg.type !== "step.execute") return;

      const step = msg.payload as InstallStep;
      console.log(theme.muted(`[daemon] Executing: ${step.command}`));

      const stepStart = Date.now();

      // Run through shell to support redirects (>), pipes (|), tilde (~), &&, etc.
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
      const shellArgs =
        process.platform === "win32"
          ? ["/c", step.command]
          : ["-c", step.command];

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child: ChildProcess = spawnProcess(shell, shellArgs, {
        stdio: "pipe",
        env: { ...process.env, HOME: process.env.HOME || os.homedir() },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, step.timeout || 300000);

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        client.trySend(
          createMessage("step.output", { stepId: step.id, output: text }),
        );
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        client.trySend(
          createMessage("step.output", { stepId: step.id, output: text }),
        );
      });

      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        const exitCode = timedOut ? -1 : (code ?? 1);
        const stepResult: StepResult = {
          stepId: step.id,
          success: exitCode === 0,
          exitCode,
          stdout,
          stderr,
          duration: Date.now() - stepStart,
        };
        client.trySend(createMessage("step.complete", stepResult));
        console.log(
          theme.muted(`[daemon] Step ${step.id} completed (exit ${exitCode})`),
        );
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        const stepResult: StepResult = {
          stepId: step.id,
          success: false,
          exitCode: -1,
          stdout,
          stderr: stderr + err.message,
          duration: Date.now() - stepStart,
        };
        client.trySend(createMessage("step.complete", stepResult));
        console.error(
          theme.error(`[daemon] Step ${step.id} error: ${err.message}`),
        );
      });
    });

    // Keep alive — wait for SIGTERM/SIGINT
    await new Promise<void>(() => {
      // Never resolves; process exits via shutdown()
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(theme.error(`[daemon] Failed to connect: ${msg}`));
    return 1;
  }

  return 0;
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Main entry point for the agent CLI.
 *
 * Parses arguments, handles --help and --version, then runs the install flow.
 *
 * @param argv - process.argv (or override for testing)
 * @returns Exit code
 */
export async function main(argv: string[] = process.argv): Promise<number> {
  try {
    const options = parseArgs(argv);

    if (options.help) {
      console.log(buildHelpText());
      return 0;
    }

    if (options.version) {
      console.log(`${AGENT_NAME} v${AGENT_VERSION}`);
      return 0;
    }

    // Handle update check
    if (options.checkUpdate) {
      return await runCheckUpdate(options.serverUrl);
    }

    // Handle update installation
    if (options.update) {
      return await runUpdate(options.serverUrl);
    }

    // Daemon mode: persistent connection + metrics
    if (options.daemon) {
      return await runDaemon(options);
    }

    return await runInstall(options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(theme.error(`Error: ${msg}`));
    return 1;
  }
}

// Run main when executed directly (Node.js or bun compiled binary)
const isDirectRun =
  (import.meta as { main?: boolean }).main === true ||
  (typeof process.argv[1] === "string" &&
    (process.argv[1].endsWith("/index.js") ||
      process.argv[1].endsWith("/index.ts")));

if (isDirectRun) {
  main().then((code) => {
    process.exit(code);
  });
}
