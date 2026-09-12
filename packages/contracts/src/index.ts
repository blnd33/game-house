import type { components, paths } from './generated.js';
export type { components, paths } from './generated.js';
export type Schema<Name extends keyof components['schemas']> = components['schemas'][Name];

// Device transport boundary: implementations must runtime-validate both directions.
// Monetary calculations, staff authorization, and cashier stop have no device method.
export interface StationApi {
  enroll(input: Schema<'EnrollRequest'>, idempotencyKey: string): Promise<Schema<'EnrollResponse'>>;
  renew(input: Schema<'RenewRequest'>, idempotencyKey: string): Promise<Schema<'RenewResponse'>>;
  revokeOwnCredential(input: Schema<'RevokeRequest'>, idempotencyKey: string): Promise<Schema<'RevokeResponse'>>;
  getConfiguration(stationId: string, requestId: string): Promise<Schema<'ConfigResponse'>>;
  getSnapshot(stationId: string, requestId: string): Promise<Schema<'SnapshotResponse'>>;
  getSession(stationId: string, sessionId: string, requestId: string): Promise<Schema<'SnapshotResponse'>>;
  heartbeat(input: Schema<'HeartbeatRequest'>, idempotencyKey: string): Promise<Schema<'SnapshotResponse'>>;
  requestLaunch(input: Schema<'LaunchRequest'>, idempotencyKey: string): Promise<Schema<'LaunchResponse'>>;
  cancelAttempt(input: Schema<'CancelLaunchRequest'>, idempotencyKey: string): Promise<Schema<'SnapshotResponse'>>;
  submitEvents(input: Schema<'EventsRequest'>, idempotencyKey: string): Promise<Schema<'EventsResponse'>>;
  pollCommands(stationId: string, requestId: string, cursor?: string): Promise<Schema<'CommandsResponse'>>;
  acknowledgeCommand(input: Schema<'CommandResultRequest'>, idempotencyKey: string): Promise<Schema<'CommandResultResponse'>>;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'stale';

// Agent-side boundaries (Phase 3+).
export interface CatalogProvider { installedAndEnabled(): Promise<readonly Schema<'GameProfile'>[]> }
export interface GameLauncher {
  // An agent-issued, expiring permit is mandatory; the renderer only supplies game ID.
  launch(permit: Schema<'LaunchAttempt'>): Promise<void>;
}
export interface StationUseObservation {
  sessionId: string;
  bootId: string;
  segmentId: string;
  observedSeconds: number;
  coverage: 'continuous' | 'recovered_unverified';
}

// Renderer boundary (Phase 2). Everything the player UI may see and do. The
// development sample implements it now; the preload/agent bridge replaces it in
// Phase 3. The renderer never receives credentials, executable paths, launch
// arguments or pricing policy, and it never sends anything but a game ID.
export type LibraryGame = Pick<Schema<'GameProfile'>,
  'game_id' | 'title' | 'artwork_asset' | 'category' | 'controller' | 'multiplayer'>;
export type LaunchFailureReason = Schema<'LaunchFailedEvent'>['reason'];
export type LaunchStatus =
  | { readonly phase: 'idle' }
  | { readonly phase: 'requesting' | 'starting'; readonly game_id: string }
  | { readonly phase: 'failed'; readonly game_id: string; readonly reason: LaunchFailureReason };
export type HelpStatus = 'idle' | 'sending' | 'requested' | 'failed';
export interface StationUseReading {
  /** Locally observed cumulative station use for the current session, at emit time. */
  readonly observed_seconds: number;
  readonly coverage: 'continuous' | 'recovered_unverified';
}
export interface StationState {
  readonly backend_mode?: 'development' | 'partner';
  readonly source: 'sample' | 'native';
  readonly station_label: string;
  readonly connection: ConnectionState;
  /** Latest authoritative backend snapshot; null before first contact. */
  readonly snapshot: Schema<'SnapshotResponse'> | null;
  readonly launch: LaunchStatus;
  /** Locally observed game processes. Telemetry only; never session authority. */
  readonly running_game_ids: readonly string[];
  readonly station_use: StationUseReading | null;
  readonly help: HelpStatus;
}
export interface StationClient {
  catalog(): Promise<readonly LibraryGame[]>;
  subscribe(listener: (state: StationState) => void): () => void;
  play(gameId: string): Promise<void>;
  requestHelp(): Promise<void>;
}
