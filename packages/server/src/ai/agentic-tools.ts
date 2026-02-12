// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/** Tool definitions and input schemas for the Agentic Chat Engine. */

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Tool Definitions

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'execute_command',
    description:
      'Execute a shell command on the target server. ' +
      'The command runs in /bin/sh. ' +
      'Use this for all server operations: checking status, installing software, reading configs, etc. ' +
      'Output (stdout + stderr) is returned. ' +
      'IMPORTANT: Commands are security-classified. ' +
      'Read-only commands (ls, cat, df, ps, etc.) execute instantly. ' +
      'Modification commands (apt install, systemctl restart, etc.) may require user approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        description: {
          type: 'string',
          description: 'Brief description of what this command does (for audit logging)',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Timeout in seconds (default: 30, max: 600)',
        },
      },
      required: ['command', 'description'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read the contents of a file on the server. ' +
      'Shortcut for cat that handles large files by reading first/last lines.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute file path to read',
        },
        max_lines: {
          type: 'number',
          description: 'Maximum lines to read (default: 200). For large files, reads first and last portions.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description:
      'List files and directories at a given path. ' +
      'Returns file names, sizes, and permissions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (default: current directory)',
        },
        show_hidden: {
          type: 'boolean',
          description: 'Include hidden files (default: false)',
        },
      },
      required: ['path'],
    },
  },
];

// Tool Input Schemas (runtime validation for AI-returned inputs)

export const ExecuteCommandInputSchema = z.object({
  command: z.string().min(1, 'command must be a non-empty string'),
  description: z.string().min(1, 'description must be a non-empty string'),
  timeout_seconds: z.number().optional(),
});

export const ReadFileInputSchema = z.object({
  path: z.string().min(1, 'path must be a non-empty string'),
  max_lines: z.number().optional(),
});

export const ListFilesInputSchema = z.object({
  path: z.string().min(1, 'path must be a non-empty string'),
  show_hidden: z.boolean().optional(),
});
