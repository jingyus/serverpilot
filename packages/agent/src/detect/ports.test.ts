// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

import {
  parseSsLine,
  parseLsofLine,
  detectTcpPorts,
  detectUdpPorts,
  detectPortsWithLsof,
  detectOpenPorts,
  deduplicatePorts,
} from './ports.js';

import type { OpenPort } from '@aiinstaller/shared';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  default: { platform: vi.fn() },
}));

const mockSpawnSync = vi.mocked(spawnSync);
const mockPlatform = vi.mocked(os.platform);

function mockSpawnResult(stdout: string, status = 0) {
  return {
    stdout,
    stderr: '',
    status,
    signal: null,
    pid: 1,
    output: [],
  } as any;
}

// ============================================================================
// parseSsLine
// ============================================================================

describe('parseSsLine', () => {
  it('returns undefined for empty line', () => {
    expect(parseSsLine('')).toBeUndefined();
  });

  it('returns undefined for header line', () => {
    expect(parseSsLine('State  Recv-Q Send-Q  Local Address:Port  Peer Address:Port Process')).toBeUndefined();
  });

  it('parses TCP LISTEN line with IPv4 wildcard', () => {
    const line = 'LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1234,fd=6))';
    const result = parseSsLine(line);
    expect(result).toEqual({
      port: 80,
      protocol: 'tcp',
      address: '0.0.0.0',
      process: 'nginx',
      pid: 1234,
    });
  });

  it('parses TCP LISTEN line with IPv6 wildcard', () => {
    const line = 'LISTEN 0 128 [::]:443 [::]:* users:(("nginx",pid=1234,fd=7))';
    const result = parseSsLine(line);
    expect(result).toEqual({
      port: 443,
      protocol: 'tcp',
      address: '::',
      process: 'nginx',
      pid: 1234,
    });
  });

  it('parses TCP LISTEN on localhost', () => {
    const line = 'LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=2000,fd=10))';
    const result = parseSsLine(line);
    expect(result).toEqual({
      port: 3000,
      protocol: 'tcp',
      address: '127.0.0.1',
      process: 'node',
      pid: 2000,
    });
  });

  it('parses UDP UNCONN line', () => {
    const line = 'UNCONN 0 0 0.0.0.0:53 0.0.0.0:* users:(("dnsmasq",pid=500,fd=4))';
    const result = parseSsLine(line);
    expect(result).toEqual({
      port: 53,
      protocol: 'udp',
      address: '0.0.0.0',
      process: 'dnsmasq',
      pid: 500,
    });
  });

  it('parses line without process info', () => {
    const line = 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:*';
    const result = parseSsLine(line);
    expect(result).toEqual({
      port: 22,
      protocol: 'tcp',
      address: '0.0.0.0',
    });
  });

  it('normalizes wildcard address *', () => {
    const line = 'LISTEN 0 128 *:8080 *:*';
    const result = parseSsLine(line);
    expect(result).toEqual({
      port: 8080,
      protocol: 'tcp',
      address: '0.0.0.0',
    });
  });

  it('returns undefined for non-listening state', () => {
    const line = 'ESTAB 0 0 192.168.1.1:22 10.0.0.1:54321';
    expect(parseSsLine(line)).toBeUndefined();
  });

  it('returns undefined for line with too few fields', () => {
    const line = 'LISTEN 0 128';
    expect(parseSsLine(line)).toBeUndefined();
  });

  it('returns undefined for invalid port number', () => {
    const line = 'LISTEN 0 128 0.0.0.0:99999 0.0.0.0:*';
    expect(parseSsLine(line)).toBeUndefined();
  });

  it('parses IPv6 loopback address', () => {
    const line = 'LISTEN 0 128 [::1]:5432 [::]:* users:(("postgres",pid=800,fd=3))';
    const result = parseSsLine(line);
    expect(result).toEqual({
      port: 5432,
      protocol: 'tcp',
      address: '::1',
      process: 'postgres',
      pid: 800,
    });
  });
});

// ============================================================================
// parseLsofLine
// ============================================================================

describe('parseLsofLine', () => {
  it('returns undefined for empty line', () => {
    expect(parseLsofLine('')).toBeUndefined();
  });

  it('returns undefined for header line', () => {
    expect(parseLsofLine('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME')).toBeUndefined();
  });

  it('parses TCP LISTEN line with wildcard', () => {
    const line = 'nginx   1234 root  6u IPv4 12345 0t0 TCP *:80 (LISTEN)';
    const result = parseLsofLine(line);
    expect(result).toEqual({
      port: 80,
      protocol: 'tcp',
      address: '0.0.0.0',
      process: 'nginx',
      pid: 1234,
    });
  });

  it('parses TCP LISTEN line with specific address', () => {
    const line = 'node    2000 user  7u IPv4 12346 0t0 TCP 127.0.0.1:3000 (LISTEN)';
    const result = parseLsofLine(line);
    expect(result).toEqual({
      port: 3000,
      protocol: 'tcp',
      address: '127.0.0.1',
      process: 'node',
      pid: 2000,
    });
  });

  it('parses TCP LISTEN on IPv6', () => {
    const line = 'node    2000 user  7u IPv6 12347 0t0 TCP [::1]:3000 (LISTEN)';
    const result = parseLsofLine(line);
    expect(result).toEqual({
      port: 3000,
      protocol: 'tcp',
      address: '::1',
      process: 'node',
      pid: 2000,
    });
  });

  it('parses UDP line', () => {
    const line = 'dnsmasq  500 root  4u IPv4 12348 0t0 UDP *:53';
    const result = parseLsofLine(line);
    expect(result).toEqual({
      port: 53,
      protocol: 'udp',
      address: '0.0.0.0',
      process: 'dnsmasq',
      pid: 500,
    });
  });

  it('returns undefined for TCP non-LISTEN', () => {
    const line = 'chrome  3000 user 10u IPv4 12349 0t0 TCP 192.168.1.1:54321->93.184.216.34:443 (ESTABLISHED)';
    expect(parseLsofLine(line)).toBeUndefined();
  });

  it('returns undefined for unknown protocol', () => {
    const line = 'app     100 root  3u IPv4 12350 0t0 RAW *:1';
    expect(parseLsofLine(line)).toBeUndefined();
  });

  it('returns undefined for line with too few fields', () => {
    const line = 'nginx 1234 root 6u IPv4';
    expect(parseLsofLine(line)).toBeUndefined();
  });

  it('returns undefined for invalid port number', () => {
    const line = 'nginx   1234 root  6u IPv4 12345 0t0 TCP *:99999 (LISTEN)';
    expect(parseLsofLine(line)).toBeUndefined();
  });
});

// ============================================================================
// detectTcpPorts
// ============================================================================

describe('detectTcpPorts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when ss is not available', () => {
    mockSpawnSync.mockReturnValue(mockSpawnResult('', 1));
    expect(detectTcpPorts()).toEqual([]);
  });

  it('detects TCP listening ports', () => {
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/sbin/ss');
      if (cmd === 'ss' && args?.includes('-tlnp')) {
        return mockSpawnResult(
          'State  Recv-Q Send-Q  Local Address:Port  Peer Address:Port Process\n' +
          'LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1234,fd=6))\n' +
          'LISTEN 0 128 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=1234,fd=7))\n',
        );
      }
      return mockSpawnResult('', 1);
    });

    const result = detectTcpPorts();
    expect(result.length).toBe(2);
    expect(result[0].port).toBe(80);
    expect(result[0].protocol).toBe('tcp');
    expect(result[1].port).toBe(443);
  });

  it('returns empty array when ss command fails', () => {
    mockSpawnSync.mockImplementation((cmd: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/sbin/ss');
      return mockSpawnResult('', 1);
    });

    expect(detectTcpPorts()).toEqual([]);
  });

  it('returns empty array when ss throws', () => {
    mockSpawnSync.mockImplementation((cmd: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/sbin/ss');
      throw new Error('ss failed');
    });

    expect(detectTcpPorts()).toEqual([]);
  });
});

// ============================================================================
// detectUdpPorts
// ============================================================================

describe('detectUdpPorts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when ss is not available', () => {
    mockSpawnSync.mockReturnValue(mockSpawnResult('', 1));
    expect(detectUdpPorts()).toEqual([]);
  });

  it('detects UDP listening ports', () => {
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/sbin/ss');
      if (cmd === 'ss' && args?.includes('-ulnp')) {
        return mockSpawnResult(
          'State  Recv-Q Send-Q  Local Address:Port  Peer Address:Port Process\n' +
          'UNCONN 0 0 0.0.0.0:53 0.0.0.0:* users:(("dnsmasq",pid=500,fd=4))\n' +
          'UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("avahi",pid=600,fd=5))\n',
        );
      }
      return mockSpawnResult('', 1);
    });

    const result = detectUdpPorts();
    expect(result.length).toBe(2);
    expect(result[0].port).toBe(53);
    expect(result[0].protocol).toBe('udp');
    expect(result[1].port).toBe(5353);
  });

  it('returns empty array when ss command fails', () => {
    mockSpawnSync.mockImplementation((cmd: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/sbin/ss');
      return mockSpawnResult('', 1);
    });

    expect(detectUdpPorts()).toEqual([]);
  });
});

// ============================================================================
// detectPortsWithLsof
// ============================================================================

describe('detectPortsWithLsof', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when lsof is not available', () => {
    mockSpawnSync.mockReturnValue(mockSpawnResult('', 1));
    expect(detectPortsWithLsof()).toEqual([]);
  });

  it('detects TCP and UDP ports with lsof', () => {
    mockSpawnSync.mockImplementation((cmd: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/sbin/lsof');
      if (cmd === 'lsof') {
        return mockSpawnResult(
          'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
          'nginx   1234 root  6u IPv4 12345 0t0 TCP *:80 (LISTEN)\n' +
          'dnsmasq  500 root  4u IPv4 12348 0t0 UDP *:53\n',
        );
      }
      return mockSpawnResult('', 1);
    });

    const result = detectPortsWithLsof();
    expect(result.length).toBe(2);
    expect(result[0].port).toBe(80);
    expect(result[0].protocol).toBe('tcp');
    expect(result[1].port).toBe(53);
    expect(result[1].protocol).toBe('udp');
  });

  it('returns empty array when lsof command fails', () => {
    mockSpawnSync.mockImplementation((cmd: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/sbin/lsof');
      return mockSpawnResult('', 1);
    });

    expect(detectPortsWithLsof()).toEqual([]);
  });

  it('returns empty array when lsof throws', () => {
    mockSpawnSync.mockImplementation((cmd: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/sbin/lsof');
      throw new Error('lsof failed');
    });

    expect(detectPortsWithLsof()).toEqual([]);
  });
});

// ============================================================================
// deduplicatePorts
// ============================================================================

describe('deduplicatePorts', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicatePorts([])).toEqual([]);
  });

  it('returns same ports when no duplicates', () => {
    const ports: OpenPort[] = [
      { port: 80, protocol: 'tcp', address: '0.0.0.0' },
      { port: 443, protocol: 'tcp', address: '0.0.0.0' },
    ];
    expect(deduplicatePorts(ports)).toEqual(ports);
  });

  it('deduplicates identical ports', () => {
    const ports: OpenPort[] = [
      { port: 80, protocol: 'tcp', address: '0.0.0.0' },
      { port: 80, protocol: 'tcp', address: '0.0.0.0' },
    ];
    const result = deduplicatePorts(ports);
    expect(result.length).toBe(1);
    expect(result[0].port).toBe(80);
  });

  it('keeps entry with process info over one without', () => {
    const ports: OpenPort[] = [
      { port: 80, protocol: 'tcp', address: '0.0.0.0' },
      { port: 80, protocol: 'tcp', address: '0.0.0.0', process: 'nginx', pid: 1234 },
    ];
    const result = deduplicatePorts(ports);
    expect(result.length).toBe(1);
    expect(result[0].process).toBe('nginx');
    expect(result[0].pid).toBe(1234);
  });

  it('treats different protocols as distinct', () => {
    const ports: OpenPort[] = [
      { port: 53, protocol: 'tcp', address: '0.0.0.0' },
      { port: 53, protocol: 'udp', address: '0.0.0.0' },
    ];
    const result = deduplicatePorts(ports);
    expect(result.length).toBe(2);
  });

  it('treats different addresses as distinct', () => {
    const ports: OpenPort[] = [
      { port: 80, protocol: 'tcp', address: '0.0.0.0' },
      { port: 80, protocol: 'tcp', address: '127.0.0.1' },
    ];
    const result = deduplicatePorts(ports);
    expect(result.length).toBe(2);
  });

  it('sorts by port number then protocol', () => {
    const ports: OpenPort[] = [
      { port: 443, protocol: 'tcp', address: '0.0.0.0' },
      { port: 80, protocol: 'udp', address: '0.0.0.0' },
      { port: 80, protocol: 'tcp', address: '0.0.0.0' },
    ];
    const result = deduplicatePorts(ports);
    expect(result[0].port).toBe(80);
    expect(result[0].protocol).toBe('tcp');
    expect(result[1].port).toBe(80);
    expect(result[1].protocol).toBe('udp');
    expect(result[2].port).toBe(443);
  });
});

// ============================================================================
// detectOpenPorts (aggregate)
// ============================================================================

describe('detectOpenPorts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses ss on Linux', () => {
    mockPlatform.mockReturnValue('linux');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which' && args?.[0] === 'ss') return mockSpawnResult('/usr/sbin/ss');
      if (cmd === 'which') return mockSpawnResult('', 1);
      if (cmd === 'ss' && args?.includes('-tlnp')) {
        return mockSpawnResult(
          'LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1234,fd=6))\n',
        );
      }
      if (cmd === 'ss' && args?.includes('-ulnp')) {
        return mockSpawnResult(
          'UNCONN 0 0 0.0.0.0:53 0.0.0.0:* users:(("dnsmasq",pid=500,fd=4))\n',
        );
      }
      return mockSpawnResult('', 1);
    });

    const result = detectOpenPorts();
    expect(result.length).toBe(2);
    expect(result[0].port).toBe(53);
    expect(result[0].protocol).toBe('udp');
    expect(result[1].port).toBe(80);
    expect(result[1].protocol).toBe('tcp');
  });

  it('uses lsof on macOS', () => {
    mockPlatform.mockReturnValue('darwin');

    mockSpawnSync.mockImplementation((cmd: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/sbin/lsof');
      if (cmd === 'lsof') {
        return mockSpawnResult(
          'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
          'nginx   1234 root  6u IPv4 12345 0t0 TCP *:80 (LISTEN)\n',
        );
      }
      return mockSpawnResult('', 1);
    });

    const result = detectOpenPorts();
    expect(result.length).toBe(1);
    expect(result[0].port).toBe(80);
    expect(result[0].process).toBe('nginx');
  });

  it('returns empty array when no tools available', () => {
    mockPlatform.mockReturnValue('linux');
    mockSpawnSync.mockReturnValue(mockSpawnResult('', 1));
    expect(detectOpenPorts()).toEqual([]);
  });

  it('deduplicates results', () => {
    mockPlatform.mockReturnValue('linux');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which' && args?.[0] === 'ss') return mockSpawnResult('/usr/sbin/ss');
      if (cmd === 'which') return mockSpawnResult('', 1);
      if (cmd === 'ss' && args?.includes('-tlnp')) {
        return mockSpawnResult(
          'LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1234,fd=6))\n',
        );
      }
      if (cmd === 'ss' && args?.includes('-ulnp')) {
        return mockSpawnResult('');
      }
      return mockSpawnResult('', 1);
    });

    const result = detectOpenPorts();
    expect(result.length).toBe(1);
  });

  it('falls back to lsof on unknown platform when ss unavailable', () => {
    mockPlatform.mockReturnValue('freebsd' as any);

    let ssChecked = false;
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which' && args?.[0] === 'ss') {
        ssChecked = true;
        return mockSpawnResult('', 1);
      }
      if (cmd === 'which' && args?.[0] === 'lsof') return mockSpawnResult('/usr/sbin/lsof');
      if (cmd === 'which') return mockSpawnResult('', 1);
      if (cmd === 'lsof') {
        return mockSpawnResult(
          'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
          'nginx   1234 root  6u IPv4 12345 0t0 TCP *:80 (LISTEN)\n',
        );
      }
      return mockSpawnResult('', 1);
    });

    const result = detectOpenPorts();
    expect(ssChecked).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].port).toBe(80);
  });
});
