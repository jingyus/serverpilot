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
import { MessageInput, type MessageInputHandle } from '@/components/chat/MessageInput';
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
import { exportChat, type ExportFormat } from '@/utils/chat-export';

export function Chat() {
  const { t } = useTranslation();
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const virtuosoRef = useRef<VirtuosoHandle>(null);

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

  // Global keyboard shortcuts
  const messageInputRef = useRef<MessageInputHandle>(null);
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // Escape: cancel streaming (works from anywhere on the page)
      if (e.key === 'Escape' && isStreaming) {
        e.preventDefault();
        cancelStream();
        return;
      }

      // Slash: focus input (only when not already in an editable element)
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
          return;
        }
        e.preventDefault();
        messageInputRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isStreaming, cancelStream]);

  // Virtuoso followOutput: auto-scroll when new messages arrive or streaming updates
  const followOutput = useCallback(
    (isAtBottom: boolean) => {
      if (isAtBottom || isStreaming) return 'smooth';
      return false;
    },
    [isStreaming]
  );

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
      if (msg.role === 'assistant') return null;
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

  const sessionName = sessions.find((s) => s.id === sessionId)?.name;

  const handleExport = useCallback(
    (format: ExportFormat) => {
      exportChat({
        messages,
        sessionName: sessionName ?? undefined,
        serverName,
        format,
      });
    },
    [messages, sessionName, serverName],
  );

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
        hasMessages={messages.length > 0}
        onExport={handleExport}
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
          <div className="flex-1 overflow-hidden" data-testid="message-list">
            {messages.length === 0 && !isStreaming ? (
              <ChatEmptyState serverName={serverName} onSuggestionClick={handleSend} disabled={isStreaming} />
            ) : (
              <Virtuoso
                ref={virtuosoRef}
                data={messages}
                initialTopMostItemIndex={Math.max(0, messages.length - 1)}
                followOutput={followOutput}
                itemContent={(_index, msg) => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    failed={msg.id === failedMessageId}
                    onRetry={handleRetry}
                    isLastAssistant={msg.id === lastAssistantId}
                    onRegenerate={handleRegenerate}
                  />
                )}
                components={{
                  Footer: () => (
                    <MessageListFooter
                      isStreaming={isStreaming}
                      streamingContent={streamingContent}
                      isAgenticMode={isAgenticMode}
                      executionMode={executionMode}
                      currentPlan={currentPlan}
                      planStatus={planStatus}
                      execution={execution}
                      pendingConfirm={pendingConfirm}
                      agenticConfirm={agenticConfirm}
                      confirmPlan={confirmPlan}
                      rejectPlan={rejectPlan}
                      emergencyStop={emergencyStop}
                      respondToStep={respondToStep}
                      respondToAgenticConfirm={respondToAgenticConfirm}
                      t={t}
                    />
                  ),
                }}
                className="h-full"
              />
            )}
          </div>

          {/* Input */}
          <MessageInput
            ref={messageInputRef}
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

/** Footer rendered below the virtualized message list */
function MessageListFooter({
  isStreaming,
  streamingContent,
  isAgenticMode,
  executionMode,
  currentPlan,
  planStatus,
  execution,
  pendingConfirm,
  agenticConfirm,
  confirmPlan,
  rejectPlan,
  emergencyStop,
  respondToStep,
  respondToAgenticConfirm,
  t,
}: {
  isStreaming: boolean;
  streamingContent: string;
  isAgenticMode: boolean;
  executionMode: string;
  currentPlan: ReturnType<typeof useChatStore.getState>['currentPlan'];
  planStatus: string;
  execution: ReturnType<typeof useChatStore.getState>['execution'];
  pendingConfirm: ReturnType<typeof useChatStore.getState>['pendingConfirm'];
  agenticConfirm: ReturnType<typeof useChatStore.getState>['agenticConfirm'];
  confirmPlan: () => void;
  rejectPlan: () => void;
  emergencyStop: () => void;
  respondToStep: (action: string) => void;
  respondToAgenticConfirm: (approved: boolean) => void;
  t: (key: string) => string;
}) {
  return (
    <>
      {isStreaming && streamingContent && (() => {
        const displayText = stripJsonPlan(streamingContent);
        if (!displayText) return null;

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

      {currentPlan && planStatus === 'preview' && (
        <PlanPreview
          plan={currentPlan}
          onConfirm={confirmPlan}
          onReject={rejectPlan}
          isExecuting={false}
        />
      )}

      {currentPlan &&
        executionMode === 'log' &&
        (planStatus === 'executing' || planStatus === 'completed') && (
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

      {pendingConfirm && executionMode === 'log' && planStatus === 'executing' && (
        <StepConfirmBar
          step={pendingConfirm}
          onAllow={() => respondToStep('allow')}
          onAllowAll={() => respondToStep('allow_all')}
          onReject={() => respondToStep('reject')}
        />
      )}

      {agenticConfirm && (
        <AgenticConfirmBar
          confirm={agenticConfirm}
          onApprove={() => respondToAgenticConfirm(true)}
          onReject={() => respondToAgenticConfirm(false)}
        />
      )}
    </>
  );
}
