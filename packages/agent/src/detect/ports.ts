// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Port detection module.
 *
 * Detects open listening ports on the system using `ss` (Linux)
 * or `lsof` (macOS). Returns port numbers, protocols, bound
 * addresses, and associated process information.
 *
 * @module detect/ports
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';

import type { OpenPort } from '@aiinstaller/shared';

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
// ss output parsing (Linux)
// ============================================================================

/**
 * Parse a single line of `ss -tulnp` output into an OpenPort.
 *
 * Example lines:
 *   LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1234,fd=6))
 *   LISTEN 0 128 [::]:443   [::]:*    users:(("nginx",pid=1234,fd=7))
 *   UNCONN 0 0   0.0.0.0:53 0.0.0.0:* users:(("dnsmasq",pid=500,fd=4))
 */
export function parseSsLine(line: string): OpenPort | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  // Determine protocol from state column
  // TCP listening shows "LISTEN", UDP shows "UNCONN"
  const isListen = trimmed.startsWith('LISTEN');
  const isUnconn = trimmed.startsWith('UNCONN');
  if (!isListen && !isUnconn) return undefined;

  const protocol: 'tcp' | 'udp' = isListen ? 'tcp' : 'udp';

  // Extract local address:port — the 4th whitespace-separated field
  const fields = trimmed.split(/\s+/);
  if (fields.length < 5) return undefined;

  const localAddr = fields[3];
  // Parse address and port: handle IPv6 [::]:port and IPv4 addr:port and *:port
  const lastColon = localAddr.lastIndexOf(':');
  if (lastColon === -1) return undefined;

  const portStr = localAddr.slice(lastColon + 1);
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;

  let address = localAddr.slice(0, lastColon);
  // Clean up IPv6 bracket notation
  if (address.startsWith('[') && address.endsWith(']')) {
    address = address.slice(1, -1);
  }
  // Normalize wildcard addresses
  if (address === '*') address = '0.0.0.0';

  // Extract process info from users:((...)) if present
  let processName: string | undefined;
  let pid: number | undefined;
  const usersMatch = trimmed.match(/users:\(\("([^"]+)",pid=(\d+)/);
  if (usersMatch) {
    processName = usersMatch[1];
    pid = Number(usersMatch[2]);
  }

  return {
    port,
    protocol,
    address,
    ...(processName !== undefined ? { process: processName } : {}),
    ...(pid !== undefined ? { pid } : {}),
  };
}

/**
 * Detect open TCP ports using `ss -tlnp`.
 *
 * Only works on Linux systems where the `ss` command is available.
 */
export function detectTcpPorts(): OpenPort[] {
  if (!isCommandAvailable('ss')) return [];

  try {
    const res = spawnSync('ss', ['-tlnp'], {
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT,
    });
    if (res.status !== 0 || !res.stdout) return [];

    const ports: OpenPort[] = [];
    for (const line of res.stdout.split('\n')) {
      const parsed = parseSsLine(line);
      if (parsed) ports.push(parsed);
    }
    return ports;
  } catch {
    return [];
  }
}

/**
 * Detect open UDP ports using `ss -ulnp`.
 *
 * Only works on Linux systems where the `ss` command is available.
 */
export function detectUdpPorts(): OpenPort[] {
  if (!isCommandAvailable('ss')) return [];

  try {
    const res = spawnSync('ss', ['-ulnp'], {
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT,
    });
    if (res.status !== 0 || !res.stdout) return [];

    const ports: OpenPort[] = [];
    for (const line of res.stdout.split('\n')) {
      const parsed = parseSsLine(line);
      if (parsed) ports.push(parsed);
    }
    return ports;
  } catch {
    return [];
  }
}

// ============================================================================
// lsof output parsing (macOS / fallback)
// ============================================================================

/**
 * Parse a single line of `lsof -iTCP -iUDP -sTCP:LISTEN -sUDP:* -nP` output.
 *
 * Example lines:
 *   nginx   1234 root  6u IPv4 12345 0t0 TCP *:80 (LISTEN)
 *   dnsmasq  500 root  4u IPv4 12346 0t0 UDP *:53
 *   node    2000 user  7u IPv6 12347 0t0 TCP [::1]:3000 (LISTEN)
 */
export function parseLsofLine(line: string): OpenPort | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  // Skip header line
  if (trimmed.startsWith('COMMAND')) return undefined;

  const fields = trimmed.split(/\s+/);
  if (fields.length < 9) return undefined;

  const processName = fields[0];
  const pid = Number(fields[1]);

  // Protocol field (index 7): "TCP" or "UDP"
  const protoField = fields[7];
  let protocol: 'tcp' | 'udp';
  if (protoField === 'TCP') protocol = 'tcp';
  else if (protoField === 'UDP') protocol = 'udp';
  else return undefined;

  // For TCP, only include LISTEN state
  if (protocol === 'tcp' && !trimmed.includes('(LISTEN)')) return undefined;

  // Address:port field (index 8): "*:80", "[::1]:3000", "127.0.0.1:8080"
  const addrPort = fields[8];
  const lastColon = addrPort.lastIndexOf(':');
  if (lastColon === -1) return undefined;

  const portStr = addrPort.slice(lastColon + 1);
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;

  let address = addrPort.slice(0, lastColon);
  if (address.startsWith('[') && address.endsWith(']')) {
    address = address.slice(1, -1);
  }
  if (address === '*') address = '0.0.0.0';

  return {
    port,
    protocol,
    address,
    process: processName,
    ...(Number.isInteger(pid) ? { pid } : {}),
  };
}

/**
 * Detect open ports using `lsof` (primarily macOS).
 *
 * Falls back to lsof when `ss` is not available.
 */
export function detectPortsWithLsof(): OpenPort[] {
  if (!isCommandAvailable('lsof')) return [];

  try {
    const res = spawnSync(
      'lsof',
      ['-iTCP', '-iUDP', '-sTCP:LISTEN', '-sUDP:*', '-nP'],
      { encoding: 'utf-8', timeout: SPAWN_TIMEOUT },
    );
    if (res.status !== 0 || !res.stdout) return [];

    const ports: OpenPort[] = [];
    for (const line of res.stdout.split('\n')) {
      const parsed = parseLsofLine(line);
      if (parsed) ports.push(parsed);
    }
    return ports;
  } catch {
    return [];
  }
}

// ============================================================================
// Deduplication and aggregate
// ============================================================================

/** Create a unique key for deduplication */
function portKey(p: OpenPort): string {
  return `${p.protocol}:${p.address}:${p.port}`;
}

/** Deduplicate ports, keeping the entry with the most info (process/pid) */
export function deduplicatePorts(ports: OpenPort[]): OpenPort[] {
  const seen = new Map<string, OpenPort>();
  for (const p of ports) {
    const key = portKey(p);
    const existing = seen.get(key);
    // Keep the one with more information
    if (!existing || (p.process && !existing.process)) {
      seen.set(key, p);
    }
  }
  return [...seen.values()].sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
}

/**
 * Detect all open listening ports on the system.
 *
 * On Linux, uses `ss` to detect TCP and UDP listening ports.
 * On macOS, uses `lsof` as a fallback.
 * Returns a deduplicated, sorted list of open ports.
 *
 * @returns Array of detected open ports
 */
export function detectOpenPorts(): OpenPort[] {
  const platform = os.platform();

  let ports: OpenPort[];

  if (platform === 'linux') {
    // Prefer ss on Linux
    const tcp = detectTcpPorts();
    const udp = detectUdpPorts();
    ports = [...tcp, ...udp];
  } else if (platform === 'darwin') {
    // Use lsof on macOS
    ports = detectPortsWithLsof();
  } else {
    // Try ss first, then lsof as fallback
    const tcp = detectTcpPorts();
    const udp = detectUdpPorts();
    ports = [...tcp, ...udp];
    if (ports.length === 0) {
      ports = detectPortsWithLsof();
    }
  }

  return deduplicatePorts(ports);
}
