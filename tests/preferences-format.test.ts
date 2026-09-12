import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBusinessTime, formatCountdown, formatDuration } from '../apps/desktop/src/station/format.ts';
import {
  loadFavorites, loadRecent, RECENT_LIMIT, saveFavorites, toggled, withPlayed, type PreferenceStorage,
} from '../apps/desktop/src/station/preferences.ts';

function memory(initial: Record<string, string> = {}): PreferenceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
}

test('durations and countdowns format for the session card', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(3661.9), '01:01:01');
  assert.equal(formatDuration(25 * 3600), '25:00:00');
  assert.equal(formatDuration(-5), '00:00:00');
  assert.equal(formatCountdown(12.2), '0:13');
  assert.equal(formatCountdown(75), '1:15');
});

test('clock times display in Asia/Baghdad', () => {
  assert.equal(formatBusinessTime('2026-09-11T12:00:00Z'), '3:00 PM');
  assert.equal(formatBusinessTime('2026-01-15T21:30:00Z'), '12:30 AM');
  assert.equal(formatBusinessTime('not a time'), '—');
});

test('favorites toggle and survive a save/load round trip', () => {
  const storage = memory();
  const favorites = toggled(toggled(new Set(), 'tekken-8'), 'dota-2');
  saveFavorites(storage, toggled(favorites, 'dota-2'));
  assert.deepEqual([...loadFavorites(storage)], ['tekken-8']);
});

test('recently played is deduplicated, most recent first, and capped', () => {
  let recent: string[] = [];
  for (let i = 0; i < RECENT_LIMIT + 3; i++) recent = withPlayed(recent, `game-${i}`);
  recent = withPlayed(recent, 'game-5');
  assert.equal(recent.length, RECENT_LIMIT);
  assert.equal(recent[0], 'game-5');
  assert.equal(new Set(recent).size, recent.length);
});

test('corrupt or hostile stored data is ignored', () => {
  const storage = memory({
    'gaming-house.favorites.v1': JSON.stringify(['ok-game', '../../etc', 42, 'ok-game']),
    'gaming-house.recent.v1': '{not json',
  });
  assert.deepEqual([...loadFavorites(storage)], ['ok-game']);
  assert.deepEqual(loadRecent(storage), []);
});

test('unavailable storage never breaks the library', () => {
  const broken: PreferenceStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual([...loadFavorites(broken)], []);
  assert.doesNotThrow(() => saveFavorites(broken, new Set(['a'])));
  assert.deepEqual([...loadFavorites(null)], []);
});
