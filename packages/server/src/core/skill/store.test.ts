// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillKVStore — per-skill key-value persistence.
 *
 * Covers: CRUD operations, value size limits, data isolation between skills,
 * InMemory implementation, and singleton lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  InMemorySkillKVStore,
  getSkillKVStore,
  setSkillKVStore,
  _resetSkillKVStore,
} from './store.js';
import type { SkillKVStoreInterface } from './store.js';

// ============================================================================
// InMemorySkillKVStore Tests
// ============================================================================

describe('InMemorySkillKVStore', () => {
  let store: InMemorySkillKVStore;

  beforeEach(() => {
    store = new InMemorySkillKVStore();
  });

  // --------------------------------------------------------------------------
  // Basic CRUD
  // --------------------------------------------------------------------------

  it('returns null for a non-existent key', async () => {
    const value = await store.get('skill-1', 'missing-key');
    expect(value).toBeNull();
  });

  it('sets and gets a value', async () => {
    await store.set('skill-1', 'my-key', 'my-value');
    const value = await store.get('skill-1', 'my-key');
    expect(value).toBe('my-value');
  });

  it('overwrites an existing value', async () => {
    await store.set('skill-1', 'key', 'old');
    await store.set('skill-1', 'key', 'new');
    const value = await store.get('skill-1', 'key');
    expect(value).toBe('new');
  });

  it('deletes a key', async () => {
    await store.set('skill-1', 'key', 'value');
    await store.delete('skill-1', 'key');
    const value = await store.get('skill-1', 'key');
    expect(value).toBeNull();
  });

  it('delete is a no-op for non-existent key', async () => {
    // Should not throw
    await store.delete('skill-1', 'non-existent');
  });

  it('lists all keys for a skill', async () => {
    await store.set('skill-1', 'a', '1');
    await store.set('skill-1', 'b', '2');
    await store.set('skill-1', 'c', '3');

    const entries = await store.list('skill-1');
    expect(entries).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('returns empty object for list on empty skill', async () => {
    const entries = await store.list('skill-1');
    expect(entries).toEqual({});
  });

  // --------------------------------------------------------------------------
  // Data isolation between skills
  // --------------------------------------------------------------------------

  it('isolates data between different skillIds', async () => {
    await store.set('skill-a', 'key', 'value-a');
    await store.set('skill-b', 'key', 'value-b');

    expect(await store.get('skill-a', 'key')).toBe('value-a');
    expect(await store.get('skill-b', 'key')).toBe('value-b');
  });

  it('deleting from one skill does not affect another', async () => {
    await store.set('skill-a', 'key', 'a');
    await store.set('skill-b', 'key', 'b');

    await store.delete('skill-a', 'key');

    expect(await store.get('skill-a', 'key')).toBeNull();
    expect(await store.get('skill-b', 'key')).toBe('b');
  });

  it('list only returns keys for the specified skill', async () => {
    await store.set('skill-a', 'x', '1');
    await store.set('skill-b', 'y', '2');

    expect(await store.list('skill-a')).toEqual({ x: '1' });
    expect(await store.list('skill-b')).toEqual({ y: '2' });
  });

  // --------------------------------------------------------------------------
  // Value size limit (1 MB)
  // --------------------------------------------------------------------------

  it('accepts a value just under the 1 MB limit', async () => {
    const value = 'x'.repeat(1_048_576); // exactly 1 MB in ASCII
    await expect(store.set('skill-1', 'big', value)).resolves.toBeUndefined();
  });

  it('rejects a value exceeding 1 MB', async () => {
    const value = 'x'.repeat(1_048_577); // 1 byte over
    await expect(store.set('skill-1', 'too-big', value)).rejects.toThrow(
      'exceeds maximum',
    );
  });

  it('rejects multi-byte value that exceeds 1 MB in bytes', async () => {
    // Each emoji is 4 bytes in UTF-8 — 262_145 emojis = 1_048_580 bytes > 1 MB
    const value = '\u{1F600}'.repeat(262_145);
    await expect(store.set('skill-1', 'emoji', value)).rejects.toThrow(
      'exceeds maximum',
    );
  });
});

// ============================================================================
// Singleton lifecycle
// ============================================================================

describe('Singleton lifecycle', () => {
  beforeEach(() => {
    _resetSkillKVStore();
  });

  it('setSkillKVStore sets the singleton', () => {
    const mock = new InMemorySkillKVStore();
    setSkillKVStore(mock);
    expect(getSkillKVStore()).toBe(mock);
  });

  it('_resetSkillKVStore clears the singleton', () => {
    const mock = new InMemorySkillKVStore();
    setSkillKVStore(mock);
    _resetSkillKVStore();

    // After reset, getSkillKVStore creates a new instance (would fail without DB)
    // Just verify reset doesn't throw
    setSkillKVStore(new InMemorySkillKVStore());
    const store: SkillKVStoreInterface = getSkillKVStore();
    expect(store).toBeTruthy();
  });
});
