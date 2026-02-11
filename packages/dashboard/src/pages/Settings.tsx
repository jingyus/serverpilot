// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState } from 'react';
import { Save, Loader2, AlertCircle, CheckCircle2, Key, User, Bell, Shield, Book, RefreshCw } from 'lucide-react';
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

const AI_PROVIDERS: { value: AIProvider; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude (Anthropic)', description: 'Powerful AI with strong reasoning' },
  { value: 'openai', label: 'OpenAI (GPT)', description: 'Versatile and widely supported' },
  { value: 'deepseek', label: 'DeepSeek', description: 'Cost-effective with strong coding ability' },
  { value: 'ollama', label: 'Ollama (Local)', description: 'Run models locally for privacy' },
  { value: 'custom-openai', label: 'Custom OpenAI Compatible', description: 'OneAPI / LiteLLM / Azure' },
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
      useSettingsStore.setState({ error: `API key is required for ${aiProvider}` });
      return;
    }
    // custom-openai requires Base URL and Model
    if (aiProvider === 'custom-openai') {
      if (!baseUrl.trim()) {
        useSettingsStore.setState({ error: 'Base URL is required for Custom OpenAI Compatible provider' });
        return;
      }
      if (!model.trim()) {
        useSettingsStore.setState({ error: 'Model name is required for Custom OpenAI Compatible provider' });
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
      showSuccess('AI Provider settings saved successfully');
    } catch {
      // Error is handled by store
    }
  };

  const handleSaveProfile = async () => {
    try {
      await updateUserProfile({ name, email, timezone });
      showSuccess('Profile updated successfully');
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
      showSuccess('Notification preferences saved');
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
      showSuccess('Knowledge base settings saved');
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
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Platform configuration and preferences.
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
            Dismiss
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
            <CardTitle>AI Provider</CardTitle>
          </div>
          <CardDescription>
            Configure which AI model provider to use for server operations
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
                  ? `${healthStatus.provider ?? 'Provider'} is connected`
                  : healthStatus.error ?? 'Provider unavailable'}
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
            <Label htmlFor="ai-provider">Provider</Label>
            <select
              id="ai-provider"
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value as AIProvider)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} - {p.description}
                </option>
              ))}
            </select>
          </div>

          {PROVIDERS_REQUIRING_KEY.includes(aiProvider) && (
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
              <p className="text-xs text-muted-foreground">
                Your API key is stored securely and never exposed in logs
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="model">
              Model{aiProvider === 'custom-openai' ? '' : ' (optional)'}
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
                Base URL{(aiProvider === 'ollama' || aiProvider === 'custom-openai') ? '' : ' (optional)'}
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
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save AI Provider
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
            <CardTitle>User Profile</CardTitle>
          </div>
          <CardDescription>Manage your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
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
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Profile
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
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>Configure notification preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="email-notifications">Email Notifications</Label>
              <p className="text-xs text-muted-foreground">
                Receive notifications via email
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
              <Label htmlFor="task-completion">Task Completion</Label>
              <p className="text-xs text-muted-foreground">
                Notify when operations complete
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
              <Label htmlFor="system-alerts">System Alerts</Label>
              <p className="text-xs text-muted-foreground">
                Critical system and security alerts
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
              <Label htmlFor="operation-reports">Operation Reports</Label>
              <p className="text-xs text-muted-foreground">
                Daily summary of operations
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
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Preferences
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
            <CardTitle>Security</CardTitle>
          </div>
          <CardDescription>Password and session management</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Password management coming soon. Use the authentication system to change your password.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Knowledge Base */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Book className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Knowledge Base</CardTitle>
          </div>
          <CardDescription>Configure automatic learning and documentation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-learning">Automatic Learning</Label>
              <p className="text-xs text-muted-foreground">
                Automatically learn from operations and improve suggestions
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
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Settings
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
