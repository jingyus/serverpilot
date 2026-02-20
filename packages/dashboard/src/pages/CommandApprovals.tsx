// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  AlertCircle,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCommandApprovalsStore } from "@/stores/command-approvals";
import type { CommandApproval } from "@/types/command-approval";
import {
  RISK_LEVEL_LABELS,
  RISK_LEVEL_COLORS,
  STATUS_LABELS,
} from "@/types/command-approval";

// ============================================================================
// Command Approvals Page
// ============================================================================

export function CommandApprovals() {
  const { t } = useTranslation();
  const {
    approvals,
    isLoading,
    error,
    fetchApprovals,
    approveCommand,
    rejectCommand,
    startSSE,
    stopSSE,
    clearError,
  } = useCommandApprovalsStore();

  const [viewTarget, setViewTarget] = useState<CommandApproval | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => {
    fetchApprovals();
    startSSE();
    return () => stopSSE();
  }, [fetchApprovals, startSSE, stopSSE]);

  const handleApprove = useCallback(
    async (approval: CommandApproval) => {
      setDecidingId(approval.id);
      try {
        await approveCommand(approval.id);
        setViewTarget(null);
      } catch {
        /* handled by store */
      } finally {
        setDecidingId(null);
      }
    },
    [approveCommand],
  );

  const handleReject = useCallback(
    async (approval: CommandApproval) => {
      setDecidingId(approval.id);
      try {
        await rejectCommand(approval.id);
        setViewTarget(null);
      } catch {
        /* handled by store */
      } finally {
        setDecidingId(null);
      }
    },
    [rejectCommand],
  );

  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const historyApprovals = approvals.filter((a) => a.status !== "pending");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">
            {t("approvals.title", "Command Approvals")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "approvals.description",
              "Review and approve dangerous commands before execution",
            )}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={clearError}
          >
            {t("common.dismiss", "Dismiss")}
          </Button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Pending Approvals */}
      {!isLoading && pendingApprovals.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            {t("approvals.pending", "Pending Approvals")} (
            {pendingApprovals.length})
          </h2>
          {pendingApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onApprove={handleApprove}
              onReject={handleReject}
              onView={setViewTarget}
              deciding={decidingId === approval.id}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && pendingApprovals.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Shield className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              {t("approvals.noPending", "No pending approvals")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {!isLoading && historyApprovals.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            {t("approvals.history", "History")}
          </h2>
          <div className="space-y-2">
            {historyApprovals.map((approval) => (
              <HistoryItem
                key={approval.id}
                approval={approval}
                onView={setViewTarget}
              />
            ))}
          </div>
        </div>
      )}

      {/* Details Dialog */}
      {viewTarget && (
        <ApprovalDetailsDialog
          approval={viewTarget}
          onClose={() => setViewTarget(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          deciding={decidingId === viewTarget.id}
        />
      )}
    </div>
  );
}

// ============================================================================
// Approval Card (Pending)
// ============================================================================

interface ApprovalCardProps {
  approval: CommandApproval;
  onApprove: (approval: CommandApproval) => void;
  onReject: (approval: CommandApproval) => void;
  onView: (approval: CommandApproval) => void;
  deciding: boolean;
}

function ApprovalCard({
  approval,
  onApprove,
  onReject,
  onView,
  deciding,
}: ApprovalCardProps) {
  const { t } = useTranslation();
  const expiresIn = Math.max(
    0,
    Math.floor((new Date(approval.expiresAt).getTime() - Date.now()) / 1000),
  );
  const minutes = Math.floor(expiresIn / 60);
  const seconds = expiresIn % 60;

  return (
    <Card className="border-orange-200 bg-orange-50/50">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* Left: Command Info */}
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-orange-600" />
              <Badge className={RISK_LEVEL_COLORS[approval.riskLevel]}>
                {RISK_LEVEL_LABELS[approval.riskLevel]}
              </Badge>
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {minutes}:{seconds.toString().padStart(2, "0")}
              </Badge>
            </div>
            <code className="block rounded bg-muted px-2 py-1 text-sm font-mono">
              {approval.command}
            </code>
            {approval.reason && (
              <p className="text-sm text-muted-foreground">{approval.reason}</p>
            )}
            {approval.warnings.length > 0 && (
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {approval.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onView(approval)}
            >
              <Eye className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">
                {t("common.view", "View")}
              </span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onReject(approval)}
              disabled={deciding}
            >
              {deciding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <XCircle className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">
                    {t("common.reject", "Reject")}
                  </span>
                </>
              )}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => onApprove(approval)}
              disabled={deciding}
            >
              {deciding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">
                    {t("common.approve", "Approve")}
                  </span>
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// History Item
// ============================================================================

interface HistoryItemProps {
  approval: CommandApproval;
  onView: (approval: CommandApproval) => void;
}

function HistoryItem({ approval, onView }: HistoryItemProps) {
  const statusIcon = {
    pending: <Clock className="h-4 w-4 text-orange-600" />,
    approved: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    rejected: <XCircle className="h-4 w-4 text-red-600" />,
    expired: <Clock className="h-4 w-4 text-gray-400" />,
  }[approval.status];

  return (
    <div className="flex items-center gap-3 rounded-md border bg-card p-3 text-sm">
      {statusIcon}
      <code className="flex-1 font-mono">{approval.command}</code>
      <Badge variant="outline">{STATUS_LABELS[approval.status]}</Badge>
      <Button variant="ghost" size="sm" onClick={() => onView(approval)}>
        <Eye className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ============================================================================
// Approval Details Dialog
// ============================================================================

interface ApprovalDetailsDialogProps {
  approval: CommandApproval;
  onClose: () => void;
  onApprove: (approval: CommandApproval) => void;
  onReject: (approval: CommandApproval) => void;
  deciding: boolean;
}

function ApprovalDetailsDialog({
  approval,
  onClose,
  onApprove,
  onReject,
  deciding,
}: ApprovalDetailsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("approvals.details", "Command Approval Details")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "approvals.detailsDescription",
              "Review the command details before making a decision",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Command */}
          <div>
            <label className="text-sm font-medium text-foreground">
              {t("approvals.command", "Command")}
            </label>
            <code className="mt-1 block rounded bg-muted px-3 py-2 font-mono text-sm">
              {approval.command}
            </code>
          </div>

          {/* Risk Level */}
          <div>
            <label className="text-sm font-medium text-foreground">
              {t("approvals.riskLevel", "Risk Level")}
            </label>
            <div className="mt-1">
              <Badge className={RISK_LEVEL_COLORS[approval.riskLevel]}>
                {RISK_LEVEL_LABELS[approval.riskLevel]}
              </Badge>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-sm font-medium text-foreground">
              {t("approvals.status", "Status")}
            </label>
            <div className="mt-1">
              <Badge variant="outline">{STATUS_LABELS[approval.status]}</Badge>
            </div>
          </div>

          {/* Reason */}
          {approval.reason && (
            <div>
              <label className="text-sm font-medium text-foreground">
                {t("approvals.reason", "Reason")}
              </label>
              <p className="mt-1 text-sm text-muted-foreground">
                {approval.reason}
              </p>
            </div>
          )}

          {/* Warnings */}
          {approval.warnings.length > 0 && (
            <div>
              <label className="text-sm font-medium text-foreground">
                {t("approvals.warnings", "Warnings")}
              </label>
              <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                {approval.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <label className="font-medium text-foreground">
                {t("approvals.requestedAt", "Requested At")}
              </label>
              <p className="text-muted-foreground">
                {new Date(approval.requestedAt).toLocaleString()}
              </p>
            </div>
            <div>
              <label className="font-medium text-foreground">
                {t("approvals.expiresAt", "Expires At")}
              </label>
              <p className="text-muted-foreground">
                {new Date(approval.expiresAt).toLocaleString()}
              </p>
            </div>
            {approval.decidedAt && (
              <div>
                <label className="font-medium text-foreground">
                  {t("approvals.decidedAt", "Decided At")}
                </label>
                <p className="text-muted-foreground">
                  {new Date(approval.decidedAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          {approval.status === "pending" ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => onReject(approval)}
                disabled={deciding}
              >
                {deciding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                {t("common.reject", "Reject")}
              </Button>
              <Button onClick={() => onApprove(approval)} disabled={deciding}>
                {deciding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {t("common.approve", "Approve")}
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>{t("common.close", "Close")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
