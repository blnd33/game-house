import type { LibraryGame } from '../../../../packages/contracts/src/index.ts';

export type LibraryView = 'library' | 'favorites' | 'recent';
export type LibraryFilter = 'all' | 'multiplayer' | 'controller';

export interface LibraryQuery {
  readonly view: LibraryView;
  /** Applies to the library view only. */
  readonly category: string | null;
  readonly filter: LibraryFilter;
  readonly search: string;
  readonly favorites: ReadonlySet<string>;
  /** Most recent first. */
  readonly recent: readonly string[];
}

const normalize = (text: string) =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Word initials, so "gta" finds Grand Theft Auto V and "cs2" finds Counter-Strike 2. */
const initials = (title: string) =>
  normalize(title).split(' ').map(word => (/^\d+$/.test(word) ? word : word.charAt(0))).join('');

export function matchesSearch(game: LibraryGame, search: string): boolean {
  const terms = normalize(search).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${normalize(game.title)} ${normalize(game.category)}`;
  const acronym = initials(game.title);
  return terms.every(term => haystack.includes(term) || acronym.startsWith(term));
}

export function categoriesOf(games: readonly LibraryGame[]): string[] {
  return [...new Set(games.map(game => game.category))].sort((a, b) => a.localeCompare(b));
}

export function visibleGames(games: readonly LibraryGame[], query: LibraryQuery): LibraryGame[] {
  let list: LibraryGame[];
  if (query.view === 'recent') {
    const byId = new Map(games.map(game => [game.game_id, game]));
    list = query.recent.flatMap(id => byId.get(id) ?? []);
  } else if (query.view === 'favorites') {
    list = games.filter(game => query.favorites.has(game.game_id));
  } else {
    list = query.category === null ? [...games] : games.filter(game => game.category === query.category);
  }
  if (query.filter === 'multiplayer') list = list.filter(game => game.multiplayer);
  if (query.filter === 'controller') list = list.filter(game => game.controller);
  return list.filter(game => matchesSearch(game, query.search));
}
