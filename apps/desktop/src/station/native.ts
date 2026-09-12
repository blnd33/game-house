import type { LaunchFailureReason, LibraryGame, StationState } from '../../../../packages/contracts/src/index.ts';

// Real launching exposed by the preload bridge (Phase 3). The renderer sends only a
// game ID; the agent resolves, validates and confirms everything else.
export type NativeLaunchResult =
  | { readonly ok: true; readonly attempt_id: string }
  | { readonly ok: false; readonly reason: LaunchFailureReason; readonly message: string };

export type NativeEvent =
  | { readonly type: 'state'; readonly state: StationState }
  | {
    readonly type: 'attempt'; readonly attempt_id: string; readonly game_id: string;
    readonly state: 'starting' | 'running' | 'failed' | 'cancelled';
    readonly reason: LaunchFailureReason | null; readonly diagnostic: string | null;
  }
  | { readonly type: 'running'; readonly game_ids: readonly string[] }
  | { readonly type: 'game_exited'; readonly game_id: string }
  | { readonly type: 'agent'; readonly connected: boolean };

export interface NativeLauncher {
  state(): Promise<StationState>;
  catalog(): Promise<readonly LibraryGame[]>;
  launch(gameId: string): Promise<NativeLaunchResult>;
  onEvent(listener: (event: NativeEvent) => void): () => void;
  /** Admin panel messages, forwarded to the agent which checks the staff password. */
  admin(message: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Windows file picker for choosing a game program. */
  pickGameFile(): Promise<string | null>;
}
