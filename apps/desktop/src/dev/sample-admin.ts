// DEVELOPMENT SAMPLE of the admin panel's backend, for building and testing the
// screens without a station agent. It imitates the agent's answers; the real
// password check, validation and saving all live in the agent.
import type { LibraryGame } from '../../../../packages/contracts/src/index.ts';
import type { AdminApi, AdminGame, AdminResult, GameChange, NewGame } from '../station/admin.ts';
import { SAMPLE_CATALOG } from './sample-catalog.ts';

export const SAMPLE_ADMIN_PASSWORD = 'padel-house';
const LOCKED = { ok: false as const, message: 'The admin panel is locked. Enter the staff password again.' };

/** The panel and the sample library share one list, so hiding or adding a game shows up for the player. */
export function createSampleAdmin(): { api: AdminApi; library(): readonly LibraryGame[] } {
  let password = SAMPLE_ADMIN_PASSWORD;
  let token: string | null = null;
  let failures = 0;
  let games: AdminGame[] = SAMPLE_CATALOG.map((game, index) => ({
    ...game, enabled: true, sort_order: index + 1, launch_type: 'steam' as const,
    status: 'ready' as const, problems: [], missing: [], warnings: [],
  }));

  const held = (candidate: string) => token !== null && candidate === token;
  const list = (): AdminResult => ({ ok: true, games: [...games].sort((a, b) => a.sort_order - b.sort_order) });
  const change = (candidate: string, apply: () => AdminResult | null): AdminResult => {
    if (!held(candidate)) return LOCKED;
    return apply() ?? list();
  };

  const api: AdminApi = {
    async status() { return { password_set: true, locked_out_seconds: failures >= 5 ? 60 : 0 }; },
    async unlock(candidate) {
      if (failures >= 5) return { ok: false, message: 'Too many wrong tries. Try again in 60 seconds.' };
      if (candidate !== password) { failures++; return { ok: false, message: 'Wrong staff password.' }; }
      failures = 0;
      token = `sample-${Math.random().toString(36).slice(2)}`;
      return { ok: true, token };
    },
    async lock(candidate) { if (held(candidate)) token = null; },
    async setPassword(candidate, next) {
      if (!held(candidate)) return { ok: false, message: LOCKED.message };
      if (next.length < 6) return { ok: false, message: 'The staff password must be 6-128 characters.' };
      password = next;
      token = null;
      return { ok: true };
    },
    async games(candidate) { return held(candidate) ? list() : LOCKED; },
    async steam(candidate) {
      return held(candidate)
        ? { steam_root: 'C:\\Sample\\Steam', apps: [
          { app_id: '252950', name: 'Sample Steam game', fully_installed: true, update_required: false, candidate_executables: ['SampleGame.exe'] },
          { app_id: '730', name: 'Second sample game', fully_installed: true, update_required: true, candidate_executables: ['Second.exe'] },
        ] }
        : { steam_root: null, apps: [] };
    },
    async add(candidate, game: NewGame) {
      return change(candidate, () => {
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(game.game_id)) {
          return { ok: false, message: 'The game ID must be lowercase letters, digits, dots, dashes or underscores.' };
        }
        if (games.some(existing => existing.game_id === game.game_id)) return { ok: false, message: 'That game ID is already used.' };
        if (game.executable_names.length === 0) return { ok: false, message: "Choose the game's process file, for example Game.exe." };
        games = [...games, {
          game_id: game.game_id, title: game.title, artwork_asset: null, category: game.category,
          controller: game.controller, multiplayer: game.multiplayer, enabled: true,
          sort_order: games.length + 1, launch_type: game.kind, status: 'ready', problems: [], missing: [], warnings: [],
        }];
        return null;
      });
    },
    async update(candidate, gameId, patch: GameChange) {
      return change(candidate, () => {
        if (!games.some(game => game.game_id === gameId)) return { ok: false, message: "That game is not in this PC's list." };
        games = games.map(game => (game.game_id === gameId
          ? { ...game, ...patch, status: (patch.enabled ?? game.enabled) ? 'ready' as const : 'disabled' as const }
          : game));
        return null;
      });
    },
    async remove(candidate, gameId) {
      return change(candidate, () => {
        games = games.filter(game => game.game_id !== gameId);
        return null;
      });
    },
    async reorder(candidate, gameIds) {
      return change(candidate, () => {
        const order = [...gameIds, ...games.map(game => game.game_id).filter(id => !gameIds.includes(id))];
        games = games.map(game => ({ ...game, sort_order: order.indexOf(game.game_id) + 1 }));
        return null;
      });
    },
    async renameCategory(candidate, from, to) {
      return change(candidate, () => {
        if (to.trim().length === 0 || to.length > 40) return { ok: false, message: 'A category name must be 1-40 characters.' };
        games = games.map(game => (game.category.toLowerCase() === from.toLowerCase() ? { ...game, category: to } : game));
        return null;
      });
    },
    async pickGameFile() { return 'C:\\Sample\\Games\\SampleGame.exe'; },
  };

  const library = () => [...games]
    .filter(game => game.enabled)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(({ game_id, title, artwork_asset, category, controller, multiplayer }) =>
      ({ game_id, title, artwork_asset, category, controller, multiplayer }));

  return { api, library };
}
