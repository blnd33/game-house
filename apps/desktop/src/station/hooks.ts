import { useEffect, useState } from 'react';
import type { LibraryGame, StationClient, StationState } from '../../../../packages/contracts/src/index.ts';
import { EMPTY_STAMPS, nextStamps, type Stamps } from './display.ts';

export function useStation(client: StationClient): { state: StationState | null; stamps: Stamps } {
  const [view, setView] = useState<{ state: StationState | null; stamps: Stamps }>({ state: null, stamps: EMPTY_STAMPS });
  useEffect(() => client.subscribe(state =>
    setView(prev => ({ state, stamps: nextStamps(prev.stamps, state, performance.now()) }))), [client]);
  return view;
}

export function useCatalog(client: StationClient): readonly LibraryGame[] | null {
  const [games, setGames] = useState<readonly LibraryGame[] | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => client.catalog().then(list => { if (active) setGames(list); }, () => { if (active) setGames([]); });
    void refresh();
    let connected = false;
    const unsubscribe = client.subscribe(state => {
      const next = state.connection === 'connected';
      if (next && !connected) void refresh();
      connected = next;
    });
    return () => { active = false; unsubscribe(); };
  }, [client]);
  return games;
}

/**
 * Monotonic time for counting displays. Repaints twice a second only while
 * `enabled` and the window is visible, so an idle or backgrounded launcher
 * (for example, behind a running game) does no timer work.
 */
export function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
    const start = () => { stop(); setNow(performance.now()); timer = setInterval(() => setNow(performance.now()), 500); };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [enabled]);
  return enabled ? now : performance.now();
}
