import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const [command, value] = process.argv.slice(2);
const directory = resolve(process.env.GH_SIM_DATA ?? 'artifacts/simulator');
let action;
if (command === 'policy') action = { type: 'policy', policy: JSON.parse(readFileSync(value, 'utf8')) };
else if (command === 'pair') action = { type: 'pair', label: value };
else if (command === 'status') action = { type: 'status' };
else if (['authorize', 'stop', 'resolve-enforcement', 'revoke'].includes(command)) action = { type: command, station_id: value };
else if (command === 'fault') action = { type: 'fault', seconds: Number(value) };
else { console.error('Development cashier: policy <json-file> | pair PC-01 | status | authorize <station-id> | stop <station-id> | resolve-enforcement <station-id> | revoke <station-id> | fault <seconds>'); process.exit(2); }
try {
  const response = await fetch('http://127.0.0.1:4317/__dev', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Development-Token': readFileSync(join(directory, 'admin-token'), 'utf8') }, body: JSON.stringify(action) });
  console.log(JSON.stringify(await response.json(), null, 2)); if (!response.ok) process.exitCode = 1;
} catch (error) { console.error(`Development simulator unavailable: ${error.message}`); process.exitCode = 1; }
