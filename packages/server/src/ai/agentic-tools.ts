// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/** Tool definitions and input schemas for the Agentic Chat Engine. */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Tool Definitions

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "execute_command",
    description:
      "Execute a shell command on the target server. " +
      "The command runs in /bin/sh. " +
      "Use this for all server operations: checking status, installing software, reading configs, etc. " +
      "Output (stdout + stderr) is returned. " +
      "IMPORTANT: Commands are security-classified. " +
      "Read-only commands (ls, cat, df, ps, etc.) execute instantly. " +
      "Modification commands (apt install, systemctl restart, etc.) may require user approval.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        description: {
          type: "string",
          description:
            "Brief description of what this command does (for audit logging)",
        },
        timeout_seconds: {
          type: "number",
          description: "Timeout in seconds (default: 30, max: 600)",
        },
      },
      required: ["command", "description"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a file on the server. " +
      "Supports reading specific line ranges for large files. " +
      "For files > 200 lines, use offset/limit to read specific portions.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute file path to read",
        },
        max_lines: {
          type: "number",
          description:
            "Maximum total lines to read (default: 200). For large files, reads first and last portions.",
        },
        offset: {
          type: "number",
          description:
            "Skip first N lines (0-indexed). Use with limit for reading specific ranges.",
        },
        limit: {
          type: "number",
          description:
            "Read exactly N lines after offset. Use for reading middle portions of large files.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description:
      "List files and directories at a given path. " +
      "Returns file names, sizes, and permissions.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Directory path to list (default: current directory)",
        },
        show_hidden: {
          type: "boolean",
          description: "Include hidden files (default: false)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_code",
    description:
      "Search for text patterns in files using grep. " +
      "Much faster than execute_command for code/log searching. " +
      "Supports regex patterns, file type filtering, and context lines. " +
      "Use this for: finding function definitions, error messages in logs, configuration values.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description:
            'Text or regex pattern to search for (e.g., "function.*init", "ERROR")',
        },
        path: {
          type: "string",
          description: "Directory to search in (default: current directory)",
        },
        file_pattern: {
          type: "string",
          description:
            'Filter files by pattern (e.g., "*.js", "*.log", "*.conf"). Leave empty to search all files.',
        },
        context_lines: {
          type: "number",
          description:
            "Number of lines to show before and after each match (default: 2)",
        },
        case_sensitive: {
          type: "boolean",
          description: "Case-sensitive search (default: false)",
        },
        max_results: {
          type: "number",
          description:
            "Maximum number of matching lines to return (default: 50)",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "find_files",
    description:
      "Find files by name pattern (glob/wildcard matching). " +
      "Faster than execute_command for locating files. " +
      'Examples: "nginx.conf", "*.log", "package.json". ' +
      "Use this to quickly locate configuration files, logs, or specific file types.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description:
            'File name pattern to match (e.g., "*.log", "nginx.conf", "*config*")',
        },
        path: {
          type: "string",
          description: "Directory to search in (default: current directory)",
        },
        max_depth: {
          type: "number",
          description:
            "Maximum directory depth to search (default: 5, prevents slow deep searches)",
        },
        file_type: {
          type: "string",
          description:
            'Filter by type: "f" (files only), "d" (directories only), "all" (default: "f")',
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "edit_file",
    description:
      "Edit a file by replacing exact text matches. " +
      "Safer than sed/awk - validates that old_string exists before replacement. " +
      "Use this for precise configuration changes, code fixes, or content updates. " +
      "IMPORTANT: old_string must match exactly (including whitespace/newlines).",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute file path to edit",
        },
        old_string: {
          type: "string",
          description: "Exact text to replace (must exist in file)",
        },
        new_string: {
          type: "string",
          description: "Replacement text",
        },
        replace_all: {
          type: "boolean",
          description:
            "Replace all occurrences (default: false - replaces first match only)",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
];

// Tool Input Schemas (runtime validation for AI-returned inputs)

export const ExecuteCommandInputSchema = z.object({
  command: z.string().min(1, "command must be a non-empty string"),
  description: z.string().min(1, "description must be a non-empty string"),
  timeout_seconds: z.number().optional(),
});

export const ReadFileInputSchema = z.object({
  path: z.string().min(1, "path must be a non-empty string"),
  max_lines: z.number().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).optional(),
});

export const ListFilesInputSchema = z.object({
  path: z.string().min(1, "path must be a non-empty string"),
  show_hidden: z.boolean().optional(),
});

export const SearchCodeInputSchema = z.object({
  pattern: z.string().min(1, "pattern must be a non-empty string"),
  path: z.string().optional(),
  file_pattern: z.string().optional(),
  context_lines: z.number().int().min(0).max(10).optional(),
  case_sensitive: z.boolean().optional(),
  max_results: z.number().int().min(1).max(500).optional(),
});

export const FindFilesInputSchema = z.object({
  pattern: z.string().min(1, "pattern must be a non-empty string"),
  path: z.string().optional(),
  max_depth: z.number().int().min(1).max(20).optional(),
  file_type: z.enum(["f", "d", "all"]).optional(),
});

export const EditFileInputSchema = z.object({
  path: z.string().min(1, "path must be a non-empty string"),
  old_string: z.string().min(1, "old_string must be a non-empty string"),
  new_string: z.string(), // Can be empty string for deletion
  replace_all: z.boolean().optional(),
});
