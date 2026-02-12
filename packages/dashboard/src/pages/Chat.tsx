// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Bot,
  Loader2,
  AlertCircle,
  MessageSquarePlus,
  Server,
  Trash2,
  ChevronDown,
  ChevronRight,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { PlanPreview } from '@/components/chat/PlanPreview';
import { MessageInput } from '@/components/chat/MessageInput';
import { ExecutionLog } from '@/components/chat/ExecutionLog';
import { StepConfirmBar } from '@/components/chat/StepConfirmBar';
import { AgenticConfirmBar } from '@/components/chat/AgenticConfirmBar';
import { useChatStore, stripJsonPlan } from '@/stores/chat';
import { useServersStore } from '@/stores/servers';
import { useNotificationsStore } from '@/stores/notifications';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';

export function Chat() {
  const { t } = useTranslation();
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    sessions,
    isLoading,
    isStreaming,
    streamingContent,
    error,
    currentPlan,
    planStatus,
    execution,
    executionMode,
    sessionId,
    pendingConfirm,
    isReconnecting,
    agenticConfirm,
    isAgenticMode,
    setServerId,
    sendMessage,
    confirmPlan,
    rejectPlan,
    respondToStep,
    respondToAgenticConfirm,
    emergencyStop,
    fetchSessions,
    loadSession,
    deleteSession,
    newSession,
    cancelStream,
    cleanup,
    clearError,
  } = useChatStore();

  const { servers, fetchServers } = useServersStore();

  useEffect(() => {
    if (servers.length === 0) {
      fetchServers();
    }
  }, [servers.length, fetchServers]);

  useEffect(() => {
    if (serverId) {
      setServerId(serverId);
      fetchSessions(serverId);
    } else {
      setServerId(null);
    }
  }, [serverId, setServerId, fetchSessions]);

  // Abort active SSE connection when unmounting to prevent leaked connections
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
  }, []);

  // Throttled instant scroll for streaming — avoids animation pile-up
  const throttledStreamScroll = useMemo(() => {
    let lastCall = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const THROTTLE_MS = 100;

    const fn = (scrollFn: (behavior: ScrollBehavior) => void) => {
      const now = Date.now();
      if (now - lastCall >= THROTTLE_MS) {
        lastCall = now;
        scrollFn('auto');
      } else if (!pending) {
        pending = setTimeout(() => {
          pending = null;
          lastCall = Date.now();
          scrollFn('auto');
        }, THROTTLE_MS - (now - lastCall));
      }
    };
    fn.cancel = () => {
      if (pending) {
        clearTimeout(pending);
        pending = null;
      }
    };
    return fn;
  }, []);

  // Smooth scroll on new messages
  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages.length, scrollToBottom]);

  // Throttled instant scroll during streaming
  useEffect(() => {
    if (streamingContent) {
      throttledStreamScroll(scrollToBottom);
    }
    return () => throttledStreamScroll.cancel();
  }, [streamingContent, scrollToBottom, throttledStreamScroll]);

  const prevPlanStatus = useRef(planStatus);
  useEffect(() => {
    const prev = prevPlanStatus.current;
    prevPlanStatus.current = planStatus;
    if (prev === 'executing' && planStatus === 'completed') {
      const notify = useNotificationsStore.getState().add;
      if (execution.success) {
        notify({ type: 'success', title: t('chat.executionCompleted') });
      } else {
        notify({ type: 'error', title: t('chat.executionFailed') });
      }
    }
  }, [planStatus, execution.success, t]);

  const handleSend = useCallback(
    (message: string) => {
      sendMessage(message);
    },
    [sendMessage]
  );

  if (!serverId) {
    return <ServerSelector servers={servers} navigate={navigate} />;
  }

  const serverName =
    servers.find((s) => s.id === serverId)?.name ?? serverId;

  return (
    <div
      className="flex h-[calc(100vh-3.5rem)] flex-col sm:h-[calc(100vh-4rem)]"
      data-testid="chat-page"
    >
      {/* Header */}
      <ChatHeader
        serverName={serverName}
        sessionId={sessionId}
        onNewSession={newSession}
      />

      {/* Error */}
      {error && (
        <div className="mx-2 mt-2 sm:mx-4" role="alert">
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive sm:p-3">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-xs sm:text-sm">{error}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearError}
              data-testid="dismiss-error"
            >
              {t('common.dismiss')}
            </Button>
          </div>
        </div>
      )}

      {/* Reconnecting banner */}
      {isReconnecting && (
        <div className="mx-2 mt-2 sm:mx-4" data-testid="reconnecting-banner">
          <div className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-50 p-2 text-sm text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400 sm:p-3">
            <WifiOff className="h-4 w-4 shrink-0" />
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span className="text-xs sm:text-sm">{t('chat.reconnecting')}</span>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 gap-2 overflow-hidden p-2 sm:gap-4 sm:p-4">
        {/* Session sidebar */}
        <SessionSidebar
          sessions={sessions}
          activeSessionId={sessionId}
          serverId={serverId}
          onSelect={(sid) => loadSession(serverId, sid)}
          onDelete={(sid) => deleteSession(serverId, sid)}
          isLoading={isLoading}
        />

        {/* Chat area */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border">
          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto"
            data-testid="message-list"
          >
            {messages.length === 0 && !isStreaming ? (
              <EmptyState serverName={serverName} onSuggestionClick={handleSend} disabled={isStreaming} />
            ) : (
              <div className="space-y-1 py-4">
                {messages.map((msg) => (
                  <ChatMessage key={msg.id} message={msg} />
                ))}

                {/* Streaming indicator */}
                {isStreaming && streamingContent && (() => {
                  const displayText = stripJsonPlan(streamingContent);
                  if (!displayText) return null;

                  // Agentic mode: AI thinking + tool call output (interleaved)
                  if (isAgenticMode) {
                    return (
                      <div className="flex gap-2 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3" data-testid="streaming-message">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
                          <Bot className="h-4 w-4" />
                        </div>
                        <div className="max-w-[90%] rounded-2xl bg-muted px-3 py-2 text-sm sm:max-w-[85%] sm:px-4 sm:py-2.5">
                          <MarkdownRenderer content={displayText} />
                          <Loader2 className="mt-1 h-3 w-3 animate-spin text-muted-foreground" />
                        </div>
                      </div>
                    );
                  }

                  // Inline execution mode: terminal-style output
                  if (executionMode === 'inline') {
                    return (
                      <div className="flex gap-2 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3" data-testid="streaming-message">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-800 text-green-400 dark:bg-gray-900">
                          <Server className="h-4 w-4" />
                        </div>
                        <div className="max-w-[90%] rounded-lg bg-gray-900 px-3 py-2 text-sm sm:max-w-[85%] sm:px-4 sm:py-3">
                          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-green-400 sm:text-sm">{displayText}</pre>
                          <Loader2 className="mt-1 h-3 w-3 animate-spin text-green-600" />
                        </div>
                      </div>
                    );
                  }

                  // Normal chat streaming
                  return (
                    <div className="flex gap-2 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3" data-testid="streaming-message">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="max-w-[85%] rounded-2xl bg-muted px-3 py-2 text-sm sm:max-w-[75%] sm:px-4 sm:py-2.5">
                        <MarkdownRenderer content={displayText} />
                        <Loader2 className="mt-1 h-3 w-3 animate-spin text-muted-foreground" />
                      </div>
                    </div>
                  );
                })()}

                {isStreaming && !streamingContent && (
                  <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground" data-testid="thinking-indicator">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('chat.aiThinking')}
                  </div>
                )}

                {/* Plan Preview */}
                {currentPlan && planStatus === 'preview' && (
                  <PlanPreview
                    plan={currentPlan}
                    onConfirm={confirmPlan}
                    onReject={rejectPlan}
                    isExecuting={false}
                  />
                )}

                {/* Execution Log — only shown in 'log' mode (non-GREEN commands) */}
                {currentPlan &&
                  executionMode === 'log' &&
                  (planStatus === 'executing' ||
                    planStatus === 'completed') && (
                    <ExecutionLog
                      plan={currentPlan}
                      activeStepId={execution.activeStepId}
                      outputs={execution.outputs}
                      completedSteps={execution.completedSteps}
                      success={execution.success}
                      onEmergencyStop={emergencyStop}
                      isExecuting={planStatus === 'executing'}
                      startTime={execution.startTime}
                      cancelled={execution.cancelled}
                    />
                  )}

                {/* Step Confirmation Bar — only shown in 'log' mode */}
                {pendingConfirm && executionMode === 'log' && planStatus === 'executing' && (
                  <StepConfirmBar
                    step={pendingConfirm}
                    onAllow={() => respondToStep('allow')}
                    onAllowAll={() => respondToStep('allow_all')}
                    onReject={() => respondToStep('reject')}
                  />
                )}

                {/* Agentic mode confirmation for risky commands */}
                {agenticConfirm && (
                  <AgenticConfirmBar
                    confirm={agenticConfirm}
                    onApprove={() => respondToAgenticConfirm(true)}
                    onReject={() => respondToAgenticConfirm(false)}
                  />
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <MessageInput
            onSend={handleSend}
            onCancel={cancelStream}
            isStreaming={isStreaming}
            disabled={planStatus === 'executing'}
          />
        </div>
      </div>
    </div>
  );
}

function ChatHeader({
  serverName,
  sessionId,
  onNewSession,
}: {
  serverName: string;
  sessionId: string | null;
  onNewSession: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center justify-between border-b px-2 py-2 sm:px-4 sm:py-3"
      data-testid="chat-header"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:h-9 sm:w-9">
          <Bot className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold sm:text-lg">{t('chat.title')}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {t('chat.server', { name: serverName })}
            {sessionId && (
              <span className="ml-2">
                {t('chat.session', { id: `${sessionId.slice(0, 8)}...` })}
              </span>
            )}
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onNewSession}
        data-testid="new-session-btn"
        className="shrink-0"
      >
        <MessageSquarePlus className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">{t('chat.newChat')}</span>
      </Button>
    </div>
  );
}

function EmptyState({
  serverName,
  onSuggestionClick,
  disabled,
}: {
  serverName: string;
  onSuggestionClick: (text: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();

  const suggestions = [
    t('chat.suggestion1'),
    t('chat.suggestion2'),
    t('chat.suggestion3'),
    t('chat.suggestion4'),
  ];

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 p-4 sm:gap-4 sm:p-8"
      data-testid="empty-state"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:h-16 sm:w-16">
        <Bot className="h-6 w-6 sm:h-8 sm:w-8" />
      </div>
      <div className="text-center">
        <h2 className="text-base font-semibold sm:text-lg">{t('chat.startConversation')}</h2>
        <p className="mt-1 max-w-md text-xs text-muted-foreground sm:text-sm">
          {t('chat.startConversationDesc', { name: serverName })}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((suggestion, index) => (
          <Card
            key={suggestion}
            className={cn(
              'transition-colors',
              disabled
                ? 'pointer-events-none opacity-50'
                : 'cursor-pointer hover:bg-muted/50'
            )}
            onClick={() => onSuggestionClick(suggestion)}
            data-testid={`suggestion-card-${index}`}
          >
            <CardContent className="px-2 py-1.5 text-xs text-muted-foreground sm:px-3 sm:py-2 sm:text-sm">
              {suggestion}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ServerSelector({
  servers,
  navigate,
}: {
  servers: Array<{ id: string; name: string; status: string }>;
  navigate: (path: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="server-selector">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">{t('nav.aiChat')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chat.selectServer')}
        </p>
      </div>

      {servers.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t('chat.noServers')}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <Card
              key={server.id}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => navigate(`/chat/${server.id}`)}
              data-testid={`server-card-${server.id}`}
            >
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">{server.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {server.status}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function getSessionDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= weekAgo) return 'thisWeek';
  return 'older';
}

function SessionSidebar({
  sessions,
  activeSessionId,
  serverId,
  onSelect,
  onDelete,
  isLoading,
}: {
  sessions: Array<{
    id: string;
    createdAt: string;
    lastMessage?: string;
    messageCount: number;
  }>;
  activeSessionId: string | null;
  serverId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  if (sessions.length === 0 && !isLoading) return null;

  // Group sessions by date
  const grouped: Record<string, typeof sessions> = {};
  for (const session of sessions) {
    const group = getSessionDateGroup(session.createdAt);
    (grouped[group] ??= []).push(session);
  }
  const groupOrder = ['today', 'yesterday', 'thisWeek', 'older'];
  const sortedGroups = groupOrder.filter((g) => grouped[g]?.length);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <div
      className="hidden w-56 shrink-0 overflow-y-auto rounded-lg border lg:block"
      data-testid="session-sidebar"
    >
      <div className="border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {t('chat.sessions')}
        </h3>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="p-1">
          {sortedGroups.map((group) => (
            <div key={group} data-testid={`session-group-${group}`}>
              <button
                type="button"
                className="flex w-full items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground hover:text-foreground"
                onClick={() => toggleGroup(group)}
                data-testid={`session-group-toggle-${group}`}
              >
                {collapsedGroups[group] ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {t(`chat.sessionGroup.${group}`)}
              </button>
              {!collapsedGroups[group] && (
                <div className="space-y-0.5">
                  {grouped[group].map((session) => (
                    <div
                      key={session.id}
                      className={cn(
                        'group flex items-center justify-between rounded-md px-2 py-1.5 text-sm',
                        'cursor-pointer hover:bg-muted',
                        session.id === activeSessionId && 'bg-muted'
                      )}
                      onClick={() => onSelect(session.id)}
                      data-testid={`session-item-${session.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {session.lastMessage ?? t('chat.newSession')}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatDate(session.createdAt)} &middot;{' '}
                          {session.messageCount} msgs
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ml-1 hidden shrink-0 rounded p-0.5 hover:bg-destructive/10 group-hover:block"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(session.id);
                        }}
                        aria-label="Delete session"
                        data-testid={`delete-session-${session.id}`}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
