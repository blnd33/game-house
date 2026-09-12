import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { Simulator, amountFor } from '../apps/backend-simulator/engine.mjs';

const policy = delay => ({ billing_start_delay_seconds: delay, hourly_rate_decimal: '3600.00', currency: 'IQD', billing_unit_seconds: 1, rounding_mode: 'up', minimum_charge_decimal: '0.00' });
function fixture(delay = 20) {
  let now = Date.parse('2026-09-11T12:00:00Z'), sequence = 0, hb = 0;
  const sim = new Simulator(null, () => now), boot = uuid();
  sim.admin({ type: 'policy', policy: policy(delay) });
  const pair = sim.admin({ type: 'pair', label: 'PC-01' });
  const enrollment = sim.enroll({ api_version: '1', request_id: uuid(), sent_at: new Date(now).toISOString(), pairing_code: pair.pairing_code, installation_id: uuid(), agent_version: 'test', station_label: 'PC-01' }, uuid());
  const s = sim.station(enrollment.station_id);
  sim.admin({ type: 'authorize', station_id: s.id });
  const body = fields => ({ api_version: '1', request_id: uuid(), station_id: s.id, sent_at: new Date(now).toISOString(), ...fields });
  const launchBody = game => body({ session_id: s.snapshot.session?.session_id ?? null, authorization_id: s.snapshot.authorization?.authorization_id, station_epoch: s.snapshot.station_epoch, game_id: game, boot_id: boot, expected_snapshot_revision: s.snapshot.revision });
  const launch = (game = 'test-game') => sim.handle('launches', s, launchBody(game), uuid());
  const event = (attempt, type = 'game_running', fields = {}) => ({ api_version: '1', event_id: uuid(), station_id: s.id, session_id: attempt.session_id, boot_id: boot, sequence: ++sequence,
    observed_at: new Date(now).toISOString(), monotonic_elapsed_ms: sequence * 1000, type, attempt_id: attempt.attempt_id, game_id: attempt.game_id,
    game_run_id: uuid(), process_started_at: new Date(now).toISOString(), detection_profile_version: 'test', ...fields });
  const submit = e => sim.handle('events', s, body({ events: [e] }), uuid());
  const heartbeat = () => sim.handle('heartbeat', s, body({ boot_id: boot, sequence: ++hb, monotonic_elapsed_ms: hb * 1000, session_id: s.snapshot.session?.session_id ?? null, last_snapshot_revision: s.snapshot.revision, restriction: s.snapshot.restriction, running_games: Object.values(s.attempts).filter(a => a.running).map(a => ({ session_id: a.session_id, attempt_id: a.attempt_id, game_run_id: a.gameRunId, game_id: a.game_id, process_started_at: new Date(a.confirmedAt).toISOString() })), outbox_depth: 0 }), uuid());
  const advance = seconds => { for (let i = 0; i < seconds; i++) { now += 1000; heartbeat(); sim.tick(); } };
  return { sim, s, body, launch, launchBody, event, submit, advance, heartbeat, enrollment, now: () => now, jump: seconds => { now += seconds * 1000; } };
}
for (const delay of [0, 5, 10, 20, 30]) {
  test(`backend owns ${delay}-second grace and requires running evidence`, () => {
    const f = fixture(delay); const start = f.now(); const attempt = f.launch().attempt;
    f.advance(8); assert.equal(f.s.snapshot.session.state, 'pending');
    f.submit(f.event(attempt)); f.advance(Math.max(0, delay - 8));
    assert.equal(f.s.snapshot.session.state, 'active');
    assert.equal(Date.parse(f.s.snapshot.session.billable_start_at), start + Math.max(delay, 8) * 1000);
  });
}
test('policy is required; zero survives validation; fixed decimal server arithmetic', () => {
  const sim = new Simulator(); assert.throws(() => sim.admin({ type: 'policy', policy: {} }));
  assert.equal(sim.admin({ type: 'policy', policy: policy(0) }).billing_start_delay_seconds, 0);
  assert.equal(amountFor(8, policy(0)).decimal_amount, '8.00');
  assert.equal(amountFor(61, { ...policy(0), hourly_rate_decimal: '6000.00', billing_unit_seconds: 60 }).decimal_amount, '200.00');
});
test('double click preserves response and distinct launch requests preserve first anchor', () => {
  const f = fixture(); const body = f.launchBody('test-game'), key = uuid();
  const first = f.sim.handle('launches', f.s, body, key);
  assert.deepEqual(f.sim.handle('launches', f.s, body, key), first);
  assert.throws(() => f.sim.handle('launches', f.s, { ...body, game_id: 'changed' }, key), /IDEMPOTENCY_CONFLICT/);
  f.advance(2); const second = f.launch('another');
  assert.equal(first.snapshot.session.session_id, second.snapshot.session.session_id);
  assert.equal(first.snapshot.session.grace_deadline_at, second.snapshot.session.grace_deadline_at);
  assert.equal(f.submit(f.event(first.attempt)).results[0].outcome, 'rejected');
});
test('policy changes affect subsequent sessions, never existing sessions', () => {
  const f = fixture(20); f.launch();
  f.sim.admin({ type: 'policy', policy: { ...policy(0), hourly_rate_decimal: '7200.00' } });
  assert.equal(f.s.policy.billing_start_delay_seconds, 20); assert.equal(f.s.policy.hourly_rate_decimal, '3600.00');
  f.sim.admin({ type: 'stop', station_id: f.s.id }); f.sim.admin({ type: 'resolve-enforcement', station_id: f.s.id });
  f.sim.admin({ type: 'authorize', station_id: f.s.id }); f.launch();
  assert.equal(f.s.policy.billing_start_delay_seconds, 0); assert.equal(f.s.policy.hourly_rate_decimal, '7200.00');
});
test('game exit and switching preserve paid session; cashier stop freezes its bill', () => {
  const f = fixture(0); const a = f.launch().attempt; f.submit(f.event(a)); f.advance(10);
  const sessionId = f.s.snapshot.session.session_id;
  f.submit(f.event(a, 'game_exited')); f.advance(5); f.launch('another-game');
  assert.equal(f.s.snapshot.session.state, 'active'); assert.equal(f.s.snapshot.session.session_id, sessionId);
  const ended = f.sim.admin({ type: 'stop', station_id: f.s.id }); f.jump(100);
  assert.deepEqual(f.sim.admin({ type: 'stop', station_id: f.s.id }).session, ended.session);
  assert.equal(f.s.snapshot.reassignable, false);
  assert.throws(() => f.sim.admin({ type: 'authorize', station_id: f.s.id }), /STATION_UNAVAILABLE/);
});
test('out-of-order process evidence never revives an exited game', () => {
  const f = fixture(); const a = f.launch().attempt; const running = f.event(a), exit = f.event(a, 'game_exited');
  f.submit(exit); assert.equal(f.submit(running).results[0].code, 'STALE_EVENT');
  f.advance(25); assert.equal(f.s.snapshot.session.state, 'pending');
});
test('duplicate cumulative observations reconcile maxima, never sum repeats', () => {
  const f = fixture(); const a = f.launch().attempt; const segment = uuid();
  const e = value => ({ api_version: '1', event_id: uuid(), station_id: f.s.id, session_id: a.session_id, boot_id: uuid(), sequence: value, observed_at: new Date(f.now()).toISOString(), monotonic_elapsed_ms: value * 1000, type: 'station_use_observed', segment_id: segment, segment_started_at: new Date(f.now()).toISOString(), observed_station_use_seconds: value, coverage: 'continuous' });
  const first = e(10), second = { ...e(20), boot_id: first.boot_id };
  f.submit(first); f.submit(second); assert.equal(f.submit(second).results[0].outcome, 'duplicate');
  assert.equal(Object.values(f.s.segments)[0].observed_station_use_seconds, 20);
});
test('pending expiry and offline gap revoke access without ending an active bill', () => {
  const pending = fixture(); pending.launch(); pending.jump(121); pending.sim.tick(); assert.equal(pending.s.snapshot.session.state, 'cancelled');
  const active = fixture(0); active.submit(active.event(active.launch().attempt)); active.heartbeat(); active.jump(30); active.heartbeat();
  assert.equal(active.s.snapshot.session.state, 'active'); assert.equal(active.s.snapshot.authorization, null);
  assert.equal(active.s.snapshot.restriction.failure_code, 'RECOVERY_REQUIRES_STAFF');
});
test('state reload retains session and stable request replay', () => {
  const f = fixture(); const body = f.launchBody('test-game'), key = uuid(); const first = f.sim.handle('launches', f.s, body, key);
  const restored = new Simulator(structuredClone(f.sim.data), f.now);
  assert.deepEqual(restored.handle('launches', restored.station(f.s.id), body, key), first);
});
