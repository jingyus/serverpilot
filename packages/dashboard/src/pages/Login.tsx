// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Server, Loader2, AlertCircle, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';
import { setToken } from '@/api/client';
import { API_BASE_URL } from '@/utils/constants';

const loginSchema = z.object({
  email: z.string().email('login.invalidEmail'),
  password: z.string().min(6, 'login.passwordTooShort'),
});

const registerSchema = loginSchema.extend({
  name: z.string().min(1, 'login.nameRequired'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'login.passwordMismatch',
  path: ['confirmPassword'],
});

type FieldErrors = Partial<Record<string, string>>;

/** Parse OAuth callback data from URL hash fragment. */
function parseOAuthHash(): { accessToken: string; refreshToken: string; user: { id: string; email: string; name?: string } } | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#oauth_callback?')) return null;

  const params = new URLSearchParams(hash.slice('#oauth_callback?'.length));
  const accessToken = params.get('accessToken');
  const refreshToken = params.get('refreshToken');
  const userJson = params.get('user');

  if (!accessToken || !refreshToken || !userJson) return null;

  try {
    const user = JSON.parse(userJson) as { id: string; email: string; name?: string };
    return { accessToken, refreshToken, user };
  } catch {
    return null;
  }
}

/** Parse OAuth error from URL hash fragment. */
function parseOAuthError(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#oauth_error?')) return null;

  const params = new URLSearchParams(hash.slice('#oauth_error?'.length));
  return params.get('error');
}

export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, register, isLoading, error, clearError } = useAuthStore();

  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Handle OAuth callback on mount
  useEffect(() => {
    const oauthData = parseOAuthHash();
    if (oauthData) {
      setToken(oauthData.accessToken);
      localStorage.setItem('refresh_token', oauthData.refreshToken);
      localStorage.setItem('auth_user', JSON.stringify(oauthData.user));
      useAuthStore.setState({ user: oauthData.user, isAuthenticated: true });
      window.location.hash = '';
      navigate('/dashboard', { replace: true });
      return;
    }

    const errorMsg = parseOAuthError();
    if (errorMsg) {
      setOauthError(errorMsg);
      window.location.hash = '';
    }
  }, [navigate]);

  function toggleMode() {
    setIsRegisterMode((prev) => !prev);
    setFieldErrors({});
    setOauthError(null);
    clearError();
  }

  function validate(): boolean {
    const data = isRegisterMode
      ? { email, password, name, confirmPassword }
      : { email, password };

    const schema = isRegisterMode ? registerSchema : loginSchema;
    const result = schema.safeParse(data);

    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (!errors[field]) {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return false;
    }

    setFieldErrors({});
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    try {
      if (isRegisterMode) {
        await register(email, password, name);
      } else {
        await login(email, password);
      }
      navigate('/dashboard');
    } catch {
      // Error is handled by the store
    }
  }

  function handleGitHubLogin() {
    window.location.href = `${API_BASE_URL}/auth/github`;
  }

  const displayError = oauthError ?? error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Server className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">{t('login.appName')}</CardTitle>
          <CardDescription>
            {isRegisterMode
              ? t('login.createAccount')
              : t('login.signIn')}
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {displayError && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{displayError}</span>
              </div>
            )}

            {isRegisterMode && (
              <div className="space-y-2">
                <Label htmlFor="name">{t('login.name')}</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder={t('login.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={!!fieldErrors.name}
                />
                {fieldErrors.name && (
                  <p className="text-sm text-destructive">{t(fieldErrors.name)}</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">{t('login.email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t('login.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldErrors.email}
              />
              {fieldErrors.email && (
                <p className="text-sm text-destructive">
                  {t(fieldErrors.email)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('login.password')}</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!fieldErrors.password}
              />
              {fieldErrors.password && (
                <p className="text-sm text-destructive">
                  {t(fieldErrors.password)}
                </p>
              )}
            </div>

            {isRegisterMode && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('login.confirmPassword')}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={!!fieldErrors.confirmPassword}
                />
                {fieldErrors.confirmPassword && (
                  <p className="text-sm text-destructive">
                    {t(fieldErrors.confirmPassword)}
                  </p>
                )}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isRegisterMode ? t('login.createAccountBtn') : t('login.signInBtn')}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">{t('common.or')}</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGitHubLogin}
              disabled={isLoading}
            >
              <Github className="mr-2 h-4 w-4" />
              {t('login.continueWithGithub')}
            </Button>
          </CardContent>
        </form>

        <CardFooter className="justify-center">
          <Button variant="link" onClick={toggleMode} type="button">
            {isRegisterMode
              ? t('login.alreadyHaveAccount')
              : t('login.noAccount')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
