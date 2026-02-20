// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditReport } from './security-scanner.js';

const mockCreate = vi.fn();
const mockChat = vi.fn();

vi.mock('./skill-execution-repository.js', () => ({
  getSkillExecutionRepository: () => ({ create: mockCreate }),
}));
vi.mock('../ai/cloud-provider.js', () => ({
  getCloudAIProvider: () => ({ chat: mockChat }),
}));

const { securityAudit, setCommandRunner } = await import('./security-scanner.js');

describe('security-scanner', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockChat.mockReset();
    mockCreate.mockResolvedValue({ id: 1 });
    setCommandRunner(null);
  });

  describe('securityAudit', () => {
    it('应返回 vulnerabilities、misconfigurations、anomalies', async () => {
      const report: AuditReport = {
        vulnerabilities: [],
        misconfigurations: [
          {
            type: 'ssh',
            issue: 'PermitRootLogin yes',
            severity: 'high',
            remediation: 'Set PermitRootLogin no',
          },
        ],
        anomalies: [],
        autoFixScript: '#!/bin/bash\necho fix',
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'pro',
        commandRunner: async () => 'PermitRootLogin yes',
      });

      expect(result.misconfigurations).toHaveLength(1);
      expect(result.misconfigurations[0].type).toBe('ssh');
      expect(result.misconfigurations[0].issue).toContain('PermitRootLogin');
      expect(result.autoFixScript).toBeDefined();
    });

    it('应检测 SSH PermitRootLogin 配置风险', async () => {
      const report: AuditReport = {
        vulnerabilities: [],
        misconfigurations: [
          {
            type: 'ssh',
            issue: 'PermitRootLogin yes 允许 root 登录',
            severity: 'critical',
            remediation: '在 sshd_config 中设置 PermitRootLogin no',
          },
        ],
        anomalies: [],
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'team',
        commandRunner: async (_, cmd) => (cmd.includes('sshd_config') ? 'PermitRootLogin yes' : ''),
      });

      expect(result.misconfigurations.some((m) => m.issue.includes('PermitRootLogin'))).toBe(true);
    });

    it('应识别过期包与 CVE', async () => {
      const report: AuditReport = {
        vulnerabilities: [
          {
            cve: 'CVE-2024-1234',
            package: 'openssl',
            currentVersion: '1.1.1f',
            fixedVersion: '1.1.1g',
            severity: 'high',
            exploit: '远程代码执行',
          },
        ],
        misconfigurations: [],
        anomalies: [],
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'pro',
        commandRunner: async () => 'openssl 1.1.1f',
      });

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0].cve).toBe('CVE-2024-1234');
      expect(result.vulnerabilities[0].severity).toBe('high');
    });

    it('应识别异常登录', async () => {
      const report: AuditReport = {
        vulnerabilities: [],
        misconfigurations: [],
        anomalies: [
          { type: 'login', evidence: 'midnight root pts/0', risk: '异常时间登录' },
        ],
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        commandRunner: async () => 'last -n 100',
      });

      expect(result.anomalies.some((a) => a.type === 'login')).toBe(true);
    });

    it('Enterprise 时应包含 compliance 结果', async () => {
      const report: AuditReport = {
        vulnerabilities: [],
        misconfigurations: [],
        anomalies: [],
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'enterprise',
        enterprise: true,
        commandRunner: async () => 'ok',
      });

      expect(result.compliance).toBeDefined();
      expect(Array.isArray(result.compliance)).toBe(true);
      expect(result.compliance!.length).toBeGreaterThan(0);
      expect(result.compliance!.every((c) => ['standard', 'passed', 'findings'].every((k) => k in c))).toBe(true);
    });

    it('非 Enterprise 时不应包含 compliance', async () => {
      const report: AuditReport = {
        vulnerabilities: [],
        misconfigurations: [],
        anomalies: [],
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'pro',
        enterprise: false,
        commandRunner: async () => 'ok',
      });

      expect(result.compliance).toBeUndefined();
    });

    it('enterprise 未传时默认不做合规检查', async () => {
      const report: AuditReport = { vulnerabilities: [], misconfigurations: [], anomalies: [] };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'pro',
        commandRunner: async () => 'ok',
      });

      expect(result.compliance).toBeUndefined();
    });

    it('AI 返回非 JSON 时应降级为兜底 report', async () => {
      mockChat.mockResolvedValue({ content: 'not json' });

      const result = await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        commandRunner: async () => 'data',
      });

      expect(result.vulnerabilities).toEqual([]);
      expect(result.misconfigurations).toEqual([]);
      expect(result.anomalies).toEqual([]);
    });

    it('AI 抛错时应写入 failed 记录并重新抛出', async () => {
      mockChat.mockRejectedValue(new Error('Quota exceeded'));

      await expect(
        securityAudit('srv-1', {
          userId: 'u1',
          tenantId: 't1',
          userPlan: 'free',
          commandRunner: async () => 'data',
        }),
      ).rejects.toThrow('Quota exceeded');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: 'security-audit',
          status: 'failed',
          report: expect.objectContaining({ error: expect.any(String) }),
        }),
      );
    });

    it('应并行执行多条命令并合并输出', async () => {
      const report: AuditReport = { vulnerabilities: [], misconfigurations: [], anomalies: [] };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });
      const runCalls: string[] = [];
      const runner = async (_s: string, cmd: string) => {
        runCalls.push(cmd);
        return 'out';
      };

      await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'pro',
        commandRunner: runner,
      });

      expect(runCalls.length).toBeGreaterThanOrEqual(5);
      expect(runCalls.some((c) => c.includes('ssh'))).toBe(true);
      expect(runCalls.some((c) => c.includes('apt') || c.includes('dpkg'))).toBe(true);
    });

    it('成功时应写入 success 记录并包含 duration', async () => {
      const report: AuditReport = { vulnerabilities: [], misconfigurations: [], anomalies: [] };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        commandRunner: async () => 'ok',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          serverId: 'srv-1',
          duration: expect.any(Number),
        }),
      );
    });

    it('不传 commandRunner 时使用默认占位', async () => {
      const report: AuditReport = { vulnerabilities: [], misconfigurations: [], anomalies: [] };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });
      setCommandRunner(null);

      const result = await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
      });

      expect(mockChat).toHaveBeenCalled();
      expect(result.vulnerabilities).toEqual([]);
    });

    it('应请求 forceOpus（通过 chat 上下文）', async () => {
      const report: AuditReport = { vulnerabilities: [], misconfigurations: [], anomalies: [] };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      await securityAudit('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'enterprise',
        commandRunner: async () => 'ok',
      });

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          userId: 'u1',
          tenantId: 't1',
          userPlan: 'enterprise',
          forceOpus: true,
        }),
      );
    });
  });
});
