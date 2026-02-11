// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Email Notifier — sends alert notifications via SMTP.
 *
 * Uses nodemailer to deliver threshold-breach notifications
 * to configured email recipients. Supports configurable SMTP
 * settings via environment variables.
 *
 * @module core/alert/email-notifier
 */

import { createTransport, type Transporter } from 'nodemailer';
import { createContextLogger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

export interface AlertNotification {
  recipients: string[];
  ruleName: string;
  serverId: string;
  metricType: string;
  currentValue: number;
  threshold: number;
  operator: string;
  severity: string;
}

export interface EmailNotifier {
  sendAlertNotification(notification: AlertNotification): Promise<boolean>;
}

// ============================================================================
// SMTP Email Notifier
// ============================================================================

export class SmtpEmailNotifier implements EmailNotifier {
  private transporter: Transporter;
  private readonly config: SmtpConfig;
  private readonly logger = createContextLogger({ module: 'email-notifier' });

  constructor(config: SmtpConfig) {
    this.config = config;
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });
  }

  async sendAlertNotification(notification: AlertNotification): Promise<boolean> {
    const subject = this.buildSubject(notification);
    const html = this.buildHtml(notification);

    try {
      await this.transporter.sendMail({
        from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
        to: notification.recipients.join(', '),
        subject,
        html,
      });

      this.logger.info(
        {
          recipients: notification.recipients,
          ruleName: notification.ruleName,
          serverId: notification.serverId,
        },
        'Alert email sent',
      );

      return true;
    } catch (err) {
      this.logger.error(
        {
          error: err instanceof Error ? err.message : String(err),
          recipients: notification.recipients,
          ruleName: notification.ruleName,
        },
        'Failed to send alert email',
      );
      return false;
    }
  }

  private buildSubject(notification: AlertNotification): string {
    const severityTag = `[${notification.severity.toUpperCase()}]`;
    const metricLabel = {
      cpu: 'CPU',
      memory: 'Memory',
      disk: 'Disk',
    }[notification.metricType] ?? notification.metricType;

    return `${severityTag} ServerPilot Alert: ${metricLabel} threshold breached — ${notification.ruleName}`;
  }

  private buildHtml(notification: AlertNotification): string {
    const opLabel = { gt: '>', lt: '<', gte: '>=', lte: '<=' }[notification.operator] ?? '>';
    const metricLabel = {
      cpu: 'CPU Usage',
      memory: 'Memory Usage',
      disk: 'Disk Usage',
    }[notification.metricType] ?? notification.metricType;

    const severityColor = {
      critical: '#dc2626',
      warning: '#f59e0b',
      info: '#3b82f6',
    }[notification.severity] ?? '#6b7280';

    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${severityColor}; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0; font-size: 18px;">ServerPilot Alert</h2>
          <p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">${notification.severity.toUpperCase()} — ${notification.ruleName}</p>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; width: 140px;">Server ID</td>
              <td style="padding: 8px 0; font-family: monospace;">${notification.serverId}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Metric</td>
              <td style="padding: 8px 0;">${metricLabel}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Current Value</td>
              <td style="padding: 8px 0; font-weight: 600; color: ${severityColor};">${notification.currentValue.toFixed(1)}%</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Threshold</td>
              <td style="padding: 8px 0;">${opLabel} ${notification.threshold}%</td>
            </tr>
          </table>
          <p style="margin: 20px 0 0; font-size: 12px; color: #9ca3af;">
            This alert was generated by ServerPilot monitoring system.
          </p>
        </div>
      </div>
    `;
  }
}

// ============================================================================
// Factory
// ============================================================================

/** Load SMTP config from environment variables. Returns null if not configured. */
export function loadSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  return {
    host,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    fromEmail: process.env.SMTP_FROM_EMAIL ?? 'alerts@serverpilot.dev',
    fromName: process.env.SMTP_FROM_NAME ?? 'ServerPilot Alerts',
  };
}

/** Create an EmailNotifier from environment config. Returns null if SMTP is not configured. */
export function createEmailNotifier(): EmailNotifier | null {
  const config = loadSmtpConfig();
  if (!config) return null;
  return new SmtpEmailNotifier(config);
}
