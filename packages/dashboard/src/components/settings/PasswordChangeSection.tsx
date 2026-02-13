// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/api/client';
import { cn } from '@/lib/utils';

/** Password strength levels */
type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

interface StrengthResult {
  level: StrengthLevel;
  score: number; // 0-4
}

/** Evaluate password strength based on server-side rules. */
export function evaluatePasswordStrength(password: string): StrengthResult {
  if (!password) return { level: 'weak', score: 0 };

  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;

  const levels: StrengthLevel[] = ['weak', 'weak', 'fair', 'good', 'strong'];
  return { level: levels[score], score };
}

const STRENGTH_COLORS: Record<StrengthLevel, string> = {
  weak: 'bg-red-500',
  fair: 'bg-orange-500',
  good: 'bg-yellow-500',
  strong: 'bg-green-500',
};

/** Validate password fields; returns array of i18n error keys. */
export function validatePasswordForm(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): string[] {
  const errors: string[] = [];
  if (!currentPassword) errors.push('settings.passwordCurrentRequired');
  if (newPassword.length < 8) errors.push('settings.passwordMinLength');
  if (!/[A-Z]/.test(newPassword)) errors.push('settings.passwordUppercase');
  if (!/[a-z]/.test(newPassword)) errors.push('settings.passwordLowercase');
  if (!/[0-9]/.test(newPassword)) errors.push('settings.passwordDigit');
  if (newPassword !== confirmPassword) errors.push('settings.passwordMismatch');
  return errors;
}

export function PasswordChangeSection() {
  const { t } = useTranslation();
  const changePassword = useAuthStore((s) => s.changePassword);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const strength = evaluatePasswordStrength(newPassword);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(false);

    const errors = validatePasswordForm(currentPassword, newPassword, confirmPassword);
    setValidationErrors(errors);
    if (errors.length > 0) return;

    setIsSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword, confirmPassword });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setValidationErrors([]);
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : t('settings.passwordChangeFailed');
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{t('settings.security')}</CardTitle>
        </div>
        <CardDescription>{t('settings.securityDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Success message */}
        {success && (
          <div
            role="status"
            data-testid="password-success"
            className="flex items-center gap-2 rounded-md border border-green-500/50 bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{t('settings.passwordChanged')}</span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div
            role="alert"
            data-testid="password-error"
            className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div
            role="alert"
            data-testid="password-validation-errors"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <ul className="list-inside list-disc space-y-1">
              {validationErrors.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Current Password */}
        <div className="space-y-2">
          <Label htmlFor="current-password">{t('settings.currentPassword')}</Label>
          <div className="relative">
            <Input
              id="current-password"
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t('settings.currentPasswordPlaceholder')}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showCurrent ? t('settings.hidePassword') : t('settings.showPassword')}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* New Password */}
        <div className="space-y-2">
          <Label htmlFor="new-password">{t('settings.newPassword')}</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('settings.newPasswordPlaceholder')}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showNew ? t('settings.hidePassword') : t('settings.showPassword')}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {/* Password Strength Indicator */}
          {newPassword && (
            <div data-testid="password-strength" className="space-y-1">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 flex-1 rounded-full transition-colors',
                      i < strength.score
                        ? STRENGTH_COLORS[strength.level]
                        : 'bg-muted',
                    )}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t(`settings.passwordStrength.${strength.level}`)}
              </p>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div className="space-y-2">
          <Label htmlFor="confirm-password">{t('settings.confirmNewPassword')}</Label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('settings.confirmNewPasswordPlaceholder')}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showConfirm ? t('settings.hidePassword') : t('settings.showPassword')}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full sm:w-auto"
          data-testid="change-password-btn"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('settings.changingPassword')}
            </>
          ) : (
            <>
              <Shield className="mr-2 h-4 w-4" />
              {t('settings.changePassword')}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
