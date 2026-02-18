// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot, MessageSquarePlus, Menu, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExportFormat } from "@/utils/chat-export";

export interface ChatHeaderProps {
  serverName: string;
  sessionId: string | null;
  onNewSession: () => void;
  onToggleSidebar?: () => void;
  hasSessions?: boolean;
  hasMessages?: boolean;
  onExport?: (format: ExportFormat) => void;
  /** 当前对话实际使用的 AI 提供商与模型（与设置页可能不一致，以此为准） */
  currentAI?: { provider: string | null; model?: string } | null;
}

export function ChatHeader({
  serverName,
  sessionId,
  onNewSession,
  onToggleSidebar,
  hasSessions,
  hasMessages,
  onExport,
  currentAI,
}: ChatHeaderProps) {
  const { t } = useTranslation();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExportMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  return (
    <div
      className="flex items-center justify-between border-b px-2 py-2 sm:px-4 sm:py-3"
      data-testid="chat-header"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        {hasSessions && onToggleSidebar && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSidebar}
            className="lg:hidden"
            data-testid="mobile-sidebar-toggle"
            aria-label={t("chat.toggleSessions")}
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:h-9 sm:w-9">
          <Bot className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold sm:text-lg">
            {t("chat.title")}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {t("chat.server", { name: serverName })}
            {sessionId && (
              <span className="ml-2">
                {t("chat.session", { id: `${sessionId.slice(0, 8)}...` })}
              </span>
            )}
          </p>
          {currentAI !== undefined && (
            <p
              className="mt-0.5 truncate text-xs text-muted-foreground"
              data-testid="chat-current-ai"
            >
              {currentAI?.provider
                ? [currentAI.provider, currentAI.model]
                    .filter(Boolean)
                    .join(" · ") + ` ${t("chat.currentlyUsed")}`
                : t("chat.noAIConfigured")}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {hasMessages && onExport && (
          <div className="relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowExportMenu((v) => !v)}
              data-testid="export-chat-btn"
              aria-label={t("chat.export")}
              className="shrink-0"
            >
              <Download className="h-4 w-4" />
            </Button>
            {showExportMenu && (
              <div
                className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
                data-testid="export-menu"
              >
                <button
                  className="flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent"
                  onClick={() => {
                    onExport("markdown");
                    setShowExportMenu(false);
                  }}
                  data-testid="export-markdown-btn"
                >
                  {t("chat.exportMarkdown")}
                </button>
                <button
                  className="flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent"
                  onClick={() => {
                    onExport("json");
                    setShowExportMenu(false);
                  }}
                  data-testid="export-json-btn"
                >
                  {t("chat.exportJson")}
                </button>
              </div>
            )}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onNewSession}
          data-testid="new-session-btn"
          className="shrink-0"
        >
          <MessageSquarePlus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{t("chat.newChat")}</span>
        </Button>
      </div>
    </div>
  );
}
