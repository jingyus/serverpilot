// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useRef } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { useIsMobile } from '@/hooks/useMediaQuery';

export function MainLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const mobileSidebarOpen = useUiStore((s) => s.mobileSidebarOpen);
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const prevPathname = useRef(pathname);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Close mobile sidebar on route change (not initial mount)
  useEffect(() => {
    if (prevPathname.current !== pathname && isMobile) {
      setMobileSidebarOpen(false);
    }
    prevPathname.current = pathname;
  }, [pathname, isMobile, setMobileSidebarOpen]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {isMobile && mobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileSidebarOpen(false)}
            data-testid="mobile-sidebar-overlay"
          />
          <div className="fixed inset-y-0 left-0 z-50 w-64" data-testid="mobile-sidebar">
            <Sidebar />
          </div>
        </>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
