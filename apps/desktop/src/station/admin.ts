// Admin panel boundary. Staff unlock with the station password; the agent checks
// it and validates every change. The panel can only change this PC's game list:
// no prices, no sessions, no launch arguments, no commands.

export interface AdminGame {
  readonly game_id: string;
  readonly title: string;
  readonly artwork_asset: string | null;
  readonly category: string;
  readonly controller: boolean;
  readonly multiplayer: boolean;
  readonly enabled: boolean;
  readonly sort_order: number;
  readonly launch_type: 'steam' | 'executable';
  readonly status: 'ready' | 'disabled' | 'not_installed' | 'invalid';
  readonly problems: readonly string[];
  readonly missing: readonly string[];
  readonly warnings: readonly string[];
}

export interface AdminSteamApp {
  readonly app_id: string;
  readonly name: string;
  readonly fully_installed: boolean;
  readonly update_required: boolean;
  readonly candidate_executables: readonly string[];
}

export interface NewGame {
  readonly kind: 'steam' | 'executable';
  readonly game_id: string;
  readonly title: string;
  readonly category: string;
  readonly executable_names: readonly string[];
  readonly controller: boolean;
  readonly multiplayer: boolean;
  readonly timeout_seconds: number;
  readonly app_id?: string;
  readonly executable_path?: string;
}

export interface GameChange {
  readonly title?: string;
  readonly category?: string;
  readonly controller?: boolean;
  readonly multiplayer?: boolean;
  readonly enabled?: boolean;
}

export type AdminResult =
  | { readonly ok: true; readonly games: readonly AdminGame[] }
  | { readonly ok: false; readonly message: string; readonly problems?: readonly string[] };

export interface AdminApi {
  status(): Promise<{ password_set: boolean; locked_out_seconds: number }>;
  unlock(password: string): Promise<{ ok: true; token: string } | { ok: false; message: string }>;
  lock(token: string): Promise<void>;
  setPassword(token: string, next: string): Promise<{ ok: boolean; message?: string }>;
  games(token: string): Promise<AdminResult>;
  steam(token: string): Promise<{ steam_root: string | null; apps: readonly AdminSteamApp[] }>;
  add(token: string, game: NewGame): Promise<AdminResult>;
  update(token: string, gameId: string, change: GameChange): Promise<AdminResult>;
  remove(token: string, gameId: string): Promise<AdminResult>;
  reorder(token: string, gameIds: readonly string[]): Promise<AdminResult>;
  renameCategory(token: string, from: string, to: string): Promise<AdminResult>;
  /** Opens the Windows file picker; null when staff cancel. */
  pickGameFile(): Promise<string | null>;
}

type Bridge = {
  admin(message: Record<string, unknown>): Promise<Record<string, unknown>>;
  pickGameFile(): Promise<string | null>;
};

const message = (reply: Record<string, unknown>, fallback: string) =>
  typeof reply.message === 'string' ? reply.message : fallback;

function toResult(reply: Record<string, unknown>): AdminResult {
  if (reply.type === 'admin.games' && Array.isArray(reply.games)) return { ok: true, games: reply.games as AdminGame[] };
  if (reply.type === 'admin.rejected') {
    const reasons = [...(reply.problems as string[] ?? []), ...(reply.missing as string[] ?? [])];
    return { ok: false, message: reasons[0] ?? 'The change was refused.', problems: reasons };
  }
  return { ok: false, message: message(reply, 'The change was refused.') };
}

/** The real panel: every call goes to the station agent over the local pipe. */
export function nativeAdmin(bridge: Bridge): AdminApi {
  const send = (type: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
    bridge.admin({ type, ...body }).catch((error: unknown) =>
      ({ type: 'error', message: error instanceof Error ? error.message : 'The station agent is unavailable.' }));
  return {
    async status() {
      const reply = await send('admin.status');
      return {
        password_set: reply.password_set === true,
        locked_out_seconds: typeof reply.locked_out_seconds === 'number' ? reply.locked_out_seconds : 0,
      };
    },
    async unlock(password) {
      const reply = await send('admin.unlock', { password });
      return reply.type === 'admin.session' && typeof reply.token === 'string'
        ? { ok: true, token: reply.token }
        : { ok: false, message: message(reply, 'Wrong staff password.') };
    },
    async lock(token) { await send('admin.lock', { token }); },
    async setPassword(token, next) {
      const reply = await send('admin.set_password', { token, next_password: next });
      return reply.type === 'admin.state' ? { ok: true } : { ok: false, message: message(reply, 'The password was not changed.') };
    },
    games: async token => toResult(await send('admin.games', { token })),
    async steam(token) {
      const reply = await send('admin.steam', { token });
      return {
        steam_root: typeof reply.steam_root === 'string' ? reply.steam_root : null,
        apps: Array.isArray(reply.apps) ? reply.apps as AdminSteamApp[] : [],
      };
    },
    add: async (token, game) => toResult(await send('admin.add', { token, ...game })),
    update: async (token, gameId, change) => toResult(await send('admin.update', { token, game_id: gameId, ...change })),
    remove: async (token, gameId) => toResult(await send('admin.remove', { token, game_id: gameId })),
    reorder: async (token, gameIds) => toResult(await send('admin.reorder', { token, game_ids: [...gameIds] })),
    renameCategory: async (token, from, to) => toResult(await send('admin.rename_category', { token, from, to })),
    pickGameFile: () => bridge.pickGameFile(),
  };
}
