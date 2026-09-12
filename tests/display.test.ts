import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConnectionState, LaunchStatus, Schema, StationState } from '../packages/contracts/src/index.ts';
import { deriveDisplay, EMPTY_STAMPS, nextStamps, type Stamps } from '../apps/desktop/src/station/display.ts';

const T0 = Date.parse('2026-09-11T12:00:00Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const RECEIVED = 5_000; // monotonic ms when snapshot and use reading arrived
const stamps: Stamps = { snapshotKey: 'k', snapshotAtMs: RECEIVED, useKey: 'u', useAtMs: RECEIVED };
const after = (seconds: number) => RECEIVED + seconds * 1000;

type Session = Schema<'Session'>;
const pending: Session = {
  session_id: '20000000-0000-4000-8000-000000000001', authorization_id: '30000000-0000-4000-8000-000000000001',
  station_epoch: 1, revision: 1, state: 'pending', policy_version: 'test-policy', accepted_first_play_at: at(0),
  grace_deadline_at: at(20), pending_expires_at: at(120), billable_start_at: null, ended_at: null,
  billable_seconds_at_server_time: null, display_amount: null,
};
const active: Session = { ...pending, revision: 2, state: 'active', billable_start_at: at(20), billable_seconds_at_server_time: 40 };
const amount: Schema<'Amount'> = { currency: 'IQD', decimal_amount: '1000', display_text: '1,000 IQD', is_final: true };

test('an active session without a lease or with failed enforcement cannot launch', () => {
  assert.equal(deriveDisplay(station({ session: active, lease: null }), stamps, after(1)).canPlay, false);
  assert.equal(deriveDisplay(station({ restriction: 'failed', lease: 100 }), stamps, after(1)).canPlay, false);
  assert.equal(deriveDisplay(station({ restriction: 'unknown', lease: 100 }), stamps, after(1)).canPlay, false);
});

interface Options {
  serverAt?: number;
  session?: Session | null;
  authorized?: boolean;
  restriction?: Schema<'Restriction'>['state'];
  lease?: number | null;
  connection?: ConnectionState;
  use?: number | null;
  launch?: LaunchStatus;
}

function station(o: Options = {}): StationState {
  return {
    source: 'sample', station_label: 'PC-01', connection: o.connection ?? 'connected', help: 'idle',
    launch: o.launch ?? { phase: 'idle' }, running_game_ids: [],
    station_use: o.use == null ? null : { observed_seconds: o.use, coverage: 'continuous' },
    snapshot: {
      api_version: '1', request_id: '80000000-0000-4000-8000-000000000001', station_id: '10000000-0000-4000-8000-000000000001',
      server_time: at(o.serverAt ?? 0),
      snapshot: {
        revision: 1, station_epoch: 1, session: o.session ?? null, reassignable: false,
        authorization: o.authorized === false ? null
          : { authorization_id: pending.authorization_id, station_epoch: 1, expires_at: at(600), opaque_ticket_reference: null },
        restriction: { state: o.restriction ?? 'unrestricted', command_id: null, verified_at: null, failure_code: null },
        authorized_play_until: o.lease == null ? null : at(o.lease),
      },
    },
  };
}

test('waiting: browsing only, Play blocked with a cashier hint', () => {
  const d = deriveDisplay(station({ authorized: false }), stamps, after(1));
  assert.equal(d.phase, 'waiting');
  assert.equal(d.canPlay, false);
  assert.match(d.playHint ?? '', /cashier/);
  assert.deepEqual(d.billable, { kind: 'none' });
});

test('authorized: Play allowed until the backend authorization expires', () => {
  assert.equal(deriveDisplay(station(), stamps, after(1)).canPlay, true);
  const expired = deriveDisplay(station(), stamps, after(601));
  assert.equal(expired.canPlay, false);
  assert.equal(expired.phase, 'waiting');
});

test('grace countdown follows the backend deadline and monotonic time, not the wall clock', t => {
  t.mock.method(Date, 'now', () => Date.parse('1999-01-01T00:00:00Z'));
  const d = deriveDisplay(station({ session: pending, use: 0 }), stamps, after(8));
  assert.equal(d.phase, 'grace');
  assert.equal(d.graceRemainingSeconds, 12);
  assert.deepEqual(d.billable, { kind: 'not_started' });
  assert.equal(d.stationSeconds, 8);
});

test('any backend delay renders from the snapshot alone, and zero is a real value', () => {
  for (const delay of [0, 5, 10, 20, 30]) {
    const d = deriveDisplay(station({ session: { ...pending, grace_deadline_at: at(delay) } }), stamps, after(3));
    assert.equal(d.graceRemainingSeconds, Math.max(0, delay - 3), `delay ${delay}`);
    assert.deepEqual(d.billable, { kind: 'not_started' }, `delay ${delay}`);
  }
});

test('active: Billable Time extrapolates the backend value; Station Time is separate', () => {
  const d = deriveDisplay(station({ serverAt: 60, session: active, lease: 120, use: 60 }), stamps, after(5));
  assert.equal(d.phase, 'active');
  assert.deepEqual(d.billable, { kind: 'counting', seconds: 45 });
  assert.equal(d.stationSeconds, 65);
});

test('billable display stops at the authorization lease and is marked stale offline', () => {
  const s = { serverAt: 60, session: active, lease: 90, use: 60 };
  assert.deepEqual(deriveDisplay(station(s), stamps, after(45)).billable, { kind: 'stale', seconds: 70 });
  const offline = deriveDisplay(station({ ...s, connection: 'disconnected' }), stamps, after(10));
  assert.deepEqual(offline.billable, { kind: 'stale', seconds: 50 });
  assert.equal(offline.phase, 'active', 'disconnection never ends the session');
  assert.equal(offline.canPlay, false);
  assert.match(offline.playHint ?? '', /Reconnecting/);
});

test('ended: totals freeze and the backend amount passes through untouched', () => {
  const ended: Session = { ...active, state: 'ended', ended_at: at(60), display_amount: amount };
  const d = deriveDisplay(station({ serverAt: 60, session: ended, restriction: 'restricted', use: 60, authorized: false }), stamps, after(300));
  assert.equal(d.phase, 'ended');
  assert.deepEqual(d.billable, { kind: 'final', seconds: 40 });
  assert.equal(d.stationSeconds, 60);
  assert.equal(d.amount, amount);
  assert.equal(d.canPlay, false);
});

test('no amount is ever derived from time', () => {
  const d = deriveDisplay(station({ serverAt: 60, session: active, lease: 600 }), stamps, after(3600));
  assert.equal(d.amount, null);
});

test('a pending restriction locks the UI even before the session snapshot updates', () => {
  const d = deriveDisplay(station({ session: active, restriction: 'pending', lease: 120 }), stamps, after(1));
  assert.equal(d.phase, 'ended');
  assert.equal(d.canPlay, false);
});

test('a launch in progress blocks a second Play; a failure leaves the session alone', () => {
  const busy = deriveDisplay(station({ launch: { phase: 'requesting', game_id: 'x' } }), stamps, after(1));
  assert.equal(busy.canPlay, false);
  const failed = deriveDisplay(station({ session: pending, launch: { phase: 'failed', game_id: 'x', reason: 'timeout' } }), stamps, after(1));
  assert.equal(failed.phase, 'grace');
  assert.equal(failed.canPlay, true, 'retry stays available under the same pending session');
  assert.deepEqual(failed.billable, { kind: 'not_started' });
});

test('a cancelled session is not presented as a session', () => {
  const d = deriveDisplay(station({ session: { ...pending, state: 'cancelled' }, authorized: false }), stamps, after(1));
  assert.equal(d.session, null);
  assert.equal(d.phase, 'waiting');
});

test('re-delivering the same snapshot does not restart elapsed time', () => {
  const s = station({ serverAt: 60, session: active, use: 60 });
  const first = nextStamps(EMPTY_STAMPS, s, 1000);
  const again = nextStamps(first, { ...s }, 9000);
  assert.equal(again.snapshotAtMs, 1000);
  assert.equal(again.useAtMs, 1000);
  const newer = station({ serverAt: 75, session: active, use: 75 });
  const moved = nextStamps(again, newer, 16_000);
  assert.equal(moved.snapshotAtMs, 16_000);
  assert.equal(moved.useAtMs, 16_000);
});
