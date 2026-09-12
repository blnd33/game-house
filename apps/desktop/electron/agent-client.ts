import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { Duplex } from 'node:stream';
import { spawn } from 'node:child_process';

export const DEFAULT_PIPE = 'GamingHouse.Station.v1';
const MAX_BUFFER = 1024 * 1024;

export type AgentMessage = { readonly type: string; readonly id?: string | null; readonly [key: string]: unknown };

interface Waiter { resolve(message: AgentMessage): void; reject(error: Error): void; timer: NodeJS.Timeout }

/**
 * JSON-lines client for the station agent's local named pipe. Replies are matched
 * to requests by ID; everything else is emitted as an 'event'. Emits
 * 'disconnected' when the pipe closes.
 */
export class AgentClient extends EventEmitter {
  #socket: Duplex | null = null;
  #buffer = '';
  readonly #pending = new Map<string, Waiter>();

  constructor(readonly pipeName = DEFAULT_PIPE, readonly relayExecutable?: string) { super(); }

  get connected(): boolean { return this.#socket !== null; }

  async connect(version: string, timeoutMs = 3000): Promise<AgentMessage> {
    if (this.#socket) throw new Error('Agent is already connected.');
    const socket = await new Promise<Duplex>((resolve, reject) => {
      if (this.relayExecutable) {
        const relay = spawn(this.relayExecutable, ['relay', '--pipe', this.pipeName], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
        const channel = Duplex.from({ readable: relay.stdout, writable: relay.stdin });
        relay.once('spawn', () => resolve(channel)); relay.once('error', reject);
        relay.once('exit', () => channel.destroy()); channel.once('close', () => relay.kill());
        return;
      }
      const candidate = net.connect(`\\\\.\\pipe\\${this.pipeName}`);
      const timer = setTimeout(() => { candidate.destroy(); reject(new Error('Agent connection timed out.')); }, timeoutMs);
      candidate.once('connect', () => { clearTimeout(timer); resolve(candidate); });
      candidate.once('error', error => { clearTimeout(timer); reject(error); });
    });
    this.#socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', chunk => this.#receive(String(chunk)));
    socket.on('close', () => { if (this.#socket === socket) this.#closed(); });
    socket.on('error', () => { /* 'close' follows */ });
    return new Promise<AgentMessage>((resolve, reject) => {
      const timer = setTimeout(() => { this.off('event', onEvent); socket.destroy(); reject(new Error('The agent did not answer hello.')); }, timeoutMs);
      const onEvent = (message: AgentMessage) => {
        if (message.type !== 'welcome' && message.type !== 'error') return;
        clearTimeout(timer);
        this.off('event', onEvent);
        if (message.type === 'welcome') resolve(message);
        else { socket.destroy(); reject(new Error(String(message.message ?? 'Agent refused the connection.'))); }
      };
      this.on('event', onEvent);
      this.send({ type: 'hello', protocol: 1, client: 'gaming-house-desktop', version });
    });
  }

  request(message: Record<string, unknown>, timeoutMs = 10_000): Promise<AgentMessage> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error('The agent did not answer.')); }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.send({ ...message, id });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  send(message: Record<string, unknown>): void { this.sendRaw(JSON.stringify(message)); }

  /** Writes one line as-is. Used by tests to prove the agent rejects malformed input. */
  sendRaw(line: string): void {
    if (!this.#socket) throw new Error('The agent is not connected.');
    this.#socket.write(line + '\n');
  }

  close(): void { this.#socket?.destroy(); }

  #receive(chunk: string): void {
    this.#buffer += chunk;
    let index: number;
    while ((index = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, index);
      if (line.length > MAX_BUFFER) { this.close(); return; }
      this.#buffer = this.#buffer.slice(index + 1);
      this.#dispatch(line);
    }
    if (this.#buffer.length > MAX_BUFFER) this.close();
  }

  #dispatch(line: string): void {
    let message: unknown;
    try { message = JSON.parse(line); } catch { return; }
    if (typeof message !== 'object' || message === null || typeof (message as AgentMessage).type !== 'string') return;
    const typed = message as AgentMessage;
    const waiter = typeof typed.id === 'string' ? this.#pending.get(typed.id) : undefined;
    if (waiter && typeof typed.id === 'string') {
      clearTimeout(waiter.timer);
      this.#pending.delete(typed.id);
      waiter.resolve(typed);
    } else {
      this.emit('event', typed);
    }
  }

  #closed(): void {
    this.#socket = null;
    this.#buffer = '';
    for (const waiter of this.#pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('The agent disconnected.')); }
    this.#pending.clear();
    this.emit('disconnected');
  }
}
