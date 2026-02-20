// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * 使用量仪表盘 — Cloud 版本月摘要、历史趋势、配额详情。
 * 依赖后端 GET /api/v1/usage/summary | /history | /quota（需 X-Tenant-ID）。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Cpu,
  Server,
  Puzzle,
  Calendar,
  TrendingUp,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiRequest, ApiError } from "@/api/client";
import { getTenantId } from "@/api/auth";
import { cn } from "@/lib/utils";

interface UsageSummary {
  aiCalls: number;
  aiCost: number;
  quotaRemaining: number;
  skillExecutions: number;
  serverCount: number;
}

interface UsageHistory {
  dailyCosts: Array<{ date: string; cost: number }>;
  modelDistribution: Array<{
    model: string;
    callCount: number;
    totalCost: number;
    costPercent: number;
  }>;
  topSkills: Array<{ skillName: string; count: number }>;
}

interface UsageQuota {
  plan: string;
  used: number;
  limit: number | null;
  resetDate: string;
}

export function Usage() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [quota, setQuota] = useState<UsageQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasTenant = !!getTenantId();

  useEffect(() => {
    if (!hasTenant) {
      setLoading(false);
      setError("usage.tenantRequired");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiRequest<UsageSummary>("/usage/summary").catch((e) => e),
      apiRequest<UsageHistory>("/usage/history?days=30").catch((e) => e),
      apiRequest<UsageQuota>("/usage/quota").catch((e) => e),
    ]).then(([s, h, q]) => {
      if (cancelled) return;
      if (s instanceof Error) {
        setError(s instanceof ApiError ? s.message : String(s));
        setLoading(false);
        return;
      }
      setSummary(s as UsageSummary);
      setHistory(h instanceof Error ? null : (h as UsageHistory));
      setQuota(q instanceof ApiError ? null : (q as UsageQuota));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [hasTenant]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-center text-muted-foreground">
          {error === "usage.tenantRequired"
            ? t(
                "usage.tenantRequired",
                "使用量数据需要租户上下文，请重新登录。",
              )
            : error}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("usage.title", "使用量")}
        </h1>
        <p className="text-muted-foreground">
          {t("usage.description", "本月 AI 调用、成本与配额概览")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("usage.aiCalls", "AI 调用次数")}
            </CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.aiCalls ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("usage.aiCost", "AI 成本")}
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(summary?.aiCost ?? 0).toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("usage.skillExecutions", "Skills 执行")}
            </CardTitle>
            <Puzzle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.skillExecutions ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("usage.servers", "服务器数")}
            </CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.serverCount ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {quota && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("usage.quota", "配额")}
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-medium capitalize">{quota.plan}</span>
              <span className="text-muted-foreground">
                {quota.limit != null
                  ? t("usage.quotaUsed", "已用 {{used}} / {{limit}}", {
                      used: quota.used,
                      limit: quota.limit,
                    })
                  : t("usage.quotaUsedUnlimited", "已用 {{used}}", {
                      used: quota.used,
                    })}
              </span>
              <span className="text-muted-foreground text-sm">
                {t("usage.resetDate", "重置日")}: {quota.resetDate}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {history && history.dailyCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              {t("usage.dailyCosts", "近 30 日成本")}
            </CardTitle>
            <CardDescription>
              {t("usage.dailyCostsDescription", "按日汇总 AI 调用成本")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[240px] overflow-x-auto">
              <div className="flex h-full min-w-[600px] items-end gap-0.5">
                {history.dailyCosts.map((d) => {
                  const maxCost = Math.max(
                    ...history.dailyCosts.map((x) => x.cost),
                    1,
                  );
                  const pct =
                    maxCost > 0 ? Math.min(100, (d.cost / maxCost) * 100) : 0;
                  return (
                    <div
                      key={d.date}
                      className={cn(
                        "flex-1 rounded-t min-w-[8px]",
                        d.cost === 0 ? "bg-muted" : "bg-primary/70",
                      )}
                      style={{ height: `${pct}%` }}
                      title={`${d.date}: $${d.cost.toFixed(2)}`}
                    />
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
              {history.dailyCosts.slice(-7).map((d) => (
                <span key={d.date}>
                  {d.date}: ${d.cost.toFixed(2)}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {history && history.topSkills.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("usage.topSkills", "Skills 使用排行")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {history.topSkills.map((s) => (
                <li key={s.skillName} className="flex justify-between text-sm">
                  <span>{s.skillName}</span>
                  <span className="text-muted-foreground">{s.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
