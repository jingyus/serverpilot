/**
 * Tests for the binary build script.
 *
 * Tests cover:
 * - CLI argument parsing
 * - Output filename generation
 * - Current platform detection
 * - File size formatting
 * - Checksums generation
 * - GitHub Releases integration
 * - Actual binary compilation (current platform only)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getOutputFilename,
  getCurrentTarget,
  formatSize,
  parseBuildArgs,
  buildForTarget,
  computeSha256,
  generateChecksums,
  isGhCliAvailable,
  MAX_BINARY_SIZE,
  validateBinarySize,
  compressBinary,
} from './build-binary.js';
import type { BuildResult } from './build-binary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// ============================================================================
// Unit tests — pure functions
// ============================================================================

describe('getOutputFilename', () => {
  it('returns correct filename for darwin-arm64', () => {
    expect(getOutputFilename('install-agent', 'bun-darwin-arm64')).toBe(
      'install-agent-darwin-arm64',
    );
  });

  it('returns correct filename for linux-x64', () => {
    expect(getOutputFilename('install-agent', 'bun-linux-x64')).toBe(
      'install-agent-linux-x64',
    );
  });

  it('returns correct filename for darwin-x64', () => {
    expect(getOutputFilename('install-agent', 'bun-darwin-x64')).toBe(
      'install-agent-darwin-x64',
    );
  });

  it('returns correct filename for linux-arm64', () => {
    expect(getOutputFilename('install-agent', 'bun-linux-arm64')).toBe(
      'install-agent-linux-arm64',
    );
  });

  it('uses custom binary name', () => {
    expect(getOutputFilename('my-app', 'bun-linux-x64')).toBe('my-app-linux-x64');
  });
});

describe('getCurrentTarget', () => {
  it('returns a valid BuildTarget string', () => {
    const target = getCurrentTarget();
    expect(target).toMatch(/^bun-(darwin|linux)-(arm64|x64)$/);
  });

  it('matches the current platform and arch', () => {
    const target = getCurrentTarget();
    const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    expect(target).toBe(`bun-${platform}-${arch}`);
  });
});

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(512)).toBe('512 B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(2560)).toBe('2.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(57.2 * 1024 * 1024)).toBe('57.2 MB');
  });

  it('formats zero', () => {
    expect(formatSize(0)).toBe('0 B');
  });
});

describe('parseBuildArgs', () => {
  it('uses current target by default', () => {
    const options = parseBuildArgs(['node', 'script']);
    expect(options.targets).toEqual([getCurrentTarget()]);
    expect(options.minify).toBe(true);
  });

  it('parses --all flag', () => {
    const options = parseBuildArgs(['node', 'script', '--all']);
    expect(options.targets).toHaveLength(4);
    expect(options.targets).toContain('bun-darwin-arm64');
    expect(options.targets).toContain('bun-darwin-x64');
    expect(options.targets).toContain('bun-linux-x64');
    expect(options.targets).toContain('bun-linux-arm64');
  });

  it('parses --target with full target name', () => {
    const options = parseBuildArgs(['node', 'script', '--target', 'bun-linux-x64']);
    expect(options.targets).toEqual(['bun-linux-x64']);
  });

  it('parses --target with shorthand', () => {
    const options = parseBuildArgs(['node', 'script', '--target', 'linux-arm64']);
    expect(options.targets).toEqual(['bun-linux-arm64']);
  });

  it('parses --no-minify', () => {
    const options = parseBuildArgs(['node', 'script', '--no-minify']);
    expect(options.minify).toBe(false);
  });

  it('throws on unknown target', () => {
    expect(() =>
      parseBuildArgs(['node', 'script', '--target', 'windows-x64']),
    ).toThrow(/Unknown target/);
  });

  it('throws when --target has no value', () => {
    expect(() =>
      parseBuildArgs(['node', 'script', '--target']),
    ).toThrow(/--target requires a value/);
  });

  it('sets correct defaults for outDir and entryPoint', () => {
    const options = parseBuildArgs(['node', 'script']);
    expect(options.outDir).toContain('packages/agent/dist/bin');
    expect(options.entryPoint).toContain('packages/agent/src/index.ts');
    expect(options.binaryName).toBe('install-agent');
  });
});

// ============================================================================
// Integration tests — actual compilation
// ============================================================================

describe('buildForTarget (integration)', () => {
  const testOutDir = join(PROJECT_ROOT, 'packages/agent/dist/bin-test');
  const entryPoint = join(PROJECT_ROOT, 'packages/agent/src/index.ts');

  afterAll(() => {
    if (existsSync(testOutDir)) {
      rmSync(testOutDir, { recursive: true, force: true });
    }
  });

  it('builds a working executable for the current platform', () => {
    const target = getCurrentTarget();
    const result = buildForTarget(target, {
      entryPoint,
      outDir: testOutDir,
      binaryName: 'test-agent',
      minify: true,
    });

    expect(result.success).toBe(true);
    expect(result.target).toBe(target);
    expect(result.size).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
    expect(existsSync(result.outfile)).toBe(true);

    // Binary should be a reasonable size (> 1MB due to bun runtime)
    const stat = statSync(result.outfile);
    expect(stat.size).toBeGreaterThan(1024 * 1024);
  }, 60000);

  it('produces a binary that responds to --version', () => {
    const target = getCurrentTarget();
    const outfile = join(testOutDir, getOutputFilename('test-agent', target));

    if (!existsSync(outfile)) {
      buildForTarget(target, {
        entryPoint,
        outDir: testOutDir,
        binaryName: 'test-agent',
        minify: true,
      });
    }

    const output = execSync(`"${outfile}" --version`, {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    }).trim();

    expect(output).toContain('@aiinstaller/agent');
    expect(output).toContain('0.1.0');
  }, 60000);

  it('produces a binary that responds to --help', () => {
    const target = getCurrentTarget();
    const outfile = join(testOutDir, getOutputFilename('test-agent', target));

    if (!existsSync(outfile)) {
      buildForTarget(target, {
        entryPoint,
        outDir: testOutDir,
        binaryName: 'test-agent',
        minify: true,
      });
    }

    const output = execSync(`"${outfile}" --help`, {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    }).trim();

    expect(output).toContain('Usage:');
    expect(output).toContain('--server');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--verbose');
  }, 60000);

  it('returns error for invalid entry point', () => {
    const target = getCurrentTarget();
    const result = buildForTarget(target, {
      entryPoint: '/nonexistent/file.ts',
      outDir: testOutDir,
      binaryName: 'should-fail',
      minify: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  }, 30000);
});

// ============================================================================
// Binary size optimization tests
// ============================================================================

describe('binary size optimization', () => {
  it('minified binary is smaller than non-minified', () => {
    const target = getCurrentTarget();
    const testOutDir2 = join(PROJECT_ROOT, 'packages/agent/dist/bin-size-test');
    const entryPoint = join(PROJECT_ROOT, 'packages/agent/src/index.ts');

    try {
      const minified = buildForTarget(target, {
        entryPoint,
        outDir: testOutDir2,
        binaryName: 'agent-min',
        minify: true,
      });

      const unminified = buildForTarget(target, {
        entryPoint,
        outDir: testOutDir2,
        binaryName: 'agent-nomin',
        minify: false,
      });

      expect(minified.success).toBe(true);
      expect(unminified.success).toBe(true);
      // Minified should be smaller or equal (bun runtime is the bulk)
      expect(minified.size!).toBeLessThanOrEqual(unminified.size!);
    } finally {
      if (existsSync(testOutDir2)) {
        rmSync(testOutDir2, { recursive: true, force: true });
      }
    }
  }, 120000);
});

// ============================================================================
// Checksums tests
// ============================================================================

describe('computeSha256', () => {
  const tmpDir = join(PROJECT_ROOT, 'packages/agent/dist/checksum-test');

  afterAll(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns correct SHA-256 hash for a known string', () => {
    mkdirSync(tmpDir, { recursive: true });
    const testFile = join(tmpDir, 'hash-test.txt');
    writeFileSync(testFile, 'hello world');

    const hash = computeSha256(testFile);
    // sha256("hello world") is well-known
    const expected = createHash('sha256').update('hello world').digest('hex');
    expect(hash).toBe(expected);
  });

  it('returns different hashes for different content', () => {
    mkdirSync(tmpDir, { recursive: true });
    const file1 = join(tmpDir, 'file1.txt');
    const file2 = join(tmpDir, 'file2.txt');
    writeFileSync(file1, 'content A');
    writeFileSync(file2, 'content B');

    expect(computeSha256(file1)).not.toBe(computeSha256(file2));
  });

  it('returns same hash for same content', () => {
    mkdirSync(tmpDir, { recursive: true });
    const file1 = join(tmpDir, 'same1.txt');
    const file2 = join(tmpDir, 'same2.txt');
    writeFileSync(file1, 'identical');
    writeFileSync(file2, 'identical');

    expect(computeSha256(file1)).toBe(computeSha256(file2));
  });
});

describe('generateChecksums', () => {
  const tmpDir = join(PROJECT_ROOT, 'packages/agent/dist/gen-checksum-test');

  afterAll(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates checksums.txt with correct format', () => {
    mkdirSync(tmpDir, { recursive: true });

    // Create mock binary files
    const bin1 = join(tmpDir, 'install-agent-darwin-arm64');
    const bin2 = join(tmpDir, 'install-agent-linux-x64');
    writeFileSync(bin1, 'binary-content-1');
    writeFileSync(bin2, 'binary-content-2');

    const results: BuildResult[] = [
      { target: 'bun-darwin-arm64', outfile: bin1, success: true, size: 100, duration: 50 },
      { target: 'bun-linux-x64', outfile: bin2, success: true, size: 200, duration: 60 },
    ];

    const checksumPath = generateChecksums(results, tmpDir);
    expect(existsSync(checksumPath)).toBe(true);

    const content = readFileSync(checksumPath, 'utf-8');
    const lines = content.trim().split('\n');
    // Each uncompressed binary gets a checksum line (no .gz files in this test)
    expect(lines).toHaveLength(2);

    // Each line should be: <64-char-hex>  <filename>
    for (const line of lines) {
      expect(line).toMatch(/^[a-f0-9]{64}  install-agent-(darwin-arm64|linux-x64)(\.gz)?$/);
    }
  });

  it('skips failed builds', () => {
    mkdirSync(tmpDir, { recursive: true });

    const bin1 = join(tmpDir, 'ok-binary');
    writeFileSync(bin1, 'ok');

    const results: BuildResult[] = [
      { target: 'bun-darwin-arm64', outfile: bin1, success: true, size: 2, duration: 10 },
      { target: 'bun-linux-x64', outfile: '/nonexistent', success: false, error: 'fail', duration: 5 },
    ];

    const checksumPath = generateChecksums(results, tmpDir);
    const content = readFileSync(checksumPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('ok-binary');
  });

  it('skips builds whose output file is missing', () => {
    mkdirSync(tmpDir, { recursive: true });

    const results: BuildResult[] = [
      { target: 'bun-darwin-arm64', outfile: join(tmpDir, 'ghost'), success: true, size: 0, duration: 10 },
    ];

    const checksumPath = generateChecksums(results, tmpDir);
    const content = readFileSync(checksumPath, 'utf-8');
    // Only the trailing newline
    expect(content.trim()).toBe('');
  });
});

// ============================================================================
// GitHub Releases tests
// ============================================================================

describe('isGhCliAvailable', () => {
  it('returns a boolean', () => {
    const result = isGhCliAvailable();
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================================
// validateBinarySize tests
// ============================================================================

describe('validateBinarySize', () => {
  const tmpDir = join(PROJECT_ROOT, 'packages/agent/dist/validate-size-test');

  afterAll(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns valid=true for a file under the limit', () => {
    mkdirSync(tmpDir, { recursive: true });
    const testFile = join(tmpDir, 'small-file');
    writeFileSync(testFile, 'small');

    const result = validateBinarySize(testFile, 1024);
    expect(result.valid).toBe(true);
    expect(result.size).toBeLessThanOrEqual(result.maxSize);
  });

  it('returns valid=false for a file over the limit', () => {
    mkdirSync(tmpDir, { recursive: true });
    const testFile = join(tmpDir, 'large-file');
    writeFileSync(testFile, Buffer.alloc(2048));

    const result = validateBinarySize(testFile, 1024);
    expect(result.valid).toBe(false);
    expect(result.size).toBeGreaterThan(result.maxSize);
  });

  it('uses MAX_BINARY_SIZE as default limit', () => {
    mkdirSync(tmpDir, { recursive: true });
    const testFile = join(tmpDir, 'default-limit');
    writeFileSync(testFile, 'test');

    const result = validateBinarySize(testFile);
    expect(result.maxSize).toBe(MAX_BINARY_SIZE);
    expect(result.maxSize).toBe(50 * 1024 * 1024);
  });
});

// ============================================================================
// compressBinary tests
// ============================================================================

describe('compressBinary', () => {
  const tmpDir = join(PROJECT_ROOT, 'packages/agent/dist/compress-test');

  afterAll(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates a .gz file smaller than the original', () => {
    mkdirSync(tmpDir, { recursive: true });
    const testFile = join(tmpDir, 'compressible');
    // Write repetitive data that compresses well
    writeFileSync(testFile, 'a'.repeat(10000));

    const { compressedFile, compressedSize } = compressBinary(testFile);
    expect(existsSync(compressedFile)).toBe(true);
    expect(compressedFile).toBe(`${testFile}.gz`);
    expect(compressedSize).toBeLessThan(10000);
    expect(compressedSize).toBeGreaterThan(0);
  });
});

// ============================================================================
// Binary size acceptance test — compressed distributable < 50 MB
// ============================================================================

describe('binary size acceptance: compressed distributable < 50 MB', () => {
  const testOutDir = join(PROJECT_ROOT, 'packages/agent/dist/bin-acceptance');
  const entryPoint = join(PROJECT_ROOT, 'packages/agent/src/index.ts');

  afterAll(() => {
    if (existsSync(testOutDir)) {
      rmSync(testOutDir, { recursive: true, force: true });
    }
  });

  it('compressed client binary for current platform is under 50 MB', () => {
    const target = getCurrentTarget();
    const result = buildForTarget(target, {
      entryPoint,
      outDir: testOutDir,
      binaryName: 'size-check-agent',
      minify: true,
    });

    expect(result.success).toBe(true);
    expect(existsSync(result.outfile)).toBe(true);
    expect(result.compressedFile).toBeDefined();
    expect(existsSync(result.compressedFile!)).toBe(true);

    // The compressed distributable must be under 50 MB
    const compressedSizeMB = (result.compressedSize! / (1024 * 1024)).toFixed(2);
    const rawSizeMB = (result.size! / (1024 * 1024)).toFixed(2);

    console.log(`Raw binary size: ${rawSizeMB} MB`);
    console.log(`Compressed size: ${compressedSizeMB} MB (limit: ${formatSize(MAX_BINARY_SIZE)})`);
    console.log(`Compression ratio: ${((1 - result.compressedSize! / result.size!) * 100).toFixed(1)}%`);

    expect(result.compressedSize!).toBeLessThanOrEqual(MAX_BINARY_SIZE);
  }, 120000);
});
