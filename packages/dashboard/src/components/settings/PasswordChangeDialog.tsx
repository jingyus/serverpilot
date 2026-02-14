// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/stores/auth";
import { ApiError } from "@/api/client";
import {
  evaluatePasswordStrength,
  validatePasswordForm,
} from "./PasswordChangeSection";

const STRENGTH_COLORS = {
  weak: "bg-red-500",
  fair: "bg-orange-500",
  good: "bg-yellow-500",
  strong: "bg-green-500",
} as const;

interface PasswordChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PasswordChangeDialog({
  open,
  onOpenChange,
}: PasswordChangeDialogProps) {
  const { t } = useTranslation();
  const changePassword = useAuthStore((s) => s.changePassword);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState(false);

  const strength = evaluatePasswordStrength(newPassword);

  const handleSubmit = async () => {
    const validationErrors = validatePasswordForm(
      currentPassword,
      newPassword,
      confirmPassword,
    );
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);
    setIsSubmitting(true);
    setSuccess(false);

    try {
      await changePassword({ currentPassword, newPassword, confirmPassword });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(false);
      }, 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors([err.message || "settings.passwordChangeFailed"]);
      } else {
        setErrors(["settings.passwordChangeFailed"]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t("settings.changePassword")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.changePasswordDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Password */}
          <div className="space-y-2">
            <Label htmlFor="current-password-dialog">
              {t("settings.currentPassword")}
            </Label>
            <div className="relative">
              <Input
                id="current-password-dialog"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t("settings.currentPasswordPlaceholder")}
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                aria-label={showCurrent ? "Hide password" : "Show password"}
              >
                {showCurrent ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="space-y-2">
            <Label htmlFor="new-password-dialog">
              {t("settings.newPassword")}
            </Label>
            <div className="relative">
              <Input
                id="new-password-dialog"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("settings.newPasswordPlaceholder")}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                aria-label={showNew ? "Hide password" : "Show password"}
              >
                {showNew ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {newPassword && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={`h-full transition-all ${STRENGTH_COLORS[strength.level]}`}
                    style={{ width: `${(strength.score / 4) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {t(`settings.passwordStrength.${strength.level}`)}
                </span>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password-dialog">
              {t("settings.confirmNewPassword")}
            </Label>
            <div className="relative">
              <Input
                id="confirm-password-dialog"
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("settings.confirmNewPasswordPlaceholder")}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Error Messages */}
          {errors.length > 0 && (
            <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
              {errors.map((err) => (
                <p key={err} className="text-destructive">
                  • {t(err)}
                </p>
              ))}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex items-center gap-2 rounded-md border border-green-500/50 bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
              {t("settings.passwordChanged")}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || success}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("settings.changingPassword")}
              </>
            ) : (
              t("settings.changePassword")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
