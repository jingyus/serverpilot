// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * 计费页 — Cloud 版本订阅管理、计划列表、升级/取消。
 * 依赖 GET /api/v1/billing/plans、/subscription，POST /subscribe、/cancel（需 X-Tenant-ID）。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, Loader2, AlertCircle, Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, ApiError } from "@/api/client";
import { getTenantId } from "@/api/auth";
import { cn } from "@/lib/utils";

interface BillingPlan {
  id: string;
  name: string;
  maxServers: number;
  maxUsers: number;
  monthlyPrice: number;
  aiCallsPerMonth: number;
  features: string[];
}

interface Subscription {
  id: number;
  tenantId: string;
  plan: string;
  status: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

export function Billing() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const hasTenant = !!getTenantId();

  const load = () => {
    if (!hasTenant) {
      setLoading(false);
      setError("billing.tenantRequired");
      return;
    }
    setLoading(true);
    setError(null);
    apiRequest<{ plans: BillingPlan[] }>("/billing/plans")
      .then((r) => {
        setPlans(r.plans ?? []);
        return apiRequest<{ subscription: Subscription | null }>(
          "/billing/subscription",
        );
      })
      .then((r) => {
        setSubscription(r.subscription ?? null);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [hasTenant]);

  const handleCancel = () => {
    if (!subscription || actionLoading) return;
    setActionLoading("cancel");
    apiRequest("/billing/cancel", { method: "POST" })
      .then(() => load())
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setActionLoading(null));
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !plans.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-center text-muted-foreground">
          {error === "billing.tenantRequired"
            ? t(
                "billing.tenantRequired",
                "计费数据需要租户上下文，请重新登录。",
              )
            : error}
        </p>
      </div>
    );
  }

  const currentPlanId = subscription?.plan ?? "free";

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("billing.title", "计费与订阅")}
        </h1>
        <p className="text-muted-foreground">
          {t("billing.description", "管理您的订阅与计划")}
        </p>
      </div>

      {subscription && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              {t("billing.currentSubscription", "当前订阅")}
            </CardTitle>
            <Badge
              variant={
                subscription.status === "active" ? "default" : "secondary"
              }
            >
              {subscription.status}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="font-medium capitalize">
                {subscription.plan}
              </span>
              {subscription.currentPeriodEnd && (
                <span className="text-muted-foreground">
                  {t("billing.periodEnd", "周期结束")}:{" "}
                  {subscription.currentPeriodEnd}
                </span>
              )}
              {subscription.cancelAtPeriodEnd && (
                <span className="text-amber-600 dark:text-amber-400">
                  {t("billing.cancelAtPeriodEnd", "将在周期结束时取消")}
                </span>
              )}
              {subscription.status === "active" &&
                !subscription.cancelAtPeriodEnd && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancel}
                    disabled={!!actionLoading || currentPlanId === "free"}
                  >
                    {actionLoading === "cancel" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("billing.cancel", "取消订阅")
                    )}
                  </Button>
                )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = currentPlanId === plan.id;
          return (
            <Card
              key={plan.id}
              className={cn(isCurrent && "ring-2 ring-primary")}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  {isCurrent && (
                    <Badge variant="secondary">
                      <Check className="h-3 w-3 mr-1" />
                      {t("billing.current", "当前")}
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  ${plan.monthlyPrice}/月
                  {plan.aiCallsPerMonth >= 0
                    ? ` · ${plan.aiCallsPerMonth === -1 ? t("billing.unlimitedCalls", "无限") : plan.aiCallsPerMonth} AI 调用/月`
                    : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {plan.features.slice(0, 4).map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
