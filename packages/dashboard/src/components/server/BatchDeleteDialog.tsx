// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BatchDeleteDialogProps {
  open: boolean;
  count: number;
  isDeleting: boolean;
  progress: { done: number; total: number };
  onConfirm: () => void;
  onCancel: () => void;
}

export function BatchDeleteDialog({
  open,
  count,
  isDeleting,
  progress,
  onConfirm,
  onCancel,
}: BatchDeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(val) => !val && !isDeleting && onCancel()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {t("servers.batchDeleteTitle", { count })}
          </DialogTitle>
          <DialogDescription>
            {isDeleting
              ? t("servers.batchDeleteProgress", {
                  done: progress.done,
                  total: progress.total,
                })
              : t("servers.batchDeleteConfirm", { count })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("servers.batchDeleteProgress", {
                  done: progress.done,
                  total: progress.total,
                })}
              </>
            ) : (
              t("common.delete")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
