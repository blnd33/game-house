// The real launch chain on this Windows PC, end to end: development backend →
// enrolled agent → protected catalog → cashier authorization → Electron launcher
// → Windows process detection → exit. It uses the stand-in test program only:
// no venue game and no Steam title has been launched or verified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import electron from 'electron';
import { startSimulator } from '../apps/backend-simulator/server.mjs';

const agentExe = resolve('services/station-agent/bin/Debug/net10.0-windows/GamingHouse.Agent.exe');
const testGame = resolve('tools/test-game/bin/Debug/net10.0/GH.TestGame.exe');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, args, stdin) {
  const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  if (stdin !== undefined) child.stdin.end(stdin); else child.stdin.end();
  const done = new Promise((ok, fail) => {
    child.on('error', fail);
    child.on('exit', code => (code === 0 ? ok(output) : fail(new Error(`${command} exited ${code}: ${output}`))));
  });
  return { child, done, output: () => output };
}

/** One short conversation on the agent's pipe, used before the desktop connects. */
async function openPipe(pipe, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let last = new Error('no attempt');
  while (Date.now() < end) {
    const socket = connect(`\\\\.\\pipe\\${pipe}`);
    try {
      await new Promise((ok, fail) => { socket.once('connect', ok); socket.once('error', fail); });
      return socket;
    } catch (error) {
      last = error;
      socket.destroy();
      await sleep(250); // the agent is still opening its pipe
    }
  }
  throw last;
}

async function pipeExchange(pipe, messages, matches, timeoutMs = 10_000) {
  const socket = await openPipe(pipe, timeoutMs);
  socket.setEncoding('utf8');
  const received = [];
  let buffer = '';
  socket.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try { received.push(JSON.parse(line)); } catch { /* ignore */ }
    }
  });
  try {
    for (const message of messages) socket.write(JSON.stringify(message) + '\n');
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = received.find(matches);
      if (found) return found;
      await sleep(100);
    }
    throw new Error(`no matching reply; saw ${JSON.stringify(received)}`);
  } finally {
    socket.destroy();
    await sleep(200); // let the agent release its single client slot
  }
}

test('real launch chain with the stand-in program: permit, start, detect, exit', { timeout: 300_000 }, async () => {
  const root = resolve('artifacts/integration');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'native-'));
  const config = join(directory, 'station');
  const simulator = await startSimulator(join(directory, 'server'), 0);
  const base = `http://127.0.0.1:${simulator.port}`;
  const adminToken = await readFile(join(directory, 'server/admin-token'), 'utf8');
  const admin = async body => {
    const response = await fetch(`${base}/__dev`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Development-Token': adminToken }, body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const pipe = `GamingHouse.Test.${randomUUID()}`;
  const setup = (...args) => spawnSync(agentExe, ['setup', ...args, '--config-dir', config, '--dev'], { encoding: 'utf8', windowsHide: true });
  const standIn = (id, exe, args, timeout, path = testGame) =>
    setup('add-exe', '--id', id, '--title', `Stand-in ${id}`, '--category', 'Test', '--path', path, '--exe', exe,
      '--timeout', String(timeout), ...args.flatMap(argument => ['--arg', argument]));
  let agent;
  let desktop;

  try {
    await admin({
      type: 'policy',
      policy: {
        billing_start_delay_seconds: 0, hourly_rate_decimal: '3600.00', currency: 'IQD',
        billing_unit_seconds: 1, rounding_mode: 'up', minimum_charge_decimal: '0.00',
      },
    });
    const pair = await admin({ type: 'pair', label: 'PC-01' });
    await run(agentExe, ['enroll', '--dev', '--api-url', `${base}/gaming/v1`, '--station-label', 'PC-01', '--config-dir', config],
      pair.pairing_code + '\n').done;
    const settings = JSON.parse(await readFile(join(config, 'station.json'), 'utf8'));

    // Protected setup refuses unsafe or absent targets, and accepts the stand-in profiles.
    assert.equal(standIn('missing', 'game.exe', [], 20, join(config, 'nowhere', 'game.exe')).status, 1, 'missing executable was accepted');
    assert.equal(standIn('script', 'game.exe', [], 20, resolve('tools/test-game/Program.cs')).status, 1, 'a non-.exe file was accepted');
    for (const [id, exe, args, timeout] of [
      ['test-game', 'GH.TestGame.exe', ['--exit-after', '90'], 20],
      ['wrong-process', 'NeverStarts.exe', ['--exit-after', '40'], 10],
      ['crash-game', 'NeverStarts.exe', ['--exit-after', '0', '--exit-code', '3'], 20],
    ]) {
      const result = standIn(id, exe, args, timeout);
      assert.equal(result.status, 0, `${id}: ${result.stdout}${result.stderr}`);
    }

    // A game whose files disappear after setup must stop being offered.
    const catalogPath = join(config, 'catalog.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    const gone = structuredClone(catalog.games.find(game => game.game_id === 'test-game'));
    gone.game_id = 'gone-game';
    gone.launch.executable_path = join(config, 'gone', 'game.exe');
    gone.launch.working_directory = join(config, 'gone');
    gone.detection.expected_install_root = join(config, 'gone');
    catalog.games.push(gone);
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    agent = spawn(agentExe, ['run', '--dev', '--config-dir', config, '--pipe', pipe], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let agentLog = '';
    agent.stderr.on('data', chunk => { agentLog += chunk; });
    agent.on('exit', code => { agentLog += `\nagent exited ${code}`; });

    // Play is denied until the cashier authorizes the station, even though the game is installed and approved.
    const denied = await pipeExchange(pipe, [
      { type: 'hello', protocol: 1, client: 'integration-test', version: '0' },
      { type: 'launch.begin', id: 'denied', game_id: 'test-game' },
    ], message => message.id === 'denied', 30_000);
    assert.equal(denied.type, 'error', `${JSON.stringify(denied)} ${agentLog}`);
    assert.equal(denied.code, 'authorization_required', JSON.stringify(denied));

    await admin({ type: 'authorize', station_id: settings.station_id });

    desktop = run(electron, ['apps/desktop/dist-electron/main.js', '--native-test', '--pipe', pipe]);
    await desktop.done.catch(error => { throw new Error(`${error.message}\nagent log:\n${agentLog}`); });
    const report = JSON.parse(await readFile(resolve('artifacts/native-test.json'), 'utf8'));
    const failed = report.checks.filter(check => !check.passed);
    assert.deepEqual(failed, [], `${JSON.stringify(failed, null, 2)}\nagent log:\n${agentLog}`);
    assert.equal(report.checks.length, 8);

    // The launches above never ended the paid session; only the cashier does.
    const status = (await admin({ type: 'status' }))[0];
    assert.equal(status.snapshot.session.state, 'active');
  } finally {
    desktop?.child.kill();
    agent?.kill();
    spawnSync('taskkill', ['/IM', 'GH.TestGame.exe', '/F'], { windowsHide: true }); // stand-ins only
    await simulator.close();
  }
});
