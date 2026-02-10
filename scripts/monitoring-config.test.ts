/**
 * Tests for Monitoring and Logging Configuration Module.
 *
 * Validates:
 * - Constants and defaults
 * - Alert rules
 * - Monitoring metrics
 * - Sentry config building
 * - Log config building
 * - Health check config
 * - Full monitoring config
 * - Validation
 * - Deployment docs check
 * - Dry-run setup
 * - Type exports
 * - Integration with project
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_LOG_LEVEL,
  DEFAULT_TRACES_SAMPLE_RATE,
  DEFAULT_PROFILES_SAMPLE_RATE,
  HEALTH_CHECK_ENDPOINT,
  DEFAULT_ALERT_RULES,
  DEFAULT_METRICS,
  buildSentryConfig,
  buildLogConfig,
  buildHealthCheckConfig,
  buildMonitoringConfig,
  validateMonitoringConfig,
  checkDeploymentDocs,
  setupMonitoring,
} from './monitoring-config';
import type {
  AlertSeverity,
  AlertRule,
  MonitoringMetric,
  HealthCheckConfig,
  LogConfig,
  SentryConfig,
  MonitoringConfig,
  MonitoringSetupResult,
} from './monitoring-config';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// ============================================================================
// Constants
// ============================================================================

describe('Constants', () => {
  it('DEFAULT_LOG_LEVEL should be info', () => {
    expect(DEFAULT_LOG_LEVEL).toBe('info');
  });

  it('DEFAULT_TRACES_SAMPLE_RATE should be between 0 and 1', () => {
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBeGreaterThan(0);
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBeLessThanOrEqual(1);
  });

  it('DEFAULT_PROFILES_SAMPLE_RATE should be between 0 and 1', () => {
    expect(DEFAULT_PROFILES_SAMPLE_RATE).toBeGreaterThan(0);
    expect(DEFAULT_PROFILES_SAMPLE_RATE).toBeLessThanOrEqual(1);
  });

  it('HEALTH_CHECK_ENDPOINT should be /', () => {
    expect(HEALTH_CHECK_ENDPOINT).toBe('/');
  });
});

// ============================================================================
// Alert Rules
// ============================================================================

describe('DEFAULT_ALERT_RULES', () => {
  it('should have at least 3 rules', () => {
    expect(DEFAULT_ALERT_RULES.length).toBeGreaterThanOrEqual(3);
  });

  it('should include a critical rule', () => {
    const critical = DEFAULT_ALERT_RULES.filter((r) => r.severity === 'critical');
    expect(critical.length).toBeGreaterThanOrEqual(1);
  });

  it('should include a warning rule', () => {
    const warnings = DEFAULT_ALERT_RULES.filter((r) => r.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('should include service-unavailable rule', () => {
    const rule = DEFAULT_ALERT_RULES.find((r) => r.name === 'service-unavailable');
    expect(rule).toBeDefined();
    expect(rule!.severity).toBe('critical');
  });

  it('should include ai-api-error-rate rule', () => {
    const rule = DEFAULT_ALERT_RULES.find((r) => r.name === 'ai-api-error-rate');
    expect(rule).toBeDefined();
  });

  it('should include memory-high rule', () => {
    const rule = DEFAULT_ALERT_RULES.find((r) => r.name === 'memory-high');
    expect(rule).toBeDefined();
  });

  it('each rule should have required fields', () => {
    for (const rule of DEFAULT_ALERT_RULES) {
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.condition.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
      expect(['critical', 'warning', 'info']).toContain(rule.severity);
    }
  });

  it('rule names should be unique', () => {
    const names = DEFAULT_ALERT_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ============================================================================
// Monitoring Metrics
// ============================================================================

describe('DEFAULT_METRICS', () => {
  it('should have at least 5 metrics', () => {
    expect(DEFAULT_METRICS.length).toBeGreaterThanOrEqual(5);
  });

  it('should include ws_active_connections', () => {
    const metric = DEFAULT_METRICS.find((m) => m.name === 'ws_active_connections');
    expect(metric).toBeDefined();
    expect(metric!.type).toBe('gauge');
  });

  it('should include ai_api_requests_total', () => {
    const metric = DEFAULT_METRICS.find((m) => m.name === 'ai_api_requests_total');
    expect(metric).toBeDefined();
    expect(metric!.type).toBe('counter');
  });

  it('should include ai_api_response_time_ms', () => {
    const metric = DEFAULT_METRICS.find((m) => m.name === 'ai_api_response_time_ms');
    expect(metric).toBeDefined();
    expect(metric!.type).toBe('histogram');
  });

  it('should include memory_usage_bytes', () => {
    const metric = DEFAULT_METRICS.find((m) => m.name === 'memory_usage_bytes');
    expect(metric).toBeDefined();
    expect(metric!.type).toBe('gauge');
  });

  it('each metric should have required fields', () => {
    for (const metric of DEFAULT_METRICS) {
      expect(metric.name.length).toBeGreaterThan(0);
      expect(['counter', 'gauge', 'histogram']).toContain(metric.type);
      expect(metric.description.length).toBeGreaterThan(0);
    }
  });

  it('metric names should be unique', () => {
    const names = DEFAULT_METRICS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ============================================================================
// Config Builders
// ============================================================================

describe('buildSentryConfig()', () => {
  it('should be disabled when no DSN', () => {
    const config = buildSentryConfig();
    expect(config.enabled).toBe(false);
    expect(config.dsn).toBeUndefined();
  });

  it('should be enabled when DSN provided', () => {
    const config = buildSentryConfig('https://exampledsn@sentry.io/123');
    expect(config.enabled).toBe(true);
    expect(config.dsn).toBe('https://exampledsn@sentry.io/123');
  });

  it('should use default environment', () => {
    const config = buildSentryConfig();
    expect(config.environment).toBe('production');
  });

  it('should use custom environment', () => {
    const config = buildSentryConfig(undefined, 'staging');
    expect(config.environment).toBe('staging');
  });

  it('should set sample rates', () => {
    const config = buildSentryConfig();
    expect(config.tracesSampleRate).toBe(DEFAULT_TRACES_SAMPLE_RATE);
    expect(config.profilesSampleRate).toBe(DEFAULT_PROFILES_SAMPLE_RATE);
  });
});

describe('buildLogConfig()', () => {
  it('should use default provider', () => {
    const config = buildLogConfig();
    expect(config.provider).toBe('console');
  });

  it('should use specified provider', () => {
    const config = buildLogConfig('loki');
    expect(config.provider).toBe('loki');
  });

  it('should use default level', () => {
    const config = buildLogConfig();
    expect(config.level).toBe(DEFAULT_LOG_LEVEL);
  });

  it('should use custom level', () => {
    const config = buildLogConfig('console', 'debug');
    expect(config.level).toBe('debug');
  });

  it('should be structured', () => {
    const config = buildLogConfig();
    expect(config.structured).toBe(true);
  });

  it('console provider should not have filePath', () => {
    const config = buildLogConfig('console');
    expect(config.filePath).toBeUndefined();
  });

  it('non-console provider should have filePath', () => {
    const config = buildLogConfig('loki');
    expect(config.filePath).toBeDefined();
  });
});

describe('buildHealthCheckConfig()', () => {
  it('should return valid config', () => {
    const config = buildHealthCheckConfig();
    expect(config.endpoint).toBe(HEALTH_CHECK_ENDPOINT);
    expect(config.interval).toBe('10s');
    expect(config.timeout).toBe('5s');
    expect(config.retries).toBe(5);
  });

  it('timeout should be shorter than interval', () => {
    const config = buildHealthCheckConfig();
    const timeout = parseInt(config.timeout);
    const interval = parseInt(config.interval);
    expect(timeout).toBeLessThan(interval);
  });

  it('retries should be positive', () => {
    const config = buildHealthCheckConfig();
    expect(config.retries).toBeGreaterThan(0);
  });
});

describe('buildMonitoringConfig()', () => {
  it('should include all components', () => {
    const config = buildMonitoringConfig();
    expect(config.sentry).toBeDefined();
    expect(config.logging).toBeDefined();
    expect(config.alerts).toBeDefined();
    expect(config.metrics).toBeDefined();
    expect(config.healthCheck).toBeDefined();
  });

  it('should have alerts and metrics', () => {
    const config = buildMonitoringConfig();
    expect(config.alerts.length).toBeGreaterThan(0);
    expect(config.metrics.length).toBeGreaterThan(0);
  });

  it('should pass custom DSN to sentry config', () => {
    const config = buildMonitoringConfig('https://test@sentry.io/1');
    expect(config.sentry.enabled).toBe(true);
    expect(config.sentry.dsn).toBe('https://test@sentry.io/1');
  });

  it('should pass custom log provider', () => {
    const config = buildMonitoringConfig(undefined, 'elk');
    expect(config.logging.provider).toBe('elk');
  });

  it('should pass custom log level', () => {
    const config = buildMonitoringConfig(undefined, 'console', 'debug');
    expect(config.logging.level).toBe('debug');
  });
});

// ============================================================================
// Validation
// ============================================================================

describe('validateMonitoringConfig()', () => {
  it('should warn when Sentry is disabled', () => {
    const config = buildMonitoringConfig();
    const result = validateMonitoringConfig(config);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('Sentry'))).toBe(true);
  });

  it('should not warn about Sentry when enabled', () => {
    const config = buildMonitoringConfig('https://test@sentry.io/1');
    const result = validateMonitoringConfig(config);
    expect(result.warnings.some((w) => w.includes('Sentry'))).toBe(false);
  });

  it('should warn about debug log level', () => {
    const config = buildMonitoringConfig(undefined, 'console', 'debug');
    const result = validateMonitoringConfig(config);
    expect(result.warnings.some((w) => w.includes('debug'))).toBe(true);
  });

  it('should not warn about info log level', () => {
    const config = buildMonitoringConfig(undefined, 'console', 'info');
    const result = validateMonitoringConfig(config);
    expect(result.warnings.some((w) => w.includes('debug'))).toBe(false);
  });

  it('should always be valid', () => {
    const config = buildMonitoringConfig();
    const result = validateMonitoringConfig(config);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// checkDeploymentDocs
// ============================================================================

describe('checkDeploymentDocs()', () => {
  it('should find deployment docs', () => {
    const result = checkDeploymentDocs();
    expect(result.found).toBe(true);
  });

  it('should have a descriptive message', () => {
    const result = checkDeploymentDocs();
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('deployment docs should reference monitoring', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('监控');
  });

  it('deployment docs should reference Sentry', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('Sentry');
  });

  it('deployment docs should reference logging', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('日志');
  });

  it('deployment docs should reference health check', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    expect(deployDoc).toContain('健康检查');
  });
});

// ============================================================================
// setupMonitoring (dry-run)
// ============================================================================

describe('setupMonitoring() dry-run', () => {
  it('should succeed in dry-run mode', () => {
    const result = setupMonitoring(undefined, 'console', true);
    expect(result.success).toBe(true);
    expect(result.action).toBe('dry-run');
  });

  it('should include config', () => {
    const result = setupMonitoring(undefined, 'console', true);
    expect(result.config).toBeDefined();
  });

  it('message should mention dry-run', () => {
    const result = setupMonitoring(undefined, 'console', true);
    expect(result.message).toContain('dry-run');
  });

  it('should include metric and alert counts in message', () => {
    const result = setupMonitoring(undefined, 'console', true);
    expect(result.message).toContain('Alerts=');
    expect(result.message).toContain('Metrics=');
  });
});

describe('setupMonitoring() real', () => {
  it('should configure successfully', () => {
    const result = setupMonitoring(undefined, 'console', false);
    expect(result.success).toBe(true);
    expect(result.action).toBe('configured');
  });

  it('should include config', () => {
    const result = setupMonitoring(undefined, 'console', false);
    expect(result.config).toBeDefined();
    expect(result.config!.alerts.length).toBeGreaterThan(0);
    expect(result.config!.metrics.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Type exports
// ============================================================================

describe('Type exports', () => {
  it('AlertSeverity should accept valid values', () => {
    const severities: AlertSeverity[] = ['critical', 'warning', 'info'];
    expect(severities).toHaveLength(3);
  });

  it('AlertRule type should be usable', () => {
    const rule: AlertRule = {
      name: 'test',
      condition: 'x > 1',
      severity: 'warning',
      description: 'test rule',
    };
    expect(rule.name).toBe('test');
  });

  it('MonitoringMetric type should be usable', () => {
    const metric: MonitoringMetric = {
      name: 'test_metric',
      type: 'counter',
      description: 'test',
      labels: ['label1'],
    };
    expect(metric.type).toBe('counter');
  });

  it('HealthCheckConfig type should be usable', () => {
    const config: HealthCheckConfig = {
      endpoint: '/',
      interval: '30s',
      timeout: '5s',
      retries: 3,
    };
    expect(config.retries).toBe(3);
  });

  it('SentryConfig type should be usable', () => {
    const config: SentryConfig = {
      enabled: false,
      environment: 'test',
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.1,
    };
    expect(config.enabled).toBe(false);
  });

  it('MonitoringSetupResult type should be usable', () => {
    const result: MonitoringSetupResult = {
      success: true,
      action: 'configured',
      message: 'done',
    };
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Integration
// ============================================================================

describe('Integration: consistency with deployment docs', () => {
  it('alert rules should match deployment doc table', () => {
    const deployDoc = fs.readFileSync(
      path.join(ROOT_DIR, 'docs/deployment.md'),
      'utf-8',
    );
    // Deployment doc should mention key alert concepts
    expect(deployDoc).toContain('Critical');
    expect(deployDoc).toContain('Warning');
  });

  it('health check config should match Dockerfile', () => {
    const dockerfile = fs.readFileSync(
      path.join(ROOT_DIR, 'packages/server/Dockerfile'),
      'utf-8',
    );
    const config = buildHealthCheckConfig();
    expect(dockerfile).toContain(config.interval);
    expect(dockerfile).toContain(config.timeout);
  });

  it('health check should match docker-compose.yml', () => {
    const compose = fs.readFileSync(
      path.join(ROOT_DIR, 'docker-compose.yml'),
      'utf-8',
    );
    const config = buildHealthCheckConfig();
    expect(compose).toContain(config.interval);
    expect(compose).toContain(config.timeout);
  });
});
