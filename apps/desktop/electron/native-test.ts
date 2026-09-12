// The real launch chain on this Windows PC: protected catalog → agent over the
// local pipe → Electron launcher → process detection → exit. Driven by
// tests/native-launch.integration.mjs, which supplies an enrolled station whose
// session the development cashier has authorized (--config-dir and --pipe).
// Uses the stand-in test program: no real games, and Steam is never exercised.
// Results go to artifacts/native-test.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentClient, type AgentMessage } from './agent-client.js';
import { launchThroughAgent, type LaunchResult } from './native.js';

interface Check { name: string; passed: boolean; detail?: string }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

export async function runNativeTest(root: string, version: string): Promise<boolean> {
  const pipe = argument('--pipe');
  if (!pipe) {
    console.error('--native-test needs --pipe from tests/native-launch.integration.mjs; run: npm run test:native');
    return false;
  }
  const checks: Check[] = [];
  const launched = new Set<number>();
  const events: AgentMessage[] = [];
  const client = new AgentClient(pipe);
  client.on('event', (message: AgentMessage) => events.push(message));

  const expect = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const check = async (name: string, body: () => Promise<string | void>) => {
    try {
      const detail = await body();
      checks.push(detail ? { name, passed: true, detail } : { name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const mark = () => events.length;
  const waitFor = async (predicate: (m: AgentMessage) => boolean, what: string, timeoutMs: number, since: number) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = events.slice(since).find(predicate);
      if (found) return found;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const launch = async (gameId: string): Promise<LaunchResult> => {
    const result = await launchThroughAgent(client, gameId);
    if (result.ok && result.pid !== null) launched.add(result.pid);
    return result;
  };
  const attempt = (result: LaunchResult, state: string) => (m: AgentMessage) =>
    m.type === 'attempt' && result.ok && m.attempt_id === result.attempt_id && m.state === state;

  try {
    await check('desktop connects to the agent over the local pipe', async () => {
      const end = Date.now() + 15_000;
      let last: unknown = new Error('no attempt');
      while (Date.now() < end) {
        try { return `agent ${String((await client.connect(version)).agent_version)}`; } catch (error) { last = error; await sleep(250); }
      }
      throw last;
    });

    await check('catalog offers only games verified on this PC, without launch details', async () => {
      const reply = await client.request({ type: 'catalog.get' });
      const ids = (reply.games as { game_id: string }[]).map(g => g.game_id).sort();
      expect(JSON.stringify(ids) === '["crash-game","test-game","wrong-process"]', `catalog: ${JSON.stringify(ids)}`);
      expect(!JSON.stringify(reply).includes('GH.TestGame'), 'catalog exposed launch details');
    });

    await check('an authorized launch starts a real process that is confirmed running', async () => {
      const since = mark();
      const result = await launch('test-game');
      expect(result.ok && result.pid, `launch: ${JSON.stringify(result)}`);
      const running = await waitFor(attempt(result, 'running'), 'confirmation', 25_000, since);
      expect(result.ok && running.pid === result.pid, `detected pid ${String(running.pid)}, launched ${result.ok ? result.pid : '?'}`);
      await waitFor(m => m.type === 'running' && (m.game_ids as string[]).includes('test-game'), 'running list', 5000, since);
      return `pid ${String(running.pid)}, process started ${String(running.process_started_at)}`;
    });

    await check('closing the game is reported as a game exit', async () => {
      const since = mark();
      for (const pid of launched) { try { process.kill(pid); } catch { /* already gone */ } }
      await waitFor(m => m.type === 'game.exited' && m.game_id === 'test-game', 'game exit', 15_000, since);
      await waitFor(m => m.type === 'running' && (m.game_ids as string[]).length === 0, 'empty running list', 5000, since);
    });

    await check('a launch whose game process never appears times out honestly', async () => {
      const since = mark();
      const result = await launch('wrong-process');
      const failed = await waitFor(attempt(result, 'failed'), 'timeout', 25_000, since);
      expect(failed.reason === 'timeout', JSON.stringify(failed));
      return String(failed.diagnostic);
    });

    await check('a game that crashes while starting is reported as start_failed', async () => {
      const since = mark();
      const result = await launch('crash-game');
      const failed = await waitFor(attempt(result, 'failed'), 'start failure', 15_000, since);
      expect(failed.reason === 'start_failed', JSON.stringify(failed));
    });

    await check('a game whose files disappeared is refused as not installed', async () => {
      const result = await launch('gone-game');
      expect(!result.ok && result.reason === 'not_installed', JSON.stringify(result));
    });

    await check('malformed and unknown messages are rejected; the agent keeps serving', async () => {
      const since = mark();
      client.sendRaw('not json');
      client.sendRaw(JSON.stringify({ type: 'run.command', command: 'cmd.exe' }));
      client.sendRaw(JSON.stringify({ type: 'launch.begin', id: 'x', game_id: 'test-game', path: 'C:\\Windows\\System32\\cmd.exe' }));
      const end = Date.now() + 4000;
      while (events.slice(since).filter(m => m.type === 'error').length < 3 && Date.now() < end) await sleep(50);
      expect(events.slice(since).filter(m => m.type === 'error').length === 3, 'agent did not reject all three');
      expect((await client.request({ type: 'catalog.get' })).type === 'catalog', 'agent stopped serving');
    });
  } finally {
    client.close();
    for (const pid of launched) { try { process.kill(pid); } catch { /* already gone */ } }
  }

  const passed = checks.length > 0 && checks.every(c => c.passed);
  const artifacts = join(root, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, 'native-test.json'), JSON.stringify({
    passed,
    environment: 'Electron launcher + GamingHouse.Agent + development backend on this Windows PC; stand-in test program, no real games, no Steam',
    checks,
  }, null, 2));
  for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  console.log(passed ? `Native launch test passed (${checks.length} checks)` : 'Native launch test FAILED');
  return passed;
}
