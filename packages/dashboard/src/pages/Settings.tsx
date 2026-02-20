// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Save,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Key,
  Bell,
  User,
  Shield,
  Activity,
  RefreshCw,
} from "lucide-react";
import { SystemStatus } from "@/components/settings/SystemStatus";
import { PasswordChangeSection } from "@/components/settings/PasswordChangeSection";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore, type AIProvider } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { useNotificationsStore } from "@/stores/notifications";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Shanghai",
  "Asia/Tokyo",
];

const AI_PROVIDERS: { value: AIProvider; labelKey: string }[] = [
  { value: "claude", labelKey: "settings.providerClaude" },
  { value: "openai", labelKey: "settings.providerOpenai" },
  { value: "deepseek", labelKey: "settings.providerDeepseek" },
  { value: "ollama", labelKey: "settings.providerOllama" },
  { value: "custom-openai", labelKey: "settings.providerCustom" },
];

const PROVIDERS_REQUIRING_KEY: AIProvider[] = [
  "claude",
  "openai",
  "deepseek",
  "custom-openai",
];
const PROVIDERS_WITH_BASE_URL: AIProvider[] = [
  "openai",
  "deepseek",
  "ollama",
  "custom-openai",
];

function getModelPlaceholder(provider: AIProvider): string {
  switch (provider) {
    case "claude":
      return "claude-sonnet-4-5-20250929";
    case "openai":
      return "gpt-4";
    case "deepseek":
      return "deepseek-chat";
    case "ollama":
      return "llama3";
    case "custom-openai":
      return "gpt-4o / deepseek-chat / ...";
  }
}

function getBaseUrlPlaceholder(provider: AIProvider): string {
  switch (provider) {
    case "ollama":
      return "http://localhost:11434";
    case "deepseek":
      return "https://api.deepseek.com";
    case "openai":
      return "https://api.openai.com/v1";
    case "custom-openai":
      return "https://your-api.example.com/v1";
    default:
      return "";
  }
}

export function Settings() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
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
    checkProviderHealth,
    clearError,
  } = useSettingsStore();

  // Get initial tab from URL or default to 'ai-provider'
  const defaultTab = searchParams.get("tab") || "ai-provider";
  const [activeTab, setActiveTab] = useState(defaultTab);

  // AI Provider form state
  const [aiProvider, setAiProvider] = useState<AIProvider>("claude");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  // User profile form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("UTC");

  // Notification preferences state
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [taskCompletion, setTaskCompletion] = useState(true);
  const [systemAlerts, setSystemAlerts] = useState(true);
  const [operationReports, setOperationReports] = useState(false);

  useEffect(() => {
    fetchSettings();
    checkProviderHealth();
  }, [fetchSettings, checkProviderHealth]);

  useEffect(() => {
    if (settings) {
      setAiProvider(settings.aiProvider.provider);
      setApiKey(settings.aiProvider.apiKey ?? "");
      setModel(settings.aiProvider.model ?? "");
      setBaseUrl(settings.aiProvider.baseUrl ?? "");

      setName(settings.userProfile.name);
      setEmail(settings.userProfile.email);
      setTimezone(settings.userProfile.timezone);

      setEmailNotifications(settings.notifications.emailNotifications);
      setTaskCompletion(settings.notifications.taskCompletion);
      setSystemAlerts(settings.notifications.systemAlerts);
      setOperationReports(settings.notifications.operationReports);
    } else if (user) {
      setName(user.name ?? "");
      setEmail(user.email);
      setTimezone(user.timezone ?? "UTC");
    }
  }, [settings, user]);

  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams({ tab: value });
  };

  const showSuccess = (message: string) => {
    useNotificationsStore.getState().add({ type: "success", title: message });
  };

  const handleSaveAIProvider = async () => {
    if (PROVIDERS_REQUIRING_KEY.includes(aiProvider) && !apiKey.trim()) {
      useSettingsStore.setState({
        error: t("settings.apiKeyRequired", { provider: aiProvider }),
      });
      return;
    }
    if (aiProvider === "custom-openai") {
      if (!baseUrl.trim()) {
        useSettingsStore.setState({ error: t("settings.baseUrlRequired") });
        return;
      }
      if (!model.trim()) {
        useSettingsStore.setState({ error: t("settings.modelRequired") });
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
      showSuccess(t("settings.aiProviderSaved"));
    } catch {
      useNotificationsStore
        .getState()
        .add({ type: "error", title: t("settings.saveFailed") });
    }
  };

  const handleSaveProfile = async () => {
    try {
      await updateUserProfile({ name, email, timezone });
      showSuccess(t("settings.profileSaved"));
    } catch {
      useNotificationsStore
        .getState()
        .add({ type: "error", title: t("settings.saveFailed") });
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
      showSuccess(t("settings.preferencesSaved"));
    } catch {
      useNotificationsStore
        .getState()
        .add({ type: "error", title: t("settings.saveFailed") });
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
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">
          {t("settings.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.description")}
        </p>
      </div>

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
            {t("common.dismiss")}
          </Button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-flex">
          <TabsTrigger value="ai-provider">
            <Key className="mr-2 h-4 w-4" />
            {t("settings.aiProviderTab")}
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="mr-2 h-4 w-4" />
            {t("settings.notificationsTab")}
          </TabsTrigger>
          <TabsTrigger value="profile">
            <User className="mr-2 h-4 w-4" />
            {t("settings.profileTab")}
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="mr-2 h-4 w-4" />
            {t("settings.securityTab")}
          </TabsTrigger>
          <TabsTrigger value="system">
            <Activity className="mr-2 h-4 w-4" />
            {t("settings.systemTab")}
          </TabsTrigger>
        </TabsList>

        {/* AI Provider Tab */}
        <TabsContent value="ai-provider">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.aiProvider")}</CardTitle>
              <CardDescription>{t("settings.aiProviderDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {healthStatus && (
                <div
                  data-testid="health-status"
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-3 text-sm",
                    healthStatus.available
                      ? "border-green-500/50 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300"
                      : "border-destructive/50 bg-destructive/10 text-destructive",
                  )}
                >
                  {healthStatus.available ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    {healthStatus.available
                      ? `${healthStatus.provider ?? t("settings.provider")} ${t("settings.isConnected")}`
                      : (healthStatus.error ??
                        t("settings.providerUnavailable"))}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={checkProviderHealth}
                    disabled={isCheckingHealth}
                    className="ml-auto h-auto p-1"
                    aria-label="Refresh health status"
                  >
                    <RefreshCw
                      className={cn(
                        "h-4 w-4",
                        isCheckingHealth && "animate-spin",
                      )}
                    />
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="ai-provider">{t("settings.provider")}</Label>
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
                  <Label htmlFor="api-key">{t("settings.apiKey")}</Label>
                  <Input
                    id="api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("settings.apiKeyHint")}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="model">
                  {aiProvider === "custom-openai"
                    ? t("settings.model")
                    : `${t("settings.model")} ${t("settings.optional")}`}
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
                    {aiProvider === "ollama" || aiProvider === "custom-openai"
                      ? t("settings.baseUrl")
                      : `${t("settings.baseUrl")} ${t("settings.optional")}`}
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
                    {t("common.saving")}
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    {t("settings.saveAiProvider")}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.notifications")}</CardTitle>
              <CardDescription>
                {t("settings.notificationsDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email-notifications">
                    {t("settings.emailNotifications")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.emailNotificationsDesc")}
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
                  <Label htmlFor="task-completion">
                    {t("settings.taskCompletion")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.taskCompletionDesc")}
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
                  <Label htmlFor="system-alerts">
                    {t("settings.systemAlerts")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.systemAlertsDesc")}
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
                  <Label htmlFor="operation-reports">
                    {t("settings.operationReports")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.operationReportsDesc")}
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
                    {t("common.saving")}
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    {t("settings.savePreferences")}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Profile Tab */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.userProfile")}</CardTitle>
              <CardDescription>{t("settings.userProfileDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t("settings.name")}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("settings.namePlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t("settings.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("settings.emailPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="timezone">{t("settings.timezone")}</Label>
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
                    {t("common.saving")}
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    {t("settings.saveProfile")}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <PasswordChangeSection />
        </TabsContent>

        {/* System Tab */}
        <TabsContent value="system">
          <SystemStatus />
        </TabsContent>
      </Tabs>
    </div>
  );
}
