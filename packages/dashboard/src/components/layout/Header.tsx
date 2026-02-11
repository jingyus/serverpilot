// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Bell } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { useAlertsStore } from '@/stores/alerts';
import { ConnectionStatus } from '@/components/common/ConnectionStatus';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/servers': 'Servers',
  '/chat': 'AI Chat',
  '/tasks': 'Tasks',
  '/operations': 'Operations',
  '/alerts': 'Alerts',
  '/settings': 'Settings',
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith('/servers/')) return 'Server Detail';
  if (pathname.startsWith('/chat/')) return 'AI Chat';
  return 'ServerPilot';
}

export function Header() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const toggleMobileSidebar = useUiStore((s) => s.toggleMobileSidebar);
  const unresolvedCount = useAlertsStore((s) => s.unresolvedCount);
  const fetchUnresolvedCount = useAlertsStore((s) => s.fetchUnresolvedCount);
  const title = getPageTitle(pathname);

  useEffect(() => {
    fetchUnresolvedCount();
    const interval = setInterval(fetchUnresolvedCount, 60_000);
    return () => clearInterval(interval);
  }, [fetchUnresolvedCount]);

  return (
    <header
      data-testid="header"
      className="flex h-14 items-center justify-between border-b border-border bg-card px-3 sm:h-16 sm:px-6"
    >
      <div className="flex items-center gap-2 sm:gap-4">
        <button
          type="button"
          onClick={toggleMobileSidebar}
          aria-label="Toggle sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h2 className="text-base font-semibold text-foreground sm:text-lg">{title}</h2>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <ConnectionStatus />

        <button
          type="button"
          aria-label="Notifications"
          onClick={() => navigate('/alerts')}
          className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          data-testid="alert-badge-btn"
        >
          <Bell className="h-5 w-5" />
          {unresolvedCount > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
              data-testid="alert-count-badge"
            >
              {unresolvedCount > 99 ? '99+' : unresolvedCount}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium"
            aria-label="User avatar"
          >
            {(user?.name ?? user?.email ?? 'U').charAt(0).toUpperCase()}
          </div>
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {user?.name ?? user?.email ?? 'User'}
          </span>
        </div>
      </div>
    </header>
  );
}
