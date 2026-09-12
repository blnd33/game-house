import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { spawn } from 'node:child_process';
import { AgentClient, type AgentMessage } from './agent-client.js';
import { parseLaunchSpec, steamUri, type LaunchSpec } from './launch-spec.js';

const GAME_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FAILURE_REASONS = new Set(['timeout', 'not_installed', 'login_required', 'process_unreliable', 'start_failed', 'communication_lost']);

export type LaunchResult =
  | { readonly ok: true; readonly attempt_id: string; readonly pid: number | null }
  | { readonly ok: false; readonly reason: 'not_installed' | 'start_failed' | 'communication_lost'; readonly message: string };

/** Starts a validated plan in this process's (the player's) Windows session. Never uses a shell. */
export async function execute(spec: LaunchSpec, onExit: (pid: number, code: number) => void): Promise<number | null> {
  if (spec.type === 'steam') {
    await shell.openExternal(steamUri(spec), { activate: true });
    return null;
  }
  const child = spawn(spec.executable_path, [...spec.arguments], {
    cwd: spec.working_directory, detached: true, stdio: 'ignore', shell: false, windowsHide: false,
  });
  const pid = await new Promise<number>((resolve, reject) => {
    child.once('spawn', () => resolve(child.pid ?? -1));
    child.once('error', reject);
  });
  child.once('exit', code => onExit(pid, code ?? -1));
  child.unref();
  return pid;
}

/** Asks the agent for a plan, re-validates it, starts it, and reports the outcome. Detection stays with the agent. */
export async function launchThroughAgent(agent: AgentClient, gameId: string): Promise<LaunchResult> {
  if (!GAME_ID.test(gameId)) return { ok: false, reason: 'start_failed', message: 'Invalid game.' };
  let plan: AgentMessage;
  try {
    plan = await agent.request({ type: 'launch.begin', game_id: gameId });
  } catch {
    return { ok: false, reason: 'communication_lost', message: 'The station agent is not available.' };
  }
  if (plan.type === 'error') {
    return { ok: false, reason: plan.code === 'not_installed' ? 'not_installed' : 'start_failed', message: String(plan.message ?? '') };
  }
  if (plan.type !== 'launch.plan' || typeof plan.attempt_id !== 'string' || plan.game_id !== gameId ||
      typeof plan.permit_valid_for_milliseconds !== 'number' || plan.permit_valid_for_milliseconds <= 0 || plan.permit_valid_for_milliseconds > 20000) {
    return { ok: false, reason: 'start_failed', message: 'Unexpected reply from the station agent.' };
  }
  const attemptId = plan.attempt_id;
  const report = (message: Record<string, unknown>) => { try { agent.send(message); } catch { /* agent gone; attempt expires there */ } };
  let pid: number | null = null;
  try {
    pid = await execute(parseLaunchSpec(plan.spec), (child, code) =>
      report({ type: 'child.exited', attempt_id: attemptId, pid: child, exit_code: code }));
    report({ type: 'launch.started', attempt_id: attemptId, pid });
  } catch (error) {
    report({ type: 'launch.start_failed', attempt_id: attemptId, message: error instanceof Error ? error.message : 'Unknown error' });
    return { ok: false, reason: 'start_failed', message: 'The game could not be started.' };
  }
  return { ok: true, attempt_id: attemptId, pid };
}

/** Converts agent events into the small, display-safe events the renderer may see. */
export function rendererEvent(message: AgentMessage): Record<string, unknown> | null {
  const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 300) : null);
  switch (message.type) {
    case 'state':
      return message.state && typeof message.state === 'object' ? { type: 'state', state: message.state } : null;
    case 'attempt':
      if (typeof message.attempt_id !== 'string' || typeof message.game_id !== 'string' || typeof message.state !== 'string') return null;
      return {
        type: 'attempt', attempt_id: message.attempt_id, game_id: message.game_id, state: message.state,
        reason: typeof message.reason === 'string' && FAILURE_REASONS.has(message.reason) ? message.reason : null,
        diagnostic: text(message.diagnostic),
      };
    case 'running':
      return Array.isArray(message.game_ids)
        ? { type: 'running', game_ids: message.game_ids.filter((id): id is string => typeof id === 'string' && GAME_ID.test(id)) }
        : null;
    case 'game.exited':
      return typeof message.game_id === 'string' ? { type: 'game_exited', game_id: message.game_id } : null;
    default:
      return null;
  }
}

function catalogGames(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const g = item as Record<string, unknown>;
    const valid = typeof g === 'object' && g !== null && typeof g.game_id === 'string' && GAME_ID.test(g.game_id)
      && typeof g.title === 'string' && typeof g.category === 'string'
      && typeof g.controller === 'boolean' && typeof g.multiplayer === 'boolean'
      && (g.artwork_asset === null || (typeof g.artwork_asset === 'string' && GAME_ID.test(g.artwork_asset)));
    return valid ? [{
      game_id: g.game_id, title: (g.title as string).slice(0, 80), artwork_asset: g.artwork_asset,
      category: (g.category as string).slice(0, 40), controller: g.controller, multiplayer: g.multiplayer,
    }] : [];
  });
}

/** Connects to the agent (retrying while it starts) and exposes two narrow IPC calls to the renderer. */
export class NativeStation {
  readonly agent: AgentClient;
  #window: BrowserWindow | null = null;
  #reconnect: NodeJS.Timeout | null = null;

  constructor(pipeName: string, readonly version: string, relayExecutable?: string) {
    this.agent = new AgentClient(pipeName, relayExecutable);
    this.agent.on('event', (message: AgentMessage) => {
      const event = rendererEvent(message);
      if (event) this.#send(event);
    });
    this.agent.on('disconnected', () => {
      this.#send({ type: 'agent', connected: false });
      this.#scheduleReconnect();
    });
  }

  async start(waitMs: number): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    do {
      try {
        await this.agent.connect(this.version);
        if (this.#reconnect) { clearTimeout(this.#reconnect); this.#reconnect = null; }
        return true;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } while (Date.now() < deadline);
    this.#scheduleReconnect();
    return false;
  }

  attach(window: BrowserWindow, trusted: (event: IpcMainInvokeEvent) => boolean): void {
    this.#window = window;
    ipcMain.handle('native:state', async (event, ...args: unknown[]) => {
      if (!trusted(event) || args.length !== 0) throw new Error('IPC request rejected');
      const reply = await this.agent.request({ type: 'state.get' });
      if (reply.type !== 'state') throw new Error(String(reply.message ?? 'Station state unavailable.'));
      return reply.state;
    });
    ipcMain.handle('native:catalog', async (event, ...args: unknown[]) => {
      if (!trusted(event) || args.length !== 0) throw new Error('IPC request rejected');
      const reply = await this.agent.request({ type: 'catalog.get' });
      if (reply.type !== 'catalog') throw new Error(String(reply.message ?? 'The station catalog is unavailable.'));
      return catalogGames(reply.games);
    });
    ipcMain.handle('native:launch', async (event, ...args: unknown[]) => {
      if (!trusted(event) || args.length !== 1 || typeof args[0] !== 'string') throw new Error('IPC request rejected');
      const result = await launchThroughAgent(this.agent, args[0]);
      return result.ok ? { ok: true, attempt_id: result.attempt_id } : result; // the renderer never needs a PID
    });
  }

  #send(event: Record<string, unknown>): void {
    if (this.#window && !this.#window.isDestroyed()) this.#window.webContents.send('native:event', event);
  }

  #scheduleReconnect(): void {
    if (this.#reconnect || this.agent.connected) return;
    this.#reconnect = setTimeout(async () => {
      this.#reconnect = null;
      if (this.agent.connected) return;
      try {
        await this.agent.connect(this.version);
        this.#send({ type: 'agent', connected: true });
      } catch {
        this.#scheduleReconnect();
      }
    }, 2000);
  }
}
