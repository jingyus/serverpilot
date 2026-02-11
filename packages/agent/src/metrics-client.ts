// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Metrics reporting client for the agent.
 *
 * Periodically collects and sends system metrics to the server.
 * Runs as a background task alongside the main agent process.
 *
 * @module metrics-client
 */

import { AuthenticatedClient } from './authenticated-client.js';
import type { AuthenticatedClientOptions } from './authenticated-client.js';
import { MessageType, createMessageLite as createMessage } from './protocol-lite.js';
import { collectMetrics } from './detect/metrics.js';

/**
 * Metrics client options.
 */
export interface MetricsClientOptions extends AuthenticatedClientOptions {
  /** Server ID to report metrics for */
  serverId: string;
  /** Reporting interval in milliseconds (default: 60000 = 1 minute) */
  reportIntervalMs?: number;
}

/**
 * Metrics client that periodically reports system metrics to the server.
 *
 * @example
 * ```ts
 * const client = new MetricsClient({
 *   serverUrl: 'ws://localhost:3000',
 *   serverId: 'server-123',
 *   reportIntervalMs: 60000, // 1 minute
 * });
 *
 * await client.start();
 * // Metrics are now being sent every minute
 *
 * // Stop reporting
 * client.stop();
 * ```
 */
export class MetricsClient extends AuthenticatedClient {
  private readonly serverId: string;
  private readonly reportIntervalMs: number;
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private isReporting = false;

  constructor(options: MetricsClientOptions) {
    super(options);
    this.serverId = options.serverId;
    this.reportIntervalMs = options.reportIntervalMs ?? 60000; // Default: 1 minute
  }

  /**
   * Start metrics reporting.
   *
   * Connects to the server, authenticates, and begins periodic metrics collection.
   *
   * @returns Promise that resolves when connection and authentication are complete
   * @throws {Error} When connection or authentication fails
   */
  async start(): Promise<void> {
    if (this.isReporting) {
      throw new Error('Metrics reporting is already running');
    }

    // Connect and authenticate
    await this.connectAndAuth();

    // Start periodic reporting
    this.isReporting = true;
    this.startReporting();
  }

  /**
   * Stop metrics reporting.
   *
   * Stops the reporting timer and disconnects from the server.
   */
  stop(): void {
    this.stopReporting();
    this.disconnect();
  }

  /**
   * Start periodic metrics reporting.
   */
  private startReporting(): void {
    // Send first report immediately
    this.reportMetrics().catch((err) => {
      console.error('Failed to send initial metrics report:', err);
    });

    // Set up periodic reporting
    this.reportTimer = setInterval(() => {
      this.reportMetrics().catch((err) => {
        console.error('Failed to send metrics report:', err);
      });
    }, this.reportIntervalMs);
  }

  /**
   * Stop periodic metrics reporting.
   */
  private stopReporting(): void {
    this.isReporting = false;

    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
  }

  /**
   * Collect and send metrics to the server.
   */
  private async reportMetrics(): Promise<void> {
    if (!this.isAuthenticated() || this.state !== 'connected') {
      console.warn('Cannot report metrics: not connected or not authenticated');
      return;
    }

    try {
      // Collect metrics
      const metrics = await collectMetrics();

      // Send metrics report message
      const message = createMessage(MessageType.METRICS_REPORT, {
        serverId: this.serverId,
        cpuUsage: metrics.cpuUsage,
        memoryUsage: metrics.memoryUsage,
        memoryTotal: metrics.memoryTotal,
        diskUsage: metrics.diskUsage,
        diskTotal: metrics.diskTotal,
        networkIn: metrics.networkIn,
        networkOut: metrics.networkOut,
      });

      this.send(message);
    } catch (err) {
      console.error('Failed to collect or send metrics:', err);
    }
  }

  /**
   * Override disconnect to stop reporting.
   */
  override disconnect(code?: number, reason?: string): void {
    this.stopReporting();
    super.disconnect(code, reason);
  }
}
