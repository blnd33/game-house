// DEVELOPMENT SAMPLE: a fake cashier and backend for building the player UI.
// It is not the Phase 4 simulator and must never ship in a production station
// build. Its pending→active rule mirrors docs/session-rules.md only so the UI can
// be exercised. Real paid start, billing and pricing stay backend-owned, and the
// only amount it can attach is a fixed fictional display string. Given a native
// launcher (Phase 3), launches and running games are real; the session is not.
import type {
  ConnectionState, HelpStatus, LaunchFailureReason, LaunchStatus, LibraryGame, Schema, StationClient, StationState,
} from '../../../../packages/contracts/src/index.ts';
import type { NativeEvent, NativeLauncher } from '../station/native.ts';
import { SAMPLE_CATALOG } from './sample-catalog.ts';

export const SAMPLE_GRACE_OPTIONS = [0, 5, 10, 20, 30] as const;
export const SAMPLE_LAUNCH_OUTCOMES = ['succeeds', 'timeout', 'not_installed', 'login_required',
  'process_unreliable', 'start_failed'] as const;

export interface SampleSettings {
  /** Sample backend grace policy, snapshotted into the next session only. */
  readonly graceSeconds: number;
  readonly nextLaunch: 'succeeds' | LaunchFailureReason;
  readonly lockOutcome: 'verified' | 'failed';
  /** Attach the fictional display amount to active/ended sessions. */
  readonly supplyAmount: boolean;
}

export interface SampleControls {
  settings(): SampleSettings;
  update(patch: Partial<SampleSettings>): void;
  /** Cashier authorizes a customer (also the only way to reuse a station after an ended session). */
  authorize(): void;
  /** Cashier ends billing. The only way a session ends. */
  endSession(): void;
  /** The running game exits. Telemetry only: the session continues. */
  closeGame(): void;
  setConnection(connection: ConnectionState): void;
  dispose(): void;
}

export interface SampleClock {
  wallMs(): number;
  monoMs(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const SAMPLE_TIMING = {
  connectMs: 700, permitMs: 600, startMs: 2400, lockMs: 1500, helpMs: 800, helpResetMs: 15_000,
  heartbeatMs: 15_000, leaseMs: 60_000, authorizationMs: 10 * 60_000, pendingMs: 2 * 60_000,
};

const STATION_ID = '10000000-0000-4000-8000-000000000001';
const FICTIONAL_AMOUNT = { currency: 'IQD', decimal_amount: '1000', display_text: '1,000 IQD' };

const systemClock: SampleClock = {
  wallMs: () => Date.now(),
  monoMs: () => performance.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

const iso = (ms: number) => new Date(ms).toISOString();
const uuid = () => globalThis.crypto.randomUUID();

export function createSampleStation(options: {
  clock?: SampleClock; timing?: Partial<typeof SAMPLE_TIMING>; stationLabel?: string;
  catalog?: readonly LibraryGame[]; launcher?: Pick<NativeLauncher, 'launch' | 'onEvent'>;
} = {}): { client: StationClient; controls: SampleControls } {
  const clock = options.clock ?? systemClock;
  const t = { ...SAMPLE_TIMING, ...options.timing };
  const label = options.stationLabel ?? 'PC-01';
  const catalog = options.catalog ?? SAMPLE_CATALOG;
  const launcher = options.launcher ?? null;
  const listeners = new Set<(state: StationState) => void>();
  const timers = new Set<unknown>();
  let attemptId: string | null = null;
  const earlyEvents = new Map<string, NativeEvent>(); // attempt results that arrive before the launch reply

  let settings: SampleSettings = { graceSeconds: 20, nextLaunch: 'succeeds', lockOutcome: 'verified', supplyAmount: false };
  let connection: ConnectionState = 'connecting';
  let revision = 0;
  let epoch = 0;
  let tickets = 0;
  let authorization: Schema<'Authorization'> | null = null;
  let session: Schema<'Session'> | null = null;
  let restriction: Schema<'Restriction'> = { state: 'unrestricted', command_id: null, verified_at: iso(clock.wallMs()), failure_code: null };
  let reassignable = true;
  let launch: LaunchStatus = { phase: 'idle' };
  let running: string[] = [];
  let useStartMono: number | null = null;
  let useFrozen: number | null = null;
  let help: HelpStatus = 'idle';
  let snapshot: Schema<'SnapshotResponse'> | null = null;
  let current: StationState | null = null;
  let activation: unknown = null;
  let heartbeat: unknown = null;
  let launchToken = 0;
  let helpToken = 0;

  const after = (ms: number, callback: () => void) => {
    const handle = clock.setTimeout(() => { timers.delete(handle); callback(); }, ms);
    timers.add(handle);
    return handle;
  };
  const cancel = (handle: unknown) => {
    if (handle === null) return;
    clock.clearTimeout(handle);
    timers.delete(handle);
  };
  const live = () => session?.state === 'pending' || session?.state === 'active';

  function sessionAt(now: number): Schema<'Session'> | null {
    if (session?.state !== 'active' || session.billable_start_at === null) return session;
    return {
      ...session,
      billable_seconds_at_server_time: Math.max(0, Math.floor((now - Date.parse(session.billable_start_at)) / 1000)),
      display_amount: settings.supplyAmount ? { ...FICTIONAL_AMOUNT, is_final: false } : null,
    };
  }

  /** Fake backend response. Revision moves only when station state changes. */
  function issue(changed: boolean) {
    const now = clock.wallMs();
    if (changed || revision === 0) revision += 1;
    snapshot = {
      api_version: '1', request_id: uuid(), station_id: STATION_ID, server_time: iso(now),
      snapshot: {
        revision, station_epoch: epoch, authorization, session: sessionAt(now), restriction,
        authorized_play_until: live() ? iso(now + t.leaseMs) : null, reassignable,
      },
    };
  }

  function reading(): StationState['station_use'] {
    if (useStartMono === null) return null;
    const seconds = useFrozen ?? Math.floor((clock.monoMs() - useStartMono) / 1000);
    return { observed_seconds: Math.max(0, seconds), coverage: 'continuous' };
  }

  function emit() {
    current = {
      source: 'sample', station_label: label, connection, snapshot, launch,
      running_game_ids: [...running], station_use: reading(), help,
    };
    for (const listener of listeners) listener(current);
  }

  function scheduleHeartbeat() {
    cancel(heartbeat);
    heartbeat = after(t.heartbeatMs, () => {
      if (connection === 'connected' && live()) { issue(false); emit(); }
      scheduleHeartbeat();
    });
  }

  // Sample backend: activate at the grace deadline if a game is confirmed running,
  // or as soon as one is confirmed after the deadline. Never while evidence is stale.
  function scheduleActivation() {
    cancel(activation);
    activation = null;
    if (session?.state !== 'pending' || running.length === 0) return;
    const wait = Math.max(0, Date.parse(session.grace_deadline_at) - clock.wallMs());
    activation = after(wait, () => {
      activation = null;
      if (session?.state !== 'pending' || running.length === 0 || connection !== 'connected') return;
      session = { ...session, state: 'active', revision: session.revision + 1, billable_start_at: iso(clock.wallMs()), billable_seconds_at_server_time: 0 };
      issue(true);
      emit();
    });
  }

  function applyAttempt(event: Extract<NativeEvent, { type: 'attempt' }>) {
    if (event.state === 'running') launch = { phase: 'idle' };
    else if (event.state === 'failed') launch = { phase: 'failed', game_id: event.game_id, reason: event.reason ?? 'start_failed' };
    else return;
    attemptId = null;
    emit();
  }

  // Real launch: the agent confirms the game from process evidence.
  function launchNatively(native: Pick<NativeLauncher, 'launch'>, gameId: string, token: number) {
    native.launch(gameId).then(result => {
      if (token !== launchToken) return;
      if (!result.ok) {
        launch = { phase: 'failed', game_id: gameId, reason: result.reason };
        emit();
        return;
      }
      attemptId = result.attempt_id;
      const early = earlyEvents.get(result.attempt_id);
      earlyEvents.clear();
      if (early?.type === 'attempt') applyAttempt(early);
    }, () => {
      if (token !== launchToken) return;
      launch = { phase: 'failed', game_id: gameId, reason: 'communication_lost' };
      emit();
    });
  }

  const stopNativeEvents = launcher?.onEvent(event => {
    if (event.type === 'attempt') {
      if (event.attempt_id === attemptId) applyAttempt(event);
      else if (event.state === 'running' || event.state === 'failed') earlyEvents.set(event.attempt_id, event);
    } else if (event.type === 'running') {
      running = [...event.game_ids];
      scheduleActivation();
      emit();
    }
  });

  const client: StationClient = {
    catalog: async () => catalog,
    subscribe(listener) {
      listeners.add(listener);
      if (current) listener(current);
      return () => { listeners.delete(listener); };
    },
    async play(gameId) {
      if (!catalog.some(game => game.game_id === gameId)) throw new Error('GAME_NOT_ALLOWED');
      if (launch.phase === 'requesting' || launch.phase === 'starting') return; // same logical request
      if (connection !== 'connected') {
        launch = { phase: 'failed', game_id: gameId, reason: 'communication_lost' };
        emit();
        return;
      }
      const now = clock.wallMs();
      const entitled = session
        ? session.state === 'active' || (session.state === 'pending' && now < Date.parse(session.pending_expires_at))
        : !!authorization && now < Date.parse(authorization.expires_at);
      if (!entitled) throw new Error('AUTHORIZATION_REQUIRED');

      const token = ++launchToken;
      launch = { phase: 'requesting', game_id: gameId };
      emit();
      after(t.permitMs, () => {
        if (token !== launchToken) return;
        if (!session) {
          if (!authorization) { launch = { phase: 'idle' }; emit(); return; }
          const first = clock.wallMs();
          session = {
            session_id: uuid(), authorization_id: authorization.authorization_id, station_epoch: epoch, revision: 1,
            state: 'pending', policy_version: `sample-grace-${settings.graceSeconds}s`,
            accepted_first_play_at: iso(first), grace_deadline_at: iso(first + settings.graceSeconds * 1000),
            pending_expires_at: iso(first + t.pendingMs), billable_start_at: null, ended_at: null,
            billable_seconds_at_server_time: null, display_amount: null,
          };
          useStartMono = clock.monoMs();
          useFrozen = null;
          issue(true);
        }
        launch = { phase: 'starting', game_id: gameId };
        emit();
        if (launcher) { launchNatively(launcher, gameId, token); return; }
        after(t.startMs, () => {
          if (token !== launchToken) return;
          if (settings.nextLaunch !== 'succeeds') {
            launch = { phase: 'failed', game_id: gameId, reason: settings.nextLaunch };
          } else {
            running = [gameId];
            launch = { phase: 'idle' };
            scheduleActivation();
          }
          emit();
        });
      });
    },
    async requestHelp() {
      if (help === 'sending') return;
      const token = ++helpToken;
      help = 'sending';
      emit();
      after(t.helpMs, () => {
        if (token !== helpToken) return;
        help = connection === 'connected' ? 'requested' : 'failed';
        emit();
        after(t.helpResetMs, () => { if (token === helpToken) { help = 'idle'; emit(); } });
      });
    },
  };

  const controls: SampleControls = {
    settings: () => settings,
    update(patch) {
      settings = { ...settings, ...patch };
      if (patch.supplyAmount !== undefined && session?.state === 'active') { issue(false); emit(); }
    },
    authorize() {
      if (live() || restriction.state === 'pending') return; // one session per station; enforcement first
      launchToken += 1;
      cancel(activation);
      activation = null;
      epoch += 1;
      tickets += 1;
      const now = clock.wallMs();
      authorization = { authorization_id: uuid(), station_epoch: epoch, expires_at: iso(now + t.authorizationMs), opaque_ticket_reference: `sample-ticket-${tickets}` };
      session = null;
      running = [];
      launch = { phase: 'idle' };
      useStartMono = null;
      useFrozen = null;
      help = 'idle';
      restriction = { state: 'unrestricted', command_id: null, verified_at: iso(now), failure_code: null };
      reassignable = false;
      issue(true);
      emit();
    },
    endSession() {
      if (!session || !live()) return;
      launchToken += 1;
      cancel(activation);
      activation = null;
      const now = clock.wallMs();
      const start = session.state === 'active' && session.billable_start_at !== null ? Date.parse(session.billable_start_at) : null;
      useFrozen = reading()?.observed_seconds ?? null;
      session = {
        ...session, state: 'ended', revision: session.revision + 1, ended_at: iso(now),
        billable_seconds_at_server_time: start === null ? 0 : Math.max(0, Math.floor((now - start) / 1000)),
        display_amount: settings.supplyAmount ? { ...FICTIONAL_AMOUNT, is_final: true } : null,
      };
      authorization = null;
      launch = { phase: 'idle' };
      reassignable = false;
      const commandId = uuid();
      const commandEpoch = epoch;
      restriction = { state: 'pending', command_id: commandId, verified_at: null, failure_code: null };
      issue(true);
      emit();
      after(t.lockMs, () => {
        if (epoch !== commandEpoch) return; // an old command never touches a later customer
        running = [];
        const verified = settings.lockOutcome === 'verified';
        restriction = verified
          ? { state: 'restricted', command_id: commandId, verified_at: iso(clock.wallMs()), failure_code: null }
          : { state: 'failed', command_id: commandId, verified_at: null, failure_code: 'SAMPLE_LOCK_FAILED' };
        reassignable = verified;
        issue(true);
        emit();
      });
    },
    closeGame() {
      if (running.length === 0) return;
      running = [];
      scheduleActivation();
      emit();
    },
    setConnection(next) {
      connection = next;
      if (next === 'connected') { issue(false); scheduleActivation(); }
      emit();
    },
    dispose() {
      for (const handle of [...timers]) cancel(handle);
      listeners.clear();
    },
  };

  emit();
  after(t.connectMs, () => {
    connection = 'connected';
    issue(true);
    emit();
    scheduleHeartbeat();
  });
  return { client, controls };
}
