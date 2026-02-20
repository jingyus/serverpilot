// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScanReport } from './log-scanner.js';

// 顶层 mock，供 log-scanner 加载时使用
const mockCreate = vi.fn();
const mockChat = vi.fn();

vi.mock('./skill-execution-repository.js', () => ({
  getSkillExecutionRepository: () => ({ create: mockCreate }),
}));
vi.mock('../ai/cloud-provider.js', () => ({
  getCloudAIProvider: () => ({ chat: mockChat }),
}));

const {
  scanLogs,
  enableAutoScan,
  disableAutoScan,
  getAutoScanServerIds,
  runScheduledScans,
  setLogFetcher,
} = await import('./log-scanner.js');

describe('log-scanner', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockChat.mockReset();
    mockCreate.mockResolvedValue({ id: 1 });
    setLogFetcher(null);
  });

  afterEach(() => {
    disableAutoScan('srv-1');
    disableAutoScan('srv-2');
  });

  describe('scanLogs', () => {
    it('正常日志应返回 healthScore 与 issues', async () => {
      const report: ScanReport = {
        issues: [
          {
            category: 'performance',
            severity: 'medium',
            summary: '高 CPU',
            evidence: ['cpu 90%'],
            impact: '响应变慢',
            recommendation: '扩容',
          },
        ],
        trends: ['CPU 呈上升趋势'],
        healthScore: 75,
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'pro',
        logFetcher: async () => 'error something',
      });

      expect(result.healthScore).toBe(75);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].category).toBe('performance');
      expect(result.issues[0].severity).toBe('medium');
      expect(result.trends).toContain('CPU 呈上升趋势');
    });

    it('安全类问题应被识别', async () => {
      const report: ScanReport = {
        issues: [
          {
            category: 'security',
            severity: 'high',
            summary: '多次登录失败',
            evidence: ['Failed password for root'],
            impact: '可能暴力破解',
            recommendation: '限制尝试次数',
          },
        ],
        trends: [],
        healthScore: 40,
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        logFetcher: async () => 'Failed password for root',
      });

      expect(result.issues.some((i) => i.category === 'security' && i.severity === 'high')).toBe(true);
      expect(result.healthScore).toBe(40);
    });

    it('high/critical 应触发告警并写入 skill_executions', async () => {
      const report: ScanReport = {
        issues: [
          {
            category: 'config',
            severity: 'critical',
            summary: '服务启动失败',
            evidence: ['Address already in use'],
            impact: '服务不可用',
            recommendation: '更换端口或停止占用进程',
          },
        ],
        trends: [],
        healthScore: 20,
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'team',
        logFetcher: async () => 'log',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: 'log-scanner',
          status: 'success',
          serverId: 'srv-1',
          report: expect.objectContaining({ issues: report.issues, healthScore: 20 }),
        }),
      );
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('空日志应返回空 issues 与合理 healthScore', async () => {
      const report: ScanReport = { issues: [], trends: [], healthScore: 100 };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        logFetcher: async () => '',
      });

      expect(result.issues).toHaveLength(0);
      expect(result.healthScore).toBe(100);
    });

    it('AI 返回非 JSON 时应降级为兜底 report', async () => {
      mockChat.mockResolvedValue({ content: 'not json at all' });

      const result = await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'pro',
        logFetcher: async () => 'log',
      });

      expect(result.issues).toHaveLength(0);
      expect(result.healthScore).toBe(0);
      expect(result.trends).toEqual([]);
    });

    it('AI 返回被 markdown 包裹的 JSON 时应正确解析', async () => {
      const report: ScanReport = { issues: [], trends: [], healthScore: 80 };
      mockChat.mockResolvedValue({ content: '```json\n' + JSON.stringify(report) + '\n```' });

      const result = await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        logFetcher: async () => 'log',
      });

      expect(result.healthScore).toBe(80);
    });

    it('AI 抛错时应写入 failed 记录并重新抛出', async () => {
      mockChat.mockRejectedValue(new Error('Quota exceeded'));

      await expect(
        scanLogs('srv-1', {
          userId: 'u1',
          tenantId: 't1',
          userPlan: 'free',
          logFetcher: async () => 'log',
        }),
      ).rejects.toThrow('Quota exceeded');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: 'log-scanner',
          status: 'failed',
          report: expect.objectContaining({ error: expect.any(String) }),
        }),
      );
    });

    it('不传 logFetcher 时使用默认（未配置则占位内容）', async () => {
      const report: ScanReport = { issues: [], trends: [], healthScore: 50 };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });
      setLogFetcher(null);

      const result = await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
      });

      expect(mockChat).toHaveBeenCalled();
      expect(result.healthScore).toBe(50);
    });

    it('四类问题 category 均应支持', async () => {
      const report: ScanReport = {
        issues: [
          { category: 'performance', severity: 'low', summary: 'p', evidence: [], impact: '', recommendation: '' },
          { category: 'security', severity: 'low', summary: 's', evidence: [], impact: '', recommendation: '' },
          { category: 'config', severity: 'low', summary: 'c', evidence: [], impact: '', recommendation: '' },
          { category: 'capacity', severity: 'low', summary: 'c', evidence: [], impact: '', recommendation: '' },
        ],
        trends: [],
        healthScore: 60,
      };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'pro',
        logFetcher: async () => 'log',
      });

      const cats = result.issues.map((i) => i.category);
      expect(cats).toContain('performance');
      expect(cats).toContain('security');
      expect(cats).toContain('config');
      expect(cats).toContain('capacity');
    });

    it('healthScore 超出 0-100 时应被裁剪为 100', async () => {
      const report: ScanReport = { issues: [], trends: [], healthScore: 150 };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        logFetcher: async () => 'log',
      });

      expect(result.healthScore).toBe(100);
    });

    it('healthScore 为负数时应被裁剪为 0', async () => {
      const report: ScanReport = { issues: [], trends: [], healthScore: -10 };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      const result = await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        logFetcher: async () => 'log',
      });

      expect(result.healthScore).toBe(0);
    });

    it('执行成功应写入 success 记录并包含 duration', async () => {
      const report: ScanReport = { issues: [], trends: [], healthScore: 90 };
      mockChat.mockResolvedValue({ content: JSON.stringify(report) });

      await scanLogs('srv-1', {
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        logFetcher: async () => 'log',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          duration: expect.any(Number),
        }),
      );
    });
  });

  describe('enableAutoScan / disableAutoScan / getAutoScanServerIds', () => {
    it('enable 后 getAutoScanServerIds 应包含该 server', () => {
      expect(getAutoScanServerIds()).toEqual([]);
      enableAutoScan('srv-1');
      expect(getAutoScanServerIds()).toContain('srv-1');
      enableAutoScan('srv-2');
      expect(getAutoScanServerIds()).toContain('srv-2');
      disableAutoScan('srv-1');
      expect(getAutoScanServerIds()).not.toContain('srv-1');
      expect(getAutoScanServerIds()).toContain('srv-2');
    });
  });

  describe('runScheduledScans', () => {
    it('应对所有已 enable 的 server 各调用一次 scanLogs', async () => {
      enableAutoScan('srv-1');
      enableAutoScan('srv-2');
      mockChat
        .mockResolvedValueOnce({ content: JSON.stringify({ issues: [], trends: [], healthScore: 90 }) })
        .mockResolvedValueOnce({ content: JSON.stringify({ issues: [], trends: [], healthScore: 80 }) });

      await runScheduledScans((serverId) => ({
        userId: 'u1',
        tenantId: 't1',
        userPlan: 'free',
        logFetcher: async () => `logs-${serverId}`,
      }));

      expect(mockChat).toHaveBeenCalledTimes(2);
    });
  });
});
