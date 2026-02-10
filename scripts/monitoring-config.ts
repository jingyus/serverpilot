/**
 * Monitoring and Logging Configuration Module
 *
 * Configures application monitoring (Sentry), log aggregation,
 * alert rules, and monitoring dashboards for the AI Installer server.
 *
 * Features:
 * - Sentry integration configuration
 * - Log aggregation setup (Loki/ELK)
 * - Alert rule definitions
 * - Dashboard metric definitions
 * - Health check configuration
 *
 * Usage: npx tsx scripts/monitoring-config.ts [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Types
// ============================================================================

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type LogProvider = 'loki' | 'elk' | 'console';
export type MonitorProvider = 'sentry' | 'datadog' | 'none';

export interface AlertRule {
  name: string;
  condition: string;
  severity: AlertSeverity;
  description: string;
  threshold?: string;
}

export interface MonitoringMetric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  description: string;
  labels?: string[];
}

export interface HealthCheckConfig {
  endpoint: string;
  interval: string;
  timeout: string;
  retries: number;
}

export interface LogConfig {
  provider: LogProvider;
  level: string;
  structured: boolean;
  filePath?: string;
}

export interface SentryConfig {
  enabled: boolean;
  dsn?: string;
  environment: string;
  tracesSampleRate: number;
  profilesSampleRate: number;
}

export interface MonitoringConfig {
  sentry: SentryConfig;
  logging: LogConfig;
  alerts: AlertRule[];
  metrics: MonitoringMetric[];
  healthCheck: HealthCheckConfig;
}

export interface MonitoringSetupResult {
  success: boolean;
  action: 'configured' | 'skipped' | 'dry-run';
  message: string;
  config?: MonitoringConfig;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_LOG_LEVEL = 'info';
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
export const DEFAULT_PROFILES_SAMPLE_RATE = 0.1;
export const HEALTH_CHECK_ENDPOINT = '/';

// ============================================================================
// Alert Rules
// ============================================================================

/**
 * Default alert rules for the application.
 */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    name: 'service-unavailable',
    condition: 'health_check_failures >= 3',
    severity: 'critical',
    description: 'Service health check failed 3 consecutive times',
    threshold: '3 consecutive failures',
  },
  {
    name: 'ai-api-error-rate',
    condition: 'ai_api_error_rate > 0.5',
    severity: 'warning',
    description: 'AI API error rate exceeded 50% in 5 minutes',
    threshold: '50% error rate in 5 min',
  },
  {
    name: 'memory-high',
    condition: 'memory_usage_percent > 85',
    severity: 'warning',
    description: 'Memory usage exceeded 85%',
    threshold: '85% memory',
  },
  {
    name: 'websocket-connection-drop',
    condition: 'active_connections_drop > 0.5',
    severity: 'warning',
    description: 'Active WebSocket connections dropped by more than 50%',
    threshold: '50% connection drop',
  },
  {
    name: 'ai-api-slow-response',
    condition: 'ai_api_avg_response_time > 10000',
    severity: 'info',
    description: 'AI API average response time exceeded 10 seconds',
    threshold: '10s avg response',
  },
];

// ============================================================================
// Monitoring Metrics
// ============================================================================

/**
 * Default monitoring metrics.
 */
export const DEFAULT_METRICS: MonitoringMetric[] = [
  {
    name: 'ws_active_connections',
    type: 'gauge',
    description: 'Number of active WebSocket connections',
  },
  {
    name: 'ai_api_requests_total',
    type: 'counter',
    description: 'Total number of AI API requests',
    labels: ['status', 'model'],
  },
  {
    name: 'ai_api_response_time_ms',
    type: 'histogram',
    description: 'AI API response time in milliseconds',
    labels: ['model'],
  },
  {
    name: 'install_sessions_total',
    type: 'counter',
    description: 'Total number of installation sessions',
    labels: ['status', 'os'],
  },
  {
    name: 'install_success_rate',
    type: 'gauge',
    description: 'Installation success rate (0-1)',
  },
  {
    name: 'command_execution_timeout_total',
    type: 'counter',
    description: 'Total number of command execution timeouts',
  },
  {
    name: 'memory_usage_bytes',
    type: 'gauge',
    description: 'Current memory usage in bytes',
  },
];

// ============================================================================
// Configuration Builders
// ============================================================================

/**
 * Build the default Sentry configuration.
 */
export function buildSentryConfig(
  dsn?: string,
  environment = 'production',
): SentryConfig {
  return {
    enabled: !!dsn,
    dsn,
    environment,
    tracesSampleRate: DEFAULT_TRACES_SAMPLE_RATE,
    profilesSampleRate: DEFAULT_PROFILES_SAMPLE_RATE,
  };
}

/**
 * Build the default log configuration.
 */
export function buildLogConfig(
  provider: LogProvider = 'console',
  level = DEFAULT_LOG_LEVEL,
): LogConfig {
  return {
    provider,
    level,
    structured: true,
    filePath: provider === 'console' ? undefined : '/var/log/aiinstaller/server.log',
  };
}

/**
 * Build the default health check configuration.
 */
export function buildHealthCheckConfig(): HealthCheckConfig {
  return {
    endpoint: HEALTH_CHECK_ENDPOINT,
    interval: '30s',
    timeout: '5s',
    retries: 3,
  };
}

/**
 * Build the full monitoring configuration.
 */
export function buildMonitoringConfig(
  sentryDsn?: string,
  logProvider: LogProvider = 'console',
  logLevel = DEFAULT_LOG_LEVEL,
): MonitoringConfig {
  return {
    sentry: buildSentryConfig(sentryDsn),
    logging: buildLogConfig(logProvider, logLevel),
    alerts: [...DEFAULT_ALERT_RULES],
    metrics: [...DEFAULT_METRICS],
    healthCheck: buildHealthCheckConfig(),
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate the monitoring configuration.
 */
export function validateMonitoringConfig(config: MonitoringConfig): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!config.sentry.enabled) {
    warnings.push('Sentry is not configured. Set SENTRY_DSN for error tracking.');
  }

  if (config.logging.level === 'debug') {
    warnings.push('Log level is set to "debug". This may impact performance in production.');
  }

  if (config.alerts.length === 0) {
    warnings.push('No alert rules configured.');
  }

  if (config.metrics.length === 0) {
    warnings.push('No metrics defined.');
  }

  return { valid: true, warnings };
}

/**
 * Check if deployment docs reference monitoring.
 */
export function checkDeploymentDocs(): { found: boolean; message: string } {
  const deployDocPath = path.join(ROOT_DIR, 'docs/deployment.md');
  if (!fs.existsSync(deployDocPath)) {
    return { found: false, message: 'docs/deployment.md not found' };
  }

  const content = fs.readFileSync(deployDocPath, 'utf-8');
  const hasMonitoring = content.includes('监控') || content.includes('monitoring');
  const hasSentry = content.includes('Sentry') || content.includes('sentry');
  const hasLogging = content.includes('日志') || content.includes('logging');

  if (hasMonitoring && hasSentry && hasLogging) {
    return { found: true, message: 'Deployment docs reference monitoring, Sentry, and logging' };
  }

  return {
    found: true,
    message: `Deployment docs found. Monitoring: ${hasMonitoring}, Sentry: ${hasSentry}, Logging: ${hasLogging}`,
  };
}

// ============================================================================
// Setup
// ============================================================================

/**
 * Configure monitoring and logging.
 */
export function setupMonitoring(
  sentryDsn?: string,
  logProvider: LogProvider = 'console',
  dryRun = false,
): MonitoringSetupResult {
  const config = buildMonitoringConfig(sentryDsn, logProvider);
  const validation = validateMonitoringConfig(config);

  if (dryRun) {
    return {
      success: true,
      action: 'dry-run',
      message: `[dry-run] Would configure monitoring: Sentry=${config.sentry.enabled}, Logs=${config.logging.provider}, Alerts=${config.alerts.length}, Metrics=${config.metrics.length}`,
      config,
    };
  }

  return {
    success: true,
    action: 'configured',
    message: `Monitoring configured: ${config.alerts.length} alert rules, ${config.metrics.length} metrics. ${validation.warnings.length > 0 ? `Warnings: ${validation.warnings.join('; ')}` : ''}`,
    config,
  };
}

// ============================================================================
// CLI entry point
// ============================================================================

if (process.argv[1] && import.meta.filename && process.argv[1] === import.meta.filename) {
  console.log('=== Monitoring & Logging Configuration ===\n');

  const dryRun = process.argv.includes('--dry-run');

  const sentryDsn = process.env.SENTRY_DSN;
  const logLevel = process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL;

  const config = buildMonitoringConfig(sentryDsn, 'console', logLevel);

  console.log('Sentry:');
  console.log(`  Enabled: ${config.sentry.enabled}`);
  if (config.sentry.dsn) {
    console.log(`  DSN: ${config.sentry.dsn.substring(0, 20)}...`);
  }
  console.log(`  Traces sample rate: ${config.sentry.tracesSampleRate}`);

  console.log('\nLogging:');
  console.log(`  Provider: ${config.logging.provider}`);
  console.log(`  Level: ${config.logging.level}`);
  console.log(`  Structured: ${config.logging.structured}`);

  console.log('\nAlert Rules:');
  for (const rule of config.alerts) {
    const icon = rule.severity === 'critical' ? '🔴' : rule.severity === 'warning' ? '🟡' : '🔵';
    console.log(`  ${icon} ${rule.name}: ${rule.description}`);
  }

  console.log('\nMetrics:');
  for (const metric of config.metrics) {
    console.log(`  - ${metric.name} (${metric.type}): ${metric.description}`);
  }

  console.log('\nHealth Check:');
  console.log(`  Endpoint: ${config.healthCheck.endpoint}`);
  console.log(`  Interval: ${config.healthCheck.interval}`);

  const validation = validateMonitoringConfig(config);
  if (validation.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of validation.warnings) {
      console.log(`  ⚠ ${w}`);
    }
  }

  const docsCheck = checkDeploymentDocs();
  console.log(`\nDocs: ${docsCheck.message}`);
}
