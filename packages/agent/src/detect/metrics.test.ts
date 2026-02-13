// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/* eslint-disable @typescript-eslint/no-explicit-any -- mock type coercion in tests */
import os from 'node:os';
import { exec } from 'node:child_process';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

vi.mock('node:os', () => ({
  default: {
    cpus: vi.fn(() => [
      { times: { user: 100, nice: 0, sys: 50, idle: 800, irq: 0 } },
      { times: { user: 120, nice: 0, sys: 60, idle: 750, irq: 0 } },
    ]),
    totalmem: vi.fn(() => 16 * 1024 * 1024 * 1024), // 16 GB
    freemem: vi.fn(() => 8 * 1024 * 1024 * 1024), // 8 GB
    platform: vi.fn(() => 'linux'),
  },
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: vi.fn((fn: (...args: any[]) => any) => fn),
}));

const mockExec = vi.mocked(exec);
const mockCpus = vi.mocked(os.cpus);
const _mockTotalmem = vi.mocked(os.totalmem);
const mockFreemem = vi.mocked(os.freemem);
const mockPlatform = vi.mocked(os.platform);

// ============================================================================
// Helpers
// ============================================================================

// Standard df -k / output (linux/darwin) — columns: Filesystem, 1K-blocks, Used, Available, Use%, Mounted on
const LINUX_DF_OUTPUT = [
  'Filesystem     1K-blocks     Used Available Use% Mounted on',
  '/dev/sda1      500000000 200000000 300000000  40% /',
].join('\n');

// /proc/net/dev output (linux)
const LINUX_PROC_NET_DEV = [
  'Inter-|   Receive                                                |  Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
  '    lo: 1000000  10000    0    0    0     0          0         0  1000000  10000    0    0    0     0       0          0',
  '  eth0: 5000000  50000    0    0    0     0          0         0  3000000  30000    0    0    0     0       0          0',
  'wlan0:  2000000  20000    0    0    0     0          0         0  1000000  10000    0    0    0     0       0          0',
].join('\n');

// Second reading with increased values for delta calculation
const LINUX_PROC_NET_DEV_SECOND = [
  'Inter-|   Receive                                                |  Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
  '    lo: 1100000  11000    0    0    0     0          0         0  1100000  11000    0    0    0     0       0          0',
  '  eth0: 6000000  60000    0    0    0     0          0         0  4000000  40000    0    0    0     0       0          0',
  'wlan0:  2500000  25000    0    0    0     0          0         0  1500000  15000    0    0    0     0       0          0',
].join('\n');

// Darwin netstat -ibn output
const DARWIN_NETSTAT_OUTPUT = [
  'Name  Mtu   Network       Address            Ipkts Ierrs Ibytes    Opkts Oerrs Obytes    Coll',
  'lo0   16384 <Link#1>                          5000  0     500000    5000  0     500000    0',
  'en0   1500  <Link#4>      aa:bb:cc:dd:ee:ff   40000 0     4000000   30000 0     2000000   0',
  'en1   1500  <Link#5>      *                   0     0     0         0     0     0         0',
].join('\n');

function setupExecMock(dfOutput: string, netOutput: string) {
  mockExec.mockImplementation((cmd: any) => {
    if (typeof cmd === 'string' && cmd.includes('df -k')) {
      return Promise.resolve({ stdout: dfOutput, stderr: '' }) as any;
    }
    if (typeof cmd === 'string' && cmd.includes('/proc/net/dev')) {
      return Promise.resolve({ stdout: netOutput, stderr: '' }) as any;
    }
    if (typeof cmd === 'string' && cmd.includes('netstat -ibn')) {
      return Promise.resolve({ stdout: netOutput, stderr: '' }) as any;
    }
    if (typeof cmd === 'string' && cmd.includes('wmic')) {
      return Promise.resolve({
        stdout: 'Node,FreeSpace,Size\nPC,100000000000,500000000000\n',
        stderr: '',
      }) as any;
    }
    return Promise.reject(new Error(`Unexpected command: ${cmd}`)) as any;
  });
}

// ============================================================================
// Tests — collectMetrics() shape and types
// ============================================================================

describe('collectMetrics', () => {
  // Because the module has module-level mutable state (previousCpuInfo,
  // previousNetStats), we reset modules before each describe block to get
  // a clean slate. We dynamically import collectMetrics after reset.

  describe('returns correct SystemMetrics shape', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.restoreAllMocks();
    });

    it('returns an object with all SystemMetrics fields', async () => {
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(metrics).toHaveProperty('cpuUsage');
      expect(metrics).toHaveProperty('memoryUsage');
      expect(metrics).toHaveProperty('memoryTotal');
      expect(metrics).toHaveProperty('diskUsage');
      expect(metrics).toHaveProperty('diskTotal');
      expect(metrics).toHaveProperty('networkIn');
      expect(metrics).toHaveProperty('networkOut');
    });

    it('returns numeric values for all fields', async () => {
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(typeof metrics.cpuUsage).toBe('number');
      expect(typeof metrics.memoryUsage).toBe('number');
      expect(typeof metrics.memoryTotal).toBe('number');
      expect(typeof metrics.diskUsage).toBe('number');
      expect(typeof metrics.diskTotal).toBe('number');
      expect(typeof metrics.networkIn).toBe('number');
      expect(typeof metrics.networkOut).toBe('number');
    });

    it('returns no NaN values', async () => {
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(Number.isNaN(metrics.cpuUsage)).toBe(false);
      expect(Number.isNaN(metrics.memoryUsage)).toBe(false);
      expect(Number.isNaN(metrics.memoryTotal)).toBe(false);
      expect(Number.isNaN(metrics.diskUsage)).toBe(false);
      expect(Number.isNaN(metrics.diskTotal)).toBe(false);
      expect(Number.isNaN(metrics.networkIn)).toBe(false);
      expect(Number.isNaN(metrics.networkOut)).toBe(false);
    });
  });

  // ============================================================================
  // CPU Usage
  // ============================================================================

  describe('CPU usage', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.restoreAllMocks();
    });

    it('returns cpuUsage 0 on first call (no delta baseline)', async () => {
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(metrics.cpuUsage).toBe(0);
    });

    it('returns non-zero cpuUsage on second call with changed CPU times', async () => {
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      // First call — establishes baseline
      await collectMetrics();

      // Change CPU times for the second call (more user/sys, same idle)
      mockCpus.mockReturnValueOnce([
        { times: { user: 200, nice: 0, sys: 100, idle: 850, irq: 0 } },
        { times: { user: 220, nice: 0, sys: 110, idle: 800, irq: 0 } },
      ] as any);

      const metrics2 = await collectMetrics();

      // idle delta: (850+800) - (800+750) = 1650 - 1550 = 100
      // total delta: (200+0+100+850+0 + 220+0+110+800+0) - (100+0+50+800+0 + 120+0+60+750+0)
      //            = 2280 - 1880 = 400
      // usage = 100 - (100 * 100 / 400) = 100 - 25 = 75
      expect(metrics2.cpuUsage).toBe(75);
    });

    it('clamps cpuUsage between 0 and 100', async () => {
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      // First call — baseline
      await collectMetrics();

      // Second call — 100% CPU (no idle increase at all, lots of user increase)
      mockCpus.mockReturnValueOnce([
        { times: { user: 1000, nice: 0, sys: 500, idle: 800, irq: 0 } },
        { times: { user: 1200, nice: 0, sys: 600, idle: 750, irq: 0 } },
      ] as any);

      const metrics2 = await collectMetrics();

      expect(metrics2.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(metrics2.cpuUsage).toBeLessThanOrEqual(100);
    });
  });

  // ============================================================================
  // Memory Usage
  // ============================================================================

  describe('memory usage', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.restoreAllMocks();
    });

    it('memoryUsage equals totalmem - freemem', async () => {
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();
      const expected = 16 * 1024 * 1024 * 1024 - 8 * 1024 * 1024 * 1024; // 8 GB

      expect(metrics.memoryUsage).toBe(expected);
    });

    it('memoryTotal matches os.totalmem()', async () => {
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(metrics.memoryTotal).toBe(16 * 1024 * 1024 * 1024);
    });

    it('adjusts when freemem changes', async () => {
      mockFreemem.mockReturnValue(4 * 1024 * 1024 * 1024 as any); // 4 GB free
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(metrics.memoryUsage).toBe(12 * 1024 * 1024 * 1024); // 16 - 4 = 12 GB
      expect(metrics.memoryTotal).toBe(16 * 1024 * 1024 * 1024);
    });
  });

  // ============================================================================
  // Disk Usage
  // ============================================================================

  describe('disk usage', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.restoreAllMocks();
    });

    it('parses diskUsage and diskTotal from df output (linux)', async () => {
      mockPlatform.mockReturnValue('linux' as any);
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      // df shows: 500000000 1K-blocks total, 200000000 used
      expect(metrics.diskTotal).toBe(500000000 * 1024);
      expect(metrics.diskUsage).toBe(200000000 * 1024);
    });

    it('parses diskUsage and diskTotal from df output (darwin)', async () => {
      mockPlatform.mockReturnValue('darwin' as any);
      setupExecMock(LINUX_DF_OUTPUT, DARWIN_NETSTAT_OUTPUT);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      // df is the same for linux/darwin in our mock
      expect(metrics.diskTotal).toBe(500000000 * 1024);
      expect(metrics.diskUsage).toBe(200000000 * 1024);
    });

    it('parses disk from wmic output on win32', async () => {
      mockPlatform.mockReturnValue('win32' as any);
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      // wmic mock: freeSpace=100000000000, size=500000000000
      expect(metrics.diskTotal).toBe(500000000000);
      expect(metrics.diskUsage).toBe(500000000000 - 100000000000);
    });

    it('falls back to { diskUsage: 0, diskTotal: 1 } on df error', async () => {
      mockPlatform.mockReturnValue('linux' as any);
      mockExec.mockImplementation((cmd: any) => {
        if (typeof cmd === 'string' && cmd.includes('df -k')) {
          return Promise.reject(new Error('df command failed')) as any;
        }
        if (typeof cmd === 'string' && cmd.includes('/proc/net/dev')) {
          return Promise.resolve({ stdout: LINUX_PROC_NET_DEV, stderr: '' }) as any;
        }
        return Promise.reject(new Error(`Unexpected command: ${cmd}`)) as any;
      });

      // Suppress console.warn from the error path
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(metrics.diskUsage).toBe(0);
      expect(metrics.diskTotal).toBe(1);
      warnSpy.mockRestore();
    });

    it('falls back to { diskUsage: 0, diskTotal: 1 } on malformed df output', async () => {
      mockPlatform.mockReturnValue('linux' as any);
      mockExec.mockImplementation((cmd: any) => {
        if (typeof cmd === 'string' && cmd.includes('df -k')) {
          // Only a single header line, no data line
          return Promise.resolve({ stdout: 'Filesystem 1K-blocks Used', stderr: '' }) as any;
        }
        if (typeof cmd === 'string' && cmd.includes('/proc/net/dev')) {
          return Promise.resolve({ stdout: LINUX_PROC_NET_DEV, stderr: '' }) as any;
        }
        return Promise.reject(new Error(`Unexpected command: ${cmd}`)) as any;
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(metrics.diskUsage).toBe(0);
      expect(metrics.diskTotal).toBe(1);
      warnSpy.mockRestore();
    });

    it('falls back on unsupported platform', async () => {
      mockPlatform.mockReturnValue('freebsd' as any);
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      // Neither linux/darwin/win32 branch, so fallback
      expect(metrics.diskUsage).toBe(0);
      expect(metrics.diskTotal).toBe(1);
    });
  });

  // ============================================================================
  // Network Usage
  // ============================================================================

  describe('network usage', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.restoreAllMocks();
    });

    it('returns networkIn and networkOut as 0 on first call (no delta baseline)', async () => {
      mockPlatform.mockReturnValue('linux' as any);
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(metrics.networkIn).toBe(0);
      expect(metrics.networkOut).toBe(0);
    });

    it('returns non-zero network values on second call (linux)', async () => {
      vi.useFakeTimers({ now: 1000000 });
      mockPlatform.mockReturnValue('linux' as any);

      let callCount = 0;
      mockExec.mockImplementation((cmd: any) => {
        if (typeof cmd === 'string' && cmd.includes('df -k')) {
          return Promise.resolve({ stdout: LINUX_DF_OUTPUT, stderr: '' }) as any;
        }
        if (typeof cmd === 'string' && cmd.includes('/proc/net/dev')) {
          callCount++;
          const output = callCount <= 1 ? LINUX_PROC_NET_DEV : LINUX_PROC_NET_DEV_SECOND;
          return Promise.resolve({ stdout: output, stderr: '' }) as any;
        }
        return Promise.reject(new Error(`Unexpected command: ${cmd}`)) as any;
      });

      const { collectMetrics } = await import('./metrics.js');

      // First call — establishes baseline
      const metrics1 = await collectMetrics();
      expect(metrics1.networkIn).toBe(0);
      expect(metrics1.networkOut).toBe(0);

      // Advance time by 1 second so timeDelta is non-zero
      vi.advanceTimersByTime(1000);

      // Second call — should show delta
      const metrics2 = await collectMetrics();

      // rx delta: (6000000+2500000) - (5000000+2000000) = 8500000 - 7000000 = 1500000
      // tx delta: (4000000+1500000) - (3000000+1000000) = 5500000 - 4000000 = 1500000
      // timeDelta = 1 second, so bytes/s = 1500000
      expect(metrics2.networkIn).toBe(1500000);
      expect(metrics2.networkOut).toBe(1500000);

      vi.useRealTimers();
    });

    it('skips loopback interface on linux', async () => {
      mockPlatform.mockReturnValue('linux' as any);

      // Only loopback in /proc/net/dev
      const loopbackOnlyOutput = [
        'Inter-|   Receive                                                |  Transmit',
        ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
        '    lo: 9999999  99999    0    0    0     0          0         0  9999999  99999    0    0    0     0       0          0',
      ].join('\n');

      let _callCount = 0;
      mockExec.mockImplementation((cmd: any) => {
        if (typeof cmd === 'string' && cmd.includes('df -k')) {
          return Promise.resolve({ stdout: LINUX_DF_OUTPUT, stderr: '' }) as any;
        }
        if (typeof cmd === 'string' && cmd.includes('/proc/net/dev')) {
          _callCount++;
          return Promise.resolve({ stdout: loopbackOnlyOutput, stderr: '' }) as any;
        }
        return Promise.reject(new Error(`Unexpected command: ${cmd}`)) as any;
      });

      const { collectMetrics } = await import('./metrics.js');

      // First call — baseline (rx=0, tx=0 since lo is skipped)
      await collectMetrics();

      // Second call — still 0 because only lo exists
      const metrics2 = await collectMetrics();
      expect(metrics2.networkIn).toBe(0);
      expect(metrics2.networkOut).toBe(0);
    });

    it('parses darwin netstat -ibn output and skips lo0 and inactive interfaces', async () => {
      mockPlatform.mockReturnValue('darwin' as any);
      setupExecMock(LINUX_DF_OUTPUT, DARWIN_NETSTAT_OUTPUT);
      const { collectMetrics } = await import('./metrics.js');

      // First call — baseline
      const metrics = await collectMetrics();

      // Should return 0 on first call
      expect(metrics.networkIn).toBe(0);
      expect(metrics.networkOut).toBe(0);
    });

    it('falls back to { networkIn: 0, networkOut: 0 } on network command error', async () => {
      mockPlatform.mockReturnValue('linux' as any);
      mockExec.mockImplementation((cmd: any) => {
        if (typeof cmd === 'string' && cmd.includes('df -k')) {
          return Promise.resolve({ stdout: LINUX_DF_OUTPUT, stderr: '' }) as any;
        }
        if (typeof cmd === 'string' && cmd.includes('/proc/net/dev')) {
          return Promise.reject(new Error('Cannot read /proc/net/dev')) as any;
        }
        return Promise.reject(new Error(`Unexpected command: ${cmd}`)) as any;
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { collectMetrics } = await import('./metrics.js');

      const metrics = await collectMetrics();

      expect(metrics.networkIn).toBe(0);
      expect(metrics.networkOut).toBe(0);
      warnSpy.mockRestore();
    });

    it('returns 0 for network on unsupported platform', async () => {
      mockPlatform.mockReturnValue('freebsd' as any);
      setupExecMock(LINUX_DF_OUTPUT, LINUX_PROC_NET_DEV);
      const { collectMetrics } = await import('./metrics.js');

      // First call — no platform match, so rx=0, tx=0, stores baseline
      await collectMetrics();

      // Second call — still 0 since rx and tx never change
      const metrics2 = await collectMetrics();
      expect(metrics2.networkIn).toBe(0);
      expect(metrics2.networkOut).toBe(0);
    });
  });

  // ============================================================================
  // Combined second-call behavior (all deltas)
  // ============================================================================

  describe('second call returns non-zero delta values', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.restoreAllMocks();
    });

    it('returns non-zero cpu and network on second call', async () => {
      vi.useFakeTimers({ now: 1000000 });
      mockPlatform.mockReturnValue('linux' as any);

      let netCallCount = 0;
      mockExec.mockImplementation((cmd: any) => {
        if (typeof cmd === 'string' && cmd.includes('df -k')) {
          return Promise.resolve({ stdout: LINUX_DF_OUTPUT, stderr: '' }) as any;
        }
        if (typeof cmd === 'string' && cmd.includes('/proc/net/dev')) {
          netCallCount++;
          const output = netCallCount <= 1 ? LINUX_PROC_NET_DEV : LINUX_PROC_NET_DEV_SECOND;
          return Promise.resolve({ stdout: output, stderr: '' }) as any;
        }
        return Promise.reject(new Error(`Unexpected command: ${cmd}`)) as any;
      });

      const { collectMetrics } = await import('./metrics.js');

      // First call — baselines established
      const first = await collectMetrics();
      expect(first.cpuUsage).toBe(0);
      expect(first.networkIn).toBe(0);
      expect(first.networkOut).toBe(0);

      // Advance time by 1 second so timeDelta is non-zero
      vi.advanceTimersByTime(1000);

      // Update CPU mock for second call
      mockCpus.mockReturnValueOnce([
        { times: { user: 300, nice: 0, sys: 150, idle: 900, irq: 0 } },
        { times: { user: 320, nice: 0, sys: 160, idle: 850, irq: 0 } },
      ] as any);

      const second = await collectMetrics();

      // CPU should be non-zero since times changed
      expect(second.cpuUsage).toBeGreaterThan(0);
      expect(second.cpuUsage).toBeLessThanOrEqual(100);

      // Network should be non-zero since bytes changed
      expect(second.networkIn).toBeGreaterThan(0);
      expect(second.networkOut).toBeGreaterThan(0);

      // Memory and disk are not delta-based, they should remain correct
      expect(second.memoryUsage).toBe(16 * 1024 * 1024 * 1024 - 8 * 1024 * 1024 * 1024);
      expect(second.memoryTotal).toBe(16 * 1024 * 1024 * 1024);
      expect(second.diskTotal).toBe(500000000 * 1024);
      expect(second.diskUsage).toBe(200000000 * 1024);

      vi.useRealTimers();
    });
  });
});
