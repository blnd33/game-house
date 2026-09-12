// Station-level library conveniences. Losing them is harmless, so every storage
// failure degrades to in-memory behavior instead of breaking the library.
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECENT_LIMIT = 12;
const FAVORITES_KEY = 'gaming-house.favorites.v1';
const RECENT_KEY = 'gaming-house.recent.v1';
const GAME_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function readIds(storage: PreferenceStorage | null, key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value): value is string => typeof value === 'string' && GAME_ID.test(value)))];
  } catch {
    return [];
  }
}

function writeIds(storage: PreferenceStorage | null, key: string, ids: readonly string[]): void {
  try {
    storage?.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage unavailable or full: keep the in-memory value only.
  }
}

export function browserStorage(): PreferenceStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const loadFavorites = (storage: PreferenceStorage | null) => new Set(readIds(storage, FAVORITES_KEY));
export const saveFavorites = (storage: PreferenceStorage | null, favorites: ReadonlySet<string>) =>
  writeIds(storage, FAVORITES_KEY, [...favorites]);
export const loadRecent = (storage: PreferenceStorage | null) => readIds(storage, RECENT_KEY).slice(0, RECENT_LIMIT);
export const saveRecent = (storage: PreferenceStorage | null, recent: readonly string[]) =>
  writeIds(storage, RECENT_KEY, recent);

export function toggled(favorites: ReadonlySet<string>, gameId: string): Set<string> {
  const next = new Set(favorites);
  if (next.has(gameId)) next.delete(gameId);
  else next.add(gameId);
  return next;
}

export function withPlayed(recent: readonly string[], gameId: string): string[] {
  return [gameId, ...recent.filter(id => id !== gameId)].slice(0, RECENT_LIMIT);
}
