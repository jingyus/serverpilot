/**
 * Alert Evaluator — periodically checks metrics against alert rules.
 *
 * Polls enabled alert rules, fetches latest metrics for each server,
 * compares values against thresholds, and fires alerts with email
 * notifications when conditions are met. Respects cooldown periods
 * to prevent alert spam.
 *
 * @module core/alert/alert-evaluator
 */

import { createContextLogger } from '../../utils/logger.js';
import type { AlertRuleRepository, AlertRule } from '../../db/repositories/alert-rule-repository.js';
import { getAlertRuleRepository } from '../../db/repositories/alert-rule-repository.js';
import type { AlertRepository } from '../../db/repositories/alert-repository.js';
import { getAlertRepository } from '../../db/repositories/alert-repository.js';
import type { MetricsRepository, MetricPoint } from '../../db/repositories/metrics-repository.js';
import { getMetricsRepository } from '../../db/repositories/metrics-repository.js';
import type { EmailNotifier } from './email-notifier.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_EVAL_INTERVAL_MS = 60_000;
const MIN_EVAL_INTERVAL_MS = 10_000;
const MAX_EVAL_INTERVAL_MS = 300_000;

// ============================================================================
// Types
// ============================================================================

export interface AlertEvaluatorOptions {
  evalIntervalMs?: number;
}

export interface EvaluationResult {
  ruleId: string;
  triggered: boolean;
  currentValue: number;
  threshold: number;
}

// ============================================================================
// Alert Evaluator
// ============================================================================

export class AlertEvaluator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private processing = false;
  private readonly evalIntervalMs: number;
  private readonly logger = createContextLogger({ module: 'alert-evaluator' });

  constructor(
    private ruleRepo: AlertRuleRepository = getAlertRuleRepository(),
    private alertRepo: AlertRepository = getAlertRepository(),
    private metricsRepo: MetricsRepository = getMetricsRepository(),
    private emailNotifier: EmailNotifier | null = null,
    options: AlertEvaluatorOptions = {},
  ) {
    const interval = options.evalIntervalMs ?? DEFAULT_EVAL_INTERVAL_MS;
    this.evalIntervalMs = Math.min(
      Math.max(interval, MIN_EVAL_INTERVAL_MS),
      MAX_EVAL_INTERVAL_MS,
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.logger.info(
      { evalIntervalMs: this.evalIntervalMs },
      'Alert evaluator started',
    );

    this.evaluate();
    this.timer = setInterval(() => this.evaluate(), this.evalIntervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info('Alert evaluator stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Run a single evaluation cycle. Exposed for testing. */
  async evaluate(): Promise<EvaluationResult[]> {
    if (this.processing) return [];
    this.processing = true;

    const results: EvaluationResult[] = [];

    try {
      const rules = await this.ruleRepo.listEnabled();

      if (rules.length === 0) {
        return results;
      }

      // Group rules by server to minimize DB lookups
      const rulesByServer = new Map<string, AlertRule[]>();
      for (const rule of rules) {
        const existing = rulesByServer.get(rule.serverId) ?? [];
        existing.push(rule);
        rulesByServer.set(rule.serverId, existing);
      }

      for (const [serverId, serverRules] of rulesByServer) {
        const metric = await this.metricsRepo.getLatest(serverId, serverRules[0].userId);
        if (!metric) continue;

        for (const rule of serverRules) {
          const result = await this.evaluateRule(rule, metric);
          results.push(result);
        }
      }
    } catch (err) {
      this.logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Error during alert evaluation cycle',
      );
    } finally {
      this.processing = false;
    }

    return results;
  }

  private async evaluateRule(
    rule: AlertRule,
    metric: MetricPoint,
  ): Promise<EvaluationResult> {
    const currentValue = this.extractMetricValue(rule.metricType, metric);
    const triggered = this.compareValue(currentValue, rule.operator, rule.threshold);

    const result: EvaluationResult = {
      ruleId: rule.id,
      triggered,
      currentValue,
      threshold: rule.threshold,
    };

    if (!triggered) return result;

    // Check cooldown period
    if (this.isInCooldown(rule)) {
      return result;
    }

    // Fire alert
    const alertMessage = this.buildAlertMessage(rule, currentValue);

    try {
      await this.alertRepo.create({
        serverId: rule.serverId,
        userId: rule.userId,
        type: rule.metricType,
        severity: rule.severity,
        message: alertMessage,
        value: String(currentValue),
        threshold: String(rule.threshold),
      });

      await this.ruleRepo.updateLastTriggered(rule.id);

      this.logger.info(
        {
          ruleId: rule.id,
          serverId: rule.serverId,
          metricType: rule.metricType,
          currentValue,
          threshold: rule.threshold,
        },
        'Alert rule triggered',
      );

      // Send email notification
      if (this.emailNotifier && rule.emailRecipients.length > 0) {
        await this.emailNotifier.sendAlertNotification({
          recipients: rule.emailRecipients,
          ruleName: rule.name,
          serverId: rule.serverId,
          metricType: rule.metricType,
          currentValue,
          threshold: rule.threshold,
          operator: rule.operator,
          severity: rule.severity,
        });
      }
    } catch (err) {
      this.logger.error(
        {
          ruleId: rule.id,
          error: err instanceof Error ? err.message : String(err),
        },
        'Failed to create alert from rule',
      );
    }

    return result;
  }

  /** Extract the relevant metric value for a given metric type. */
  extractMetricValue(metricType: string, metric: MetricPoint): number {
    switch (metricType) {
      case 'cpu':
        return metric.cpuUsage;
      case 'memory':
        return metric.memoryTotal > 0
          ? (metric.memoryUsage / metric.memoryTotal) * 100
          : 0;
      case 'disk':
        return metric.diskTotal > 0
          ? (metric.diskUsage / metric.diskTotal) * 100
          : 0;
      default:
        return 0;
    }
  }

  /** Compare a value against a threshold using the specified operator. */
  compareValue(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      default: return false;
    }
  }

  private isInCooldown(rule: AlertRule): boolean {
    if (!rule.lastTriggeredAt) return false;
    const lastTriggered = new Date(rule.lastTriggeredAt).getTime();
    const cooldownMs = rule.cooldownMinutes * 60 * 1000;
    return Date.now() - lastTriggered < cooldownMs;
  }

  private buildAlertMessage(rule: AlertRule, currentValue: number): string {
    const opLabel = { gt: '>', lt: '<', gte: '>=', lte: '<=' }[rule.operator] ?? '>';
    const metricLabel = { cpu: 'CPU usage', memory: 'Memory usage', disk: 'Disk usage' }[rule.metricType] ?? rule.metricType;
    return `${metricLabel} is ${currentValue.toFixed(1)}%, threshold ${opLabel} ${rule.threshold}% (rule: ${rule.name})`;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _evaluator: AlertEvaluator | null = null;

export function getAlertEvaluator(
  emailNotifier?: EmailNotifier | null,
  options?: AlertEvaluatorOptions,
): AlertEvaluator {
  if (!_evaluator) {
    _evaluator = new AlertEvaluator(
      undefined,
      undefined,
      undefined,
      emailNotifier ?? null,
      options,
    );
  }
  return _evaluator;
}

export function setAlertEvaluator(evaluator: AlertEvaluator): void {
  _evaluator = evaluator;
}

export function _resetAlertEvaluator(): void {
  if (_evaluator) {
    _evaluator.stop();
  }
  _evaluator = null;
}
