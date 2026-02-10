/**
 * Device fingerprint generation module.
 *
 * Generates a unique, stable device identifier based on hardware and OS characteristics.
 * The fingerprint is used for device authentication and quota tracking.
 *
 * @module detect/device-fingerprint
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import os from 'node:os';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Device fingerprint information stored locally.
 */
export interface DeviceFingerprint {
  /** Unique device identifier hash */
  deviceId: string;
  /** Hostname of the device */
  hostname: string;
  /** Operating system platform */
  platform: string;
  /** CPU architecture */
  arch: string;
  /** MAC address (hashed for privacy) */
  macAddressHash: string;
  /** Username */
  username: string;
  /** Timestamp when fingerprint was first created */
  createdAt: string;
  /** Timestamp when fingerprint was last verified */
  lastVerifiedAt: string;
}

/**
 * Device authentication token and metadata.
 */
export interface DeviceAuthInfo extends DeviceFingerprint {
  /** Authentication token from server (optional, set after registration) */
  deviceToken?: string;
}

/**
 * Configuration for device fingerprint storage.
 */
export interface DeviceFingerprintConfig {
  /** Directory to store device.json (default: ~/.aiinstaller) */
  configDir?: string;
  /** Filename for device info (default: device.json) */
  filename?: string;
}

const DEFAULT_CONFIG_DIR = path.join(homedir(), '.aiinstaller');
const DEFAULT_FILENAME = 'device.json';

/**
 * Get the first non-internal MAC address from network interfaces.
 * Returns undefined if no suitable MAC address is found.
 */
function getMACAddress(): string | undefined {
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (!interfaces) continue;

    for (const net of interfaces) {
      // Skip internal (loopback) and non-physical interfaces
      if (net.internal || !net.mac || net.mac === '00:00:00:00:00:00') {
        continue;
      }

      return net.mac;
    }
  }

  return undefined;
}

/**
 * Hash a MAC address for privacy.
 * Returns a SHA-256 hash of the MAC address.
 */
function hashMACAddress(mac: string): string {
  return createHash('sha256').update(mac).digest('hex').substring(0, 16);
}

/**
 * Generate a unique device fingerprint based on system characteristics.
 *
 * The fingerprint is created by hashing:
 * - Hostname
 * - OS Platform
 * - CPU Architecture
 * - MAC Address (first non-internal interface)
 * - Username
 *
 * @returns Device fingerprint object
 */
export function generateDeviceFingerprint(): DeviceFingerprint {
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  const username = os.userInfo().username;

  // Get MAC address and hash it for privacy
  const mac = getMACAddress() || 'no-mac-address';
  const macAddressHash = hashMACAddress(mac);

  // Create device ID by hashing all components
  const components = [hostname, platform, arch, mac, username];
  const deviceId = createHash('sha256')
    .update(components.join('|'))
    .digest('hex');

  const now = new Date().toISOString();

  return {
    deviceId,
    hostname,
    platform,
    arch,
    macAddressHash,
    username,
    createdAt: now,
    lastVerifiedAt: now,
  };
}

/**
 * Get the path to the device configuration file.
 */
function getDeviceConfigPath(config?: DeviceFingerprintConfig): string {
  const configDir = config?.configDir || DEFAULT_CONFIG_DIR;
  const filename = config?.filename || DEFAULT_FILENAME;
  return path.join(configDir, filename);
}

/**
 * Load device fingerprint from local storage.
 * Returns undefined if the file doesn't exist or is invalid.
 *
 * @param config - Configuration for storage location
 * @returns Device authentication info or undefined
 */
export function loadDeviceFingerprint(config?: DeviceFingerprintConfig): DeviceAuthInfo | undefined {
  const filePath = getDeviceConfigPath(config);

  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as DeviceAuthInfo;

    // Basic validation
    if (!data.deviceId || !data.hostname || !data.platform) {
      return undefined;
    }

    return data;
  } catch {
    // Invalid JSON or read error
    return undefined;
  }
}

/**
 * Save device fingerprint to local storage.
 * Creates the config directory if it doesn't exist.
 *
 * @param fingerprint - Device fingerprint to save
 * @param config - Configuration for storage location
 */
export function saveDeviceFingerprint(
  fingerprint: DeviceAuthInfo,
  config?: DeviceFingerprintConfig
): void {
  const configDir = config?.configDir || DEFAULT_CONFIG_DIR;
  const filePath = getDeviceConfigPath(config);

  // Create config directory if it doesn't exist
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Write fingerprint to file
  const content = JSON.stringify(fingerprint, null, 2);
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Get or create device fingerprint.
 *
 * This is the main function to use for device identification:
 * - If a fingerprint exists locally, load and verify it
 * - If not, generate a new fingerprint and save it
 * - Updates lastVerifiedAt timestamp on each call
 *
 * @param config - Configuration for storage location
 * @returns Device authentication info
 */
export function getOrCreateDeviceFingerprint(
  config?: DeviceFingerprintConfig
): DeviceAuthInfo {
  // Try to load existing fingerprint
  let device = loadDeviceFingerprint(config);

  if (device) {
    // Verify that the device fingerprint still matches
    const currentFingerprint = generateDeviceFingerprint();

    if (device.deviceId === currentFingerprint.deviceId) {
      // Update lastVerifiedAt
      device.lastVerifiedAt = new Date().toISOString();
      saveDeviceFingerprint(device, config);
      return device;
    }

    // Device changed (hostname, username, or hardware changed)
    // Generate new fingerprint but keep the token if it exists
    const deviceToken = device.deviceToken;
    device = {
      ...currentFingerprint,
      deviceToken,
    };
  } else {
    // No existing fingerprint, create new one
    device = generateDeviceFingerprint();
  }

  // Save and return
  saveDeviceFingerprint(device, config);
  return device;
}

/**
 * Update device token after successful registration with server.
 *
 * @param deviceToken - Authentication token from server
 * @param config - Configuration for storage location
 */
export function updateDeviceToken(
  deviceToken: string,
  config?: DeviceFingerprintConfig
): void {
  const device = getOrCreateDeviceFingerprint(config);
  device.deviceToken = deviceToken;
  saveDeviceFingerprint(device, config);
}

/**
 * Clear device fingerprint and token from local storage.
 * Useful for testing or when user wants to reset device registration.
 *
 * @param config - Configuration for storage location
 * @returns true if file was deleted, false if it didn't exist
 */
export function clearDeviceFingerprint(config?: DeviceFingerprintConfig): boolean {
  const filePath = getDeviceConfigPath(config);

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const fs = require('node:fs');
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if device fingerprint has changed since last verification.
 * Returns true if the current system fingerprint matches the stored one.
 *
 * @param config - Configuration for storage location
 * @returns true if fingerprint is stable, false if changed or not found
 */
export function isDeviceFingerprintStable(config?: DeviceFingerprintConfig): boolean {
  const stored = loadDeviceFingerprint(config);
  if (!stored) {
    return false;
  }

  const current = generateDeviceFingerprint();
  return stored.deviceId === current.deviceId;
}
