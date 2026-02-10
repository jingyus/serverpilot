/**
 * Network detection module.
 *
 * Detects network connectivity, proxy settings, and reachability
 * of key services (npm registry, GitHub).
 *
 * @module detect/network
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

import type { EnvironmentInfo } from '@aiinstaller/shared';

/** Proxy configuration detected from environment variables. */
export interface ProxySettings {
  /** HTTP proxy URL, or undefined if not set */
  httpProxy?: string;
  /** HTTPS proxy URL, or undefined if not set */
  httpsProxy?: string;
  /** No-proxy exclusion list, or undefined if not set */
  noProxy?: string;
  /** Whether any proxy is configured */
  hasProxy: boolean;
}

/** Detailed network information beyond the basic EnvironmentInfo['network'] fields. */
export interface NetworkInfo {
  /** Whether the npm registry (registry.npmjs.org) is reachable */
  canAccessNpm: boolean;
  /** Whether GitHub (github.com) is reachable */
  canAccessGithub: boolean;
  /** Whether the system has basic internet connectivity */
  hasInternet: boolean;
  /** Proxy configuration from environment variables */
  proxy: ProxySettings;
  /** Human-readable label summarizing network status */
  label: string;
}

/**
 * Detect proxy settings from environment variables.
 *
 * Checks HTTP_PROXY, HTTPS_PROXY, NO_PROXY, and their lowercase variants.
 *
 * @returns Proxy configuration object
 */
export function detectProxy(): ProxySettings {
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy || undefined;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || undefined;

  return {
    httpProxy,
    httpsProxy,
    noProxy,
    hasProxy: !!(httpProxy || httpsProxy),
  };
}

/**
 * Check if a host is reachable by attempting an HTTP HEAD request.
 *
 * Uses curl with a short timeout to verify connectivity.
 *
 * @param host - Hostname to check (e.g. "registry.npmjs.org")
 * @param timeoutSeconds - Maximum time to wait in seconds (default: 5)
 * @returns true if the host is reachable
 */
export function canAccessHost(host: string, timeoutSeconds: number = 5): boolean {
  try {
    const res = spawnSync(
      'curl',
      ['-sS', '--max-time', String(timeoutSeconds), '--head', `https://${host}`],
      { encoding: 'utf-8', timeout: (timeoutSeconds + 5) * 1000 },
    );
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Detect whether the npm registry is reachable.
 *
 * @returns true if registry.npmjs.org responds to HTTPS
 */
export function detectNpmAccess(): boolean {
  return canAccessHost('registry.npmjs.org');
}

/**
 * Detect whether GitHub is reachable.
 *
 * @returns true if github.com responds to HTTPS
 */
export function detectGithubAccess(): boolean {
  return canAccessHost('github.com');
}

/**
 * Detect basic internet connectivity by checking a reliable public host.
 *
 * @returns true if the system can reach the internet
 */
export function detectInternetConnection(): boolean {
  return canAccessHost('dns.google', 3);
}

/**
 * Detect basic network info compatible with EnvironmentInfo['network'].
 *
 * @returns Network info with npm and GitHub reachability booleans
 */
export function detectNetworkStatus(): EnvironmentInfo['network'] {
  return {
    canAccessNpm: detectNpmAccess(),
    canAccessGithub: detectGithubAccess(),
  };
}

/**
 * Build a human-readable label summarizing the network status.
 */
function buildLabel(hasInternet: boolean, canAccessNpm: boolean, canAccessGithub: boolean, proxy: ProxySettings): string {
  if (!hasInternet) {
    return 'No internet connection';
  }

  const parts: string[] = [];

  parts.push('Internet: OK');

  if (canAccessNpm) {
    parts.push('npm: OK');
  } else {
    parts.push('npm: unreachable');
  }

  if (canAccessGithub) {
    parts.push('GitHub: OK');
  } else {
    parts.push('GitHub: unreachable');
  }

  if (proxy.hasProxy) {
    parts.push('Proxy: configured');
  }

  return parts.join(', ');
}

/**
 * Detect detailed network information including connectivity, proxy, and service reachability.
 *
 * @returns Detailed network info with proxy settings and human-readable label
 */
export function detectNetworkDetails(): NetworkInfo {
  const proxy = detectProxy();
  const hasInternet = detectInternetConnection();
  const canAccessNpm = hasInternet ? detectNpmAccess() : false;
  const canAccessGithub = hasInternet ? detectGithubAccess() : false;
  const label = buildLabel(hasInternet, canAccessNpm, canAccessGithub, proxy);

  return {
    canAccessNpm,
    canAccessGithub,
    hasInternet,
    proxy,
    label,
  };
}
