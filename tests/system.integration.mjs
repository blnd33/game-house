import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startSimulator } from '../apps/backend-simulator/server.mjs';

function child(command, args, stdin) {
  const process = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; process.stdout.on('data', b => { output += b; }); process.stderr.on('data', b => { output += b; });
  process.stdin.end(stdin);
  const done = new Promise((resolve, reject) => { process.on('error', reject); process.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`Child exited ${code}: ${output}`))); });
  return { process, done, output: () => output };
}
test('real HTTP schemas and .NET agent lifecycle with synthetic observations, no games or restriction', { timeout: 90000 }, async () => {
  const root = resolve('artifacts/integration'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  const simulator = await startSimulator(join(directory, 'server'), 0);
  const base = `http://127.0.0.1:${simulator.port}`;
  const adminToken = await readFile(join(directory, 'server/admin-token'), 'utf8');
  const admin = async body => {
    const response = await fetch(`${base}/__dev`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Development-Token': adminToken }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  let probe;
  try {
    await admin({ type: 'policy', policy: { billing_start_delay_seconds: 0, hourly_rate_decimal: '3600.00', currency: 'IQD', billing_unit_seconds: 1, rounding_mode: 'up', minimum_charge_decimal: '0.00' } });
    const pair = await admin({ type: 'pair', label: 'PC-01' });
    const config = join(directory, 'station');
    const enrolled = child(resolve('services/station-agent/bin/Debug/net10.0-windows/GamingHouse.Agent.exe'), ['enroll', '--dev', '--api-url', `${base}/gaming/v1`, '--station-label', 'PC-01', '--config-dir', config], pair.pairing_code + '\n');
    await enrolled.done;
    const settings = JSON.parse(await readFile(join(config, 'station.json'), 'utf8'));
    await admin({ type: 'authorize', station_id: settings.station_id });
    const unauthorized = await fetch(`${base}/gaming/v1/stations/${settings.station_id}/snapshot`, { headers: { 'X-Request-ID': randomUUID() } });
    assert.equal(unauthorized.status, 401);
    probe = child('dotnet', ['run', '--project', 'tools/session-probe/GamingHouse.SessionProbe.csproj', '--', config]);
    let completed = false; const finished = probe.done.finally(() => { completed = true; }); finished.catch(() => {});
    const deadline = Date.now() + 50000;
    while (!probe.output().includes('ACTIVE_SYNTHETIC') && !completed && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    assert.ok(probe.output().includes('ACTIVE_SYNTHETIC'), probe.output());
    await admin({ type: 'stop', station_id: settings.station_id });
    const output = await finished;
    assert.match(output, /ENDED_RESTRICTION_HONESTLY_UNCONFIGURED/);
    const status = (await admin({ type: 'status' }))[0];
    assert.equal(status.snapshot.session.state, 'ended'); assert.equal(status.snapshot.reassignable, false);
    assert.equal(status.snapshot.restriction.state, 'failed');
    assert.ok(Object.keys(status.observed_segments).length > 0);
  } finally { probe?.process.kill(); await simulator.close(); }
});
