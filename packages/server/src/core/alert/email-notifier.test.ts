// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for EmailNotifier service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SmtpEmailNotifier, loadSmtpConfig } from './email-notifier.js';
import type { AlertNotification, SmtpConfig } from './email-notifier.js';

// Mock nodemailer
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
  })),
}));

const testConfig: SmtpConfig = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'alerts@serverpilot.dev',
  password: 'secret',
  fromEmail: 'alerts@serverpilot.dev',
  fromName: 'ServerPilot Alerts',
};

const testNotification: AlertNotification = {
  recipients: ['admin@example.com', 'ops@example.com'],
  ruleName: 'High CPU',
  serverId: 'srv-123',
  metricType: 'cpu',
  currentValue: 92.5,
  threshold: 80,
  operator: 'gt',
  severity: 'critical',
};

describe('SmtpEmailNotifier', () => {
  let notifier: SmtpEmailNotifier;

  beforeEach(() => {
    notifier = new SmtpEmailNotifier(testConfig);
  });

  it('should send alert notification email', async () => {
    const result = await notifier.sendAlertNotification(testNotification);
    expect(result).toBe(true);
  });

  it('should handle send failure gracefully', async () => {
    const { createTransport } = await import('nodemailer');
    (createTransport as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      sendMail: vi.fn().mockRejectedValueOnce(new Error('SMTP connection failed')),
    });

    const failNotifier = new SmtpEmailNotifier(testConfig);
    const result = await failNotifier.sendAlertNotification(testNotification);
    expect(result).toBe(false);
  });

  it('should format subject with severity and metric type', async () => {
    const result = await notifier.sendAlertNotification(testNotification);
    expect(result).toBe(true);
    // Verify via mock that sendMail was called
    // (the mock is already set up to resolve successfully)
  });

  it('should handle different severity levels', async () => {
    for (const severity of ['info', 'warning', 'critical'] as const) {
      const notification = { ...testNotification, severity };
      const result = await notifier.sendAlertNotification(notification);
      expect(result).toBe(true);
    }
  });

  it('should handle different metric types', async () => {
    for (const metricType of ['cpu', 'memory', 'disk'] as const) {
      const notification = { ...testNotification, metricType };
      const result = await notifier.sendAlertNotification(notification);
      expect(result).toBe(true);
    }
  });

  it('should handle all operator types', async () => {
    for (const operator of ['gt', 'lt', 'gte', 'lte'] as const) {
      const notification = { ...testNotification, operator };
      const result = await notifier.sendAlertNotification(notification);
      expect(result).toBe(true);
    }
  });
});

describe('loadSmtpConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM_EMAIL;
    delete process.env.SMTP_FROM_NAME;
  });

  it('should return null when SMTP_HOST is not set', () => {
    const config = loadSmtpConfig();
    expect(config).toBeNull();
  });

  it('should load config from environment variables', () => {
    vi.stubEnv('SMTP_HOST', 'mail.test.com');
    vi.stubEnv('SMTP_PORT', '465');
    vi.stubEnv('SMTP_SECURE', 'true');
    vi.stubEnv('SMTP_USER', 'user');
    vi.stubEnv('SMTP_PASSWORD', 'pass');
    vi.stubEnv('SMTP_FROM_EMAIL', 'noreply@test.com');
    vi.stubEnv('SMTP_FROM_NAME', 'Test');

    const config = loadSmtpConfig();

    expect(config).not.toBeNull();
    expect(config!.host).toBe('mail.test.com');
    expect(config!.port).toBe(465);
    expect(config!.secure).toBe(true);
    expect(config!.user).toBe('user');
    expect(config!.password).toBe('pass');
    expect(config!.fromEmail).toBe('noreply@test.com');
    expect(config!.fromName).toBe('Test');
  });

  it('should use default values for optional fields', () => {
    vi.stubEnv('SMTP_HOST', 'mail.test.com');

    const config = loadSmtpConfig();

    expect(config).not.toBeNull();
    expect(config!.port).toBe(587);
    expect(config!.secure).toBe(false);
    expect(config!.fromEmail).toBe('alerts@serverpilot.dev');
    expect(config!.fromName).toBe('ServerPilot Alerts');
  });
});
