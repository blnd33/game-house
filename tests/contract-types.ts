import type { Schema } from '../packages/contracts/src/index.js';

function assertNarrowing(event: Schema<'StationEvent'>) {
  if (event.type === 'station_use_observed') {
    const rawSeconds: number = event.observed_station_use_seconds;
    // @ts-expect-error Financial amounts are not station observations.
    event.final_charge;
    return rawSeconds;
  }
  return event.attempt_id;
}
void assertNarrowing;
