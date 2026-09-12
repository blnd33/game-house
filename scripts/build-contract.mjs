// Source of truth. Regenerate JSON + TypeScript with npm run contract:generate.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { examples } from '../contracts/examples.mjs';

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const id = () => ({ type: 'string', format: 'uuid' });
const time = () => ({ type: 'string', format: 'date-time', pattern: 'Z$', description: 'UTC RFC3339 timestamp ending in Z. Server validates device observations; device wall time is not financial authority.' });
const integer = (minimum = 0) => ({ type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER });
const enumeration = (...values) => ({ type: 'string', enum: values });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const array = (items, maxItems = 100) => ({ type: 'array', items, maxItems });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const version = { type: 'string', const: '1' };
const request = properties => object({ api_version: version, request_id: id(), station_id: id(), sent_at: time(), ...properties });
const response = properties => object({ api_version: version, request_id: id(), station_id: id(), server_time: time(), ...properties });
const token = () => str('Opaque secret. Never log or expose to the renderer.', { minLength: 32, maxLength: 4096 });
const gameId = () => str('Stable ID resolved through the protected station catalog.', { pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' });
const schemas = {};
schemas.Error = object({
  api_version: version, request_id: id(), station_id: nullable(id()), session_id: nullable(id()), server_time: time(),
  code: enumeration('INVALID_REQUEST', 'UNAUTHENTICATED', 'CREDENTIAL_REVOKED', 'FORBIDDEN_STATION', 'PAIRING_EXPIRED',
    'AUTHORIZATION_REQUIRED', 'AUTHORIZATION_EXPIRED', 'STATION_UNAVAILABLE', 'SESSION_MISMATCH', 'REVISION_CONFLICT',
    'IDEMPOTENCY_CONFLICT', 'ATTEMPT_EXPIRED', 'ATTEMPT_CANCELLED', 'GAME_NOT_ALLOWED', 'STALE_EVENT',
    'SEQUENCE_CONFLICT', 'COMMAND_EXPIRED', 'UNSUPPORTED_COMMAND', 'RATE_LIMITED', 'TEMPORARILY_UNAVAILABLE'),
  message: str('Safe diagnostic without secrets or customer credentials.', { maxLength: 512 }),
  retryable: { type: 'boolean' }, retry_after_seconds: nullable(integer(1)),
});
schemas.EnrollRequest = object({ api_version: version, request_id: id(), sent_at: time(), pairing_code: str('One-use code entered through protected setup.', { minLength: 8, maxLength: 128 }), installation_id: id(), agent_version: str('Installed application version.'), station_label: str('Requested label, backend assigns identity.', { pattern: '^PC-[0-9]{2,4}$' }) });
schemas.Credentials = object({ credential_id: id(), access_token: token(), expires_at: time(), renewal_token: token(), renewal_expires_at: time() });
schemas.EnrollResponse = response({ station_label: str('Backend-approved station label.'), credentials: ref('Credentials') });
schemas.RenewRequest = request({ credential_id: id(), renewal_token: token() });
schemas.RenewResponse = response({ credentials: ref('Credentials') });
schemas.RevokeRequest = request({ credential_id: id() });
schemas.RevokeResponse = response({ revoked: { type: 'boolean', const: true } });
schemas.Authorization = object({ authorization_id: id(), station_epoch: integer(1), expires_at: time(), opaque_ticket_reference: nullable(str('Non-sensitive opaque ticket reference. No staff or customer credentials.')) });
schemas.Amount = object({ currency: str('ISO 4217 currency.', { pattern: '^[A-Z]{3}$' }), decimal_amount: str('Backend-calculated decimal string; do not recalculate.', { pattern: '^\\d+(\\.\\d+)?$' }), display_text: str('Formatted by backend for display.'), is_final: { type: 'boolean' } });
schemas.Session = object({
  session_id: id(), authorization_id: id(), station_epoch: integer(1), revision: integer(1),
  state: enumeration('pending', 'active', 'ended', 'cancelled'),
  policy_version: str('Immutable policy snapshot reference. Raw rate and delay settings are not device controls.'),
  accepted_first_play_at: time(), grace_deadline_at: time(), pending_expires_at: time(),
  billable_start_at: nullable(time()), ended_at: nullable(time()),
  billable_seconds_at_server_time: nullable(integer()), display_amount: nullable(ref('Amount')),
});
schemas.Restriction = object({ state: enumeration('unknown', 'unrestricted', 'pending', 'restricted', 'failed'), command_id: nullable(id()), verified_at: nullable(time()), failure_code: nullable(str('Safe operator diagnostic.')) });
schemas.Snapshot = object({
  revision: integer(1), station_epoch: integer(), authorization: nullable(ref('Authorization')), session: nullable(ref('Session')),
  restriction: ref('Restriction'),
  authorized_play_until: nullable(time()),
  reassignable: { type: 'boolean', description: 'Backend decision; ended billing alone does not make a station available.' },
});
schemas.ProcessProfile = object({
  executable_names: array(str('Exact expected process executable basename.', { pattern: '^[^\\\\/:*?"<>|]+\\.exe$' }), 20),
  expected_install_root: str('Protected absolute local root; resolve canonical path and prohibit player-writable launch targets.'),
  launch_timeout_seconds: integer(1),
  handoff_strategy: enumeration('direct_process', 'steam_process'),
});
schemas.SteamLaunch = object({ type: { const: 'steam', type: 'string' }, app_id: str('Digits only; construct supported Steam URI locally.', { pattern: '^[1-9][0-9]{0,9}$' }) });
schemas.ExecutableLaunch = object({ type: { const: 'executable', type: 'string' }, executable_path: str('Admin-approved absolute Windows executable path. Never a command line or URL.'), arguments: array(str('Individual argument; never concatenate through a shell.'), 32), working_directory: str('Validated absolute Windows directory.') });
schemas.GameProfile = object({ game_id: gameId(), title: str('Display title.'), artwork_asset: nullable(str('Approved local asset ID; never load arbitrary remote content.')), category: str('Category name.'), controller: { type: 'boolean' }, multiplayer: { type: 'boolean' }, enabled: { type: 'boolean' }, installed: { type: 'boolean', description: 'Locally verified per station; central claims do not prove installation.' }, launch: { oneOf: [ref('SteamLaunch'), ref('ExecutableLaunch')] }, detection: ref('ProcessProfile') });
schemas.StationConfig = object({ config_version: integer(1), station_label: str('PC label.'), planned_station_count: integer(1), business_timezone: { type: 'string', const: 'Asia/Baghdad' }, heartbeat_interval_seconds: integer(1), command_poll_interval_seconds: integer(1), observation_freshness_seconds: integer(1), pending_launch_offline_timeout_seconds: integer(1), restriction_profile_id: nullable(str('Locally supported, operator-approved profile. No remote code or commands.')), catalog_revision: nullable(str('Optional central metadata revision.')) });
schemas.ConfigResponse = response({ config: ref('StationConfig') });
schemas.SnapshotResponse = response({ snapshot: ref('Snapshot') });
schemas.RunningObservation = object({ session_id: id(), attempt_id: id(), game_run_id: id(), game_id: gameId(), process_started_at: time() });
schemas.HeartbeatRequest = request({ boot_id: id(), sequence: integer(1), monotonic_elapsed_ms: integer(), session_id: nullable(id()), last_snapshot_revision: integer(), restriction: ref('Restriction'), running_games: array(ref('RunningObservation'), 16), outbox_depth: integer() });
schemas.LaunchRequest = request({ session_id: nullable(id()), authorization_id: id(), station_epoch: integer(1), game_id: gameId(), boot_id: id(), expected_snapshot_revision: integer(1) });
schemas.LaunchAttempt = object({ attempt_id: id(), session_id: id(), game_id: gameId(), station_epoch: integer(1), issued_at: time(), expires_at: time(), state: enumeration('permitted', 'running', 'failed', 'cancelled', 'expired') });
schemas.LaunchResponse = response({ snapshot: ref('Snapshot'), attempt: ref('LaunchAttempt') });
schemas.CancelLaunchRequest = request({ session_id: id(), attempt_id: id(), reason: enumeration('player_cancelled', 'launch_timeout', 'agent_recovery', 'communication_lost') });

const eventCommon = {
  api_version: version, event_id: id(), station_id: id(), session_id: id(), boot_id: id(), sequence: integer(1),
  observed_at: time(), monotonic_elapsed_ms: integer(),
};
const gameFields = { attempt_id: id(), game_run_id: id(), game_id: gameId() };
schemas.GameRunningEvent = object({ ...eventCommon, type: { type: 'string', const: 'game_running' }, ...gameFields, process_started_at: time(), detection_profile_version: str('Protected local profile revision.') });
schemas.LaunchFailedEvent = object({ ...eventCommon, type: { type: 'string', const: 'launch_failed' }, attempt_id: id(), game_id: gameId(), reason: enumeration('timeout', 'not_installed', 'login_required', 'process_unreliable', 'start_failed', 'communication_lost'), diagnostic: nullable(str('Safe diagnostic without tokens, account names, or credentials.', { maxLength: 512 })) });
schemas.GameExitedEvent = object({ ...eventCommon, type: { type: 'string', const: 'game_exited' }, ...gameFields, exit_code: nullable({ type: 'integer' }) });
schemas.ObservedUseEvent = object({ ...eventCommon, type: { type: 'string', const: 'station_use_observed' }, segment_id: id(), segment_started_at: time(), observed_station_use_seconds: integer(), coverage: enumeration('continuous', 'recovered_unverified') });
schemas.StationEvent = { oneOf: [ref('GameRunningEvent'), ref('LaunchFailedEvent'), ref('GameExitedEvent'), ref('ObservedUseEvent')], discriminator: { propertyName: 'type', mapping: { game_running: '#/components/schemas/GameRunningEvent', launch_failed: '#/components/schemas/LaunchFailedEvent', game_exited: '#/components/schemas/GameExitedEvent', station_use_observed: '#/components/schemas/ObservedUseEvent' } } };
schemas.EventsRequest = request({ events: { ...array(ref('StationEvent')), minItems: 1 } });
schemas.EventResult = object({ event_id: id(), outcome: enumeration('accepted', 'duplicate', 'rejected', 'retry'), code: nullable(enumeration('STALE_EVENT', 'SESSION_MISMATCH', 'ATTEMPT_EXPIRED', 'ATTEMPT_CANCELLED', 'SEQUENCE_CONFLICT', 'INVALID_REQUEST', 'TEMPORARILY_UNAVAILABLE')) });
schemas.EventsResponse = response({ results: array(ref('EventResult')), snapshot: ref('Snapshot') });
schemas.RestrictCommand = object({ api_version: version, command_id: id(), station_id: id(), session_id: id(), station_epoch: integer(1), session_revision: integer(1), type: { type: 'string', const: 'restrict_station' }, issued_at: time(), expires_at: time(), restriction_profile_id: str('Must match locally approved and implemented profile.'), reason: enumeration('cashier_session_ended', 'authorization_expired') });
schemas.CommandsResponse = response({ commands: array(ref('RestrictCommand')), next_cursor: nullable(str('Opaque cursor. Polling is at-least-once, not an acknowledgement.')), snapshot: ref('Snapshot') });
schemas.CommandResultRequest = request({ session_id: id(), station_epoch: integer(1), command_id: id(), boot_id: id(), result_id: id(), attempted_at: time(), outcome: enumeration('verified', 'failed', 'rejected_stale', 'expired', 'unsupported'), restriction_state: enumeration('restricted', 'failed', 'unknown'), verified_at: nullable(time()), evidence: nullable(str('Safe verification detail, not an unverified claim.', { maxLength: 512 })), failure_code: nullable(str('Machine-readable local diagnostic.', { maxLength: 128 })) });
schemas.CommandResultResponse = response({ command_id: id(), result_id: id(), recorded: { type: 'boolean', const: true }, snapshot: ref('Snapshot') });

const stationParam = { name: 'station_id', in: 'path', required: true, description: 'Must equal the authenticated station ID and any station ID in the body.', schema: id() };
const requestIdParam = { name: 'X-Request-ID', in: 'header', required: true, description: 'Correlation UUID for reads. Responses echo this value.', schema: id() };
const sessionParam = { name: 'session_id', in: 'path', required: true, description: 'Must belong to the authenticated station; never grants cross-station reads.', schema: id() };
const idempotencyParam = { name: 'Idempotency-Key', in: 'header', required: true, description: 'Stable UUID for one logical mutation; same key + different canonical payload returns 409. Reuse identical body on retry.', schema: id() };
const json = schema => ({ 'application/json': { schema: ref(schema) } });
function operation(operationId, summary, reply, { body, station = true, read = false, parameters = [], enrollment = false, renewal = false } = {}) {
  return {
    operationId, summary, tags: [enrollment || renewal ? 'Enrollment' : 'Station'],
    description: 'PROPOSED, not an existing Padel House route. See docs/partner-handoff.md for transactional, timing, and retry semantics.',
    ...(enrollment || renewal ? { security: [] } : {}),
    parameters: [...(station ? [stationParam] : []), ...(read ? [requestIdParam] : [idempotencyParam]), ...parameters],
    ...(body ? { requestBody: { required: true, content: json(body) } } : {}),
    responses: {
      '200': { description: 'Accepted response. A launch permit is not proof that a game is running or billing has started.', content: json(reply) },
      '400': { description: 'Invalid message.', content: json('Error') },
      '401': { description: 'Credential, renewal token, or pairing code invalid/expired/revoked.', content: json('Error') },
      '403': { description: 'Station scope or authorization rejected.', content: json('Error') },
      '409': { description: 'Session, revision, sequence, or idempotency conflict; reconcile before a new action.', content: json('Error') },
      '410': { description: 'Expired authorization, attempt, or command.', content: json('Error') },
      '429': { description: 'Back off using Retry-After.', headers: { 'Retry-After': { description: 'Seconds before retry.', schema: integer(1) } }, content: json('Error') },
      '503': { description: 'Transient failure; retry with stable identifiers and backoff.', content: json('Error') },
    },
  };
}
export const contract = {
  openapi: '3.1.0',
  info: { title: 'Gaming House Station API — PROPOSAL', version: '0.1.0', description: 'Phase 1 proposal for partner review. No production endpoints are asserted to exist. Station scope only; no cashier powers. Canonical API version 1.', contact: { name: 'Gaming House / Padel House integration owners' } },
  servers: [{ url: 'http://127.0.0.1:4317/gaming/v1', description: 'Development simulator address reserved for Phase 4; not running in Phase 1. Real adapter requires configured HTTPS.' }],
  security: [{ stationBearer: [] }],
  tags: [{ name: 'Enrollment', description: 'Protected device setup and credential lifecycle.' }, { name: 'Station', description: 'Device-scoped operations; never cashier or pricing authority.' }],
  paths: {
    '/devices/enroll': { post: operation('enrollDevice', 'Redeem a one-time partner-issued station pairing code', 'EnrollResponse', { body: 'EnrollRequest', station: false, enrollment: true }) },
    '/stations/{station_id}/credentials/renew': { post: operation('renewCredentials', 'Rotate credentials using a station-scoped renewal secret', 'RenewResponse', { body: 'RenewRequest', renewal: true }) },
    '/stations/{station_id}/credentials/revoke': { post: operation('revokeOwnCredentials', 'Revoke this station credential family only', 'RevokeResponse', { body: 'RevokeRequest' }) },
    '/stations/{station_id}/configuration': { get: operation('getConfiguration', 'Read station configuration without billing controls', 'ConfigResponse', { read: true }) },
    '/stations/{station_id}/snapshot': { get: operation('getStationSnapshot', 'Read authorization and authoritative station/session state', 'SnapshotResponse', { read: true }) },
    '/stations/{station_id}/sessions/{session_id}': { get: operation('getSessionSnapshot', 'Read a station-owned session snapshot', 'SnapshotResponse', { read: true, parameters: [sessionParam] }) },
    '/stations/{station_id}/heartbeat': { post: operation('sendHeartbeat', 'Report liveness and currently observed game processes', 'SnapshotResponse', { body: 'HeartbeatRequest' }) },
    '/stations/{station_id}/launches': { post: operation('requestLaunch', 'Obtain an expiring launch permit under cashier authorization', 'LaunchResponse', { body: 'LaunchRequest' }) },
    '/stations/{station_id}/launches/cancel': { post: operation('cancelLaunchAttempt', 'Cancel a launch attempt without ending billing or resetting grace', 'SnapshotResponse', { body: 'CancelLaunchRequest' }) },
    '/stations/{station_id}/events': { post: operation('submitEvents', 'Submit durable observations without client-calculated charges', 'EventsResponse', { body: 'EventsRequest' }) },
    '/stations/{station_id}/commands': { get: operation('pollCommands', 'Poll expiring station-scoped restriction commands', 'CommandsResponse', { read: true, parameters: [{ name: 'cursor', in: 'query', required: false, description: 'Opaque previous cursor; commands remain eligible until terminal acknowledgement or expiry.', schema: str('Opaque cursor.') }] }) },
    '/stations/{station_id}/commands/results': { post: operation('acknowledgeCommand', 'Report verified restriction or honest enforcement failure', 'CommandResultResponse', { body: 'CommandResultRequest' }) },
  },
  components: { securitySchemes: { stationBearer: { type: 'http', scheme: 'bearer', description: 'Per-station revocable opaque bearer token over HTTPS; never a staff cookie. Enrollment uses a one-time code; renewal uses its dedicated scoped secret.' } }, schemas },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = new URL('../contracts/openapi.json', import.meta.url);
  await mkdir(new URL('../contracts/', import.meta.url), { recursive: true });
  await writeFile(destination, JSON.stringify(contract, null, 2) + '\n');
  await writeFile(new URL('../contracts/examples.json', import.meta.url), JSON.stringify(examples, null, 2) + '\n');
  console.log('Generated contracts/openapi.json (proposal).');
}
