// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import {
  Bot,
  Loader2,
  AlertCircle,
  Server,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { PlanPreview } from '@/components/chat/PlanPreview';
import { MessageInput } from '@/components/chat/MessageInput';
import { ExecutionLog } from '@/components/chat/ExecutionLog';
import { StepConfirmBar } from '@/components/chat/StepConfirmBar';
import { AgenticConfirmBar } from '@/components/chat/AgenticConfirmBar';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { ServerSelector } from '@/components/chat/ServerSelector';
import { SessionSidebar } from '@/components/chat/SessionSidebar';
import { useChatStore, stripJsonPlan } from '@/stores/chat';
import { useServersStore } from '@/stores/servers';
import { useNotificationsStore } from '@/stores/notifications';

export function Chat() {
  const { t } = useTranslation();
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
    retryMessage,
    regenerateLastResponse,
    confirmPlan,
    rejectPlan,
    respondToStep,
    respondToAgenticConfirm,
    emergencyStop,
    fetchSessions,
    loadSession,
    deleteSession,
    renameSession,
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

  // Scroll to bottom when messages change (smooth for new messages)
  useEffect(() => {
    const el = messagesEndRef.current;
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Throttled auto-scroll during streaming content updates
  const lastScrollTime = useRef(0);
  useEffect(() => {
    if (!isStreaming || !streamingContent) return;
    const el = messagesEndRef.current;
    if (!el?.scrollIntoView) return;
    const now = Date.now();
    const elapsed = now - lastScrollTime.current;
    if (elapsed >= 100) {
      el.scrollIntoView({ behavior: 'auto' });
      lastScrollTime.current = now;
    } else {
      const timer = setTimeout(() => {
        el.scrollIntoView({ behavior: 'auto' });
        lastScrollTime.current = Date.now();
      }, 100 - elapsed);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, streamingContent]);

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

  const handleRetry = useCallback(
    (messageId: string) => {
      retryMessage(messageId);
    },
    [retryMessage]
  );

  // Determine the last user message ID that has no successful assistant reply after it
  const failedMessageId = useMemo(() => {
    if (!error || isStreaming) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') return null; // assistant replied — not failed
      if (msg.role === 'user') return msg.id;
    }
    return null;
  }, [error, isStreaming, messages]);

  // Find the last assistant message ID for the regenerate button
  const lastAssistantId = useMemo(() => {
    if (isStreaming) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [isStreaming, messages]);

  const handleRegenerate = useCallback(() => {
    regenerateLastResponse();
  }, [regenerateLastResponse]);

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
        onToggleSidebar={() => setMobileSidebarOpen((v) => !v)}
        hasSessions={sessions.length > 0}
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
        {/* Session sidebar — desktop always visible, mobile overlay */}
        <SessionSidebar
          sessions={sessions}
          activeSessionId={sessionId}
          serverId={serverId}
          onSelect={(sid) => {
            loadSession(serverId, sid);
            setMobileSidebarOpen(false);
          }}
          onDelete={(sid) => deleteSession(serverId, sid)}
          onRename={(sid, name) => renameSession(serverId, sid, name)}
          isLoading={isLoading}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />

        {/* Chat area */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border">
          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto"
            data-testid="message-list"
          >
            {messages.length === 0 && !isStreaming ? (
              <ChatEmptyState serverName={serverName} onSuggestionClick={handleSend} disabled={isStreaming} />
            ) : (
              <div className="space-y-1 py-4">
                {messages.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    failed={msg.id === failedMessageId}
                    onRetry={handleRetry}
                    isLastAssistant={msg.id === lastAssistantId}
                    onRegenerate={handleRegenerate}
                  />
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
