import test from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryGame } from '../packages/contracts/src/index.ts';
import { categoriesOf, matchesSearch, visibleGames, type LibraryQuery } from '../apps/desktop/src/station/library.ts';

const game = (game_id: string, title: string, category: string, multiplayer: boolean, controller: boolean): LibraryGame =>
  ({ game_id, title, category, multiplayer, controller, artwork_asset: null });
const games = [
  game('cs2', 'Counter-Strike 2', 'Action', true, false),
  game('gta', 'Grand Theft Auto V', 'Action', true, true),
  game('fh5', 'Forza Horizon 5', 'Racing', true, true),
  game('solo', 'Pokémon Quest', 'Adventure', false, true),
];
const query = (patch: Partial<LibraryQuery> = {}): LibraryQuery =>
  ({ view: 'library', category: null, filter: 'all', search: '', favorites: new Set(), recent: [], ...patch });
const titles = (list: readonly LibraryGame[]) => list.map(g => g.title);

test('search ignores case, punctuation and accents, and matches title initials', () => {
  assert.ok(matchesSearch(games[0]!, 'counter strike'));
  assert.ok(matchesSearch(games[0]!, 'CS2'));
  assert.ok(matchesSearch(games[1]!, 'gta'));
  assert.ok(matchesSearch(games[3]!, 'pokemon'));
  assert.ok(matchesSearch(games[2]!, 'racing'), 'category words match');
  assert.ok(!matchesSearch(games[2]!, 'strike'));
  assert.equal(visibleGames(games, query({ search: '   ' })).length, games.length);
});

test('categories are unique and sorted', () => {
  assert.deepEqual(categoriesOf(games), ['Action', 'Adventure', 'Racing']);
});

test('views: category, favorites and most-recent-first history', () => {
  assert.deepEqual(titles(visibleGames(games, query({ category: 'Action' }))), ['Counter-Strike 2', 'Grand Theft Auto V']);
  assert.deepEqual(titles(visibleGames(games, query({ view: 'favorites', favorites: new Set(['fh5']) }))), ['Forza Horizon 5']);
  assert.deepEqual(titles(visibleGames(games, query({ view: 'recent', recent: ['solo', 'removed-game', 'cs2'] }))),
    ['Pokémon Quest', 'Counter-Strike 2'], 'unknown IDs are skipped, order kept');
});

test('filter chips combine with search', () => {
  assert.deepEqual(titles(visibleGames(games, query({ filter: 'controller' }))), ['Grand Theft Auto V', 'Forza Horizon 5', 'Pokémon Quest']);
  assert.deepEqual(titles(visibleGames(games, query({ filter: 'multiplayer', search: 'forza' }))), ['Forza Horizon 5']);
  assert.deepEqual(titles(visibleGames(games, query({ filter: 'multiplayer', search: 'pokemon' }))), []);
});
