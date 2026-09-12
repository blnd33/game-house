// Turns station state into what the player sees. Pure and clock-injected: it
// reads only server timestamps plus monotonic elapsed time, never the Windows
// wall clock, and it never calculates billing. Billable Time is the backend's
// confirmed duration, extrapolated for display only while it is fresh.
import type { ConnectionState, LaunchFailureReason, Schema, StationState } from '../../../../packages/contracts/src/index.ts';

export type SessionPhase = 'connecting' | 'waiting' | 'authorized' | 'grace' | 'active' | 'ended';

export type Billable =
  | { readonly kind: 'none' }
  | { readonly kind: 'not_started' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'counting' | 'stale' | 'final'; readonly seconds: number };

export interface SessionDisplay {
  readonly phase: SessionPhase;
  readonly connection: ConnectionState;
  /** Current pending/active/ended session; cancelled sessions are not shown. */
  readonly session: Schema<'Session'> | null;
  readonly restriction: Schema<'Restriction'>['state'];
  /** Local observation, labeled Station Time. Not a billing value. */
  readonly stationSeconds: number | null;
  readonly billable: Billable;
  /** Seconds to the backend-supplied grace deadline; null unless pending. */
  readonly graceRemainingSeconds: number | null;
  /** Backend-formatted amount, passed through untouched. */
  readonly amount: Schema<'Amount'> | null;
  readonly canPlay: boolean;
  /** Why Play is unavailable, in player language. */
  readonly playHint: string | null;
}

/** Monotonic (performance.now) receipt times of the current snapshot and use reading. */
export interface Stamps {
  readonly snapshotKey: string;
  readonly snapshotAtMs: number;
  readonly useKey: string;
  readonly useAtMs: number;
}

export const EMPTY_STAMPS: Stamps = { snapshotKey: '', snapshotAtMs: 0, useKey: '', useAtMs: 0 };

/** Restamp only when content changes, so re-delivering the same state cannot move time. */
export function nextStamps(prev: Stamps, state: StationState, nowMs: number): Stamps {
  const snap = state.snapshot;
  const snapshotKey = snap ? `${snap.request_id}|${snap.server_time}|${snap.snapshot.revision}` : '';
  const use = state.station_use;
  const useKey = use ? `${snap?.snapshot.session?.session_id ?? ''}|${use.observed_seconds}|${use.coverage}` : '';
  return {
    snapshotKey, snapshotAtMs: snapshotKey === prev.snapshotKey ? prev.snapshotAtMs : nowMs,
    useKey, useAtMs: useKey === prev.useKey ? prev.useAtMs : nowMs,
  };
}

export function isLive(state: StationState | null): boolean {
  const s = state?.snapshot?.snapshot.session?.state;
  return s === 'pending' || s === 'active';
}

const toMs = (iso: string | null) => (iso === null ? Number.NaN : Date.parse(iso));

export function deriveDisplay(state: StationState, stamps: Stamps, nowMs: number): SessionDisplay {
  const { connection, launch } = state;
  const connected = connection === 'connected';
  const response = state.snapshot;
  if (!response) {
    return {
      phase: connection === 'connecting' ? 'connecting' : 'waiting', connection, session: null, restriction: 'unknown',
      stationSeconds: null, billable: { kind: 'none' }, graceRemainingSeconds: null, amount: null, canPlay: false,
      playHint: connection === 'connecting' ? 'Connecting to Padel House…' : 'Not connected to Padel House',
    };
  }

  const snap = response.snapshot;
  const serverTime = Date.parse(response.server_time);
  const serverNow = serverTime + Math.max(0, nowMs - stamps.snapshotAtMs);
  const session = snap.session && snap.session.state !== 'cancelled' ? snap.session : null;
  const live = session?.state === 'pending' || session?.state === 'active';
  const restriction = snap.restriction.state;
  const locked = session?.state === 'ended' || restriction === 'pending' || restriction === 'restricted' || restriction === 'failed';
  const leaseEnd = toMs(snap.authorized_play_until);
  const withinLease = !Number.isNaN(leaseEnd) && serverNow <= leaseEnd;

  let stationSeconds: number | null = null;
  if (state.station_use) {
    const extra = live && !locked ? Math.max(0, nowMs - stamps.useAtMs) / 1000 : 0;
    stationSeconds = Math.floor(state.station_use.observed_seconds + extra);
  }

  let billable: Billable = { kind: 'none' };
  if (session) {
    const base = session.billable_seconds_at_server_time;
    if (session.state === 'pending') billable = { kind: 'not_started' };
    else if (base === null) billable = { kind: 'unknown' };
    else if (session.state === 'ended') billable = { kind: 'final', seconds: base };
    else {
      const until = Number.isNaN(leaseEnd) ? serverNow : Math.min(serverNow, leaseEnd);
      const seconds = Math.floor(base + Math.max(0, until - serverTime) / 1000);
      billable = { kind: connected && withinLease ? 'counting' : 'stale', seconds };
    }
  }

  const graceRemainingSeconds = session?.state === 'pending'
    ? Math.max(0, Math.ceil((Date.parse(session.grace_deadline_at) - serverNow) / 1000)) : null;

  const authorization = snap.authorization;
  const authorizationOpen = !!authorization && serverNow < Date.parse(authorization.expires_at);
  const pendingOpen = session?.state === 'pending' && serverNow < Date.parse(session.pending_expires_at);
  const entitled = session ? (session.state === 'active' && withinLease) || pendingOpen : authorizationOpen;
  const busy = launch.phase === 'requesting' || launch.phase === 'starting';

  let phase: SessionPhase;
  if (locked) phase = 'ended';
  else if (session?.state === 'active') phase = 'active';
  else if (session?.state === 'pending') phase = 'grace';
  else if (authorizationOpen) phase = 'authorized';
  else phase = 'waiting';

  let playHint: string | null = null;
  if (locked) playHint = 'Session ended — please see the cashier';
  else if (connection === 'connecting') playHint = 'Connecting to Padel House…';
  else if (!connected) playHint = 'Reconnecting to Padel House…';
  else if (busy) playHint = 'Starting a game…';
  else if (!entitled) playHint = session || authorization
    ? 'Your session needs attention — please see the cashier'
    : 'Ask the cashier to start your session';

  return {
    phase, connection, session, restriction, stationSeconds, billable, graceRemainingSeconds,
    amount: session?.display_amount ?? null,
    canPlay: connected && restriction === 'unrestricted' && !locked && !busy && entitled,
    playHint,
  };
}

export const LAUNCH_FAILURE_TEXT: Readonly<Record<LaunchFailureReason, string>> = {
  timeout: 'The game took too long to open.',
  not_installed: 'This game is not available on this PC right now.',
  login_required: 'The game needs a sign-in before it can start. Please ask staff for help.',
  process_unreliable: 'We could not confirm that the game started. Staff can check it for you.',
  start_failed: 'The game could not start.',
  communication_lost: 'The connection to Padel House dropped while starting.',
};
