/**
 * Service discovery module.
 *
 * Detects running services managed by systemd, pm2, and docker.
 * Returns a unified list of Service objects with name, status, ports,
 * manager type, and uptime information.
 *
 * @module detect/services
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';

import type { Service, ServiceManager } from '@aiinstaller/shared';

/** Default timeout for spawned processes (ms) */
const SPAWN_TIMEOUT = 10000;

/** Check if a command is available on the system */
function isCommandAvailable(command: string): boolean {
  try {
    const res = spawnSync('which', [command], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return res.status === 0 && (res.stdout || '').trim().length > 0;
  } catch {
    return false;
  }
}

// ============================================================================
// systemd service detection (Linux only)
// ============================================================================

/** Parse systemd service status into a normalized status */
function parseSystemdStatus(sub: string): Service['status'] {
  switch (sub) {
    case 'running':
      return 'running';
    case 'dead':
    case 'exited':
    case 'inactive':
      return 'stopped';
    default:
      return 'failed';
  }
}

/** Parse systemd ActiveEnterTimestamp into a human-readable uptime string */
function parseSystemdUptime(timestampLine: string): string | undefined {
  // Format: "ActiveEnterTimestamp=Mon 2025-01-01 12:00:00 UTC"
  const eqIdx = timestampLine.indexOf('=');
  if (eqIdx === -1) return undefined;
  const dateStr = timestampLine.slice(eqIdx + 1).trim();
  if (!dateStr) return undefined;

  const startTime = new Date(dateStr).getTime();
  if (Number.isNaN(startTime)) return undefined;

  const diffMs = Date.now() - startTime;
  if (diffMs < 0) return undefined;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** Extract listening ports for a given service by its main PID */
function getPortsByPid(pid: string): number[] {
  if (!pid || pid === '0') return [];
  try {
    const res = spawnSync('ss', ['-tlnp'], {
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT,
    });
    if (res.status !== 0 || !res.stdout) return [];

    const ports: Set<number> = new Set();
    for (const line of res.stdout.split('\n')) {
      if (!line.includes(`pid=${pid}`)) continue;
      // Match port from address like *:80 or 0.0.0.0:3000 or [::]:443
      const match = line.match(/:(\d+)\s/);
      if (match) {
        const port = Number(match[1]);
        if (port > 0 && port <= 65535) ports.add(port);
      }
    }
    return [...ports].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Detect services managed by systemd.
 *
 * Lists all loaded service units and queries their status, PID, and uptime.
 * Only available on Linux systems with systemctl installed.
 */
export function detectSystemdServices(): Service[] {
  if (os.platform() !== 'linux' || !isCommandAvailable('systemctl')) {
    return [];
  }

  const services: Service[] = [];

  try {
    // List all loaded service units (one per line: unit, load, active, sub, description)
    const res = spawnSync(
      'systemctl',
      ['list-units', '--type=service', '--all', '--no-pager', '--no-legend', '--plain'],
      { encoding: 'utf-8', timeout: SPAWN_TIMEOUT },
    );
    if (res.status !== 0 || !res.stdout) return [];

    for (const line of res.stdout.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;

      const unitName = parts[0];
      // Skip template/slice units and internal systemd units
      if (!unitName.endsWith('.service')) continue;
      const name = unitName.replace('.service', '');

      const sub = parts[3];
      const status = parseSystemdStatus(sub);

      // Get PID and uptime via show
      let uptime: string | undefined;
      let ports: number[] = [];
      try {
        const showRes = spawnSync(
          'systemctl',
          ['show', unitName, '--property=MainPID,ActiveEnterTimestamp', '--no-pager'],
          { encoding: 'utf-8', timeout: SPAWN_TIMEOUT },
        );
        if (showRes.status === 0 && showRes.stdout) {
          const lines = showRes.stdout.trim().split('\n');
          for (const showLine of lines) {
            if (showLine.startsWith('MainPID=')) {
              const pid = showLine.split('=')[1]?.trim();
              if (pid) ports = getPortsByPid(pid);
            }
            if (showLine.startsWith('ActiveEnterTimestamp=')) {
              if (status === 'running') {
                uptime = parseSystemdUptime(showLine);
              }
            }
          }
        }
      } catch {
        // continue without extra details
      }

      services.push({ name, status, ports, manager: 'systemd', uptime });
    }
  } catch {
    // systemctl not available or failed
  }

  return services;
}

// ============================================================================
// pm2 service detection
// ============================================================================

/** pm2 jlist output row shape (subset of fields we use) */
interface Pm2Process {
  name?: string;
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
  };
  monit?: Record<string, unknown>;
}

/** Parse pm2 status string into normalized status */
function parsePm2Status(status: string | undefined): Service['status'] {
  switch (status) {
    case 'online':
      return 'running';
    case 'stopped':
      return 'stopped';
    default:
      return 'failed';
  }
}

/** Convert pm2 uptime timestamp (ms since epoch) to human-readable string */
function formatPm2Uptime(pmUptime: number | undefined): string | undefined {
  if (!pmUptime || pmUptime <= 0) return undefined;

  const diffMs = Date.now() - pmUptime;
  if (diffMs < 0) return undefined;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Detect services managed by pm2.
 *
 * Uses `pm2 jlist` to get JSON output of all managed processes.
 */
export function detectPm2Services(): Service[] {
  if (!isCommandAvailable('pm2')) {
    return [];
  }

  const services: Service[] = [];

  try {
    const res = spawnSync('pm2', ['jlist'], {
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT,
    });
    if (res.status !== 0 || !res.stdout) return [];

    const processes: Pm2Process[] = JSON.parse(res.stdout.trim());
    if (!Array.isArray(processes)) return [];

    for (const proc of processes) {
      if (!proc.name) continue;

      const status = parsePm2Status(proc.pm2_env?.status);
      const uptime = formatPm2Uptime(proc.pm2_env?.pm_uptime);

      services.push({
        name: proc.name,
        status,
        ports: [], // pm2 doesn't directly expose ports
        manager: 'pm2',
        uptime,
      });
    }
  } catch {
    // pm2 not available or JSON parse failed
  }

  return services;
}

// ============================================================================
// Docker container detection
// ============================================================================

/** Docker ps --format JSON output row shape */
interface DockerContainer {
  Names?: string;
  State?: string;
  Status?: string;
  Ports?: string;
}

/** Parse docker container state into normalized status */
function parseDockerStatus(state: string | undefined): Service['status'] {
  switch (state?.toLowerCase()) {
    case 'running':
      return 'running';
    case 'exited':
    case 'created':
    case 'paused':
      return 'stopped';
    default:
      return 'failed';
  }
}

/** Parse docker ports string into port numbers (e.g. "0.0.0.0:80->80/tcp, 443/tcp") */
export function parseDockerPorts(portsStr: string | undefined): number[] {
  if (!portsStr) return [];

  const ports: Set<number> = new Set();
  // Match host port from binding like "0.0.0.0:8080->80/tcp" or ":::443->443/tcp"
  const bindingRegex = /(?:\d+\.\d+\.\d+\.\d+|::):(\d+)->/g;
  let match;
  while ((match = bindingRegex.exec(portsStr)) !== null) {
    const port = Number(match[1]);
    if (port > 0 && port <= 65535) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

/** Parse docker Status field uptime (e.g. "Up 3 days", "Up 2 hours") */
export function parseDockerUptime(statusStr: string | undefined): string | undefined {
  if (!statusStr) return undefined;
  const match = statusStr.match(/Up\s+(.+?)(?:\s+\(.*\))?$/i);
  if (!match) return undefined;
  return match[1].trim();
}

/**
 * Detect services running as Docker containers.
 *
 * Uses `docker ps -a` with JSON format to get all containers.
 */
export function detectDockerServices(): Service[] {
  if (!isCommandAvailable('docker')) {
    return [];
  }

  const services: Service[] = [];

  try {
    const res = spawnSync(
      'docker',
      ['ps', '-a', '--format', '{{json .}}'],
      { encoding: 'utf-8', timeout: SPAWN_TIMEOUT },
    );
    if (res.status !== 0 || !res.stdout) return [];

    // Each line is a separate JSON object
    for (const line of res.stdout.trim().split('\n')) {
      if (!line.trim()) continue;

      let container: DockerContainer;
      try {
        container = JSON.parse(line);
      } catch {
        continue;
      }

      const name = container.Names?.split(',')[0]?.trim();
      if (!name) continue;

      const status = parseDockerStatus(container.State);
      const ports = parseDockerPorts(container.Ports);
      const uptime = status === 'running' ? parseDockerUptime(container.Status) : undefined;

      services.push({
        name,
        status,
        ports,
        manager: 'docker',
        uptime,
      });
    }
  } catch {
    // docker not available or failed
  }

  return services;
}

// ============================================================================
// Aggregate service detection
// ============================================================================

/**
 * Detect all services across all supported managers (systemd, pm2, docker).
 *
 * Aggregates results from all available service managers into a single list.
 *
 * @returns Array of detected services from all managers
 */
export function detectServices(): Service[] {
  const services: Service[] = [];

  services.push(...detectSystemdServices());
  services.push(...detectPm2Services());
  services.push(...detectDockerServices());

  return services;
}

/**
 * Check which service managers are available on this system.
 *
 * @returns Array of available service manager names
 */
export function detectAvailableManagers(): ServiceManager[] {
  const managers: ServiceManager[] = [];

  if (os.platform() === 'linux' && isCommandAvailable('systemctl')) {
    managers.push('systemd');
  }
  if (isCommandAvailable('pm2')) {
    managers.push('pm2');
  }
  if (isCommandAvailable('docker')) {
    managers.push('docker');
  }

  return managers;
}
