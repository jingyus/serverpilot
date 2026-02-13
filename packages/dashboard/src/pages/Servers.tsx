// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Server,
  Plus,
  Search,
  MessageCircle,
  Trash2,
  AlertCircle,
  Loader2,
  Monitor,
  LayoutGrid,
  List,
  CheckSquare,
  Square,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AddServerDialog,
  BatchDeleteDialog,
  DeleteServerDialog,
} from "@/components/server";
import { useServersStore } from "@/stores/servers";
import { useNotificationsStore } from "@/stores/notifications";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/format";
import type { Server as ServerType } from "@/types/server";

// Hash-based color palette for tag chips
const TAG_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
  "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800",
  "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800",
  "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800",
  "bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800",
  "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800",
  "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800",
  "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
];

/** Deterministic color based on tag string hash. */
export function getTagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

const STATUS_CONFIG: Record<
  string,
  {
    tKey: string;
    variant: "default" | "secondary" | "destructive";
    dot: string;
  }
> = {
  online: { tKey: "status.online", variant: "default", dot: "bg-green-500" },
  offline: { tKey: "status.offline", variant: "secondary", dot: "bg-gray-400" },
  error: { tKey: "status.error", variant: "destructive", dot: "bg-red-500" },
};

const STATUS_FILTERS = [
  { value: "all", tKey: "servers.all" },
  { value: "online", tKey: "status.online" },
  { value: "offline", tKey: "status.offline" },
  { value: "error", tKey: "status.error" },
];

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return (
    <Badge variant={config.variant} className="gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", config.dot)} />
      {t(config.tKey)}
    </Badge>
  );
}

function TagChip({ tag }: { tag: string }) {
  const colorClass = getTagColor(tag);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium",
        colorClass,
      )}
    >
      {tag}
    </span>
  );
}

function ServerCard({
  server,
  selected,
  onSelect,
  onChat,
  onDelete,
  onDetail,
}: {
  server: ServerType;
  selected: boolean;
  onSelect: (id: string) => void;
  onChat: (id: string) => void;
  onDelete: (id: string) => void;
  onDetail: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card
      data-testid={`server-card-${server.id}`}
      className={cn(
        "cursor-pointer transition-shadow hover:shadow-md",
        selected && "ring-2 ring-primary",
      )}
      onClick={() => onDetail(server.id)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(server.id);
              }}
              aria-label={`Select ${server.name}`}
              data-testid={`select-server-${server.id}`}
            >
              {selected ? (
                <CheckSquare className="h-5 w-5" />
              ) : (
                <Monitor className="h-5 w-5" />
              )}
            </button>
            <div>
              <CardTitle className="text-base">{server.name}</CardTitle>
              {server.osInfo && (
                <CardDescription className="mt-0.5">
                  {server.osInfo.platform} {server.osInfo.version}
                </CardDescription>
              )}
            </div>
          </div>
          <StatusBadge status={server.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {(server.tags.length > 0 || server.group) && (
            <div className="flex flex-wrap gap-1">
              {server.group && (
                <Badge
                  variant="secondary"
                  className="text-xs"
                  data-testid="server-group"
                >
                  {server.group}
                </Badge>
              )}
              {server.tags.map((tag) => (
                <TagChip key={tag} tag={tag} />
              ))}
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {server.lastSeen
                ? `Last seen: ${formatDate(server.lastSeen)}`
                : `Created: ${formatDate(server.createdAt)}`}
            </span>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onChat(server.id);
              }}
              aria-label={`Chat with ${server.name}`}
            >
              <MessageCircle className="mr-1 h-3.5 w-3.5" />
              {t("servers.chat")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(server.id);
              }}
              aria-label={`Delete ${server.name}`}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t("common.delete")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Servers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    servers,
    availableGroups,
    isLoading,
    error,
    statusFilter,
    searchQuery,
    groupFilter,
    tagFilter,
    viewMode,
    fetchServers,
    fetchGroups,
    addServer,
    deleteServer,
    startStatusStream,
    stopStatusStream,
    setStatusFilter,
    setSearchQuery,
    setGroupFilter,
    setTagFilter,
    setViewMode,
    clearError,
  } = useServersStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServerType | null>(null);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchDelete, setShowBatchDelete] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [batchDeleteProgress, setBatchDeleteProgress] = useState({
    done: 0,
    total: 0,
  });

  useEffect(() => {
    fetchServers();
    fetchGroups();
    startStatusStream();
    return () => {
      stopStatusStream();
    };
  }, [fetchServers, fetchGroups, startStatusStream, stopStatusStream]);

  // Clear selection when servers change (e.g. after deletion)
  useEffect(() => {
    setSelectedIds((prev) => {
      const serverIds = new Set(servers.map((s) => s.id));
      const next = new Set([...prev].filter((id) => serverIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [servers]);

  // Extract unique groups and tags for filter dropdowns
  const { groups, allTags } = useMemo(() => {
    const groupSet = new Set<string>(availableGroups);
    const tagSet = new Set<string>();
    for (const s of servers) {
      if (s.group) groupSet.add(s.group);
      for (const tag of s.tags) tagSet.add(tag);
    }
    return { groups: [...groupSet].sort(), allTags: [...tagSet].sort() };
  }, [servers, availableGroups]);

  const filteredServers = useMemo(() => {
    return servers.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (groupFilter !== "all") {
        if (groupFilter === "_ungrouped") {
          if (s.group) return false;
        } else {
          if (s.group !== groupFilter) return false;
        }
      }
      if (tagFilter !== "all" && !s.tags.some((tag) => tag === tagFilter))
        return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          (s.group && s.group.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [servers, statusFilter, searchQuery, groupFilter, tagFilter]);

  const groupedServers = useMemo(() => {
    const grouped = new Map<string, ServerType[]>();
    const ungrouped: ServerType[] = [];
    for (const s of filteredServers) {
      if (s.group) {
        const list = grouped.get(s.group) ?? [];
        list.push(s);
        grouped.set(s.group, list);
      } else {
        ungrouped.push(s);
      }
    }
    const entries = [...grouped.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (ungrouped.length > 0) entries.push([t("servers.ungrouped"), ungrouped]);
    return entries;
  }, [filteredServers, t]);

  const stats = useMemo(() => {
    const counts = { total: servers.length, online: 0, offline: 0, error: 0 };
    for (const s of servers) {
      if (s.status === "online") counts.online++;
      else if (s.status === "offline") counts.offline++;
      else if (s.status === "error") counts.error++;
    }
    return counts;
  }, [servers]);

  const handleChat = useCallback(
    (id: string) => navigate(`/chat/${id}`),
    [navigate],
  );
  const handleDetail = useCallback(
    (id: string) => navigate(`/servers/${id}`),
    [navigate],
  );

  const handleAddServer = useCallback(
    async (name: string, tags?: string[], group?: string) => {
      const result = await addServer(name, tags, group);
      useNotificationsStore
        .getState()
        .add({
          type: "success",
          title: t("servers.serverAdded"),
          message: name,
        });
      return result;
    },
    [addServer, t],
  );

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    try {
      await deleteServer(deleteTarget.id);
      useNotificationsStore
        .getState()
        .add({
          type: "success",
          title: t("servers.serverDeleted"),
          message: deleteTarget.name,
        });
    } catch {
      useNotificationsStore
        .getState()
        .add({ type: "error", title: t("servers.deleteFailed") });
    }
    setDeleteTarget(null);
  }

  // Batch selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredIds = useMemo(
    () => new Set(filteredServers.map((s) => s.id)),
    [filteredServers],
  );
  const allFilteredSelected =
    filteredServers.length > 0 &&
    filteredServers.every((s) => selectedIds.has(s.id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (filteredServers.every((s) => prev.has(s.id))) {
        // Deselect all filtered
        const next = new Set(prev);
        for (const s of filteredServers) next.delete(s.id);
        return next;
      }
      // Select all filtered
      const next = new Set(prev);
      for (const s of filteredServers) next.add(s.id);
      return next;
    });
  }, [filteredServers]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Batch delete handler
  const handleBatchDeleteConfirm = useCallback(async () => {
    const ids = [...selectedIds].filter((id) => filteredIds.has(id));
    if (ids.length === 0) return;
    setIsBatchDeleting(true);
    setBatchDeleteProgress({ done: 0, total: ids.length });
    let success = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteServer(id);
        success++;
      } catch {
        failed++;
      }
      setBatchDeleteProgress({ done: success + failed, total: ids.length });
    }
    setIsBatchDeleting(false);
    setShowBatchDelete(false);
    setSelectedIds(new Set());
    const notifications = useNotificationsStore.getState();
    if (failed === 0) {
      notifications.add({
        type: "success",
        title: t("servers.batchDeleteSuccess", { count: success }),
      });
    } else {
      notifications.add({
        type: "error",
        title: t("servers.batchDeletePartial", { success, failed }),
      });
    }
  }, [selectedIds, filteredIds, deleteServer, t]);

  // Batch chat handler — navigate to chat with selected server IDs as query param
  const handleBatchChat = useCallback(() => {
    const ids = [...selectedIds].filter((id) => filteredIds.has(id));
    if (ids.length === 1) {
      navigate(`/chat/${ids[0]}`);
    } else if (ids.length > 1) {
      navigate(`/chat?servers=${ids.join(",")}`);
    }
  }, [selectedIds, filteredIds, navigate]);

  const selectedCount = [...selectedIds].filter((id) =>
    filteredIds.has(id),
  ).length;

  const renderServerCard = useCallback(
    (server: ServerType) => (
      <ServerCard
        key={server.id}
        server={server}
        selected={selectedIds.has(server.id)}
        onSelect={toggleSelect}
        onChat={handleChat}
        onDelete={(id) => {
          const s = servers.find((sv) => sv.id === id);
          if (s) setDeleteTarget(s);
        }}
        onDetail={handleDetail}
      />
    ),
    [selectedIds, toggleSelect, handleChat, handleDetail, servers],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">
            {t("servers.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("servers.description")}
          </p>
        </div>
        <Button
          onClick={() => setShowAddDialog(true)}
          className="w-full sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("servers.addServer")}
        </Button>
      </div>

      {/* Stats */}
      <div
        className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-4"
        data-testid="server-stats"
      >
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xl font-bold sm:text-2xl">{stats.total}</div>
            <p className="text-xs text-muted-foreground">
              {t("servers.totalServers")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xl font-bold text-green-600 sm:text-2xl">
              {stats.online}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("status.online")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xl font-bold text-gray-500 sm:text-2xl">
              {stats.offline}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("status.offline")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xl font-bold text-red-600 sm:text-2xl">
              {stats.error}
            </div>
            <p className="text-xs text-muted-foreground">{t("status.error")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Error alert */}
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
            className="ml-auto"
            onClick={clearError}
          >
            {t("common.dismiss")}
          </Button>
        </div>
      )}

      {/* Batch action toolbar */}
      {selectedCount > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3"
          data-testid="batch-toolbar"
        >
          <span className="text-sm font-medium">
            {t("servers.selectedCount", { count: selectedCount })}
          </span>
          <Button variant="outline" size="sm" onClick={toggleSelectAll}>
            {allFilteredSelected ? (
              <>
                <Square className="mr-1 h-3.5 w-3.5" />
                {t("servers.deselectAll")}
              </>
            ) : (
              <>
                <CheckSquare className="mr-1 h-3.5 w-3.5" />
                {t("servers.selectAll")}
              </>
            )}
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchChat}
              data-testid="batch-chat-btn"
            >
              <MessageCircle className="mr-1 h-3.5 w-3.5" />
              {t("servers.batchChat")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBatchDelete(true)}
              data-testid="batch-delete-btn"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t("servers.batchDelete")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("servers.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            aria-label="Search servers"
          />
        </div>
        <div className="flex gap-1" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={statusFilter === f.value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(f.value)}
              aria-pressed={statusFilter === f.value}
            >
              {t(f.tKey)}
            </Button>
          ))}
        </div>
      </div>

      {/* Group and Tag filters + view mode toggle */}
      {(groups.length > 0 || allTags.length > 0) && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="advanced-filters"
        >
          {groups.length > 0 && (
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              aria-label="Filter by group"
            >
              <option value="all">{t("servers.allGroups")}</option>
              <option value="_ungrouped">{t("servers.ungrouped")}</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              aria-label="Filter by tag"
            >
              <option value="all">{t("servers.allTags")}</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          )}
          <div
            className="ml-auto flex gap-1"
            role="group"
            aria-label="View mode"
          >
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "grouped" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("grouped")}
              aria-pressed={viewMode === "grouped"}
              aria-label="Grouped view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Server list */}
      {isLoading ? (
        <div
          className="flex items-center justify-center py-12"
          data-testid="loading-spinner"
        >
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredServers.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-12 text-center"
          data-testid="empty-state"
        >
          <Server className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {servers.length === 0
              ? t("servers.noServers")
              : t("servers.noMatch")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {servers.length === 0
              ? t("servers.noServersDesc")
              : t("servers.noMatchDesc")}
          </p>
          {servers.length === 0 && (
            <Button className="mt-4" onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("servers.addServer")}
            </Button>
          )}
        </div>
      ) : viewMode === "grouped" && groupedServers.length > 0 ? (
        <div className="space-y-6" data-testid="grouped-view">
          {groupedServers.map(([groupName, grpServers]) => (
            <div key={groupName}>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {groupName} ({grpServers.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grpServers.map(renderServerCard)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="server-grid"
        >
          {filteredServers.map(renderServerCard)}
        </div>
      )}

      {/* Dialogs */}
      <AddServerDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAdd={handleAddServer}
        availableGroups={groups}
      />
      <DeleteServerDialog
        open={!!deleteTarget}
        serverName={deleteTarget?.name ?? ""}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
      <BatchDeleteDialog
        open={showBatchDelete}
        count={selectedCount}
        isDeleting={isBatchDeleting}
        progress={batchDeleteProgress}
        onConfirm={handleBatchDeleteConfirm}
        onCancel={() => setShowBatchDelete(false)}
      />
    </div>
  );
}
