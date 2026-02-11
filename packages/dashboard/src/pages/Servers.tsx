// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server,
  Plus,
  Search,
  MessageCircle,
  Trash2,
  AlertCircle,
  Loader2,
  Monitor,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AddServerDialog, DeleteServerDialog } from '@/components/server';
import { useServersStore } from '@/stores/servers';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';
import type { Server as ServerType } from '@/types/server';

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive'; dot: string }
> = {
  online: { label: 'Online', variant: 'default', dot: 'bg-green-500' },
  offline: { label: 'Offline', variant: 'secondary', dot: 'bg-gray-400' },
  error: { label: 'Error', variant: 'destructive', dot: 'bg-red-500' },
};

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'error', label: 'Error' },
];

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return (
    <Badge variant={config.variant} className="gap-1.5">
      <span className={cn('h-2 w-2 rounded-full', config.dot)} />
      {config.label}
    </Badge>
  );
}

function ServerCard({
  server,
  onChat,
  onDelete,
  onDetail,
}: {
  server: ServerType;
  onChat: (id: string) => void;
  onDelete: (id: string) => void;
  onDetail: (id: string) => void;
}) {
  return (
    <Card
      data-testid={`server-card-${server.id}`}
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => onDetail(server.id)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Monitor className="h-5 w-5" />
            </div>
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
          {server.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {server.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
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
              Chat
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
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Servers() {
  const navigate = useNavigate();
  const {
    servers,
    isLoading,
    error,
    statusFilter,
    searchQuery,
    fetchServers,
    addServer,
    deleteServer,
    setStatusFilter,
    setSearchQuery,
    clearError,
  } = useServersStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServerType | null>(null);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const filteredServers = useMemo(() => {
    return servers.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [servers, statusFilter, searchQuery]);

  const stats = useMemo(() => {
    const counts = { total: servers.length, online: 0, offline: 0, error: 0 };
    for (const s of servers) {
      if (s.status === 'online') counts.online++;
      else if (s.status === 'offline') counts.offline++;
      else if (s.status === 'error') counts.error++;
    }
    return counts;
  }, [servers]);

  function handleChat(id: string) {
    navigate(`/chat/${id}`);
  }

  function handleDetail(id: string) {
    navigate(`/servers/${id}`);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    try {
      await deleteServer(deleteTarget.id);
    } catch {
      // error handled by store
    }
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Servers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your servers and view their status.
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          Add Server
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-4" data-testid="server-stats">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xl font-bold sm:text-2xl">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total Servers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xl font-bold text-green-600 sm:text-2xl">{stats.online}</div>
            <p className="text-xs text-muted-foreground">Online</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xl font-bold text-gray-500 sm:text-2xl">{stats.offline}</div>
            <p className="text-xs text-muted-foreground">Offline</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xl font-bold text-red-600 sm:text-2xl">{stats.error}</div>
            <p className="text-xs text-muted-foreground">Error</p>
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
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search servers..."
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
              variant={statusFilter === f.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(f.value)}
              aria-pressed={statusFilter === f.value}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Server list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredServers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="empty-state">
          <Server className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {servers.length === 0 ? 'No servers yet' : 'No servers match'}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {servers.length === 0
              ? 'Add your first server to get started.'
              : 'Try adjusting your search or filter.'}
          </p>
          {servers.length === 0 && (
            <Button className="mt-4" onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Server
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="server-grid">
          {filteredServers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onChat={handleChat}
              onDelete={(id) => {
                const s = servers.find((sv) => sv.id === id);
                if (s) setDeleteTarget(s);
              }}
              onDetail={handleDetail}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <AddServerDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAdd={addServer}
      />
      <DeleteServerDialog
        open={!!deleteTarget}
        serverName={deleteTarget?.name ?? ''}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
