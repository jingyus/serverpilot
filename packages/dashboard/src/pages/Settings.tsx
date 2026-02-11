// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Loader2, AlertCircle, CheckCircle2, Key, User, Bell, Shield, Book, RefreshCw, Globe } from 'lucide-react';
import { supportedLanguages, setStoredLanguage } from '@/i18n';
import { DocSourceSection } from '@/components/knowledge/DocSourceSection';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useSettingsStore, type AIProvider } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Shanghai',
  'Asia/Tokyo',
];

const AI_PROVIDERS: { value: AIProvider; labelKey: string }[] = [
  { value: 'claude', labelKey: 'settings.providerClaude' },
  { value: 'openai', labelKey: 'settings.providerOpenai' },
  { value: 'deepseek', labelKey: 'settings.providerDeepseek' },
  { value: 'ollama', labelKey: 'settings.providerOllama' },
  { value: 'custom-openai', labelKey: 'settings.providerCustom' },
];

/** Providers that require an API key */
const PROVIDERS_REQUIRING_KEY: AIProvider[] = ['claude', 'openai', 'deepseek', 'custom-openai'];
/** Providers that support a custom base URL */
const PROVIDERS_WITH_BASE_URL: AIProvider[] = ['openai', 'deepseek', 'ollama', 'custom-openai'];

function getModelPlaceholder(provider: AIProvider): string {
  switch (provider) {
    case 'claude': return 'claude-sonnet-4-5-20250929';
    case 'openai': return 'gpt-4';
    case 'deepseek': return 'deepseek-chat';
    case 'ollama': return 'llama3';
    case 'custom-openai': return 'gpt-4o / deepseek-chat / ...';
  }
}

function getBaseUrlPlaceholder(provider: AIProvider): string {
  switch (provider) {
    case 'ollama': return 'http://localhost:11434';
    case 'deepseek': return 'https://api.deepseek.com';
    case 'openai': return 'https://api.openai.com/v1';
    case 'custom-openai': return 'https://your-api.example.com/v1';
    default: return '';
  }
}

export function Settings() {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const {
    settings,
    isLoading,
    error,
    isSaving,
    healthStatus,
    isCheckingHealth,
    fetchSettings,
    updateAIProvider,
    updateUserProfile,
    updateNotifications,
    updateKnowledgeBase,
    checkProviderHealth,
    clearError,
  } = useSettingsStore();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // AI Provider form state
  const [aiProvider, setAiProvider] = useState<AIProvider>('claude');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  // User profile form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('UTC');

  // Notification preferences state
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [taskCompletion, setTaskCompletion] = useState(true);
  const [systemAlerts, setSystemAlerts] = useState(true);
  const [operationReports, setOperationReports] = useState(false);

  // Knowledge base state
  const [autoLearning, setAutoLearning] = useState(false);

  useEffect(() => {
    fetchSettings();
    checkProviderHealth();
  }, [fetchSettings, checkProviderHealth]);

  useEffect(() => {
    if (settings) {
      // Populate AI Provider settings
      setAiProvider(settings.aiProvider.provider);
      setApiKey(settings.aiProvider.apiKey ?? '');
      setModel(settings.aiProvider.model ?? '');
      setBaseUrl(settings.aiProvider.baseUrl ?? '');

      // Populate user profile
      setName(settings.userProfile.name);
      setEmail(settings.userProfile.email);
      setTimezone(settings.userProfile.timezone);

      // Populate notifications
      setEmailNotifications(settings.notifications.emailNotifications);
      setTaskCompletion(settings.notifications.taskCompletion);
      setSystemAlerts(settings.notifications.systemAlerts);
      setOperationReports(settings.notifications.operationReports);

      // Populate knowledge base
      setAutoLearning(settings.knowledgeBase.autoLearning);
    } else if (user) {
      // Fallback to user data from auth store
      setName(user.name ?? '');
      setEmail(user.email);
      setTimezone(user.timezone ?? 'UTC');
    }
  }, [settings, user]);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleSaveAIProvider = async () => {
    // Basic validation: providers requiring a key must have one
    if (PROVIDERS_REQUIRING_KEY.includes(aiProvider) && !apiKey.trim()) {
      useSettingsStore.setState({ error: t('settings.apiKeyRequired', { provider: aiProvider }) });
      return;
    }
    // custom-openai requires Base URL and Model
    if (aiProvider === 'custom-openai') {
      if (!baseUrl.trim()) {
        useSettingsStore.setState({ error: t('settings.baseUrlRequired') });
        return;
      }
      if (!model.trim()) {
        useSettingsStore.setState({ error: t('settings.modelRequired') });
        return;
      }
    }
    try {
      await updateAIProvider({
        provider: aiProvider,
        apiKey: apiKey || undefined,
        model: model || undefined,
        baseUrl: baseUrl || undefined,
      });
      showSuccess(t('settings.aiProviderSaved'));
    } catch {
      // Error is handled by store
    }
  };

  const handleSaveProfile = async () => {
    try {
      await updateUserProfile({ name, email, timezone });
      showSuccess(t('settings.profileSaved'));
    } catch {
      // Error is handled by store
    }
  };

  const handleSaveNotifications = async () => {
    try {
      await updateNotifications({
        emailNotifications,
        taskCompletion,
        systemAlerts,
        operationReports,
      });
      showSuccess(t('settings.preferencesSaved'));
    } catch {
      // Error is handled by store
    }
  };

  const handleSaveKnowledgeBase = async () => {
    try {
      await updateKnowledgeBase({
        autoLearning,
        documentSources: [],
      });
      showSuccess(t('settings.knowledgeBaseSaved'));
    } catch {
      // Error is handled by store
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="settings-page">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t('settings.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('settings.description')}
        </p>
      </div>

      {/* Global Error */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearError}
            className="ml-auto h-auto p-1"
          >
            {t('common.dismiss')}
          </Button>
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-green-500/50 bg-green-50 p-3 text-sm text-green-700"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* AI Provider Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t('settings.aiProvider')}</CardTitle>
          </div>
          <CardDescription>
            {t('settings.aiProviderDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Health Status */}
          {healthStatus && (
            <div
              data-testid="health-status"
              className={cn(
                'flex items-center gap-2 rounded-md border p-3 text-sm',
                healthStatus.available
                  ? 'border-green-500/50 bg-green-50 text-green-700'
                  : 'border-destructive/50 bg-destructive/10 text-destructive'
              )}
            >
              {healthStatus.available ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>
                {healthStatus.available
                  ? `${healthStatus.provider ?? t('settings.provider')} ${t('settings.isConnected')}`
                  : healthStatus.error ?? t('settings.providerUnavailable')}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={checkProviderHealth}
                disabled={isCheckingHealth}
                className="ml-auto h-auto p-1"
                aria-label="Refresh health status"
              >
                <RefreshCw className={cn('h-4 w-4', isCheckingHealth && 'animate-spin')} />
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="ai-provider">{t('settings.provider')}</Label>
            <select
              id="ai-provider"
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value as AIProvider)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t(p.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {PROVIDERS_REQUIRING_KEY.includes(aiProvider) && (
            <div className="space-y-2">
              <Label htmlFor="api-key">{t('settings.apiKey')}</Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.apiKeyHint')}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="model">
              {aiProvider === 'custom-openai' ? t('settings.model') : `${t('settings.model')} ${t('settings.optional')}`}
            </Label>
            <Input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={getModelPlaceholder(aiProvider)}
            />
          </div>

          {PROVIDERS_WITH_BASE_URL.includes(aiProvider) && (
            <div className="space-y-2">
              <Label htmlFor="base-url">
                {(aiProvider === 'ollama' || aiProvider === 'custom-openai')
                  ? t('settings.baseUrl')
                  : `${t('settings.baseUrl')} ${t('settings.optional')}`}
              </Label>
              <Input
                id="base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={getBaseUrlPlaceholder(aiProvider)}
              />
            </div>
          )}

          <Button
            onClick={handleSaveAIProvider}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('common.saving')}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t('settings.saveAiProvider')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* User Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t('settings.userProfile')}</CardTitle>
          </div>
          <CardDescription>{t('settings.userProfileDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('settings.name')}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.namePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t('settings.email')}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('settings.emailPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">{t('settings.timezone')}</Label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <Button
            onClick={handleSaveProfile}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('common.saving')}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t('settings.saveProfile')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t('settings.notifications')}</CardTitle>
          </div>
          <CardDescription>{t('settings.notificationsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="email-notifications">{t('settings.emailNotifications')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.emailNotificationsDesc')}
              </p>
            </div>
            <Switch
              id="email-notifications"
              checked={emailNotifications}
              onCheckedChange={setEmailNotifications}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="task-completion">{t('settings.taskCompletion')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.taskCompletionDesc')}
              </p>
            </div>
            <Switch
              id="task-completion"
              checked={taskCompletion}
              onCheckedChange={setTaskCompletion}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="system-alerts">{t('settings.systemAlerts')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.systemAlertsDesc')}
              </p>
            </div>
            <Switch
              id="system-alerts"
              checked={systemAlerts}
              onCheckedChange={setSystemAlerts}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="operation-reports">{t('settings.operationReports')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.operationReportsDesc')}
              </p>
            </div>
            <Switch
              id="operation-reports"
              checked={operationReports}
              onCheckedChange={setOperationReports}
            />
          </div>

          <Button
            onClick={handleSaveNotifications}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('common.saving')}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t('settings.savePreferences')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t('settings.security')}</CardTitle>
          </div>
          <CardDescription>{t('settings.securityDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t('settings.securityComingSoon')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t('settings.language')}</CardTitle>
          </div>
          <CardDescription>{t('settings.languageDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="language">{t('settings.language')}</Label>
            <select
              id="language"
              value={i18n.language}
              onChange={(e) => {
                const lng = e.target.value;
                i18n.changeLanguage(lng);
                setStoredLanguage(lng);
                showSuccess(t('settings.languageSaved'));
              }}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="language-select"
            >
              {supportedLanguages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Knowledge Base */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Book className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t('settings.knowledgeBase')}</CardTitle>
          </div>
          <CardDescription>{t('settings.knowledgeBaseDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-learning">{t('settings.autoLearning')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.autoLearningDesc')}
              </p>
            </div>
            <Switch
              id="auto-learning"
              checked={autoLearning}
              onCheckedChange={setAutoLearning}
            />
          </div>

          <Separator />

          <DocSourceSection />

          <Separator />

          <Button
            onClick={handleSaveKnowledgeBase}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('common.saving')}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t('settings.saveSettings')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
