// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useRef } from 'react';
import { CheckCircle, XCircle, Loader2, Terminal, MessageSquare, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useSkillsStore } from '@/stores/skills';
import type { SkillExecutionEvent, SkillStepEvent, SkillLogEvent, SkillCompletedEvent } from '@/types/skill';

// ============================================================================
// ExecutionStream Component
// ============================================================================

export function ExecutionStream({ executionId }: { executionId: string }) {
  const { executionEvents, isStreaming, startExecutionStream, stopExecutionStream } = useSkillsStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startExecutionStream(executionId);
    return () => stopExecutionStream();
  }, [executionId, startExecutionStream, stopExecutionStream]);

  // Auto-scroll to bottom as events arrive
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [executionEvents.length]);

  if (executionEvents.length === 0 && isStreaming) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Connecting to execution stream...
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">Execution Progress</span>
        {isStreaming && (
          <Badge variant="secondary" className="text-xs">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Live
          </Badge>
        )}
      </div>
      <div ref={scrollRef} className="max-h-96 overflow-y-auto p-2 space-y-1">
        {executionEvents.map((event, i) => (
          <EventRow key={i} event={event} />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Event Row
// ============================================================================

function EventRow({ event }: { event: SkillExecutionEvent }) {
  switch (event.type) {
    case 'step':
      return <StepRow event={event} />;
    case 'log':
      return <LogRow event={event} />;
    case 'completed':
      return <CompletedRow event={event} />;
    case 'error':
      return (
        <div className="flex items-center gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          {event.message}
        </div>
      );
  }
}

function StepRow({ event }: { event: SkillStepEvent }) {
  const isStart = event.phase === 'start';

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-xs">
      {isStart ? (
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : event.success ? (
        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono font-medium">{event.tool}</span>
          {!isStart && event.duration !== undefined && (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatMs(event.duration)}
            </span>
          )}
        </div>
        {isStart && event.input && (
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
            {formatInput(event.input)}
          </pre>
        )}
        {!isStart && event.result && (
          <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
            {truncate(event.result, 500)}
          </pre>
        )}
      </div>
    </div>
  );
}

function LogRow({ event }: { event: SkillLogEvent }) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-xs">
      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
      <p className="whitespace-pre-wrap text-muted-foreground">{event.text}</p>
    </div>
  );
}

function CompletedRow({ event }: { event: SkillCompletedEvent }) {
  const isSuccess = event.status === 'success';

  return (
    <div className={`flex items-center gap-2 rounded-sm px-3 py-2 text-xs ${
      isSuccess ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive'
    }`}>
      {isSuccess ? (
        <CheckCircle className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <XCircle className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="font-medium capitalize">{event.status}</span>
      <span className="text-muted-foreground">
        {event.stepsExecuted} steps in {formatMs(event.duration)}
      </span>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatInput(input: Record<string, unknown>): string {
  if ('command' in input && typeof input.command === 'string') {
    return `$ ${input.command}`;
  }
  return JSON.stringify(input, null, 2);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...(truncated)';
}
