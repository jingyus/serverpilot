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
  MAX_KEYS_PER_SKILL,
  MAX_TOTAL_SIZE_PER_SKILL,
  SkillStoreQuotaError,
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
// deleteAll — batch clear all keys for a skill
// ============================================================================

describe('InMemorySkillKVStore.deleteAll', () => {
  let store: InMemorySkillKVStore;

  beforeEach(() => {
    store = new InMemorySkillKVStore();
  });

  it('deletes all keys for a skill and returns the count', async () => {
    await store.set('skill-1', 'a', '1');
    await store.set('skill-1', 'b', '2');
    await store.set('skill-1', 'c', '3');

    const count = await store.deleteAll('skill-1');
    expect(count).toBe(3);

    const entries = await store.list('skill-1');
    expect(entries).toEqual({});
  });

  it('returns 0 for a skill with no stored keys', async () => {
    const count = await store.deleteAll('non-existent');
    expect(count).toBe(0);
  });

  it('does not affect other skills', async () => {
    await store.set('skill-a', 'x', '1');
    await store.set('skill-b', 'y', '2');

    await store.deleteAll('skill-a');

    expect(await store.get('skill-a', 'x')).toBeNull();
    expect(await store.get('skill-b', 'y')).toBe('2');
  });

  it('allows new keys after deleteAll', async () => {
    await store.set('skill-1', 'a', '1');
    await store.deleteAll('skill-1');

    await store.set('skill-1', 'b', '2');
    expect(await store.get('skill-1', 'b')).toBe('2');
  });

  it('frees quota after deleteAll', async () => {
    // Fill to key count limit
    for (let i = 0; i < MAX_KEYS_PER_SKILL; i++) {
      await store.set('skill-1', `key-${i}`, 'v');
    }
    // At limit — new key would fail
    await expect(store.set('skill-1', 'overflow', 'v')).rejects.toThrow(SkillStoreQuotaError);

    await store.deleteAll('skill-1');

    // Now a new key should succeed
    await expect(store.set('skill-1', 'fresh', 'v')).resolves.toBeUndefined();
  });
});

// ============================================================================
// Quota enforcement — key count limit
// ============================================================================

describe('Key count quota (MAX_KEYS_PER_SKILL)', () => {
  let store: InMemorySkillKVStore;

  beforeEach(() => {
    store = new InMemorySkillKVStore();
  });

  it('allows storing up to MAX_KEYS_PER_SKILL keys', async () => {
    for (let i = 0; i < MAX_KEYS_PER_SKILL; i++) {
      await store.set('skill-1', `key-${i}`, 'v');
    }
    const entries = await store.list('skill-1');
    expect(Object.keys(entries)).toHaveLength(MAX_KEYS_PER_SKILL);
  });

  it('rejects a new key when MAX_KEYS_PER_SKILL is reached', async () => {
    for (let i = 0; i < MAX_KEYS_PER_SKILL; i++) {
      await store.set('skill-1', `key-${i}`, 'v');
    }
    await expect(store.set('skill-1', 'one-too-many', 'v')).rejects.toThrow(
      SkillStoreQuotaError,
    );
    await expect(store.set('skill-1', 'one-too-many', 'v')).rejects.toThrow(
      /maximum of 1000 keys/,
    );
  });

  it('allows updating an existing key when at the limit', async () => {
    for (let i = 0; i < MAX_KEYS_PER_SKILL; i++) {
      await store.set('skill-1', `key-${i}`, 'old');
    }
    // Updating an existing key should succeed
    await expect(
      store.set('skill-1', 'key-0', 'updated'),
    ).resolves.toBeUndefined();
    expect(await store.get('skill-1', 'key-0')).toBe('updated');
  });

  it('quota is per-skill — different skills have independent limits', async () => {
    for (let i = 0; i < MAX_KEYS_PER_SKILL; i++) {
      await store.set('skill-a', `key-${i}`, 'v');
    }
    // skill-b should still accept new keys
    await expect(
      store.set('skill-b', 'key-0', 'v'),
    ).resolves.toBeUndefined();
  });

  it('allows new keys after deleting one at the limit', async () => {
    for (let i = 0; i < MAX_KEYS_PER_SKILL; i++) {
      await store.set('skill-1', `key-${i}`, 'v');
    }
    await store.delete('skill-1', 'key-0');
    await expect(
      store.set('skill-1', 'new-key', 'v'),
    ).resolves.toBeUndefined();
  });
});

// ============================================================================
// Quota enforcement — total size limit
// ============================================================================

describe('Total size quota (MAX_TOTAL_SIZE_PER_SKILL)', () => {
  let store: InMemorySkillKVStore;
  /** 1 MB chunk (just under per-value limit). */
  const CHUNK = 'x'.repeat(1_048_576);

  beforeEach(() => {
    store = new InMemorySkillKVStore();
  });

  it('rejects a new value that would exceed the total size limit', async () => {
    // Fill with 1 MB chunks until close to 50 MB
    const chunksNeeded = Math.floor(MAX_TOTAL_SIZE_PER_SKILL / CHUNK.length);
    for (let i = 0; i < chunksNeeded; i++) {
      await store.set('skill-1', `chunk-${i}`, CHUNK);
    }
    // One more 1 MB chunk should exceed the limit
    await expect(
      store.set('skill-1', 'overflow', CHUNK),
    ).rejects.toThrow(SkillStoreQuotaError);
    await expect(
      store.set('skill-1', 'overflow', CHUNK),
    ).rejects.toThrow(/total storage limit/);
  });

  it('allows updating an existing key without net size increase', async () => {
    const chunksNeeded = Math.floor(MAX_TOTAL_SIZE_PER_SKILL / CHUNK.length);
    for (let i = 0; i < chunksNeeded; i++) {
      await store.set('skill-1', `chunk-${i}`, CHUNK);
    }
    // Replace an existing chunk with same-size data — no net increase
    const replacement = 'z'.repeat(CHUNK.length);
    await expect(
      store.set('skill-1', 'chunk-0', replacement),
    ).resolves.toBeUndefined();
  });

  it('total size quota is per-skill', async () => {
    const chunksNeeded = Math.floor(MAX_TOTAL_SIZE_PER_SKILL / CHUNK.length);
    for (let i = 0; i < chunksNeeded; i++) {
      await store.set('skill-a', `chunk-${i}`, CHUNK);
    }
    // skill-b should still accept data
    await expect(
      store.set('skill-b', 'key', CHUNK),
    ).resolves.toBeUndefined();
  });

  it('SkillStoreQuotaError has correct name property', () => {
    const err = new SkillStoreQuotaError('test');
    expect(err.name).toBe('SkillStoreQuotaError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SkillStoreQuotaError);
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
