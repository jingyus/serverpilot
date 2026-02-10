import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

import {
  detectSystemdServices,
  detectPm2Services,
  detectDockerServices,
  detectServices,
  detectAvailableManagers,
  parseDockerPorts,
  parseDockerUptime,
} from './services.js';

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
// systemd detection
// ============================================================================

describe('detectSystemdServices', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array on non-linux platforms', () => {
    mockPlatform.mockReturnValue('darwin');
    expect(detectSystemdServices()).toEqual([]);
  });

  it('returns empty array when systemctl is not available', () => {
    mockPlatform.mockReturnValue('linux');
    mockSpawnSync.mockReturnValue(mockSpawnResult('', 1));
    expect(detectSystemdServices()).toEqual([]);
  });

  it('detects running systemd services', () => {
    mockPlatform.mockReturnValue('linux');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/systemctl');
      if (cmd === 'systemctl' && args?.[0] === 'list-units') {
        return mockSpawnResult(
          'nginx.service loaded active running A high performance web server\n' +
          'mysql.service loaded active running MySQL Community Server\n',
        );
      }
      if (cmd === 'systemctl' && args?.[0] === 'show') {
        return mockSpawnResult(
          'MainPID=1234\nActiveEnterTimestamp=Mon 2025-01-01 00:00:00 UTC\n',
        );
      }
      if (cmd === 'ss') {
        return mockSpawnResult(
          'LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1234,fd=6))\n',
        );
      }
      return mockSpawnResult('', 1);
    });

    const result = detectSystemdServices();
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('nginx');
    expect(result[0].status).toBe('running');
    expect(result[0].manager).toBe('systemd');
    expect(result[0].ports).toEqual([80]);
    expect(result[0].uptime).toBeDefined();
    expect(result[1].name).toBe('mysql');
    expect(result[1].manager).toBe('systemd');
  });

  it('detects stopped systemd services', () => {
    mockPlatform.mockReturnValue('linux');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/systemctl');
      if (cmd === 'systemctl' && args?.[0] === 'list-units') {
        return mockSpawnResult(
          'redis.service loaded inactive dead Redis In-Memory Data Store\n',
        );
      }
      if (cmd === 'systemctl' && args?.[0] === 'show') {
        return mockSpawnResult('MainPID=0\nActiveEnterTimestamp=\n');
      }
      return mockSpawnResult('', 1);
    });

    const result = detectSystemdServices();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('redis');
    expect(result[0].status).toBe('stopped');
    expect(result[0].uptime).toBeUndefined();
    expect(result[0].ports).toEqual([]);
  });

  it('detects failed systemd services', () => {
    mockPlatform.mockReturnValue('linux');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/systemctl');
      if (cmd === 'systemctl' && args?.[0] === 'list-units') {
        return mockSpawnResult(
          'app.service loaded failed failed My Application\n',
        );
      }
      if (cmd === 'systemctl' && args?.[0] === 'show') {
        return mockSpawnResult('MainPID=0\nActiveEnterTimestamp=\n');
      }
      return mockSpawnResult('', 1);
    });

    const result = detectSystemdServices();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('app');
    expect(result[0].status).toBe('failed');
  });

  it('skips non-service units', () => {
    mockPlatform.mockReturnValue('linux');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/systemctl');
      if (cmd === 'systemctl' && args?.[0] === 'list-units') {
        return mockSpawnResult(
          'system.slice loaded active active System Slice\n' +
          'nginx.service loaded active running A web server\n',
        );
      }
      if (cmd === 'systemctl' && args?.[0] === 'show') {
        return mockSpawnResult('MainPID=100\nActiveEnterTimestamp=Mon 2025-01-01 00:00:00 UTC\n');
      }
      if (cmd === 'ss') return mockSpawnResult('');
      return mockSpawnResult('', 1);
    });

    const result = detectSystemdServices();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('nginx');
  });

  it('returns empty array when systemctl list-units fails', () => {
    mockPlatform.mockReturnValue('linux');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/systemctl');
      if (cmd === 'systemctl' && args?.[0] === 'list-units') {
        return mockSpawnResult('', 1);
      }
      return mockSpawnResult('', 1);
    });

    expect(detectSystemdServices()).toEqual([]);
  });

  it('handles malformed systemctl output', () => {
    mockPlatform.mockReturnValue('linux');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/systemctl');
      if (cmd === 'systemctl' && args?.[0] === 'list-units') {
        return mockSpawnResult('short\n\n   \n');
      }
      return mockSpawnResult('', 1);
    });

    expect(detectSystemdServices()).toEqual([]);
  });

  it('handles systemctl show failure gracefully', () => {
    mockPlatform.mockReturnValue('linux');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/systemctl');
      if (cmd === 'systemctl' && args?.[0] === 'list-units') {
        return mockSpawnResult('nginx.service loaded active running Nginx\n');
      }
      if (cmd === 'systemctl' && args?.[0] === 'show') {
        throw new Error('show failed');
      }
      return mockSpawnResult('', 1);
    });

    const result = detectSystemdServices();
    expect(result.length).toBe(1);
    expect(result[0].ports).toEqual([]);
    expect(result[0].uptime).toBeUndefined();
  });
});

// ============================================================================
// pm2 detection
// ============================================================================

describe('detectPm2Services', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when pm2 is not available', () => {
    mockSpawnSync.mockReturnValue(mockSpawnResult('', 1));
    expect(detectPm2Services()).toEqual([]);
  });

  it('detects running pm2 processes', () => {
    const now = Date.now();
    const pm2Output = JSON.stringify([
      {
        name: 'api-server',
        pm2_env: { status: 'online', pm_uptime: now - 86400000 },
        monit: {},
      },
      {
        name: 'worker',
        pm2_env: { status: 'online', pm_uptime: now - 3600000 },
        monit: {},
      },
    ]);

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/local/bin/pm2');
      if (cmd === 'pm2' && args?.[0] === 'jlist') {
        return mockSpawnResult(pm2Output);
      }
      return mockSpawnResult('', 1);
    });

    const result = detectPm2Services();
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('api-server');
    expect(result[0].status).toBe('running');
    expect(result[0].manager).toBe('pm2');
    expect(result[0].ports).toEqual([]);
    expect(result[0].uptime).toBeDefined();
    expect(result[1].name).toBe('worker');
    expect(result[1].status).toBe('running');
  });

  it('detects stopped pm2 processes', () => {
    const pm2Output = JSON.stringify([
      {
        name: 'app',
        pm2_env: { status: 'stopped', pm_uptime: 0 },
        monit: {},
      },
    ]);

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/local/bin/pm2');
      if (cmd === 'pm2' && args?.[0] === 'jlist') {
        return mockSpawnResult(pm2Output);
      }
      return mockSpawnResult('', 1);
    });

    const result = detectPm2Services();
    expect(result.length).toBe(1);
    expect(result[0].status).toBe('stopped');
    expect(result[0].uptime).toBeUndefined();
  });

  it('handles errored pm2 processes', () => {
    const pm2Output = JSON.stringify([
      {
        name: 'broken-app',
        pm2_env: { status: 'errored' },
        monit: {},
      },
    ]);

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/local/bin/pm2');
      if (cmd === 'pm2' && args?.[0] === 'jlist') {
        return mockSpawnResult(pm2Output);
      }
      return mockSpawnResult('', 1);
    });

    const result = detectPm2Services();
    expect(result.length).toBe(1);
    expect(result[0].status).toBe('failed');
  });

  it('skips pm2 processes without a name', () => {
    const pm2Output = JSON.stringify([
      { pm2_env: { status: 'online' } },
      { name: 'valid', pm2_env: { status: 'online' } },
    ]);

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/local/bin/pm2');
      if (cmd === 'pm2' && args?.[0] === 'jlist') {
        return mockSpawnResult(pm2Output);
      }
      return mockSpawnResult('', 1);
    });

    const result = detectPm2Services();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('valid');
  });

  it('returns empty array when pm2 jlist returns invalid JSON', () => {
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/local/bin/pm2');
      if (cmd === 'pm2' && args?.[0] === 'jlist') {
        return mockSpawnResult('not-json');
      }
      return mockSpawnResult('', 1);
    });

    expect(detectPm2Services()).toEqual([]);
  });

  it('returns empty array when pm2 jlist returns non-array', () => {
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/local/bin/pm2');
      if (cmd === 'pm2' && args?.[0] === 'jlist') {
        return mockSpawnResult('{"key":"value"}');
      }
      return mockSpawnResult('', 1);
    });

    expect(detectPm2Services()).toEqual([]);
  });

  it('returns empty array when pm2 jlist fails', () => {
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/local/bin/pm2');
      if (cmd === 'pm2' && args?.[0] === 'jlist') {
        return mockSpawnResult('', 1);
      }
      return mockSpawnResult('', 1);
    });

    expect(detectPm2Services()).toEqual([]);
  });
});

// ============================================================================
// Docker detection
// ============================================================================

describe('detectDockerServices', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when docker is not available', () => {
    mockSpawnSync.mockReturnValue(mockSpawnResult('', 1));
    expect(detectDockerServices()).toEqual([]);
  });

  it('detects running docker containers', () => {
    const dockerOutput = [
      JSON.stringify({
        Names: 'my-nginx',
        State: 'running',
        Status: 'Up 3 days',
        Ports: '0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp',
      }),
      JSON.stringify({
        Names: 'my-redis',
        State: 'running',
        Status: 'Up 2 hours',
        Ports: '0.0.0.0:6379->6379/tcp',
      }),
    ].join('\n');

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/docker');
      if (cmd === 'docker' && args?.[0] === 'ps') {
        return mockSpawnResult(dockerOutput);
      }
      return mockSpawnResult('', 1);
    });

    const result = detectDockerServices();
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('my-nginx');
    expect(result[0].status).toBe('running');
    expect(result[0].manager).toBe('docker');
    expect(result[0].ports).toEqual([80, 443]);
    expect(result[0].uptime).toBe('3 days');
    expect(result[1].name).toBe('my-redis');
    expect(result[1].ports).toEqual([6379]);
  });

  it('detects stopped docker containers', () => {
    const dockerOutput = JSON.stringify({
      Names: 'stopped-app',
      State: 'exited',
      Status: 'Exited (0) 5 hours ago',
      Ports: '',
    });

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/docker');
      if (cmd === 'docker' && args?.[0] === 'ps') {
        return mockSpawnResult(dockerOutput);
      }
      return mockSpawnResult('', 1);
    });

    const result = detectDockerServices();
    expect(result.length).toBe(1);
    expect(result[0].status).toBe('stopped');
    expect(result[0].uptime).toBeUndefined();
    expect(result[0].ports).toEqual([]);
  });

  it('handles containers with multiple names (takes first)', () => {
    const dockerOutput = JSON.stringify({
      Names: 'primary-name,alias-name',
      State: 'running',
      Status: 'Up 1 hour',
      Ports: '',
    });

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/docker');
      if (cmd === 'docker' && args?.[0] === 'ps') {
        return mockSpawnResult(dockerOutput);
      }
      return mockSpawnResult('', 1);
    });

    const result = detectDockerServices();
    expect(result[0].name).toBe('primary-name');
  });

  it('skips containers without names', () => {
    const dockerOutput = JSON.stringify({
      State: 'running',
      Status: 'Up 1 hour',
      Ports: '',
    });

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/docker');
      if (cmd === 'docker' && args?.[0] === 'ps') {
        return mockSpawnResult(dockerOutput);
      }
      return mockSpawnResult('', 1);
    });

    expect(detectDockerServices()).toEqual([]);
  });

  it('handles invalid JSON lines gracefully', () => {
    const dockerOutput = 'not-json\n' + JSON.stringify({
      Names: 'valid',
      State: 'running',
      Status: 'Up 1 hour',
      Ports: '',
    });

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/docker');
      if (cmd === 'docker' && args?.[0] === 'ps') {
        return mockSpawnResult(dockerOutput);
      }
      return mockSpawnResult('', 1);
    });

    const result = detectDockerServices();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('valid');
  });

  it('returns empty array when docker ps fails', () => {
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult('/usr/bin/docker');
      if (cmd === 'docker' && args?.[0] === 'ps') {
        return mockSpawnResult('', 1);
      }
      return mockSpawnResult('', 1);
    });

    expect(detectDockerServices()).toEqual([]);
  });
});

// ============================================================================
// parseDockerPorts
// ============================================================================

describe('parseDockerPorts', () => {
  it('returns empty array for undefined input', () => {
    expect(parseDockerPorts(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseDockerPorts('')).toEqual([]);
  });

  it('parses single port binding', () => {
    expect(parseDockerPorts('0.0.0.0:80->80/tcp')).toEqual([80]);
  });

  it('parses multiple port bindings', () => {
    expect(parseDockerPorts('0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp')).toEqual([80, 443]);
  });

  it('parses IPv6 port bindings', () => {
    expect(parseDockerPorts(':::8080->80/tcp')).toEqual([8080]);
  });

  it('deduplicates ports', () => {
    expect(parseDockerPorts('0.0.0.0:80->80/tcp, :::80->80/tcp')).toEqual([80]);
  });

  it('sorts ports numerically', () => {
    expect(parseDockerPorts('0.0.0.0:443->443/tcp, 0.0.0.0:80->80/tcp')).toEqual([80, 443]);
  });

  it('ignores non-binding port entries', () => {
    expect(parseDockerPorts('3000/tcp')).toEqual([]);
  });
});

// ============================================================================
// parseDockerUptime
// ============================================================================

describe('parseDockerUptime', () => {
  it('returns undefined for undefined input', () => {
    expect(parseDockerUptime(undefined)).toBeUndefined();
  });

  it('returns undefined for non-Up status', () => {
    expect(parseDockerUptime('Exited (0) 5 hours ago')).toBeUndefined();
  });

  it('parses "Up 3 days"', () => {
    expect(parseDockerUptime('Up 3 days')).toBe('3 days');
  });

  it('parses "Up 2 hours"', () => {
    expect(parseDockerUptime('Up 2 hours')).toBe('2 hours');
  });

  it('parses "Up 30 minutes"', () => {
    expect(parseDockerUptime('Up 30 minutes')).toBe('30 minutes');
  });

  it('strips health status suffix', () => {
    expect(parseDockerUptime('Up 3 days (healthy)')).toBe('3 days');
  });

  it('parses "Up About an hour"', () => {
    expect(parseDockerUptime('Up About an hour')).toBe('About an hour');
  });
});

// ============================================================================
// detectServices (aggregate)
// ============================================================================

describe('detectServices', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when no managers are available', () => {
    mockPlatform.mockReturnValue('darwin');
    mockSpawnSync.mockReturnValue(mockSpawnResult('', 1));
    expect(detectServices()).toEqual([]);
  });

  it('aggregates services from all available managers', () => {
    mockPlatform.mockReturnValue('linux');

    const pm2Output = JSON.stringify([
      { name: 'node-app', pm2_env: { status: 'online', pm_uptime: Date.now() - 1000 } },
    ]);

    const dockerOutput = JSON.stringify({
      Names: 'web',
      State: 'running',
      Status: 'Up 1 hour',
      Ports: '0.0.0.0:3000->3000/tcp',
    });

    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      // which checks
      if (cmd === 'which' && args?.[0] === 'systemctl') return mockSpawnResult('/usr/bin/systemctl');
      if (cmd === 'which' && args?.[0] === 'pm2') return mockSpawnResult('/usr/local/bin/pm2');
      if (cmd === 'which' && args?.[0] === 'docker') return mockSpawnResult('/usr/bin/docker');

      // systemd
      if (cmd === 'systemctl' && args?.[0] === 'list-units') {
        return mockSpawnResult('sshd.service loaded active running OpenSSH\n');
      }
      if (cmd === 'systemctl' && args?.[0] === 'show') {
        return mockSpawnResult('MainPID=500\nActiveEnterTimestamp=Mon 2025-01-01 00:00:00 UTC\n');
      }
      if (cmd === 'ss') return mockSpawnResult('');

      // pm2
      if (cmd === 'pm2' && args?.[0] === 'jlist') return mockSpawnResult(pm2Output);

      // docker
      if (cmd === 'docker' && args?.[0] === 'ps') return mockSpawnResult(dockerOutput);

      return mockSpawnResult('', 1);
    });

    const result = detectServices();
    expect(result.length).toBe(3);

    const managers = result.map((s) => s.manager);
    expect(managers).toContain('systemd');
    expect(managers).toContain('pm2');
    expect(managers).toContain('docker');
  });
});

// ============================================================================
// detectAvailableManagers
// ============================================================================

describe('detectAvailableManagers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when nothing is available', () => {
    mockPlatform.mockReturnValue('darwin');
    mockSpawnSync.mockReturnValue(mockSpawnResult('', 1));
    expect(detectAvailableManagers()).toEqual([]);
  });

  it('detects systemd on linux', () => {
    mockPlatform.mockReturnValue('linux');
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which' && args?.[0] === 'systemctl') {
        return mockSpawnResult('/usr/bin/systemctl');
      }
      return mockSpawnResult('', 1);
    });
    const result = detectAvailableManagers();
    expect(result).toContain('systemd');
  });

  it('does not detect systemd on non-linux', () => {
    mockPlatform.mockReturnValue('darwin');
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which' && args?.[0] === 'systemctl') {
        return mockSpawnResult('/usr/bin/systemctl');
      }
      return mockSpawnResult('', 1);
    });
    const result = detectAvailableManagers();
    expect(result).not.toContain('systemd');
  });

  it('detects pm2 when available', () => {
    mockPlatform.mockReturnValue('darwin');
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which' && args?.[0] === 'pm2') {
        return mockSpawnResult('/usr/local/bin/pm2');
      }
      return mockSpawnResult('', 1);
    });
    const result = detectAvailableManagers();
    expect(result).toContain('pm2');
  });

  it('detects docker when available', () => {
    mockPlatform.mockReturnValue('darwin');
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which' && args?.[0] === 'docker') {
        return mockSpawnResult('/usr/bin/docker');
      }
      return mockSpawnResult('', 1);
    });
    const result = detectAvailableManagers();
    expect(result).toContain('docker');
  });

  it('detects all managers when all available on linux', () => {
    mockPlatform.mockReturnValue('linux');
    mockSpawnSync.mockImplementation((cmd: any, args: any) => {
      if (cmd === 'which') return mockSpawnResult(`/usr/bin/${args?.[0]}`);
      return mockSpawnResult('', 1);
    });
    const result = detectAvailableManagers();
    expect(result).toEqual(['systemd', 'pm2', 'docker']);
  });
});
