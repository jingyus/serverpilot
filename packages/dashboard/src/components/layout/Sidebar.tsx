// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Server,
  MessageCircle,
  ListChecks,
  History,
  Bell,
  Shield,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  X,
  BookOpen,
  Webhook,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/utils/constants';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/servers', labelKey: 'nav.servers', icon: Server },
  { to: '/chat', labelKey: 'nav.aiChat', icon: MessageCircle },
  { to: '/search', labelKey: 'nav.knowledge', icon: BookOpen },
  { to: '/tasks', labelKey: 'nav.tasks', icon: ListChecks },
  { to: '/operations', labelKey: 'nav.operations', icon: History },
  { to: '/alerts', labelKey: 'nav.alerts', icon: Bell },
  { to: '/audit-log', labelKey: 'nav.auditLog', icon: Shield },
  { to: '/webhooks', labelKey: 'nav.webhooks', icon: Webhook },
  { to: '/team', labelKey: 'nav.team', icon: Users },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

export function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const isMobile = useIsMobile();

  // On mobile, sidebar is always expanded (shown as overlay)
  const isCollapsed = isMobile ? false : collapsed;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'flex h-full flex-col border-r border-border bg-card transition-[width] duration-200',
        isCollapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-border px-4 sm:h-16">
        {!isCollapsed && (
          <h1 className="text-xl font-bold text-foreground">{APP_NAME}</h1>
        )}
        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label={t('header.closeSidebar')}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={isCollapsed ? t('header.expandSidebar') : t('header.collapseSidebar')}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors',
              isCollapsed ? 'mx-auto' : 'ml-auto',
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4" aria-label="Main navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={isCollapsed ? t(item.labelKey) : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                isCollapsed && 'justify-center px-2',
              )
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!isCollapsed && <span>{t(item.labelKey)}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="border-t border-border px-2 py-4">
        <button
          type="button"
          onClick={handleLogout}
          title={isCollapsed ? t('nav.logout') : undefined}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors',
            isCollapsed && 'justify-center px-2',
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!isCollapsed && <span>{t('nav.logout')}</span>}
        </button>
      </div>
    </aside>
  );
}
