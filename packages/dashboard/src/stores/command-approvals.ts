// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from "zustand";
import { apiRequest, ApiError } from "@/api/client";
import { createGetSSE } from "@/api/sse";
import type {
  CommandApproval,
  ApprovalsResponse,
  ApprovalResponse,
  CommandApprovalStatus,
} from "@/types/command-approval";

interface CommandApprovalsState {
  approvals: CommandApproval[];
  isLoading: boolean;
  error: string | null;
  sseConnection: { abort: () => void } | null;

  fetchApprovals: (status?: CommandApprovalStatus) => Promise<void>;
  approveCommand: (id: string) => Promise<void>;
  rejectCommand: (id: string) => Promise<void>;
  startSSE: () => void;
  stopSSE: () => void;
  clearError: () => void;
}

export const useCommandApprovalsStore = create<CommandApprovalsState>(
  (set, get) => ({
    approvals: [],
    isLoading: false,
    error: null,
    sseConnection: null,

    fetchApprovals: async (status?: CommandApprovalStatus) => {
      set({ isLoading: true, error: null });
      try {
        const query = status ? `?status=${status}` : "";
        const data = await apiRequest<ApprovalsResponse>(`/approvals${query}`);
        set({ approvals: data.approvals, isLoading: false });
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : "Failed to load approvals";
        set({ error: message, isLoading: false });
      }
    },

    approveCommand: async (id: string) => {
      set({ error: null });
      try {
        const data = await apiRequest<ApprovalResponse>(
          `/approvals/${id}/decide`,
          {
            method: "POST",
            body: JSON.stringify({ decision: "approve" }),
          },
        );
        // Update the approval in the list
        set({
          approvals: get().approvals.map((a) =>
            a.id === id ? data.approval : a,
          ),
        });
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : "Failed to approve command";
        set({ error: message });
        throw err;
      }
    },

    rejectCommand: async (id: string) => {
      set({ error: null });
      try {
        const data = await apiRequest<ApprovalResponse>(
          `/approvals/${id}/decide`,
          {
            method: "POST",
            body: JSON.stringify({ decision: "reject" }),
          },
        );
        // Update the approval in the list
        set({
          approvals: get().approvals.map((a) =>
            a.id === id ? data.approval : a,
          ),
        });
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : "Failed to reject command";
        set({ error: message });
        throw err;
      }
    },

    startSSE: () => {
      const { sseConnection } = get();
      if (sseConnection) return; // Already connected

      const connection = createGetSSE({
        path: "/approvals/stream",
        dispatch(event, data) {
          if (event === "connected") {
            // Connection established
          } else if (event === "approval") {
            // New approval request
            try {
              const approval = JSON.parse(data) as CommandApproval;
              set({ approvals: [approval, ...get().approvals] });
            } catch {
              // Ignore parse errors
            }
          } else if (event === "decision") {
            // Approval decision made (approved/rejected)
            try {
              const updated = JSON.parse(data) as CommandApproval;
              set({
                approvals: get().approvals.map((a) =>
                  a.id === updated.id ? updated : a,
                ),
              });
            } catch {
              // Ignore parse errors
            }
          } else if (event === "ping") {
            // Keep-alive ping — ignore
          }
        },
        onError: (error) => {
          set({ error: error.message });
        },
      });

      set({ sseConnection: connection });
    },

    stopSSE: () => {
      const { sseConnection } = get();
      if (sseConnection) {
        sseConnection.abort();
        set({ sseConnection: null });
      }
    },

    clearError: () => set({ error: null }),
  }),
);
