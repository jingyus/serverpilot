// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillEventBus — pub/sub for skill execution progress events.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSkillEventBus,
  _resetSkillEventBus,
} from './skill-event-bus.js';
import type {
  SkillEvent,
  SkillStepEvent,
  SkillLogEvent,
  SkillCompletedEvent,
  SkillErrorEvent,
} from './skill-event-bus.js';

beforeEach(() => {
  _resetSkillEventBus();
});

// ============================================================================
// Singleton
// ============================================================================

describe('singleton', () => {
  it('should return the same instance on multiple calls', () => {
    const bus1 = getSkillEventBus();
    const bus2 = getSkillEventBus();
    expect(bus1).toBe(bus2);
  });

  it('should return a new instance after reset', () => {
    const bus1 = getSkillEventBus();
    _resetSkillEventBus();
    const bus2 = getSkillEventBus();
    expect(bus1).not.toBe(bus2);
  });
});

// ============================================================================
// Publish / Subscribe
// ============================================================================

describe('publish / subscribe', () => {
  it('should deliver events to subscribers of the same executionId', () => {
    const bus = getSkillEventBus();
    const received: SkillEvent[] = [];

    bus.subscribe('exec-1', (event) => received.push(event));

    const event: SkillStepEvent = {
      type: 'step',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      tool: 'shell',
      input: { command: 'ls' },
      phase: 'start',
    };
    bus.publish('exec-1', event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  it('should NOT deliver events to subscribers of different executionId', () => {
    const bus = getSkillEventBus();
    const received: SkillEvent[] = [];

    bus.subscribe('exec-2', (event) => received.push(event));

    bus.publish('exec-1', {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      text: 'hello',
    });

    expect(received).toHaveLength(0);
  });

  it('should deliver all event types correctly', () => {
    const bus = getSkillEventBus();
    const received: SkillEvent[] = [];
    bus.subscribe('exec-1', (event) => received.push(event));

    const stepEvent: SkillStepEvent = {
      type: 'step',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      tool: 'shell',
      phase: 'complete',
      result: 'ok',
      success: true,
      duration: 100,
    };
    const logEvent: SkillLogEvent = {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:01.000Z',
      text: 'Checking system...',
    };
    const completedEvent: SkillCompletedEvent = {
      type: 'completed',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:02.000Z',
      status: 'success',
      stepsExecuted: 3,
      duration: 5000,
      output: 'Done',
    };
    const errorEvent: SkillErrorEvent = {
      type: 'error',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:03.000Z',
      message: 'Something went wrong',
    };

    bus.publish('exec-1', stepEvent);
    bus.publish('exec-1', logEvent);
    bus.publish('exec-1', completedEvent);
    bus.publish('exec-1', errorEvent);

    expect(received).toHaveLength(4);
    expect(received[0].type).toBe('step');
    expect(received[1].type).toBe('log');
    expect(received[2].type).toBe('completed');
    expect(received[3].type).toBe('error');
  });

  it('should support multiple subscribers for the same executionId', () => {
    const bus = getSkillEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.subscribe('exec-1', listener1);
    bus.subscribe('exec-1', listener2);

    bus.publish('exec-1', {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      text: 'test',
    });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Unsubscribe
// ============================================================================

describe('unsubscribe', () => {
  it('should stop receiving events after unsubscribe', () => {
    const bus = getSkillEventBus();
    const received: SkillEvent[] = [];

    const unsub = bus.subscribe('exec-1', (event) => received.push(event));

    bus.publish('exec-1', {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      text: 'before',
    });
    expect(received).toHaveLength(1);

    unsub();

    bus.publish('exec-1', {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:01.000Z',
      text: 'after',
    });
    expect(received).toHaveLength(1);
  });

  it('should only unsubscribe the specific listener', () => {
    const bus = getSkillEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsub1 = bus.subscribe('exec-1', listener1);
    bus.subscribe('exec-1', listener2);

    unsub1();

    bus.publish('exec-1', {
      type: 'log',
      executionId: 'exec-1',
      timestamp: '2026-02-13T00:00:00.000Z',
      text: 'test',
    });

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Listener Count
// ============================================================================

describe('listenerCount', () => {
  it('should track active listeners', () => {
    const bus = getSkillEventBus();

    expect(bus.listenerCount('exec-1')).toBe(0);

    const unsub1 = bus.subscribe('exec-1', vi.fn());
    expect(bus.listenerCount('exec-1')).toBe(1);

    const unsub2 = bus.subscribe('exec-1', vi.fn());
    expect(bus.listenerCount('exec-1')).toBe(2);

    unsub1();
    expect(bus.listenerCount('exec-1')).toBe(1);

    unsub2();
    expect(bus.listenerCount('exec-1')).toBe(0);
  });

  it('should not count listeners for different executionIds', () => {
    const bus = getSkillEventBus();

    bus.subscribe('exec-1', vi.fn());
    bus.subscribe('exec-2', vi.fn());

    expect(bus.listenerCount('exec-1')).toBe(1);
    expect(bus.listenerCount('exec-2')).toBe(1);
  });
});

// ============================================================================
// removeAll
// ============================================================================

describe('removeAll', () => {
  it('should remove all listeners for all executions', () => {
    const bus = getSkillEventBus();

    bus.subscribe('exec-1', vi.fn());
    bus.subscribe('exec-2', vi.fn());

    bus.removeAll();

    expect(bus.listenerCount('exec-1')).toBe(0);
    expect(bus.listenerCount('exec-2')).toBe(0);
  });
});
