// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildStreamingCallbacks } from "./chat-sse-handlers";
import type { ChatState, ExecutionState } from "./chat-types.js";
import { INITIAL_EXECUTION } from "./chat-types.js";

// ── Mock dependencies ──

vi.mock("@/api/sse", () => ({
  createSSEConnection: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn(),
}));

// ── Helpers ──

function makeState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    serverId: "srv-1",
    sessionId: "sess-1",
    messages: [],
    sessions: [],
    sessionsTotal: 0,
    isLoadingMore: false,
    isLoading: false,
    isStreaming: true,
    isReconnecting: false,
    streamingContent: "",
    error: null,
    currentPlan: null,
    planStatus: "none",
    execution: { ...INITIAL_EXECUTION },
    executionMode: "none",
    pendingConfirm: null,
    toolCalls: [],
    agenticConfirm: null,
    isAgenticMode: false,
    sseParseErrors: 0,
    // stub action methods
    setServerId: vi.fn(),
    sendMessage: vi.fn(),
    retryMessage: vi.fn(),
    regenerateLastResponse: vi.fn(),
    confirmPlan: vi.fn(),
    rejectPlan: vi.fn(),
    respondToStep: vi.fn(),
    respondToAgenticConfirm: vi.fn(),
    emergencyStop: vi.fn(),
    fetchSessions: vi.fn(),
    loadMoreSessions: vi.fn(),
    loadSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    newSession: vi.fn(),
    cancelStream: vi.fn(),
    cleanup: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  } as ChatState;
}

/**
 * Creates mock set/get functions that operate on a mutable state object.
 * `set` supports both direct partial and updater function forms.
 */
function createMockStore(initial: Partial<ChatState> = {}) {
  let state = makeState(initial);
  const set = vi.fn(
    (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => {
      if (typeof partial === "function") {
        Object.assign(state, partial(state));
      } else {
        Object.assign(state, partial);
      }
    },
  );
  const get = vi.fn(() => state);
  return { set, get, getState: () => state };
}

describe("buildStreamingCallbacks (direct unit tests)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  // ────────────────────────────────────────────
  // 1. onMessage
  // ────────────────────────────────────────────
  describe("onMessage", () => {
    it("sets sessionId when present in payload", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onMessage!(JSON.stringify({ sessionId: "new-sess", content: "" }));
      expect(getState().sessionId).toBe("new-sess");
    });

    it("appends content to streamingContent", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "Hello ",
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onMessage!(JSON.stringify({ content: "World" }));
      expect(getState().streamingContent).toBe("Hello World");
    });

    it("sets both sessionId and content in one event", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onMessage!(JSON.stringify({ sessionId: "s1", content: "Hi" }));
      expect(getState().sessionId).toBe("s1");
      expect(getState().streamingContent).toBe("Hi");
    });

    it("falls back to raw data when JSON is invalid", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "prefix ",
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onMessage!("raw text chunk");
      expect(getState().streamingContent).toBe("prefix raw text chunk");
    });

    it("does not change sessionId when absent in payload", () => {
      const { set, get, getState } = createMockStore({ sessionId: "keep-me" });
      const cb = buildStreamingCallbacks(set, get);
      cb.onMessage!(JSON.stringify({ content: "x" }));
      expect(getState().sessionId).toBe("keep-me");
    });
  });

  // ────────────────────────────────────────────
  // 2. onRetry
  // ────────────────────────────────────────────
  describe("onRetry", () => {
    it("appends retry notice for non-fallback retry", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "start",
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onRetry!(
        JSON.stringify({
          attempt: 2,
          maxAttempts: 3,
          errorCategory: "rate_limit",
          isFallback: false,
        }),
      );
      expect(getState().streamingContent).toContain("retrying (2/3)");
      expect(getState().streamingContent).toContain("rate_limit");
    });

    it("appends fallback notice when isFallback is true", () => {
      const { set, get, getState } = createMockStore({ streamingContent: "" });
      const cb = buildStreamingCallbacks(set, get);
      cb.onRetry!(
        JSON.stringify({
          attempt: 1,
          maxAttempts: 3,
          errorCategory: "api_error",
          isFallback: true,
          fallbackProvider: "openai",
        }),
      );
      expect(getState().streamingContent).toContain(
        "Switching to backup AI provider",
      );
      expect(getState().streamingContent).toContain("openai");
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onRetry!("bad-json");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 3. onPlan
  // ────────────────────────────────────────────
  describe("onPlan", () => {
    it("sets currentPlan and planStatus to preview", () => {
      const { set, get, getState } = createMockStore();
      const plan = {
        planId: "p1",
        description: "Test",
        steps: [],
        totalRisk: "green",
        requiresConfirmation: false,
      };
      const cb = buildStreamingCallbacks(set, get);
      cb.onPlan!(JSON.stringify(plan));
      expect(getState().currentPlan).toMatchObject({ planId: "p1" });
      expect(getState().planStatus).toBe("preview");
    });

    it("sets error on invalid plan data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onPlan!("not-a-plan");
      expect(getState().error).toBe("Failed to parse execution plan");
    });
  });

  // ────────────────────────────────────────────
  // 4. onAutoExecute
  // ────────────────────────────────────────────
  describe("onAutoExecute", () => {
    it("switches to inline mode when plan is embedded", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "text ```json-plan\n{}\n```",
      });
      const plan = {
        planId: "p1",
        description: "Install",
        totalRisk: "green",
        requiresConfirmation: false,
        steps: [
          { id: "s1", command: "ls", description: "list", riskLevel: "green" },
        ],
      };
      const cb = buildStreamingCallbacks(set, get);
      cb.onAutoExecute!(JSON.stringify({ plan }));

      const s = getState();
      expect(s.executionMode).toBe("inline");
      expect(s.planStatus).toBe("executing");
      expect(s.execution.startTime).toBeTypeOf("number");
    });

    it("switches to log mode when no plan in payload", () => {
      const existingPlan = {
        planId: "p1",
        description: "T",
        steps: [],
        totalRisk: "yellow" as const,
        requiresConfirmation: true,
      };
      const { set, get, getState } = createMockStore({
        streamingContent: "Some analysis",
        currentPlan: existingPlan,
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onAutoExecute!(JSON.stringify({}));

      const s = getState();
      expect(s.executionMode).toBe("log");
      expect(s.streamingContent).toBe("");
      expect(s.messages.length).toBe(1);
      expect(s.messages[0].content).toBe("Some analysis");
      expect(s.messages[0].role).toBe("assistant");
    });

    it("handles empty streamingContent in log mode (no message committed)", () => {
      const { set, get, getState } = createMockStore({ streamingContent: "" });
      const cb = buildStreamingCallbacks(set, get);
      cb.onAutoExecute!(JSON.stringify({}));

      expect(getState().messages).toHaveLength(0);
      expect(getState().executionMode).toBe("log");
    });
  });

  // ────────────────────────────────────────────
  // 5. onStepStart
  // ────────────────────────────────────────────
  describe("onStepStart", () => {
    it("sets activeStepId", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onStepStart!(JSON.stringify({ stepId: "step-42" }));
      expect(getState().execution.activeStepId).toBe("step-42");
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onStepStart!("{{invalid");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 6. onOutput
  // ────────────────────────────────────────────
  describe("onOutput", () => {
    it("appends to streamingContent in inline mode", () => {
      const { set, get, getState } = createMockStore({
        executionMode: "inline",
        streamingContent: "prev ",
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onOutput!(JSON.stringify({ stepId: "s1", content: "new data" }));
      expect(getState().streamingContent).toBe("prev new data");
    });

    it("appends to execution outputs in log mode", () => {
      const { set, get, getState } = createMockStore({ executionMode: "log" });
      const cb = buildStreamingCallbacks(set, get);
      cb.onOutput!(JSON.stringify({ stepId: "s1", content: "line1" }));
      cb.onOutput!(JSON.stringify({ stepId: "s1", content: "\nline2" }));
      expect(getState().execution.outputs["s1"]).toBe("line1\nline2");
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onOutput!("nope");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 7. onStepComplete
  // ────────────────────────────────────────────
  describe("onStepComplete", () => {
    it("records completed step in execution state (log mode)", () => {
      const { set, get, getState } = createMockStore({ executionMode: "log" });
      const cb = buildStreamingCallbacks(set, get);
      cb.onStepComplete!(
        JSON.stringify({ stepId: "s1", exitCode: 0, duration: 250 }),
      );
      expect(getState().execution.completedSteps["s1"]).toEqual({
        exitCode: 0,
        duration: 250,
      });
    });

    it("appends newline to streamingContent in inline mode", () => {
      const { set, get, getState } = createMockStore({
        executionMode: "inline",
        streamingContent: "output",
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onStepComplete!(
        JSON.stringify({ stepId: "s1", exitCode: 0, duration: 100 }),
      );
      expect(getState().streamingContent).toBe("output\n");
      expect(getState().execution.completedSteps["s1"]).toEqual({
        exitCode: 0,
        duration: 100,
      });
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onStepComplete!("bad");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 8. onStepConfirm
  // ────────────────────────────────────────────
  describe("onStepConfirm", () => {
    it("sets pendingConfirm from valid payload", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onStepConfirm!(
        JSON.stringify({
          stepId: "s1",
          command: "rm -rf /tmp",
          description: "Clean tmp",
          riskLevel: "red",
        }),
      );
      expect(getState().pendingConfirm).toEqual({
        stepId: "s1",
        command: "rm -rf /tmp",
        description: "Clean tmp",
        riskLevel: "red",
      });
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onStepConfirm!("{}");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 9. onStepDecisionTimeout
  // ────────────────────────────────────────────
  describe("onStepDecisionTimeout", () => {
    it("clears pendingConfirm and sets error", () => {
      const { set, get, getState } = createMockStore({
        pendingConfirm: {
          stepId: "s1",
          command: "cmd",
          description: "d",
          riskLevel: "red",
        },
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onStepDecisionTimeout!(
        JSON.stringify({ stepId: "s1", timeoutMs: 300000 }),
      );
      expect(getState().pendingConfirm).toBeNull();
      expect(getState().error).toContain("timed out");
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onStepDecisionTimeout!("bad");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 10. onDiagnosis
  // ────────────────────────────────────────────
  describe("onDiagnosis", () => {
    it("is a no-op (does not throw)", () => {
      const { set, get } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      expect(() => cb.onDiagnosis!("any data")).not.toThrow();
    });
  });

  // ────────────────────────────────────────────
  // 11. onComplete — three modes
  // ────────────────────────────────────────────
  describe("onComplete", () => {
    describe("non-executing mode (planStatus != executing)", () => {
      it("commits streamingContent as assistant message", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "none",
          streamingContent: "AI reply",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({}));

        const s = getState();
        expect(s.isStreaming).toBe(false);
        expect(s.isAgenticMode).toBe(false);
        expect(s.streamingContent).toBe("");
        expect(s.messages).toHaveLength(1);
        expect(s.messages[0].role).toBe("assistant");
        expect(s.messages[0].content).toBe("AI reply");
      });

      it("adds no message when streamingContent is empty", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "none",
          streamingContent: "",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({}));

        expect(getState().messages).toHaveLength(0);
        expect(getState().isStreaming).toBe(false);
      });

      it("attaches currentPlan to assistant message when available", () => {
        const plan = {
          planId: "p1",
          description: "T",
          steps: [],
          totalRisk: "green" as const,
          requiresConfirmation: false,
        };
        const { set, get, getState } = createMockStore({
          planStatus: "none",
          streamingContent: "here is a plan",
          currentPlan: plan,
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({}));

        expect(getState().messages[0].plan).toMatchObject({ planId: "p1" });
      });

      it("adds system notice on max_turns_reached", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "none",
          streamingContent: "partial work",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({ reason: "max_turns_reached" }));

        expect(getState().messages).toHaveLength(2);
        expect(getState().messages[0].role).toBe("assistant");
        expect(getState().messages[1].role).toBe("system");
        expect(getState().messages[1].content).toContain("最大执行轮次");
      });

      it("adds system notice on max_turns_reached even without content", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "none",
          streamingContent: "",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({ reason: "max_turns_reached" }));

        expect(getState().messages).toHaveLength(1);
        expect(getState().messages[0].role).toBe("system");
      });

      it("does NOT add system notice for other reasons", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "none",
          streamingContent: "response",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({ reason: "agent_offline" }));

        expect(getState().messages).toHaveLength(1);
        expect(getState().messages[0].role).toBe("assistant");
      });
    });

    describe("inline execution mode", () => {
      it("commits content as message and marks execution complete", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "executing",
          executionMode: "inline",
          streamingContent: "Installed successfully",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({ success: true }));

        const s = getState();
        expect(s.planStatus).toBe("completed");
        expect(s.executionMode).toBe("none");
        expect(s.isStreaming).toBe(false);
        expect(s.execution.success).toBe(true);
        expect(s.execution.activeStepId).toBeNull();
        expect(s.messages).toHaveLength(1);
        expect(s.messages[0].content).toBe("Installed successfully");
      });

      it("does not commit message when streamingContent is empty", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "executing",
          executionMode: "inline",
          streamingContent: "",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({ success: true }));

        expect(getState().messages).toHaveLength(0);
        expect(getState().planStatus).toBe("completed");
      });

      it("handles parse error gracefully", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "executing",
          executionMode: "inline",
          streamingContent: "partial",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!("not-json");

        const s = getState();
        expect(s.planStatus).toBe("completed");
        expect(s.execution.success).toBeNull();
        expect(s.sseParseErrors).toBe(1);
      });

      it("clears agentic state (agenticConfirm, isAgenticMode, toolCalls)", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "executing",
          executionMode: "inline",
          streamingContent: "done",
          isAgenticMode: true,
          toolCalls: [
            {
              id: "tc-1",
              tool: "cmd",
              status: "completed" as const,
              output: "x",
            },
          ],
          agenticConfirm: {
            confirmId: "c1",
            command: "cmd",
            description: "d",
            riskLevel: "green",
          },
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({ success: true }));

        expect(getState().isAgenticMode).toBe(false);
        expect(getState().toolCalls).toEqual([]);
        expect(getState().agenticConfirm).toBeNull();
      });
    });

    describe("log execution mode", () => {
      it("sets execution result from parsed data", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "executing",
          executionMode: "log",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({ success: true, operationId: "op-42" }));

        const s = getState();
        expect(s.planStatus).toBe("completed");
        expect(s.execution.success).toBe(true);
        expect(s.execution.operationId).toBe("op-42");
        expect(s.execution.activeStepId).toBeNull();
        expect(s.isStreaming).toBe(false);
      });

      it("sets cancelled flag when present", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "executing",
          executionMode: "log",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({ success: false, cancelled: true }));

        expect(getState().execution.cancelled).toBe(true);
        expect(getState().execution.success).toBe(false);
      });

      it("handles parse error gracefully (fallback)", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "executing",
          executionMode: "log",
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!("corrupted");

        expect(getState().planStatus).toBe("completed");
        expect(getState().isStreaming).toBe(false);
        expect(getState().sseParseErrors).toBe(1);
      });

      it("clears agentic state on log complete", () => {
        const { set, get, getState } = createMockStore({
          planStatus: "executing",
          executionMode: "log",
          isAgenticMode: true,
          toolCalls: [
            { id: "tc-1", tool: "cmd", status: "running" as const, output: "" },
          ],
          agenticConfirm: {
            confirmId: "c1",
            command: "cmd",
            description: "d",
            riskLevel: "yellow",
          },
        });
        const cb = buildStreamingCallbacks(set, get);
        cb.onComplete!(JSON.stringify({ success: true }));

        expect(getState().isAgenticMode).toBe(false);
        expect(getState().toolCalls).toEqual([]);
        expect(getState().agenticConfirm).toBeNull();
      });
    });
  });

  // ────────────────────────────────────────────
  // 12. onToolCall
  // ────────────────────────────────────────────
  describe("onToolCall", () => {
    it("adds tool call entry and enables agentic mode", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolCall!(JSON.stringify({ id: "tc-1", tool: "execute_command" }));

      expect(getState().isAgenticMode).toBe(true);
      expect(getState().toolCalls).toHaveLength(1);
      expect(getState().toolCalls[0]).toMatchObject({
        id: "tc-1",
        tool: "execute_command",
        status: "running",
        output: "",
      });
    });

    it("appends multiple tool calls", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolCall!(JSON.stringify({ id: "tc-1", tool: "execute_command" }));
      cb.onToolCall!(JSON.stringify({ id: "tc-2", tool: "read_file" }));

      expect(getState().toolCalls).toHaveLength(2);
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolCall!("{{bad");
      expect(getState().sseParseErrors).toBe(1);
      expect(getState().toolCalls).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────
  // 13. onToolExecuting
  // ────────────────────────────────────────────
  describe("onToolExecuting", () => {
    it("appends bash code block and sets command on tool call", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "text",
        toolCalls: [
          {
            id: "tc-1",
            tool: "execute_command",
            status: "running" as const,
            output: "",
          },
        ],
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolExecuting!(JSON.stringify({ id: "tc-1", command: "ls -la" }));

      expect(getState().streamingContent).toContain("```bash");
      expect(getState().streamingContent).toContain("$ ls -la");
      expect(getState().toolCalls[0].command).toBe("ls -la");
    });

    it("does not modify non-matching tool call", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "",
        toolCalls: [
          {
            id: "tc-other",
            tool: "cmd",
            status: "running" as const,
            output: "",
          },
        ],
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolExecuting!(JSON.stringify({ id: "tc-1", command: "whoami" }));

      expect(getState().toolCalls[0].command).toBeUndefined();
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolExecuting!("bad");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 14. onToolOutput
  // ────────────────────────────────────────────
  describe("onToolOutput", () => {
    it("appends content to streamingContent and tool call output", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "prefix",
        toolCalls: [
          {
            id: "tc-1",
            tool: "cmd",
            status: "running" as const,
            output: "old",
          },
        ],
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolOutput!(JSON.stringify({ id: "tc-1", content: " new" }));

      expect(getState().streamingContent).toBe("prefix new");
      expect(getState().toolCalls[0].output).toBe("old new");
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolOutput!("nope");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 15. onToolResult
  // ────────────────────────────────────────────
  describe("onToolResult", () => {
    it("closes code block, updates status and metadata", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "running",
        toolCalls: [
          {
            id: "tc-1",
            tool: "cmd",
            status: "running" as const,
            output: "data",
          },
        ],
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolResult!(
        JSON.stringify({
          id: "tc-1",
          status: "completed",
          exitCode: 0,
          duration: 150,
        }),
      );

      const s = getState();
      expect(s.streamingContent).toContain("\n```\n");
      expect(s.toolCalls[0].status).toBe("completed");
      expect(s.toolCalls[0].exitCode).toBe(0);
      expect(s.toolCalls[0].duration).toBe(150);
    });

    it("appends extra output from result payload", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "",
        toolCalls: [
          { id: "tc-1", tool: "cmd", status: "running" as const, output: "" },
        ],
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolResult!(
        JSON.stringify({
          id: "tc-1",
          status: "completed",
          output: "extra output",
        }),
      );

      expect(getState().streamingContent).toContain("extra output");
      expect(getState().toolCalls[0].output).toBe("extra output");
    });

    it("handles failed status", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "",
        toolCalls: [
          { id: "tc-1", tool: "cmd", status: "running" as const, output: "" },
        ],
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolResult!(
        JSON.stringify({
          id: "tc-1",
          status: "failed",
          exitCode: 1,
        }),
      );

      expect(getState().toolCalls[0].status).toBe("failed");
      expect(getState().toolCalls[0].exitCode).toBe(1);
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onToolResult!("bad");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 16. onConfirmRequired
  // ────────────────────────────────────────────
  describe("onConfirmRequired", () => {
    it("sets agenticConfirm from valid payload", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onConfirmRequired!(
        JSON.stringify({
          confirmId: "conf-1",
          command: "rm -rf /",
          description: "Danger",
          riskLevel: "critical",
        }),
      );

      expect(getState().agenticConfirm).toEqual({
        confirmId: "conf-1",
        command: "rm -rf /",
        description: "Danger",
        riskLevel: "critical",
      });
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onConfirmRequired!("bad");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // 17. onConfirmId
  // ────────────────────────────────────────────
  describe("onConfirmId", () => {
    it("updates confirmId on existing agenticConfirm", () => {
      const { set, get, getState } = createMockStore({
        agenticConfirm: {
          confirmId: "old",
          command: "cmd",
          description: "d",
          riskLevel: "green",
        },
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onConfirmId!(JSON.stringify({ confirmId: "new-id" }));

      expect(getState().agenticConfirm?.confirmId).toBe("new-id");
    });

    it("results in null when agenticConfirm is not set", () => {
      const { set, get, getState } = createMockStore({ agenticConfirm: null });
      const cb = buildStreamingCallbacks(set, get);
      cb.onConfirmId!(JSON.stringify({ confirmId: "any" }));

      expect(getState().agenticConfirm).toBeNull();
    });

    it("increments sseParseErrors on malformed data", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);
      cb.onConfirmId!("bad");
      expect(getState().sseParseErrors).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // onReconnecting / onReconnected
  // ────────────────────────────────────────────
  describe("onReconnecting", () => {
    it("sets isReconnecting true and clears error", () => {
      const { set, get, getState } = createMockStore({ error: "old error" });
      const cb = buildStreamingCallbacks(set, get);
      cb.onReconnecting!(1);
      expect(getState().isReconnecting).toBe(true);
      expect(getState().error).toBeNull();
    });
  });

  describe("onReconnected", () => {
    it("sets isReconnecting false", () => {
      const { set, get, getState } = createMockStore({ isReconnecting: true });
      const cb = buildStreamingCallbacks(set, get);
      cb.onReconnected!();
      expect(getState().isReconnecting).toBe(false);
    });
  });

  // ────────────────────────────────────────────
  // onError
  // ────────────────────────────────────────────
  describe("onError", () => {
    it("saves partial streaming content as message with [Connection lost]", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "partial response",
        messages: [
          {
            id: "u1",
            role: "user" as const,
            content: "hello",
            timestamp: "2024-01-01",
          },
        ],
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onError!(new Error("Network failed"));

      const s = getState();
      expect(s.error).toBe("Network failed");
      expect(s.isStreaming).toBe(false);
      expect(s.streamingContent).toBe("");
      expect(s.messages).toHaveLength(2);
      expect(s.messages[1].content).toContain("partial response");
      expect(s.messages[1].content).toContain("[Connection lost]");
      expect(s.messages[1].role).toBe("assistant");
    });

    it("does not add message when streamingContent is empty", () => {
      const { set, get, getState } = createMockStore({ streamingContent: "" });
      const cb = buildStreamingCallbacks(set, get);
      cb.onError!(new Error("Timeout"));

      const s = getState();
      expect(s.error).toBe("Timeout");
      expect(s.isStreaming).toBe(false);
      expect(s.messages).toHaveLength(0);
    });

    it("resets executionMode, pendingConfirm, agenticConfirm", () => {
      const { set, get, getState } = createMockStore({
        streamingContent: "",
        executionMode: "inline",
        pendingConfirm: {
          stepId: "s1",
          command: "c",
          description: "d",
          riskLevel: "green",
        },
        agenticConfirm: {
          confirmId: "c1",
          command: "c",
          description: "d",
          riskLevel: "green",
        },
      });
      const cb = buildStreamingCallbacks(set, get);
      cb.onError!(new Error("err"));

      expect(getState().executionMode).toBe("none");
      expect(getState().pendingConfirm).toBeNull();
      expect(getState().agenticConfirm).toBeNull();
    });
  });

  // ────────────────────────────────────────────
  // Agentic lifecycle: tool_call → tool_executing → tool_output → tool_result
  // ────────────────────────────────────────────
  describe("full agentic tool lifecycle", () => {
    it("handles tool_call → tool_executing → tool_output → tool_result", () => {
      const { set, get, getState } = createMockStore();
      const cb = buildStreamingCallbacks(set, get);

      // 1. tool_call
      cb.onToolCall!(JSON.stringify({ id: "tc-1", tool: "execute_command" }));
      expect(getState().isAgenticMode).toBe(true);
      expect(getState().toolCalls).toHaveLength(1);

      // 2. tool_executing
      cb.onToolExecuting!(JSON.stringify({ id: "tc-1", command: "uname -a" }));
      expect(getState().toolCalls[0].command).toBe("uname -a");
      expect(getState().streamingContent).toContain("$ uname -a");

      // 3. tool_output (multiple chunks)
      cb.onToolOutput!(JSON.stringify({ id: "tc-1", content: "Linux " }));
      cb.onToolOutput!(JSON.stringify({ id: "tc-1", content: "server 5.15" }));
      expect(getState().toolCalls[0].output).toBe("Linux server 5.15");

      // 4. tool_result
      cb.onToolResult!(
        JSON.stringify({
          id: "tc-1",
          status: "completed",
          exitCode: 0,
          duration: 50,
        }),
      );
      expect(getState().toolCalls[0].status).toBe("completed");
      expect(getState().streamingContent).toContain("\n```\n");
    });
  });
});
