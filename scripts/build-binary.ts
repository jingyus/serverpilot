#!/usr/bin/env bun
/**
 * Build script for compiling the agent into standalone executables
 * using `bun build --compile`.
 *
 * Supports cross-compilation for multiple platforms:
 *   - darwin-arm64  (macOS Apple Silicon)
 *   - darwin-x64    (macOS Intel)
 *   - linux-x64     (Linux x86_64)
 *   - linux-arm64   (Linux ARM64)
 *
 * Usage:
 *   bun scripts/build-binary.ts                  # Build for current platform
 *   bun scripts/build-binary.ts --all            # Build for all platforms
 *   bun scripts/build-binary.ts --target linux-x64
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Types
// ============================================================================

/** Supported build target platforms. */
export type BuildTarget =
  | 'bun-darwin-arm64'
  | 'bun-darwin-x64'
  | 'bun-linux-x64'
  | 'bun-linux-arm64';

/** Result of a single platform build. */
export interface BuildResult {
  target: BuildTarget;
  outfile: string;
  success: boolean;
  size?: number;
  /** Path to the gzip-compressed distributable */
  compressedFile?: string;
  /** Size of the compressed distributable in bytes */
  compressedSize?: number;
  error?: string;
  duration: number;
}

/** Options for the build process. */
export interface BuildOptions {
  /** Build targets to compile for */
  targets: BuildTarget[];
  /** Output directory (default: packages/agent/dist/bin) */
  outDir: string;
  /** Entry point (default: packages/agent/src/index.ts) */
  entryPoint: string;
  /** Output binary name prefix */
  binaryName: string;
  /** Enable minification (default: true) */
  minify: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const DEFAULT_ENTRY_POINT = join(PROJECT_ROOT, 'packages/agent/src/index.ts');
const DEFAULT_OUT_DIR = join(PROJECT_ROOT, 'packages/agent/dist/bin');
const DEFAULT_BINARY_NAME = 'install-agent';

const ALL_TARGETS: BuildTarget[] = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64',
  'bun-linux-arm64',
];

/** Maximum allowed binary size: 50 MB */
export const MAX_BINARY_SIZE = 50 * 1024 * 1024;

// ============================================================================
// Build functions
// ============================================================================

/**
 * Get the output filename for a given target.
 */
export function getOutputFilename(binaryName: string, target: BuildTarget): string {
  // Extract platform info from target like "bun-darwin-arm64"
  const parts = target.replace('bun-', '').split('-');
  const os = parts[0];
  const arch = parts[1];
  return `${binaryName}-${os}-${arch}`;
}

/**
 * Get the current platform's build target.
 */
export function getCurrentTarget(): BuildTarget {
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `bun-${platform}-${arch}` as BuildTarget;
}

/**
 * Build a single executable for a given target.
 */
export function buildForTarget(
  target: BuildTarget,
  options: Pick<BuildOptions, 'entryPoint' | 'outDir' | 'binaryName' | 'minify'>,
): BuildResult {
  const outfile = join(options.outDir, getOutputFilename(options.binaryName, target));
  const start = Date.now();

  try {
    // Ensure output directory exists
    if (!existsSync(options.outDir)) {
      mkdirSync(options.outDir, { recursive: true });
    }

    // Build command
    const args = [
      'bun', 'build',
      '--compile',
      options.entryPoint,
      '--outfile', outfile,
      '--target', target,
    ];

    if (options.minify) {
      args.push('--minify');
    }

    const cmd = args.join(' ');
    execSync(cmd, {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    });

    const size = existsSync(outfile) ? statSync(outfile).size : 0;

    // Compress for distribution
    let compressedFile: string | undefined;
    let compressedSize: number | undefined;
    if (existsSync(outfile)) {
      const compressed = compressBinary(outfile);
      compressedFile = compressed.compressedFile;
      compressedSize = compressed.compressedSize;
    }

    return {
      target,
      outfile,
      success: true,
      size,
      compressedFile,
      compressedSize,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      target,
      outfile,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      duration: Date.now() - start,
    };
  }
}

/**
 * Build executables for all specified targets.
 */
export function buildAll(options: BuildOptions): BuildResult[] {
  const results: BuildResult[] = [];

  for (const target of options.targets) {
    console.log(`\n  Building for ${target}...`);
    const result = buildForTarget(target, options);

    if (result.success) {
      const compressedInfo = result.compressedSize
        ? `, compressed: ${formatSize(result.compressedSize)}`
        : '';
      const sizeInfo = result.compressedSize && result.compressedSize > MAX_BINARY_SIZE
        ? ` ⚠️  EXCEEDS ${formatSize(MAX_BINARY_SIZE)} LIMIT`
        : '';
      console.log(`  ✓ ${target} → ${result.outfile} (${formatSize(result.size!)}${compressedInfo} in ${result.duration}ms)${sizeInfo}`);
    } else {
      console.log(`  ✗ ${target} failed: ${result.error}`);
    }

    results.push(result);
  }

  return results;
}

/**
 * Format file size in human-readable format.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate that a binary does not exceed the maximum allowed size.
 * Returns true if the binary is within the limit.
 */
export function validateBinarySize(filePath: string, maxSize: number = MAX_BINARY_SIZE): { valid: boolean; size: number; maxSize: number } {
  const size = statSync(filePath).size;
  return { valid: size <= maxSize, size, maxSize };
}

/**
 * Compress a binary file using gzip (level 9) for distribution.
 * Returns the path and size of the compressed file.
 */
export function compressBinary(filePath: string): { compressedFile: string; compressedSize: number } {
  const data = readFileSync(filePath);
  const compressed = gzipSync(data, { level: 9 });
  const compressedFile = `${filePath}.gz`;
  writeFileSync(compressedFile, compressed);
  return { compressedFile, compressedSize: compressed.length };
}

// ============================================================================
// Checksums
// ============================================================================

/**
 * Compute the SHA-256 hash of a file.
 */
export function computeSha256(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate checksums.txt for all successfully built binaries.
 * Each line: `<sha256>  <filename>`
 */
export function generateChecksums(results: BuildResult[], outDir: string): string {
  const lines: string[] = [];

  for (const result of results) {
    if (!result.success) continue;
    // Checksum for compressed distributable (primary)
    if (result.compressedFile && existsSync(result.compressedFile)) {
      const hash = computeSha256(result.compressedFile);
      const filename = basename(result.compressedFile);
      lines.push(`${hash}  ${filename}`);
    }
    // Checksum for uncompressed binary (fallback)
    if (existsSync(result.outfile)) {
      const hash = computeSha256(result.outfile);
      const filename = basename(result.outfile);
      lines.push(`${hash}  ${filename}`);
    }
  }

  const content = lines.join('\n') + '\n';
  const checksumPath = join(outDir, 'checksums.txt');
  writeFileSync(checksumPath, content, 'utf-8');

  return checksumPath;
}

// ============================================================================
// GitHub Releases upload
// ============================================================================

export interface ReleaseOptions {
  /** Git tag for the release (e.g. "v1.1.0") */
  tag: string;
  /** Release title */
  title: string;
  /** Release notes */
  notes: string;
  /** Whether this is a draft release */
  draft: boolean;
  /** Whether this is a prerelease */
  prerelease: boolean;
}

/**
 * Check if the `gh` CLI is available.
 */
export function isGhCliAvailable(): boolean {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a GitHub Release and upload binary assets using `gh` CLI.
 * Returns the release URL on success.
 */
export function createGithubRelease(
  results: BuildResult[],
  outDir: string,
  options: ReleaseOptions,
): string {
  // Collect files to upload (successful binaries + checksums)
  const files: string[] = [];

  for (const result of results) {
    if (!result.success) continue;
    // Upload compressed version (preferred for distribution)
    if (result.compressedFile && existsSync(result.compressedFile)) {
      files.push(result.compressedFile);
    }
    // Also upload uncompressed binary
    if (existsSync(result.outfile)) {
      files.push(result.outfile);
    }
  }

  const checksumPath = join(outDir, 'checksums.txt');
  if (existsSync(checksumPath)) {
    files.push(checksumPath);
  }

  if (files.length === 0) {
    throw new Error('No files to upload');
  }

  // Build gh release create command
  const args = [
    'gh', 'release', 'create',
    options.tag,
    '--title', JSON.stringify(options.title),
    '--notes', JSON.stringify(options.notes),
  ];

  if (options.draft) args.push('--draft');
  if (options.prerelease) args.push('--prerelease');

  // Append file paths
  for (const file of files) {
    args.push(JSON.stringify(file));
  }

  const cmd = args.join(' ');
  const output = execSync(cmd, {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    stdio: 'pipe',
  }).trim();

  return output; // gh outputs the release URL
}

// ============================================================================
// CLI
// ============================================================================

/**
 * Parse CLI arguments for the build script.
 */
export function parseBuildArgs(argv: string[]): BuildOptions {
  const args = argv.slice(2);
  let targets: BuildTarget[] = [getCurrentTarget()];
  let minify = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') {
      targets = [...ALL_TARGETS];
    } else if (arg === '--target') {
      const next = args[i + 1];
      if (!next) throw new Error('--target requires a value');
      // Allow shorthand like "linux-x64" and full "bun-linux-x64"
      const target = next.startsWith('bun-') ? next : `bun-${next}`;
      if (!ALL_TARGETS.includes(target as BuildTarget)) {
        throw new Error(`Unknown target: ${next}. Valid targets: ${ALL_TARGETS.map(t => t.replace('bun-', '')).join(', ')}`);
      }
      targets = [target as BuildTarget];
      i++;
    } else if (arg === '--no-minify') {
      minify = false;
    }
  }

  return {
    targets,
    outDir: DEFAULT_OUT_DIR,
    entryPoint: DEFAULT_ENTRY_POINT,
    binaryName: DEFAULT_BINARY_NAME,
    minify,
  };
}

// ============================================================================
// Main entry
// ============================================================================

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  console.log('AI Installer Agent - Binary Build');
  console.log('=================================\n');

  try {
    const options = parseBuildArgs(process.argv);
    console.log(`Entry point: ${options.entryPoint}`);
    console.log(`Output dir:  ${options.outDir}`);
    console.log(`Targets:     ${options.targets.map(t => t.replace('bun-', '')).join(', ')}`);
    console.log(`Minify:      ${options.minify}`);

    const results = buildAll(options);

    // Generate checksums for all successful builds
    if (results.some(r => r.success)) {
      const checksumPath = generateChecksums(results, options.outDir);
      console.log(`\n  ✓ Checksums written to ${checksumPath}`);
    }

    console.log('\n=================================');
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`Results: ${succeeded} succeeded, ${failed} failed`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
