// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { User, Shield, LogOut, ChevronDown } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown";

export function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const trigger = (
    <div className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent transition-colors">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium"
        aria-label="User avatar"
      >
        {(user?.name ?? user?.email ?? "U").charAt(0).toUpperCase()}
      </div>
      <span className="hidden text-sm font-medium text-foreground sm:inline">
        {user?.name ?? user?.email ?? "User"}
      </span>
      <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:inline" />
    </div>
  );

  return (
    <DropdownMenu trigger={trigger} align="right">
      <div className="px-3 py-2">
        <p className="text-sm font-medium text-foreground">
          {user?.name ?? user?.email ?? "User"}
        </p>
        {user?.email && user.name && (
          <p className="text-xs text-muted-foreground">{user.email}</p>
        )}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => navigate("/settings?tab=profile")}
        testId="user-menu-profile"
      >
        <User className="h-4 w-4" />
        {t("userMenu.profile")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => navigate("/settings?tab=security")}
        testId="user-menu-security"
      >
        <Shield className="h-4 w-4" />
        {t("userMenu.security")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={handleLogout}
        variant="destructive"
        testId="user-menu-logout"
      >
        <LogOut className="h-4 w-4" />
        {t("nav.logout")}
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
