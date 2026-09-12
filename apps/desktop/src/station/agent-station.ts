import type { StationClient, StationState } from '../../../../packages/contracts/src/index.ts';
import type { NativeLauncher } from './native.ts';

export function createAgentStation(bridge?: NativeLauncher): StationClient {
  let state: StationState = { source: 'native', station_label: 'Not enrolled', connection: 'disconnected', snapshot: null,
    launch: { phase: 'idle' }, running_game_ids: [], station_use: null, help: 'idle' };
  const listeners = new Set<(state: StationState) => void>();
  const emit = () => { for (const listener of listeners) listener(state); };
  bridge?.onEvent(event => {
    if (event.type === 'state' && event.state.source === 'native') { state = event.state; emit(); }
    if (event.type === 'agent' && !event.connected) { state = { ...state, connection: 'disconnected' }; emit(); }
  });
  void bridge?.state().then(value => { state = value; emit(); }).catch(() => { /* visible unenrolled/disconnected state */ });
  return {
    catalog: () => bridge?.catalog().catch(() => []) ?? Promise.resolve([]),
    subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    async play(gameId) {
      if (!bridge) throw new Error('Station agent unavailable.');
      state = { ...state, launch: { phase: 'requesting', game_id: gameId } }; emit();
      const result = await bridge.launch(gameId);
      if (!result.ok) { state = { ...state, launch: { phase: 'failed', game_id: gameId, reason: result.reason } }; emit(); }
    },
    async requestHelp() { state = { ...state, help: 'failed' }; emit(); }, // Optional help remains unavailable; no false success.
  };
}
