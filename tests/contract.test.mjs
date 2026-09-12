import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';
import { contract } from '../scripts/build-contract.mjs';
import { examples } from '../contracts/examples.mjs';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addKeyword({ keyword: 'discriminator', valid: true }); // oneOf performs validation; mapping is an OpenAPI annotation.
const schema = JSON.parse(JSON.stringify({ $id: 'https://gaming-house.invalid/contract', $defs: contract.components.schemas }).replaceAll('#/components/schemas/', '#/$defs/'));
ajv.addSchema(schema);
const validator = name => ajv.getSchema(`https://gaming-house.invalid/contract#/$defs/${name}`);

test('generated OpenAPI matches reviewed source', async () => {
  assert.deepEqual(JSON.parse(await readFile(new URL('../contracts/openapi.json', import.meta.url))), contract);
});
test('portable JSON examples match validated fixtures', async () => {
  assert.deepEqual(JSON.parse(await readFile(new URL('../contracts/examples.json', import.meta.url))), examples);
});
test('generated TypeScript matches OpenAPI', async () => {
  const expected = COMMENT_HEADER + astToString(await openapiTS(new URL('../contracts/openapi.json', import.meta.url)));
  assert.equal(await readFile(new URL('../packages/contracts/src/generated.ts', import.meta.url), 'utf8'), expected);
});
for (const [name, example] of Object.entries(examples)) {
  test(`contract accepts ${name}`, () => {
    const validate = validator(example.schema);
    assert.ok(validate(example.value), JSON.stringify(validate.errors));
  });
}
for (const field of ['hourly_rate', 'billing_start_delay_seconds', 'billable_seconds', 'final_charge', 'billable_start_at']) {
  test(`raw telemetry rejects financial authority field ${field}`, () => {
    assert.equal(validator('StationEvent')({ ...examples.stationUseObserved.value, [field]: 30 }), false);
  });
}
test('player launch request accepts game ID only, rejects shell input', () => {
  assert.equal(validator('LaunchRequest')({ ...examples.launchRequested.value, command: 'cmd.exe /c start game' }), false);
});
test('device telemetry cannot assert authoritative session transitions', () => {
  for (const type of ['session_active', 'cashier_session_ended', 'authorization_granted']) {
    assert.equal(validator('StationEvent')({ ...examples.gameRunning.value, type }), false);
  }
});
test('observation requires a boot identity and nonnegative cumulative duration', () => {
  const missing = structuredClone(examples.stationUseObserved.value);
  delete missing.boot_id;
  assert.equal(validator('StationEvent')(missing), false);
  assert.equal(validator('StationEvent')({ ...examples.stationUseObserved.value, observed_station_use_seconds: -1 }), false);
});
test('timestamps must use UTC Z and commands need session fencing', () => {
  assert.equal(validator('StationEvent')({ ...examples.gameRunning.value, observed_at: '2026-09-11T15:00:08+03:00' }), false);
  const missing = structuredClone(examples.restrictCommand.value);
  delete missing.station_epoch;
  assert.equal(validator('RestrictCommand')(missing), false);
});
test('no backend price settings or arbitrary command types in the device contract', () => {
  assert.equal('hourly_rate' in contract.components.schemas.StationConfig.properties, false);
  assert.equal('billing_start_delay_seconds' in contract.components.schemas.StationConfig.properties, false);
  assert.equal(validator('RestrictCommand')({ ...examples.restrictCommand.value, type: 'remote_shell' }), false);
});
test('backend display amount is valid only as server session state', () => {
  assert.ok(validator('SnapshotResponse')(examples.cashierSessionEnded.value));
  assert.equal(validator('StationEvent')({ ...examples.stationUseObserved.value, display_amount: examples.cashierSessionEnded.value.snapshot.session.display_amount }), false);
});
