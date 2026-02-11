// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * System metrics collection module for the agent.
 *
 * Collects CPU, memory, disk, and network usage statistics
 * to send to the server for monitoring purposes.
 *
 * @module detect/metrics
 */

import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface SystemMetrics {
  cpuUsage: number; // 0-100 percentage
  memoryUsage: number; // bytes
  memoryTotal: number; // bytes
  diskUsage: number; // bytes
  diskTotal: number; // bytes
  networkIn: number; // bytes/s
  networkOut: number; // bytes/s
}

// ============================================================================
// CPU Usage Detection
// ============================================================================

let previousCpuInfo: { idle: number; total: number } | null = null;

/**
 * Get CPU usage percentage (0-100).
 * Uses a delta-based calculation for accurate readings.
 */
async function getCpuUsage(): Promise<number> {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type as keyof typeof cpu.times];
    }
    idle += cpu.times.idle;
  }

  if (!previousCpuInfo) {
    // First call: store baseline and return 0
    previousCpuInfo = { idle, total };
    return 0;
  }

  const idleDelta = idle - previousCpuInfo.idle;
  const totalDelta = total - previousCpuInfo.total;
  previousCpuInfo = { idle, total };

  const usage = totalDelta > 0 ? 100 - (100 * idleDelta) / totalDelta : 0;
  return Math.max(0, Math.min(100, usage)); // Clamp between 0-100
}

// ============================================================================
// Memory Usage Detection
// ============================================================================

/**
 * Get memory usage and total memory in bytes.
 */
function getMemoryUsage(): { memoryUsage: number; memoryTotal: number } {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    memoryUsage: usedMem,
    memoryTotal: totalMem,
  };
}

// ============================================================================
// Disk Usage Detection
// ============================================================================

/**
 * Get disk usage for the root partition (platform-specific).
 */
async function getDiskUsage(): Promise<{ diskUsage: number; diskTotal: number }> {
  const platform = os.platform();

  try {
    if (platform === 'linux' || platform === 'darwin') {
      // Use `df -k /` to get disk usage in 1K blocks
      const { stdout } = await execAsync('df -k /');
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('Unexpected df output');
      }

      // Parse the second line (e.g., "/dev/sda1 ... 80% /")
      const parts = lines[1].split(/\s+/);
      if (parts.length < 6) {
        throw new Error('Unexpected df format');
      }

      const total = parseInt(parts[1], 10) * 1024; // Convert KB to bytes
      const used = parseInt(parts[2], 10) * 1024;

      return {
        diskUsage: used,
        diskTotal: total,
      };
    } else if (platform === 'win32') {
      // Windows: use wmic to get disk info (C: drive)
      const { stdout } = await execAsync(
        'wmic logicaldisk where DeviceID="C:" get Size,FreeSpace /format:csv'
      );
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('Unexpected wmic output');
      }

      const parts = lines[1].split(',');
      const freeSpace = parseInt(parts[1], 10);
      const totalSpace = parseInt(parts[2], 10);

      return {
        diskUsage: totalSpace - freeSpace,
        diskTotal: totalSpace,
      };
    }
  } catch (err) {
    // Fallback on error
    console.warn('Failed to detect disk usage:', err);
  }

  // Default fallback values
  return { diskUsage: 0, diskTotal: 1 };
}

// ============================================================================
// Network Usage Detection
// ============================================================================

let previousNetStats: { rx: number; tx: number; timestamp: number } | null = null;

/**
 * Get network I/O bytes per second.
 * Uses delta-based calculation for accurate rate.
 */
async function getNetworkUsage(): Promise<{ networkIn: number; networkOut: number }> {
  const platform = os.platform();

  try {
    let rx = 0;
    let tx = 0;

    if (platform === 'linux') {
      // Read /proc/net/dev
      const { stdout } = await execAsync('cat /proc/net/dev');
      const lines = stdout.trim().split('\n').slice(2); // Skip header lines

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;

        // Skip loopback interface
        const iface = parts[0].replace(':', '');
        if (iface === 'lo') continue;

        rx += parseInt(parts[1], 10); // RX bytes
        tx += parseInt(parts[9], 10); // TX bytes
      }
    } else if (platform === 'darwin') {
      // Use netstat on macOS
      const { stdout } = await execAsync('netstat -ibn');
      const lines = stdout.trim().split('\n').slice(1); // Skip header

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 7) continue;

        // Skip loopback and non-active interfaces
        const iface = parts[0];
        if (iface === 'lo0' || parts[3] === '*') continue;

        rx += parseInt(parts[6], 10) || 0; // Ibytes
        tx += parseInt(parts[9], 10) || 0; // Obytes
      }
    }

    const now = Date.now();

    if (!previousNetStats) {
      // First call: store baseline and return 0
      previousNetStats = { rx, tx, timestamp: now };
      return { networkIn: 0, networkOut: 0 };
    }

    const timeDelta = (now - previousNetStats.timestamp) / 1000; // Convert to seconds
    const rxDelta = rx - previousNetStats.rx;
    const txDelta = tx - previousNetStats.tx;

    previousNetStats = { rx, tx, timestamp: now };

    return {
      networkIn: timeDelta > 0 ? Math.round(rxDelta / timeDelta) : 0,
      networkOut: timeDelta > 0 ? Math.round(txDelta / timeDelta) : 0,
    };
  } catch (err) {
    console.warn('Failed to detect network usage:', err);
  }

  return { networkIn: 0, networkOut: 0 };
}

// ============================================================================
// Main Metrics Collection
// ============================================================================

/**
 * Collect all system metrics.
 *
 * Returns CPU, memory, disk, and network usage statistics.
 * First call may return zeros for delta-based metrics (CPU, network).
 */
export async function collectMetrics(): Promise<SystemMetrics> {
  const [cpuUsage, memory, disk, network] = await Promise.all([
    getCpuUsage(),
    Promise.resolve(getMemoryUsage()),
    getDiskUsage(),
    getNetworkUsage(),
  ]);

  return {
    cpuUsage,
    ...memory,
    ...disk,
    ...network,
  };
}
