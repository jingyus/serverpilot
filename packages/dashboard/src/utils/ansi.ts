// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

/**
 * Parsed ANSI segment with optional foreground color class.
 */
export interface AnsiSegment {
  text: string;
  className?: string;
}

const ANSI_COLOR_MAP: Record<number, string> = {
  30: 'text-gray-900 dark:text-gray-300',   // black
  31: 'text-red-500',                        // red
  32: 'text-green-400',                      // green
  33: 'text-yellow-400',                     // yellow
  34: 'text-blue-400',                       // blue
  35: 'text-purple-400',                     // magenta
  36: 'text-cyan-400',                       // cyan
  37: 'text-gray-200',                       // white
  90: 'text-gray-500',                       // bright black
  91: 'text-red-400',                        // bright red
  92: 'text-green-300',                      // bright green
  93: 'text-yellow-300',                     // bright yellow
  94: 'text-blue-300',                       // bright blue
  95: 'text-purple-300',                     // bright magenta
  96: 'text-cyan-300',                       // bright cyan
  97: 'text-white',                          // bright white
};

const ANSI_BOLD = 'font-bold';
const ANSI_DIM = 'opacity-60';
const ANSI_UNDERLINE = 'underline';

// Matches ANSI escape sequences: ESC[ ... m
const ANSI_REGEX = /\x1b\[([0-9;]*)m/g;

/**
 * Parse a string containing ANSI escape codes into segments with CSS classes.
 * Unsupported codes are stripped. Returns plain segments for text without ANSI.
 */
export function parseAnsi(input: string): AnsiSegment[] {
  if (!input) return [];

  const segments: AnsiSegment[] = [];
  let currentClasses: string[] = [];
  let lastIndex = 0;

  ANSI_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ANSI_REGEX.exec(input)) !== null) {
    // Push text before this escape sequence
    if (match.index > lastIndex) {
      const text = input.slice(lastIndex, match.index);
      if (text) {
        segments.push({
          text,
          className: currentClasses.length > 0 ? currentClasses.join(' ') : undefined,
        });
      }
    }
    lastIndex = match.index + match[0].length;

    // Parse SGR parameters
    const params = match[1]
      ? match[1].split(';').map(Number)
      : [0];

    for (const code of params) {
      if (code === 0) {
        // Reset
        currentClasses = [];
      } else if (code === 1) {
        if (!currentClasses.includes(ANSI_BOLD)) currentClasses.push(ANSI_BOLD);
      } else if (code === 2) {
        if (!currentClasses.includes(ANSI_DIM)) currentClasses.push(ANSI_DIM);
      } else if (code === 4) {
        if (!currentClasses.includes(ANSI_UNDERLINE)) currentClasses.push(ANSI_UNDERLINE);
      } else if (ANSI_COLOR_MAP[code]) {
        // Remove any existing color class before adding new one
        currentClasses = currentClasses.filter(
          (c) => !Object.values(ANSI_COLOR_MAP).includes(c)
        );
        currentClasses.push(ANSI_COLOR_MAP[code]);
      }
    }
  }

  // Remaining text after last escape
  if (lastIndex < input.length) {
    const text = input.slice(lastIndex);
    if (text) {
      segments.push({
        text,
        className: currentClasses.length > 0 ? currentClasses.join(' ') : undefined,
      });
    }
  }

  // If no escape sequences were found, return the whole string as one segment
  if (segments.length === 0 && input) {
    segments.push({ text: input });
  }

  return segments;
}

/**
 * Strip all ANSI escape sequences from a string.
 */
export function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}
