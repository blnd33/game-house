// The development sample stands in for the backend while the UI is built. These
// tests keep it honest: every snapshot it emits must satisfy the proposed
// contract, and its session behavior must follow docs/session-rules.md.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { contract } from '../scripts/build-contract.mjs';
import { createSampleStation, SAMPLE_TIMING } from '../apps/desktop/src/dev/sample-station.ts';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addKeyword({ keyword: 'discriminator', valid: true });
ajv.addSchema(JSON.parse(JSON.stringify({ $id: 'https://gaming-house.invalid/contract', $defs: contract.components.schemas })
  .replaceAll('#/components/schemas/', '#/$defs/')));
const validSnapshot = ajv.getSchema('https://gaming-house.invalid/contract#/$defs/SnapshotResponse');

const T0 = Date.parse('2026-09-11T12:00:00Z');

function harness(t) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
  t.after(() => mock.timers.reset());
  const clock = {
    wallMs: () => Date.now(), monoMs: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle),
  };
  const { client, controls } = createSampleStation({ clock });
  const states = [];
  client.subscribe(state => {
    if (state.snapshot) assert.ok(validSnapshot(state.snapshot), JSON.stringify(validSnapshot.errors));
    states.push(state);
  });
  const tick = ms => mock.timers.tick(ms);
  const now = () => states.at(-1);
  const session = () => now().snapshot?.snapshot.session ?? null;
  tick(SAMPLE_TIMING.connectMs);
  t.after(() => controls.dispose());
  return { client, controls, tick, now, session, states };
}
const launch = (h, gameId) => { h.client.play(gameId); h.tick(SAMPLE_TIMING.permitMs); h.tick(SAMPLE_TIMING.startMs); };

test('no Play before cashier authorization', async t => {
  const h = harness(t);
  await assert.rejects(h.client.play('rocket-league'), /AUTHORIZATION_REQUIRED/);
  await assert.rejects(h.client.play('not-a-catalog-game'), /GAME_NOT_ALLOWED/);
  assert.equal(h.session(), null);
});

test('one session and one grace anchor across double Play, a failure and a game switch', t => {
  const h = harness(t);
  h.controls.update({ graceSeconds: 20 });
  h.controls.authorize();
  h.client.play('rocket-league');
  h.client.play('rocket-league');
  h.tick(SAMPLE_TIMING.permitMs);
  const first = h.session();
  assert.equal(first.state, 'pending');
  h.controls.update({ nextLaunch: 'timeout' });
  h.tick(SAMPLE_TIMING.startMs);
  assert.equal(h.now().launch.phase, 'failed');
  h.controls.update({ nextLaunch: 'succeeds' });
  launch(h, 'f1-25');
  launch(h, 'tekken-8');
  const later = h.session();
  assert.equal(later.session_id, first.session_id);
  assert.equal(later.accepted_first_play_at, first.accepted_first_play_at);
  assert.equal(later.grace_deadline_at, first.grace_deadline_at);
  assert.equal(new Set(h.states.map(s => s.snapshot?.snapshot.session?.session_id).filter(Boolean)).size, 1);
});

test('paid start waits for the deadline and a confirmed running game', t => {
  const h = harness(t);
  h.controls.update({ graceSeconds: 5 });
  h.controls.authorize();
  launch(h, 'rocket-league'); // running 3 s after first Play
  assert.equal(h.session().state, 'pending');
  h.controls.closeGame();
  h.tick(10_000);
  assert.equal(h.session().state, 'pending', 'no game running at the deadline: no billing');
  launch(h, 'rocket-league');
  h.tick(1);
  const s = h.session();
  assert.equal(s.state, 'active');
  assert.ok(Date.parse(s.billable_start_at) >= Date.parse(s.grace_deadline_at));
  assert.equal(s.display_amount, null, 'no amount unless the backend chooses to supply one');
});

test('changing the grace policy only affects the next session', t => {
  const h = harness(t);
  h.controls.update({ graceSeconds: 20 });
  h.controls.authorize();
  launch(h, 'rocket-league');
  const firstPlay = Date.parse(h.session().accepted_first_play_at);
  h.controls.update({ graceSeconds: 5 });
  assert.equal(Date.parse(h.session().grace_deadline_at) - firstPlay, 20_000);
  h.controls.endSession();
  h.tick(SAMPLE_TIMING.lockMs);
  h.controls.authorize();
  launch(h, 'rocket-league');
  const next = h.session();
  assert.equal(Date.parse(next.grace_deadline_at) - Date.parse(next.accepted_first_play_at), 5_000);
  assert.equal(next.policy_version, 'sample-grace-5s');
});

test('closing games and losing connection never end the session', t => {
  const h = harness(t);
  h.controls.update({ graceSeconds: 0 });
  h.controls.authorize();
  launch(h, 'rocket-league');
  h.tick(1);
  assert.equal(h.session().state, 'active');
  h.controls.closeGame();
  h.controls.setConnection('disconnected');
  h.tick(120_000);
  h.controls.setConnection('connected');
  assert.equal(h.session().state, 'active');
  assert.ok(h.now().station_use.observed_seconds >= 120);
});

test('cashier end freezes totals; the next customer waits for enforcement to resolve', t => {
  const h = harness(t);
  h.controls.update({ graceSeconds: 0 });
  h.controls.authorize();
  launch(h, 'rocket-league');
  h.tick(30_000);
  h.controls.endSession();
  const ended = h.session();
  assert.equal(ended.state, 'ended');
  assert.equal(h.now().snapshot.snapshot.authorization, null);
  assert.equal(h.now().snapshot.snapshot.restriction.state, 'pending');
  h.controls.authorize();
  assert.equal(h.session()?.state, 'ended', 'no new customer while enforcement is pending');
  h.tick(SAMPLE_TIMING.lockMs);
  assert.equal(h.now().snapshot.snapshot.restriction.state, 'restricted');
  h.tick(60_000);
  assert.equal(h.session().billable_seconds_at_server_time, ended.billable_seconds_at_server_time);
  h.controls.authorize();
  h.tick(SAMPLE_TIMING.lockMs * 2);
  assert.equal(h.now().snapshot.snapshot.restriction.state, 'unrestricted');
  assert.equal(h.session(), null);
});

test('a failed lock is reported as failed, never as locked', t => {
  const h = harness(t);
  h.controls.update({ lockOutcome: 'failed' });
  h.controls.authorize();
  launch(h, 'rocket-league');
  h.controls.endSession();
  h.tick(SAMPLE_TIMING.lockMs);
  const restriction = h.now().snapshot.snapshot.restriction;
  assert.equal(restriction.state, 'failed');
  assert.equal(restriction.verified_at, null);
  assert.equal(h.now().snapshot.snapshot.reassignable, false);
});
