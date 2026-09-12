import { randomUUID, randomBytes, createHash } from 'node:crypto';

const uuid = () => randomUUID();
const secret = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const iso = value => new Date(value).toISOString();
export class ApiError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new ApiError(code, status); };
const emptyRestriction = () => ({ state: 'unknown', command_id: null, verified_at: null, failure_code: null });

// Only this development backend owns financial policy and arithmetic.
export function validatePolicy(value) {
  const required = ['billing_start_delay_seconds', 'hourly_rate_decimal', 'currency', 'billing_unit_seconds', 'rounding_mode', 'minimum_charge_decimal'];
  if (!value || required.some(k => !(k in value)) || Object.keys(value).some(k => !required.includes(k))) fail('INVALID_REQUEST', 400);
  if (!Number.isInteger(value.billing_start_delay_seconds) || value.billing_start_delay_seconds < 0 || value.billing_start_delay_seconds > 3600 ||
      !Number.isInteger(value.billing_unit_seconds) || value.billing_unit_seconds < 1 || value.billing_unit_seconds > 3600 ||
      !['up', 'down', 'nearest'].includes(value.rounding_mode) || !/^[A-Z]{3}$/.test(value.currency) ||
      !/^\d{1,9}(\.\d{1,2})?$/.test(value.hourly_rate_decimal) || !/^\d{1,9}(\.\d{1,2})?$/.test(value.minimum_charge_decimal)) fail('INVALID_REQUEST', 400);
  return structuredClone(value);
}
const cents = text => { const [whole, part = ''] = text.split('.'); return BigInt(whole) * 100n + BigInt(part.padEnd(2, '0')); };
export function amountFor(seconds, policy, final = false) {
  const unit = policy.billing_unit_seconds;
  const units = ({ up: Math.ceil, down: Math.floor, nearest: Math.round })[policy.rounding_mode](seconds / unit);
  const numerator = cents(policy.hourly_rate_decimal) * BigInt(units * unit);
  const priced = (numerator + 1800n) / 3600n; // Half-up to hundredths, documented simulator semantics.
  const total = priced > cents(policy.minimum_charge_decimal) ? priced : cents(policy.minimum_charge_decimal);
  const decimal = `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
  return { currency: policy.currency, decimal_amount: decimal, display_text: `${decimal} ${policy.currency}`, is_final: final };
}

export class Simulator {
  constructor(state = null, now = () => Date.now()) {
    this.now = now;
    this.data = state ?? { policy: null, policyVersion: 0, stations: {}, pairs: {}, idempotency: {}, events: {}, sequences: {}, results: {} };
  }
  station(id) { return this.data.stations[id] ?? fail('FORBIDDEN_STATION', 403); }
  tick() {
    const now = this.now();
    for (const s of Object.values(this.data.stations)) {
      const session = s.snapshot.session;
      if (!session || session.state !== 'pending') continue;
      if (Date.parse(session.pending_expires_at) <= now) {
        session.state = 'cancelled'; session.revision++; s.snapshot.authorization = null;
        s.snapshot.authorized_play_until = null; s.snapshot.revision++;
        this.restrict(s, 'authorization_expired'); continue;
      }
      const running = Object.values(s.attempts).find(a => a.state === 'running' && a.session_id === session.session_id &&
        a.expiresMs > now && a.running && a.lastEvidence + s.config.observation_freshness_seconds * 1000 >= now);
      if (running && Date.parse(session.grace_deadline_at) <= now && s.snapshot.authorization && Date.parse(s.snapshot.authorization.expires_at) > now) {
        session.state = 'active'; session.billable_start_at = iso(Math.max(Date.parse(session.grace_deadline_at), running.confirmedAt));
        session.revision++; s.snapshot.revision++;
      }
    }
  }
  snapshot(s) {
    const session = s.snapshot.session;
    if (session?.state === 'active') {
      // Never count beyond latest validated online lease. A reconnect must reconcile a gap.
      const end = Math.min(this.now(), s.verifiedThrough);
      session.billable_seconds_at_server_time = Math.max(0, Math.floor((end - Date.parse(session.billable_start_at) - s.excludedMs) / 1000));
      session.display_amount = amountFor(session.billable_seconds_at_server_time, s.policy);
    }
    return structuredClone(s.snapshot);
  }
  envelope(stationId, requestId, data) { return { api_version: '1', request_id: requestId, station_id: stationId, server_time: iso(this.now()), ...data }; }
  authorizeToken(stationId, token) {
    const s = this.station(stationId);
    if (s.revoked) fail('CREDENTIAL_REVOKED', 401);
    if (hash(token ?? '') !== s.accessHash || this.now() >= s.accessExpires) fail('UNAUTHENTICATED', 401);
    return s;
  }
  credentials(s) {
    const access = secret(), renewal = secret();
    s.accessHash = hash(access); s.renewalHash = hash(renewal); s.accessExpires = this.now() + 3600000; s.renewalExpires = this.now() + 30 * 86400000;
    s.credentialId = uuid();
    return { credential_id: s.credentialId, access_token: access, expires_at: iso(s.accessExpires), renewal_token: renewal, renewal_expires_at: iso(s.renewalExpires) };
  }
  remember(scope, key, body, action) {
    if (!key) fail('INVALID_REQUEST', 400);
    const fingerprint = hash(JSON.stringify(body)), index = `${scope}:${key}`, existing = this.data.idempotency[index];
    if (existing) {
      if (existing.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT');
      return structuredClone(existing.response);
    }
    const response = action();
    this.data.idempotency[index] = { fingerprint, response: structuredClone(response) };
    return response;
  }
  enroll(body, key) {
    return this.remember(`enroll:${body.installation_id}`, key, body, () => {
      const pair = this.data.pairs[hash(body.pairing_code)];
      if (!pair || pair.used || pair.expires <= this.now() || pair.label !== body.station_label) fail('PAIRING_EXPIRED', 401);
      if (Object.values(this.data.stations).some(s => s.label === pair.label && !s.revoked)) fail('STATION_UNAVAILABLE');
      pair.used = true;
      const id = uuid();
      const s = this.data.stations[id] = { id, label: pair.label, revoked: false, attempts: {}, commands: [], segments: {}, history: {}, excludedMs: 0, verifiedThrough: this.now(),
        config: { config_version: 1, station_label: pair.label, planned_station_count: 12, business_timezone: 'Asia/Baghdad', heartbeat_interval_seconds: 2, command_poll_interval_seconds: 2, observation_freshness_seconds: 6, pending_launch_offline_timeout_seconds: 5, restriction_profile_id: 'disconnect-session-v1', catalog_revision: null },
        snapshot: { revision: 1, station_epoch: 0, authorization: null, session: null, restriction: emptyRestriction(), authorized_play_until: null, reassignable: true } };
      return this.envelope(id, body.request_id, { station_label: s.label, credentials: this.credentials(s) });
    });
  }
  admin(action) {
    const now = this.now();
    if (action.type === 'policy') { this.data.policy = validatePolicy(action.policy); this.data.policyVersion++; return { policy_version: `sim-${this.data.policyVersion}`, ...this.data.policy }; }
    if (action.type === 'pair') {
      if (!/^PC-\d{2,4}$/.test(action.label ?? '')) fail('INVALID_REQUEST', 400);
      const code = secret(); this.data.pairs[hash(code)] = { label: action.label, expires: now + 600000, used: false };
      return { pairing_code: code, expires_at: iso(now + 600000) };
    }
    if (action.type === 'status') return Object.values(this.data.stations).map(s => ({ station_id: s.id, station_label: s.label, snapshot: this.snapshot(s), diagnostics: s.diagnostics ?? [], observed_segments: s.segments }));
    const s = this.station(action.station_id);
    if (action.type === 'authorize') {
      if (!this.data.policy) fail('INVALID_REQUEST', 400);
      if (!s.snapshot.reassignable || ['active', 'pending'].includes(s.snapshot.session?.state)) fail('STATION_UNAVAILABLE');
      if (s.snapshot.session) s.history[s.snapshot.session.session_id] = this.snapshot(s);
      s.snapshot.station_epoch++; s.snapshot.revision++; s.snapshot.session = null; s.snapshot.reassignable = false;
      s.snapshot.authorization = { authorization_id: uuid(), station_epoch: s.snapshot.station_epoch, expires_at: iso(now + 120000), opaque_ticket_reference: null };
      s.snapshot.restriction = { state: 'unrestricted', command_id: null, verified_at: null, failure_code: null };
      s.snapshot.authorized_play_until = null; s.attempts = {}; s.excludedMs = 0;
    } else if (action.type === 'stop') {
      const session = s.snapshot.session;
      if (!session) fail('SESSION_MISMATCH');
      if (session.state === 'ended') return this.snapshot(s);
      this.snapshot(s);
      session.state = 'ended'; session.ended_at = iso(now); session.revision++;
      session.display_amount = session.billable_start_at ? amountFor(session.billable_seconds_at_server_time ?? 0, s.policy, true) : { currency: s.policy.currency, decimal_amount: '0.00', display_text: `0.00 ${s.policy.currency}`, is_final: true };
      session.billable_seconds_at_server_time ??= 0;
      s.snapshot.authorization = null; s.snapshot.authorized_play_until = null; s.snapshot.revision++;
      this.restrict(s, 'cashier_session_ended');
    } else if (action.type === 'resolve-enforcement') {
      if (['active', 'pending'].includes(s.snapshot.session?.state)) fail('STATION_UNAVAILABLE');
      // Explicit development operator action; never a device-issued success or payment operation.
      s.commands = []; s.snapshot.restriction = emptyRestriction(); s.snapshot.reassignable = true; s.snapshot.revision++;
    } else if (action.type === 'revoke') s.revoked = true;
    else fail('INVALID_REQUEST', 400);
    return this.snapshot(s);
  }
  restrict(s, reason) {
    const command = { api_version: '1', command_id: uuid(), station_id: s.id, session_id: s.snapshot.session.session_id, station_epoch: s.snapshot.station_epoch, session_revision: s.snapshot.session.revision, type: 'restrict_station', issued_at: iso(this.now()), expires_at: iso(this.now() + 120000), restriction_profile_id: s.config.restriction_profile_id, reason };
    s.commands.push(command); s.snapshot.restriction = { state: 'pending', command_id: command.command_id, verified_at: null, failure_code: null }; s.snapshot.reassignable = false;
  }
  handle(operation, s, body, key, requestId = body?.request_id) {
    this.tick();
    const env = data => this.envelope(s.id, requestId, data);
    if (operation === 'configuration') return env({ config: s.config });
    if (operation === 'snapshot') return env({ snapshot: this.snapshot(s) });
    if (operation.startsWith('sessions/')) {
      const id = operation.split('/')[1];
      const snapshot = s.snapshot.session?.session_id === id ? this.snapshot(s) : s.history[id];
      if (!snapshot) fail('SESSION_MISMATCH');
      return env({ snapshot });
    }
    if (operation === 'commands') return env({ commands: s.commands.filter(c => !this.data.results[c.command_id]), next_cursor: null, snapshot: this.snapshot(s) });
    if (body.station_id !== s.id) fail('FORBIDDEN_STATION', 403);
    return this.remember(`${s.id}:${operation}`, key, body, () => {
      const now = this.now();
      if (operation === 'credentials/renew') {
        if (s.revoked || body.credential_id !== s.credentialId || hash(body.renewal_token) !== s.renewalHash || s.renewalExpires <= now) fail('UNAUTHENTICATED', 401);
        return env({ credentials: this.credentials(s) });
      }
      if (operation === 'credentials/revoke') { if (body.credential_id !== s.credentialId) fail('UNAUTHENTICATED', 401); s.revoked = true; return env({ revoked: true }); }
      if (operation === 'launches') {
        const snap = s.snapshot, auth = snap.authorization;
        if (!auth || auth.authorization_id !== body.authorization_id || auth.station_epoch !== body.station_epoch) fail('AUTHORIZATION_REQUIRED', 403);
        if (Date.parse(auth.expires_at) <= now) fail('AUTHORIZATION_EXPIRED', 410);
        if (!['unrestricted'].includes(snap.restriction.state) || ['ended', 'cancelled'].includes(snap.session?.state)) fail('STATION_UNAVAILABLE');
        if (body.session_id && body.session_id !== snap.session?.session_id) fail('SESSION_MISMATCH');
        if (body.expected_snapshot_revision !== snap.revision) fail('REVISION_CONFLICT');
        if (!snap.session) {
          s.policy = { ...this.data.policy, policy_version: `sim-${this.data.policyVersion}` };
          snap.session = { session_id: uuid(), authorization_id: auth.authorization_id, station_epoch: snap.station_epoch, revision: 1, state: 'pending', policy_version: s.policy.policy_version, accepted_first_play_at: iso(now), grace_deadline_at: iso(now + s.policy.billing_start_delay_seconds * 1000), pending_expires_at: iso(now + 120000), billable_start_at: null, ended_at: null, billable_seconds_at_server_time: null, display_amount: null };
      s.verifiedThrough = now; snap.revision++;
        }
        for (const a of Object.values(s.attempts)) if (a.session_id === snap.session.session_id && ['permitted', 'running'].includes(a.state) && snap.session.state === 'pending') { a.state = 'cancelled'; a.running = false; }
        const expires = Math.min(now + 90000, snap.session.state === 'pending' ? Date.parse(snap.session.pending_expires_at) : now + 90000);
        const attempt = { attempt_id: uuid(), session_id: snap.session.session_id, game_id: body.game_id, station_epoch: snap.station_epoch, issued_at: iso(now), expires_at: iso(expires), state: 'permitted' };
        s.attempts[attempt.attempt_id] = { ...attempt, expiresMs: expires, running: false, lastEvidence: 0, confirmedAt: null };
        snap.authorized_play_until = iso(now + 10000); s.leaseUntil = now + 10000; s.verifiedThrough = now;
        return env({ snapshot: this.snapshot(s), attempt });
      }
      if (operation === 'launches/cancel') {
        const a = s.attempts[body.attempt_id];
        if (!a || a.session_id !== body.session_id) fail('SESSION_MISMATCH');
        a.state = 'cancelled'; a.running = false;
        (s.diagnostics ??= []).push({ code: 'CANCELLED_LAUNCH', attempt_id: a.attempt_id });
      } else if (operation === 'heartbeat') {
        if (body.session_id !== (s.snapshot.session?.session_id ?? null)) fail('SESSION_MISMATCH');
        const stream = `heartbeat:${s.id}:${body.boot_id}`;
        if (body.sequence <= (this.data.sequences[stream] ?? 0)) fail('SEQUENCE_CONFLICT');
        this.data.sequences[stream] = body.sequence;
        for (const a of Object.values(s.attempts)) {
          if (a.state !== 'running') continue;
          const observed = body.running_games.find(g => g.attempt_id === a.attempt_id && g.session_id === a.session_id && g.game_id === a.game_id && g.game_run_id === a.gameRunId);
          a.running = !!observed; if (observed) a.lastEvidence = now;
        }
        if (['pending', 'active'].includes(s.snapshot.session?.state)) {
          // A reboot or missed lease is an unverified gap; hold the station for staff.
          if (s.lastBoot && s.lastBoot !== body.boot_id || (s.lastHeartbeat && now > s.leaseUntil)) {
            s.snapshot.authorized_play_until = null; s.snapshot.restriction = { state: 'failed', command_id: null, verified_at: null, failure_code: 'RECOVERY_REQUIRES_STAFF' };
            s.snapshot.authorization = null; s.snapshot.revision++;
          } else if (s.snapshot.authorization) {
            s.verifiedThrough = now; s.leaseUntil = now + 10000;
            s.snapshot.authorized_play_until = iso(s.leaseUntil);
            if (s.snapshot.session.state === 'active') s.snapshot.authorization.expires_at = iso(s.leaseUntil);
          }
        }
        s.lastBoot = body.boot_id; s.lastHeartbeat = now;
      } else if (operation === 'events') {
        if (body.events.some(e => e.station_id !== s.id)) fail('FORBIDDEN_STATION', 403);
        const results = body.events.map(e => this.event(s, e));
        this.tick(); return env({ results, snapshot: this.snapshot(s) });
      } else if (operation === 'commands/results') {
        const cmd = s.commands.find(c => c.command_id === body.command_id);
        if (!cmd || cmd.session_id !== body.session_id || cmd.station_epoch !== body.station_epoch || s.snapshot.station_epoch !== body.station_epoch) fail('SESSION_MISMATCH');
        const old = this.data.results[cmd.command_id];
        if (old && JSON.stringify(old) !== JSON.stringify(body)) fail('IDEMPOTENCY_CONFLICT');
        if (body.outcome === 'verified' && (body.restriction_state !== 'restricted' || !body.verified_at || !body.evidence || Date.parse(cmd.expires_at) < Date.parse(body.attempted_at))) fail('INVALID_REQUEST', 400);
        this.data.results[cmd.command_id] = structuredClone(body);
        const verified = body.outcome === 'verified';
        s.snapshot.restriction = { state: verified ? 'restricted' : 'failed', command_id: cmd.command_id, verified_at: verified ? body.verified_at : null, failure_code: verified ? null : body.failure_code ?? body.outcome };
        s.snapshot.reassignable = verified; s.snapshot.revision++;
        return env({ command_id: cmd.command_id, result_id: body.result_id, recorded: true, snapshot: this.snapshot(s) });
      } else fail('INVALID_REQUEST', 400);
      this.tick(); return env({ snapshot: this.snapshot(s) });
    });
  }
  event(s, e) {
    const result = (outcome, code = null) => ({ event_id: e.event_id, outcome, code });
    const existing = this.data.events[e.event_id];
    if (existing) return existing.hash === hash(JSON.stringify(e)) ? result('duplicate') : result('rejected', 'SEQUENCE_CONFLICT');
    if (s.snapshot.session?.session_id !== e.session_id) return result('rejected', 'SESSION_MISMATCH');
    const seqKey = `event:${s.id}:${e.boot_id}:${e.sequence}`;
    if (this.data.sequences[seqKey]) return result('rejected', 'SEQUENCE_CONFLICT');
    const a = e.attempt_id ? s.attempts[e.attempt_id] : null;
    if (e.type === 'game_running' && (this.now() - Date.parse(e.observed_at) > s.config.observation_freshness_seconds * 1000 || Date.parse(e.observed_at) - this.now() > 5000)) return result('rejected', 'STALE_EVENT');
    if (e.type !== 'station_use_observed' && (!a || a.session_id !== e.session_id || a.game_id !== e.game_id)) return result('rejected', 'SESSION_MISMATCH');
    if (a && e.sequence <= (a.sequence ?? 0)) return result('rejected', 'STALE_EVENT');
    if (e.type === 'game_running' && (['cancelled', 'failed', 'expired'].includes(a.state) || a.expiresMs <= this.now() || !['pending', 'active'].includes(s.snapshot.session.state))) return result('rejected', 'ATTEMPT_EXPIRED');
    if (e.type === 'station_use_observed') {
      const key = `${e.session_id}:${e.boot_id}:${e.segment_id}`, previous = s.segments[key];
      if (e.coverage !== 'continuous') return result('rejected', 'STALE_EVENT');
      if (previous && e.observed_station_use_seconds < previous.observed_station_use_seconds) return result('rejected', 'SEQUENCE_CONFLICT');
      s.segments[key] = structuredClone(e);
    } else {
      a.sequence = e.sequence;
      if (e.type === 'game_running') { a.state = 'running'; a.running = true; a.confirmedAt ??= this.now(); a.lastEvidence = this.now(); a.gameRunId = e.game_run_id; }
      else { a.running = false; a.state = e.type === 'launch_failed' ? 'failed' : 'expired'; }
    }
    this.data.events[e.event_id] = { hash: hash(JSON.stringify(e)), event: structuredClone(e) }; this.data.sequences[seqKey] = true;
    return result('accepted');
  }
}
