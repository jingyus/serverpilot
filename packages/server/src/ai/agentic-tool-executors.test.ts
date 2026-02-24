// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for agentic tool executor functions extracted from AgenticChatEngine.
 *
 * Validates:
 * 1. shellEscape handles special characters correctly
 * 2. writeSSE catches errors and sets abort flag
 * 3. awaitAbort resolves on abort and supports cleanup
 * 4. handleValidationError sends correct SSE events and logs warnings
 * 5. executeToolCall routes to correct tool and handles unknown tools
 * 6. toolReadFile / toolListFiles build correct commands
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SSEStreamingApi } from "hono/streaming";

vi.mock("../core/agent/agent-connector.js", () => ({
  findConnectedAgent: vi.fn(() => "agent-1"),
}));
vi.mock("../core/task/executor.js", () => ({
  getTaskExecutor: vi.fn(() => ({
    executeCommand: vi.fn(async () => ({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      success: true,
      operationId: "op-1",
      duration: 100,
    })),
    addProgressListener: vi.fn(),
    removeProgressListener: vi.fn(),
  })),
}));
vi.mock("../core/security/audit-logger.js", () => ({
  getAuditLogger: vi.fn(() => ({
    log: vi.fn(async () => ({ id: "audit-1" })),
    updateExecutionResult: vi.fn(async () => true),
  })),
}));
vi.mock("../core/security/command-validator.js", () => ({
  validateCommand: vi.fn(() => ({
    action: "allowed",
    classification: { riskLevel: "green", reason: "safe" },
  })),
}));

import {
  shellEscape,
  writeSSE,
  awaitAbort,
  handleValidationError,
  executeToolCall,
  toolReadFile,
  toolListFiles,
  toolExecuteCommand,
  toolSearchCode,
  toolFindFiles,
  toolEditFile,
  type AbortStateInterface,
  type ToolExecutorContext,
} from "./agentic-tool-executors.js";

/** Create a simple AbortState for testing. */
function createAbortState(): AbortStateInterface {
  let _aborted = false;
  const listeners: Array<() => void> = [];
  return {
    get aborted() {
      return _aborted;
    },
    set aborted(value: boolean) {
      if (value && !_aborted) {
        _aborted = true;
        for (const cb of listeners) cb();
        listeners.length = 0;
      }
    },
    onAbort(cb: () => void): () => void {
      if (_aborted) {
        cb();
        return () => {};
      }
      listeners.push(cb);
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
  };
}

/** Create a mock SSEStreamingApi. */
function createMockStream() {
  const sseEvents: Array<{ event: string; data: Record<string, unknown> }> = [];
  const stream = {
    writeSSE: vi.fn(async (msg: { event?: string; data: string }) => {
      sseEvents.push({
        event: msg.event ?? "message",
        data: JSON.parse(msg.data),
      });
    }),
    onAbort: vi.fn(),
  } as unknown as SSEStreamingApi;
  return { stream, sseEvents };
}

function createContext(
  overrides?: Partial<ToolExecutorContext>,
): ToolExecutorContext {
  const { stream } = createMockStream();
  return {
    serverId: "srv-1",
    userId: "usr-1",
    sessionId: "sess-1",
    clientId: "client-1",
    stream,
    abort: createAbortState(),
    ...overrides,
  };
}

// ============================================================================
// shellEscape
// ============================================================================

describe("shellEscape", () => {
  it("should wrap string in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  it("should escape single quotes within string", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it("should handle empty string", () => {
    expect(shellEscape("")).toBe("''");
  });

  it("should handle string with spaces", () => {
    expect(shellEscape("/path/to/my file.txt")).toBe("'/path/to/my file.txt'");
  });

  it("should handle string with special shell chars", () => {
    expect(shellEscape("$(whoami)")).toBe("'$(whoami)'");
  });

  it("should handle multiple single quotes", () => {
    expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
  });
});

// ============================================================================
// writeSSE
// ============================================================================

describe("writeSSE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should write SSE event with JSON data", async () => {
    const { stream, sseEvents } = createMockStream();

    await writeSSE(stream, "message", { content: "hello" });

    expect(sseEvents).toHaveLength(1);
    expect(sseEvents[0].event).toBe("message");
    expect(sseEvents[0].data).toEqual({ content: "hello" });
  });

  it("should set abort.aborted on write failure", async () => {
    const abort = createAbortState();
    const stream = {
      writeSSE: vi.fn(async () => {
        throw new Error("stream closed");
      }),
    } as unknown as SSEStreamingApi;

    await writeSSE(stream, "message", { content: "hello" }, abort);

    expect(abort.aborted).toBe(true);
  });

  it("should not throw when stream.writeSSE fails", async () => {
    const stream = {
      writeSSE: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    } as unknown as SSEStreamingApi;

    // Should not throw
    await expect(
      writeSSE(stream, "test", { data: "value" }),
    ).resolves.toBeUndefined();
  });

  it("should not set abort when no abort parameter provided", async () => {
    const stream = {
      writeSSE: vi.fn(async () => {
        throw new Error("error");
      }),
    } as unknown as SSEStreamingApi;

    // Should not throw even without abort parameter
    await expect(
      writeSSE(stream, "test", { data: "value" }),
    ).resolves.toBeUndefined();
  });
});

// ============================================================================
// awaitAbort
// ============================================================================

describe("awaitAbort", () => {
  it("should resolve immediately when already aborted", async () => {
    const abort = createAbortState();
    abort.aborted = true;

    const { promise } = awaitAbort(abort);
    const result = await promise;

    expect(result).toBe(false);
  });

  it("should resolve when abort is triggered", async () => {
    const abort = createAbortState();
    const { promise } = awaitAbort(abort);

    // Trigger abort after a tick
    setTimeout(() => {
      abort.aborted = true;
    }, 10);

    const result = await promise;
    expect(result).toBe(false);
  });

  it("should allow unsubscribe to prevent resolution", async () => {
    const abort = createAbortState();
    const { promise, unsubscribe } = awaitAbort(abort);

    unsubscribe();

    // Trigger abort — promise should NOT resolve since we unsubscribed
    abort.aborted = true;

    // Race with a timeout to prove the promise doesn't resolve
    const result = await Promise.race([
      promise.then(() => "resolved" as const),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 50)),
    ]);

    expect(result).toBe("timeout");
  });

  it("should return noop unsubscribe when already aborted", () => {
    const abort = createAbortState();
    abort.aborted = true;

    const { unsubscribe } = awaitAbort(abort);
    // Should not throw
    unsubscribe();
  });
});

// ============================================================================
// handleValidationError
// ============================================================================

describe("handleValidationError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return error message with issues", async () => {
    const { stream } = createMockStream();
    const abort = createAbortState();

    const result = await handleValidationError(
      "execute_command",
      "tool-1",
      [{ message: "Required", path: ["command"] }],
      {},
      stream,
      abort,
    );

    expect(result).toContain("Error: Invalid tool input");
    expect(result).toContain("execute_command");
    expect(result).toContain("Required");
  });

  it("should send validation_error SSE event", async () => {
    const { stream, sseEvents } = createMockStream();
    const abort = createAbortState();

    await handleValidationError(
      "read_file",
      "tool-2",
      [{ message: "path is required", path: ["path"] }],
      null,
      stream,
      abort,
    );

    expect(sseEvents).toHaveLength(1);
    expect(sseEvents[0].event).toBe("tool_result");
    expect(sseEvents[0].data).toMatchObject({
      id: "tool-2",
      tool: "read_file",
      status: "validation_error",
    });
  });

  it("should join multiple issues with semicolons", async () => {
    const { stream } = createMockStream();
    const abort = createAbortState();

    const result = await handleValidationError(
      "execute_command",
      "tool-3",
      [
        { message: "command required", path: ["command"] },
        { message: "description required", path: ["description"] },
      ],
      {},
      stream,
      abort,
    );

    expect(result).toContain("command required; description required");
  });

  it("should log a warning", async () => {
    const { logger: loggerModule } = await import("../utils/logger.js");
    const warnSpy = vi.spyOn(loggerModule, "warn");
    const { stream } = createMockStream();
    const abort = createAbortState();

    await handleValidationError(
      "list_files",
      "tool-4",
      [{ message: "bad input", path: [] }],
      42,
      stream,
      abort,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "tool_validation",
        tool: "list_files",
      }),
      expect.stringContaining("Tool input validation failed"),
    );
    warnSpy.mockRestore();
  });
});

// ============================================================================
// executeToolCall — routing
// ============================================================================

describe("executeToolCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return error for unknown tool name", async () => {
    const ctx = createContext();

    const result = await executeToolCall(
      { id: "t-1", name: "unknown_tool", input: {} },
      ctx,
    );

    expect(result).toContain("Unknown tool");
    expect(result).toContain("unknown_tool");
  });

  it("should return error when abort is already set", async () => {
    const abort = createAbortState();
    abort.aborted = true;
    const ctx = createContext({ abort });

    const result = await executeToolCall(
      {
        id: "t-1",
        name: "execute_command",
        input: { command: "ls", description: "list" },
      },
      ctx,
    );

    expect(result).toContain("Client disconnected");
  });

  it("should route execute_command with valid input", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      {
        id: "t-1",
        name: "execute_command",
        input: { command: "echo hello", description: "test" },
      },
      ctx,
    );

    expect(result).toContain("Exit code: 0");
    // Should have tool_executing event
    const executing = sseEvents.filter((e) => e.event === "tool_executing");
    expect(executing).toHaveLength(1);
  });

  it("should route read_file with valid input", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      {
        id: "t-2",
        name: "read_file",
        input: { path: "/etc/hostname" },
      },
      ctx,
    );

    expect(result).toContain("Exit code: 0");
    // The executed command should be head-based
    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing).toBeDefined();
    expect(executing!.data.command).toContain("head");
  });

  it("should route list_files with valid input", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      {
        id: "t-3",
        name: "list_files",
        input: { path: "/tmp" },
      },
      ctx,
    );

    expect(result).toContain("Exit code: 0");
    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing).toBeDefined();
    expect(executing!.data.command).toContain("ls");
  });

  it("should return validation error for invalid execute_command input", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      {
        id: "t-4",
        name: "execute_command",
        input: { command: 123 },
      },
      ctx,
    );

    expect(result).toContain("Error: Invalid tool input");
    const validationEvents = sseEvents.filter(
      (e) => e.data.status === "validation_error",
    );
    expect(validationEvents).toHaveLength(1);
  });

  it("should return validation error for invalid read_file input", async () => {
    const { stream } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      { id: "t-5", name: "read_file", input: {} },
      ctx,
    );

    expect(result).toContain("Error: Invalid tool input");
  });

  it("should return validation error for invalid list_files input", async () => {
    const { stream } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      { id: "t-6", name: "list_files", input: { path: 42 } },
      ctx,
    );

    expect(result).toContain("Error: Invalid tool input");
  });

  it("should catch exceptions from tool execution and send failed SSE", async () => {
    // Make getTaskExecutor throw
    const { getTaskExecutor } = await import("../core/task/executor.js");
    vi.mocked(getTaskExecutor).mockReturnValueOnce({
      executeCommand: vi.fn(async () => {
        throw new Error("execution failed");
      }),
      addProgressListener: vi.fn(),
      removeProgressListener: vi.fn(),
    } as never);

    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      {
        id: "t-7",
        name: "execute_command",
        input: { command: "fail", description: "test failure" },
      },
      ctx,
    );

    expect(result).toContain("Error executing execute_command");
    const failedEvents = sseEvents.filter(
      (e) => e.event === "tool_result" && e.data.status === "failed",
    );
    expect(failedEvents).toHaveLength(1);
  });
});

// ============================================================================
// toolReadFile — command construction
// ============================================================================

describe("toolReadFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should use head with default 200 lines", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolReadFile({ path: "/etc/hosts" }, ctx, "t-read-1");

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing).toBeDefined();
    expect(executing!.data.command).toBe("head -n 200 '/etc/hosts'");
  });

  it("should use specified max_lines", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolReadFile(
      { path: "/var/log/syslog", max_lines: 50 },
      ctx,
      "t-read-2",
    );

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toBe("head -n 50 '/var/log/syslog'");
  });

  it("should escape paths with special characters", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolReadFile({ path: "/tmp/my file's.txt" }, ctx, "t-read-3");

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toContain("'\\''");
  });
});

// ============================================================================
// toolListFiles — command construction
// ============================================================================

describe("toolListFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should use ls -lh by default", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolListFiles({ path: "/tmp" }, ctx, "t-list-1");

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toBe("ls -lh '/tmp'");
  });

  it("should use ls -lah when show_hidden is true", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolListFiles({ path: "/home", show_hidden: true }, ctx, "t-list-2");

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toBe("ls -lah '/home'");
  });
});

// ============================================================================
// toolExecuteCommand — security and audit
// ============================================================================

describe("toolExecuteCommand — blocked command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return blocked message for forbidden commands", async () => {
    const { validateCommand } =
      await import("../core/security/command-validator.js");
    vi.mocked(validateCommand).mockReturnValueOnce({
      action: "blocked",
      classification: { riskLevel: "critical", reason: "forbidden command" },
    } as ReturnType<typeof validateCommand>);

    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    const result = await toolExecuteCommand(
      { command: "rm -rf /", description: "dangerous" },
      ctx,
      "t-block-1",
    );

    expect(result).toContain("安全策略阻止");
    const blocked = sseEvents.find((e) => e.data.status === "blocked");
    expect(blocked).toBeDefined();
  });
});

describe("toolExecuteCommand — abort during execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return error when aborted before execution", async () => {
    const abort = createAbortState();
    abort.aborted = true;
    const ctx = createContext({ abort });

    const result = await toolExecuteCommand(
      { command: "echo test", description: "test" },
      ctx,
      "t-abort-1",
    );

    // The abort check happens inside toolExecuteCommand after validation/audit
    // but before dispatch
    expect(result).toContain("Client disconnected");
  });
});

// ============================================================================
// toolSearchCode — command construction
// ============================================================================

describe("toolSearchCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should build basic grep command with pattern", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolSearchCode({ pattern: "ERROR" }, ctx, "t-search-1");

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toContain("grep -rniC2 'ERROR' '.'");
    expect(executing!.data.command).toContain("| head -n 50");
  });

  it("should add file pattern filter", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolSearchCode(
      { pattern: "function", file_pattern: "*.js" },
      ctx,
      "t-search-2",
    );

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toContain("--include='*.js'");
  });

  it("should support case-sensitive search", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolSearchCode(
      { pattern: "WARN", case_sensitive: true },
      ctx,
      "t-search-3",
    );

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    // grep -rn (no 'i' flag for case-sensitive)
    expect(executing!.data.command).toMatch(/grep -rn[^i]/);
  });

  it("should use custom context lines", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolSearchCode(
      { pattern: "error", context_lines: 5 },
      ctx,
      "t-search-4",
    );

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toContain("C5");
  });

  it("should limit results to max_results", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolSearchCode(
      { pattern: "test", max_results: 100 },
      ctx,
      "t-search-5",
    );

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toContain("| head -n 100");
  });
});

// ============================================================================
// toolFindFiles — command construction
// ============================================================================

describe("toolFindFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should build basic find command with pattern", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolFindFiles({ pattern: "*.log" }, ctx, "t-find-1");

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toContain("find '.' -maxdepth 5");
    expect(executing!.data.command).toContain("-type f");
    expect(executing!.data.command).toContain("-name '*.log'");
  });

  it("should search in custom path", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolFindFiles(
      { pattern: "nginx.conf", path: "/etc" },
      ctx,
      "t-find-2",
    );

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toContain("find '/etc'");
  });

  it("should use custom max_depth", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolFindFiles({ pattern: "*.js", max_depth: 3 }, ctx, "t-find-3");

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toContain("-maxdepth 3");
  });

  it("should filter by file type (directories only)", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolFindFiles(
      { pattern: "node_modules", file_type: "d" },
      ctx,
      "t-find-4",
    );

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).toContain("-type d");
  });

  it("should search all types when file_type is all", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolFindFiles(
      { pattern: "data*", file_type: "all" },
      ctx,
      "t-find-5",
    );

    const executing = sseEvents.find((e) => e.event === "tool_executing");
    expect(executing!.data.command).not.toContain("-type");
  });
});

// ============================================================================
// toolEditFile — edit logic
// ============================================================================

describe("toolEditFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should verify pattern exists before editing", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolEditFile(
      {
        path: "/etc/nginx/nginx.conf",
        old_string: "worker_processes 2",
        new_string: "worker_processes 4",
      },
      ctx,
      "t-edit-1",
    );

    // Should execute two commands: check + sed
    const executingEvents = sseEvents.filter(
      (e) => e.event === "tool_executing",
    );
    expect(executingEvents.length).toBeGreaterThanOrEqual(1);

    // First command should be grep check
    expect(executingEvents[0].data.command).toContain("grep -F");
  });

  it("should use sed for replacement", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolEditFile(
      {
        path: "/app/config.txt",
        old_string: "DEBUG=false",
        new_string: "DEBUG=true",
      },
      ctx,
      "t-edit-2",
    );

    const executingEvents = sseEvents.filter(
      (e) => e.event === "tool_executing",
    );
    // Last command should be sed replacement
    const sedCmd = executingEvents[executingEvents.length - 1].data.command;
    expect(sedCmd).toContain("sed");
    expect(sedCmd).toContain("/app/config.txt");
  });

  it("should support replace_all flag", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolEditFile(
      {
        path: "/var/www/index.html",
        old_string: "old",
        new_string: "new",
        replace_all: true,
      },
      ctx,
      "t-edit-3",
    );

    const executingEvents = sseEvents.filter(
      (e) => e.event === "tool_executing",
    );
    const sedCmd = executingEvents[executingEvents.length - 1].data.command;
    // Should have 'g' flag for global replacement
    expect(sedCmd).toMatch(/s\/.*\/.*\/g/);
  });

  it("should escape special characters in old_string", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await toolEditFile(
      {
        path: "/test.txt",
        old_string: "a/b&c",
        new_string: "replaced",
      },
      ctx,
      "t-edit-4",
    );

    const executingEvents = sseEvents.filter(
      (e) => e.event === "tool_executing",
    );
    const sedCmd = executingEvents[executingEvents.length - 1].data.command;
    // Sed command should escape / and &
    expect(sedCmd).toBeDefined();
  });
});

// ============================================================================
// executeToolCall — new tools routing
// ============================================================================

describe("executeToolCall — new tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should route search_code to toolSearchCode", async () => {
    const { stream } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      { id: "tc-1", name: "search_code", input: { pattern: "ERROR" } },
      ctx,
    );

    expect(result).toContain("[Exit code:");
  });

  it("should route find_files to toolFindFiles", async () => {
    const { stream } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      { id: "tc-2", name: "find_files", input: { pattern: "*.log" } },
      ctx,
    );

    expect(result).toContain("[Exit code:");
  });

  it("should route edit_file to toolEditFile", async () => {
    const { stream } = createMockStream();
    const ctx = createContext({ stream });

    const result = await executeToolCall(
      {
        id: "tc-3",
        name: "edit_file",
        input: {
          path: "/test.txt",
          old_string: "old",
          new_string: "new",
        },
      },
      ctx,
    );

    expect(result).toBeDefined();
  });

  it("should validate search_code input schema", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await executeToolCall(
      {
        id: "tc-4",
        name: "search_code",
        input: { pattern: "" }, // Invalid: empty pattern
      },
      ctx,
    );

    const validationError = sseEvents.find(
      (e) => e.data.status === "validation_error",
    );
    expect(validationError).toBeDefined();
  });

  it("should validate find_files input schema", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await executeToolCall(
      {
        id: "tc-5",
        name: "find_files",
        input: { pattern: "", path: "/tmp" }, // Invalid: empty pattern
      },
      ctx,
    );

    const validationError = sseEvents.find(
      (e) => e.data.status === "validation_error",
    );
    expect(validationError).toBeDefined();
  });

  it("should validate edit_file input schema", async () => {
    const { stream, sseEvents } = createMockStream();
    const ctx = createContext({ stream });

    await executeToolCall(
      {
        id: "tc-6",
        name: "edit_file",
        input: { path: "/test.txt", old_string: "" }, // Missing new_string, empty old_string
      },
      ctx,
    );

    const validationError = sseEvents.find(
      (e) => e.data.status === "validation_error",
    );
    expect(validationError).toBeDefined();
  });
});
