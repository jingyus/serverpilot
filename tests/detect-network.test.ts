/**
 * Tests for packages/agent/src/detect/network.ts
 *
 * Network detection module - connectivity, proxy settings,
 * npm registry and GitHub reachability.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canAccessHost,
  detectGithubAccess,
  detectInternetConnection,
  detectNetworkDetails,
  detectNetworkStatus,
  detectNpmAccess,
  detectProxy,
} from '../packages/agent/src/detect/network.js';
import type { NetworkInfo, ProxySettings } from '../packages/agent/src/detect/network.js';
import { EnvironmentInfoSchema } from '@aiinstaller/shared';

// ============================================================================
// File Existence
// ============================================================================

describe('detect/network.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/network.ts');

  it('should exist', () => {
    expect(existsSync(filePath)).toBe(true);
  });

  it('should not be empty', () => {
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Exports
// ============================================================================

describe('detect/network.ts - exports', () => {
  it('should export detectProxy function', () => {
    expect(typeof detectProxy).toBe('function');
  });

  it('should export canAccessHost function', () => {
    expect(typeof canAccessHost).toBe('function');
  });

  it('should export detectNpmAccess function', () => {
    expect(typeof detectNpmAccess).toBe('function');
  });

  it('should export detectGithubAccess function', () => {
    expect(typeof detectGithubAccess).toBe('function');
  });

  it('should export detectInternetConnection function', () => {
    expect(typeof detectInternetConnection).toBe('function');
  });

  it('should export detectNetworkStatus function', () => {
    expect(typeof detectNetworkStatus).toBe('function');
  });

  it('should export detectNetworkDetails function', () => {
    expect(typeof detectNetworkDetails).toBe('function');
  });
});

// ============================================================================
// detectProxy
// ============================================================================

describe('detectProxy()', () => {
  it('should return an object with hasProxy boolean', () => {
    const result = detectProxy();
    expect(typeof result.hasProxy).toBe('boolean');
  });

  it('should return ProxySettings with all expected fields', () => {
    const result = detectProxy();
    expect(result).toHaveProperty('hasProxy');
    expect(result).toHaveProperty('httpProxy');
    expect(result).toHaveProperty('httpsProxy');
    expect(result).toHaveProperty('noProxy');
  });

  it('should detect HTTP_PROXY if set', () => {
    const original = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = 'http://proxy.example.com:8080';
    try {
      const result = detectProxy();
      expect(result.httpProxy).toBe('http://proxy.example.com:8080');
      expect(result.hasProxy).toBe(true);
    } finally {
      if (original !== undefined) {
        process.env.HTTP_PROXY = original;
      } else {
        delete process.env.HTTP_PROXY;
      }
    }
  });

  it('should detect HTTPS_PROXY if set', () => {
    const original = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'https://proxy.example.com:8443';
    try {
      const result = detectProxy();
      expect(result.httpsProxy).toBe('https://proxy.example.com:8443');
      expect(result.hasProxy).toBe(true);
    } finally {
      if (original !== undefined) {
        process.env.HTTPS_PROXY = original;
      } else {
        delete process.env.HTTPS_PROXY;
      }
    }
  });

  it('should detect lowercase http_proxy if set', () => {
    const originalUpper = process.env.HTTP_PROXY;
    const originalLower = process.env.http_proxy;
    delete process.env.HTTP_PROXY;
    process.env.http_proxy = 'http://lower-proxy.example.com:8080';
    try {
      const result = detectProxy();
      expect(result.httpProxy).toBe('http://lower-proxy.example.com:8080');
      expect(result.hasProxy).toBe(true);
    } finally {
      if (originalUpper !== undefined) {
        process.env.HTTP_PROXY = originalUpper;
      } else {
        delete process.env.HTTP_PROXY;
      }
      if (originalLower !== undefined) {
        process.env.http_proxy = originalLower;
      } else {
        delete process.env.http_proxy;
      }
    }
  });

  it('should detect NO_PROXY if set', () => {
    const original = process.env.NO_PROXY;
    process.env.NO_PROXY = 'localhost,127.0.0.1';
    try {
      const result = detectProxy();
      expect(result.noProxy).toBe('localhost,127.0.0.1');
    } finally {
      if (original !== undefined) {
        process.env.NO_PROXY = original;
      } else {
        delete process.env.NO_PROXY;
      }
    }
  });

  it('should return hasProxy false when no proxy is configured', () => {
    const originals = {
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      http_proxy: process.env.http_proxy,
      https_proxy: process.env.https_proxy,
    };
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    try {
      const result = detectProxy();
      expect(result.hasProxy).toBe(false);
      expect(result.httpProxy).toBeUndefined();
      expect(result.httpsProxy).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        if (value !== undefined) {
          process.env[key] = value;
        } else {
          delete process.env[key];
        }
      }
    }
  });
});

// ============================================================================
// canAccessHost
// ============================================================================

describe('canAccessHost()', () => {
  it('should return a boolean', () => {
    const result = canAccessHost('dns.google', 3);
    expect(typeof result).toBe('boolean');
  });

  it('should return false for a non-existent host', () => {
    const result = canAccessHost('this-host-does-not-exist.invalid', 2);
    expect(result).toBe(false);
  });

  it('should accept a custom timeout', () => {
    // Should not throw with a custom timeout
    const result = canAccessHost('dns.google', 2);
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================================
// detectNpmAccess
// ============================================================================

describe('detectNpmAccess()', () => {
  it('should return a boolean', () => {
    const result = detectNpmAccess();
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================================
// detectGithubAccess
// ============================================================================

describe('detectGithubAccess()', () => {
  it('should return a boolean', () => {
    const result = detectGithubAccess();
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================================
// detectInternetConnection
// ============================================================================

describe('detectInternetConnection()', () => {
  it('should return a boolean', () => {
    const result = detectInternetConnection();
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================================
// detectNetworkStatus
// ============================================================================

describe('detectNetworkStatus()', () => {
  it('should return an object with canAccessNpm and canAccessGithub', () => {
    const result = detectNetworkStatus();
    expect(result).toHaveProperty('canAccessNpm');
    expect(result).toHaveProperty('canAccessGithub');
  });

  it('should return boolean values', () => {
    const result = detectNetworkStatus();
    expect(typeof result.canAccessNpm).toBe('boolean');
    expect(typeof result.canAccessGithub).toBe('boolean');
  });
});

// ============================================================================
// detectNetworkDetails
// ============================================================================

describe('detectNetworkDetails()', () => {
  it('should return an object with all required fields', () => {
    const result = detectNetworkDetails();
    expect(result).toHaveProperty('canAccessNpm');
    expect(result).toHaveProperty('canAccessGithub');
    expect(result).toHaveProperty('hasInternet');
    expect(result).toHaveProperty('proxy');
    expect(result).toHaveProperty('label');
  });

  it('should have boolean values for connectivity fields', () => {
    const result = detectNetworkDetails();
    expect(typeof result.canAccessNpm).toBe('boolean');
    expect(typeof result.canAccessGithub).toBe('boolean');
    expect(typeof result.hasInternet).toBe('boolean');
  });

  it('should have a proxy object with hasProxy', () => {
    const result = detectNetworkDetails();
    expect(typeof result.proxy).toBe('object');
    expect(typeof result.proxy.hasProxy).toBe('boolean');
  });

  it('should have a non-empty label string', () => {
    const result = detectNetworkDetails();
    expect(typeof result.label).toBe('string');
    expect(result.label.length).toBeGreaterThan(0);
  });

  it('should have consistent state: if no internet, npm and github should be false', () => {
    const result = detectNetworkDetails();
    if (!result.hasInternet) {
      expect(result.canAccessNpm).toBe(false);
      expect(result.canAccessGithub).toBe(false);
    }
  });

  it('should include "Internet" in the label', () => {
    const result = detectNetworkDetails();
    expect(result.label).toMatch(/Internet|internet/i);
  });
});

// ============================================================================
// NetworkInfo type
// ============================================================================

describe('NetworkInfo type', () => {
  it('should be compatible with the expected interface shape', () => {
    const info: NetworkInfo = {
      canAccessNpm: true,
      canAccessGithub: true,
      hasInternet: true,
      proxy: {
        httpProxy: 'http://proxy.example.com:8080',
        httpsProxy: undefined,
        noProxy: 'localhost',
        hasProxy: true,
      },
      label: 'Internet: OK, npm: OK, GitHub: OK, Proxy: configured',
    };
    expect(info.canAccessNpm).toBe(true);
    expect(info.proxy.hasProxy).toBe(true);
    expect(info.label).toContain('Internet');
  });

  it('should allow all-false connectivity', () => {
    const info: NetworkInfo = {
      canAccessNpm: false,
      canAccessGithub: false,
      hasInternet: false,
      proxy: { hasProxy: false },
      label: 'No internet connection',
    };
    expect(info.hasInternet).toBe(false);
    expect(info.canAccessNpm).toBe(false);
    expect(info.canAccessGithub).toBe(false);
  });
});

// ============================================================================
// ProxySettings type
// ============================================================================

describe('ProxySettings type', () => {
  it('should allow all optional fields to be undefined', () => {
    const settings: ProxySettings = {
      hasProxy: false,
    };
    expect(settings.httpProxy).toBeUndefined();
    expect(settings.httpsProxy).toBeUndefined();
    expect(settings.noProxy).toBeUndefined();
  });

  it('should support full proxy configuration', () => {
    const settings: ProxySettings = {
      httpProxy: 'http://proxy:8080',
      httpsProxy: 'https://proxy:8443',
      noProxy: 'localhost,127.0.0.1,.internal.corp',
      hasProxy: true,
    };
    expect(settings.httpProxy).toBe('http://proxy:8080');
    expect(settings.httpsProxy).toBe('https://proxy:8443');
    expect(settings.noProxy).toContain('localhost');
  });
});

// ============================================================================
// Schema Compatibility
// ============================================================================

describe('Schema compatibility', () => {
  it('should produce EnvironmentInfo-compatible network object', () => {
    const result = detectNetworkStatus();
    const envInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: {},
      packageManagers: {},
      network: result,
      permissions: { hasSudo: false, canWriteTo: [] },
    };
    expect(() => EnvironmentInfoSchema.parse(envInfo)).not.toThrow();
  });

  it('should produce valid schema with both false values', () => {
    const envInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: {},
      packageManagers: {},
      network: { canAccessNpm: false, canAccessGithub: false },
      permissions: { hasSudo: false, canWriteTo: [] },
    };
    expect(() => EnvironmentInfoSchema.parse(envInfo)).not.toThrow();
  });

  it('should produce valid schema with both true values', () => {
    const envInfo = {
      os: { platform: 'darwin', version: '15.5', arch: 'arm64' },
      shell: { type: 'zsh', version: '5.9' },
      runtime: {},
      packageManagers: {},
      network: { canAccessNpm: true, canAccessGithub: true },
      permissions: { hasSudo: false, canWriteTo: [] },
    };
    expect(() => EnvironmentInfoSchema.parse(envInfo)).not.toThrow();
  });
});

// ============================================================================
// Code Quality
// ============================================================================

describe('detect/network.ts - code quality', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/detect/network.ts');
  const content = readFileSync(filePath, 'utf-8');

  it('should use node:child_process import', () => {
    expect(content).toContain("from 'node:child_process'");
  });

  it('should use node:process import', () => {
    expect(content).toContain("from 'node:process'");
  });

  it('should import EnvironmentInfo type from @aiinstaller/shared', () => {
    expect(content).toContain('@aiinstaller/shared');
    expect(content).toContain('EnvironmentInfo');
  });

  it('should use type import for EnvironmentInfo', () => {
    expect(content).toMatch(/import\s+type\s+/);
  });

  it('should export detectProxy function', () => {
    expect(content).toMatch(/export\s+function\s+detectProxy/);
  });

  it('should export canAccessHost function', () => {
    expect(content).toMatch(/export\s+function\s+canAccessHost/);
  });

  it('should export detectNpmAccess function', () => {
    expect(content).toMatch(/export\s+function\s+detectNpmAccess/);
  });

  it('should export detectGithubAccess function', () => {
    expect(content).toMatch(/export\s+function\s+detectGithubAccess/);
  });

  it('should export detectInternetConnection function', () => {
    expect(content).toMatch(/export\s+function\s+detectInternetConnection/);
  });

  it('should export detectNetworkStatus function', () => {
    expect(content).toMatch(/export\s+function\s+detectNetworkStatus/);
  });

  it('should export detectNetworkDetails function', () => {
    expect(content).toMatch(/export\s+function\s+detectNetworkDetails/);
  });

  it('should export NetworkInfo interface', () => {
    expect(content).toMatch(/export\s+interface\s+NetworkInfo/);
  });

  it('should export ProxySettings interface', () => {
    expect(content).toMatch(/export\s+interface\s+ProxySettings/);
  });

  it('should have JSDoc comments for exported functions', () => {
    expect(content).toContain('Detect proxy settings');
    expect(content).toContain('Check if a host is reachable');
    expect(content).toContain('Detect whether the npm registry is reachable');
    expect(content).toContain('Detect whether GitHub is reachable');
    expect(content).toContain('Detect basic internet connectivity');
    expect(content).toContain('Detect basic network info');
    expect(content).toContain('Detect detailed network information');
  });

  it('should use spawnSync with timeout', () => {
    expect(content).toContain('spawnSync');
    expect(content).toContain('timeout');
  });

  it('should have a module docblock', () => {
    expect(content).toContain('@module detect/network');
  });

  it('should check proxy environment variables', () => {
    expect(content).toContain('HTTP_PROXY');
    expect(content).toContain('HTTPS_PROXY');
    expect(content).toContain('NO_PROXY');
  });

  it('should reference npm registry host', () => {
    expect(content).toContain('registry.npmjs.org');
  });

  it('should reference github.com host', () => {
    expect(content).toContain('github.com');
  });
});
