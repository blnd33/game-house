// Fictional development messages only. IDs are not venue enrollment credentials.
const station = '10000000-0000-4000-8000-000000000001';
const session = '20000000-0000-4000-8000-000000000001';
const auth = '30000000-0000-4000-8000-000000000001';
const boot = '40000000-0000-4000-8000-000000000001';
const attempt = '50000000-0000-4000-8000-000000000001';
const run = '60000000-0000-4000-8000-000000000001';
const command = '70000000-0000-4000-8000-000000000001';
const request = '80000000-0000-4000-8000-000000000001';
const at = '2026-09-11T12:00:00Z';
const req = { api_version: '1', request_id: request, station_id: station, sent_at: at };
const res = { api_version: '1', request_id: request, station_id: station, server_time: at };
const restriction = { state: 'unrestricted', command_id: null, verified_at: at, failure_code: null };
const authorization = { authorization_id: auth, station_epoch: 1, expires_at: '2026-09-11T12:02:00Z', opaque_ticket_reference: 'development-ticket' };
const snapshot = { revision: 1, station_epoch: 1, authorization, session: null, restriction, authorized_play_until: null, reassignable: false };
const pendingSession = {
  session_id: session, authorization_id: auth, station_epoch: 1, revision: 1, state: 'pending', policy_version: 'dev-policy-20s-v1',
  accepted_first_play_at: at, grace_deadline_at: '2026-09-11T12:00:20Z', pending_expires_at: '2026-09-11T12:02:00Z',
  billable_start_at: null, ended_at: null, billable_seconds_at_server_time: null, display_amount: null,
};
const permitted = { attempt_id: attempt, session_id: session, game_id: 'sample-steam-game', station_epoch: 1, issued_at: at, expires_at: '2026-09-11T12:01:00Z', state: 'permitted' };
const event = { api_version: '1', event_id: '90000000-0000-4000-8000-000000000001', station_id: station, session_id: session, boot_id: boot, sequence: 1, observed_at: '2026-09-11T12:00:08Z', monotonic_elapsed_ms: 8000 };

export const examples = {
  enrollment: { schema: 'EnrollRequest', value: { api_version: '1', request_id: request, sent_at: at, pairing_code: 'EXAMPLE-ONLY-NOT-A-REAL-CODE', installation_id: boot, agent_version: '0.1.0', station_label: 'PC-01' } },
  authorizationGranted: { schema: 'SnapshotResponse', value: { ...res, snapshot } },
  launchRequested: { schema: 'LaunchRequest', value: { ...req, session_id: null, authorization_id: auth, station_epoch: 1, game_id: 'sample-steam-game', boot_id: boot, expected_snapshot_revision: 1 } },
  launchPermitted: { schema: 'LaunchResponse', value: { ...res, snapshot: { ...snapshot, revision: 2, session: pendingSession, authorized_play_until: permitted.expires_at }, attempt: permitted } },
  gameRunning: { schema: 'GameRunningEvent', value: { ...event, type: 'game_running', attempt_id: attempt, game_run_id: run, game_id: 'sample-steam-game', process_started_at: event.observed_at, detection_profile_version: 'dev-profile-1' } },
  launchFailed: { schema: 'LaunchFailedEvent', value: { ...event, type: 'launch_failed', attempt_id: attempt, game_id: 'sample-steam-game', reason: 'login_required', diagnostic: 'Expected game process was not detected.' } },
  gameExited: { schema: 'GameExitedEvent', value: { ...event, event_id: '90000000-0000-4000-8000-000000000002', sequence: 2, observed_at: '2026-09-11T12:00:40Z', monotonic_elapsed_ms: 40000, type: 'game_exited', attempt_id: attempt, game_run_id: run, game_id: 'sample-steam-game', exit_code: 0 } },
  stationUseObserved: { schema: 'ObservedUseEvent', value: { ...event, event_id: '90000000-0000-4000-8000-000000000003', sequence: 3, observed_at: '2026-09-11T12:01:00Z', monotonic_elapsed_ms: 60000, type: 'station_use_observed', segment_id: 'a0000000-0000-4000-8000-000000000001', segment_started_at: at, observed_station_use_seconds: 60, coverage: 'continuous' } },
  sessionActive: { schema: 'SnapshotResponse', value: { ...res, server_time: '2026-09-11T12:01:00Z', snapshot: { ...snapshot, revision: 3, authorized_play_until: '2026-09-11T12:01:30Z', session: { ...pendingSession, revision: 2, state: 'active', billable_start_at: '2026-09-11T12:00:20Z', billable_seconds_at_server_time: 40 } } } },
  cashierSessionEnded: { schema: 'SnapshotResponse', value: { ...res, server_time: '2026-09-11T12:01:00Z', snapshot: { ...snapshot, revision: 4, authorization: null, restriction: { ...restriction, state: 'pending', command_id: command, verified_at: null }, session: { ...pendingSession, revision: 3, state: 'ended', billable_start_at: '2026-09-11T12:00:20Z', ended_at: '2026-09-11T12:01:00Z', billable_seconds_at_server_time: 40, display_amount: { currency: 'IQD', decimal_amount: '1000', display_text: '1,000 IQD', is_final: true } } } } },
  restrictCommand: { schema: 'RestrictCommand', value: { api_version: '1', command_id: command, station_id: station, session_id: session, station_epoch: 1, session_revision: 3, type: 'restrict_station', issued_at: '2026-09-11T12:01:00Z', expires_at: '2026-09-11T12:02:00Z', restriction_profile_id: 'pending-target-validation', reason: 'cashier_session_ended' } },
  restrictionAcknowledged: { schema: 'CommandResultRequest', value: { ...req, sent_at: '2026-09-11T12:01:02Z', session_id: session, station_epoch: 1, command_id: command, boot_id: boot, result_id: 'b0000000-0000-4000-8000-000000000001', attempted_at: '2026-09-11T12:01:01Z', outcome: 'verified', restriction_state: 'restricted', verified_at: '2026-09-11T12:01:02Z', evidence: 'Fictional example only; target restriction is not yet implemented.', failure_code: null } },
  heartbeat: { schema: 'HeartbeatRequest', value: { ...req, boot_id: boot, sequence: 1, monotonic_elapsed_ms: 0, session_id: null, last_snapshot_revision: 1, restriction, running_games: [], outbox_depth: 0 } },
};
examples.eventBatch = { schema: 'EventsRequest', value: { ...req, events: [examples.gameRunning.value] } };
examples.eventAcknowledged = { schema: 'EventsResponse', value: { ...res, results: [{ event_id: event.event_id, outcome: 'accepted', code: null }], snapshot } };
