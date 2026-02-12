// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionStream } from './ExecutionStream';
import { useSkillsStore } from '@/stores/skills';
import type {
  SkillStepEvent,
  SkillLogEvent,
  SkillCompletedEvent,
  SkillErrorEvent,
  SkillExecutionEvent,
} from '@/types/skill';

// Suppress scrollTo in jsdom
Element.prototype.scrollTo = vi.fn();

const makeStepStart = (overrides: Partial<SkillStepEvent> = {}): SkillStepEvent => ({
  type: 'step',
  executionId: 'exec-1',
  timestamp: '2026-01-15T10:00:00Z',
  tool: 'shell',
  input: { command: 'df -h' },
  phase: 'start',
  ...overrides,
});

const makeStepComplete = (overrides: Partial<SkillStepEvent> = {}): SkillStepEvent => ({
  type: 'step',
  executionId: 'exec-1',
  timestamp: '2026-01-15T10:00:01Z',
  tool: 'shell',
  result: 'Filesystem  Size  Used\n/dev/sda1  50G  20G',
  success: true,
  duration: 1500,
  phase: 'complete',
  ...overrides,
});

const makeLog = (overrides: Partial<SkillLogEvent> = {}): SkillLogEvent => ({
  type: 'log',
  executionId: 'exec-1',
  timestamp: '2026-01-15T10:00:02Z',
  text: 'Checking disk usage...',
  ...overrides,
});

const makeCompleted = (overrides: Partial<SkillCompletedEvent> = {}): SkillCompletedEvent => ({
  type: 'completed',
  executionId: 'exec-1',
  timestamp: '2026-01-15T10:00:03Z',
  status: 'success',
  stepsExecuted: 2,
  duration: 3000,
  output: 'All done.',
  ...overrides,
});

const makeError = (overrides: Partial<SkillErrorEvent> = {}): SkillErrorEvent => ({
  type: 'error',
  executionId: 'exec-1',
  timestamp: '2026-01-15T10:00:04Z',
  message: 'Connection lost',
  ...overrides,
});

function setupStore(
  events: SkillExecutionEvent[] = [],
  isStreaming = false,
  overrides: Partial<ReturnType<typeof useSkillsStore.getState>> = {},
) {
  useSkillsStore.setState({
    executionEvents: events,
    isStreaming,
    startExecutionStream: vi.fn(),
    stopExecutionStream: vi.fn(),
    ...overrides,
  });
}

describe('ExecutionStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore([], true);
  });

  it('shows connecting message when streaming with no events', () => {
    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('Connecting to execution stream...')).toBeInTheDocument();
  });

  it('calls startExecutionStream on mount with executionId', () => {
    const startExecutionStream = vi.fn();
    setupStore([], true, { startExecutionStream });

    render(<ExecutionStream executionId="exec-42" />);
    expect(startExecutionStream).toHaveBeenCalledWith('exec-42');
  });

  it('calls stopExecutionStream on unmount', () => {
    const stopExecutionStream = vi.fn();
    setupStore([], true, { stopExecutionStream });

    const { unmount } = render(<ExecutionStream executionId="exec-1" />);
    unmount();
    expect(stopExecutionStream).toHaveBeenCalled();
  });

  it('renders step start event with tool name and command input', () => {
    setupStore([makeStepStart()], true);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('shell')).toBeInTheDocument();
    expect(screen.getByText('$ df -h')).toBeInTheDocument();
  });

  it('renders step complete event with result and duration', () => {
    setupStore([makeStepComplete()], true);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('shell')).toBeInTheDocument();
    expect(screen.getByText(/Filesystem/)).toBeInTheDocument();
    expect(screen.getByText('2s')).toBeInTheDocument(); // 1500ms → 2s
  });

  it('renders step input as JSON when no command field', () => {
    const step = makeStepStart({ tool: 'read_file', input: { path: '/etc/hosts' } });
    setupStore([step], true);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('read_file')).toBeInTheDocument();
    // JSON stringified
    expect(screen.getByText(/\/etc\/hosts/)).toBeInTheDocument();
  });

  it('renders log event text', () => {
    setupStore([makeLog()], true);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('Checking disk usage...')).toBeInTheDocument();
  });

  it('renders completed event with success status', () => {
    setupStore([makeCompleted()], false);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText(/2 steps/)).toBeInTheDocument();
    expect(screen.getByText(/3s/)).toBeInTheDocument();
  });

  it('renders completed event with failed status', () => {
    setupStore([makeCompleted({ status: 'failed' })], false);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('renders error event message', () => {
    setupStore([makeError()], false);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('Connection lost')).toBeInTheDocument();
  });

  it('shows Live badge when streaming', () => {
    setupStore([makeStepStart()], true);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('hides Live badge when not streaming', () => {
    setupStore([makeCompleted()], false);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('renders multiple events in sequence', () => {
    const events: SkillExecutionEvent[] = [
      makeStepStart(),
      makeStepComplete(),
      makeLog({ text: 'Analysis complete' }),
      makeCompleted(),
    ];
    setupStore(events, false);

    render(<ExecutionStream executionId="exec-1" />);

    expect(screen.getByText('Execution Progress')).toBeInTheDocument();
    expect(screen.getByText('Analysis complete')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
  });
});
