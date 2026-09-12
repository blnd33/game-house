// SAMPLE DATA for UI development. This is not the venue's catalog: nothing here
// has been verified as installed on any Gaming House PC, and titles are only
// illustrative. Artwork is deliberately absent, so placeholder covers render.
import type { LibraryGame } from '../../../../packages/contracts/src/index.ts';

const game = (game_id: string, title: string, category: string, multiplayer: boolean, controller: boolean): LibraryGame =>
  ({ game_id, title, category, multiplayer, controller, artwork_asset: null });

export const SAMPLE_CATALOG: readonly LibraryGame[] = [
  game('counter-strike-2', 'Counter-Strike 2', 'Action', true, false),
  game('valorant', 'VALORANT', 'Action', true, false),
  game('ea-sports-fc-26', 'EA SPORTS FC 26', 'Sports', true, true),
  game('fortnite', 'Fortnite', 'Action', true, true),
  game('gta-v', 'Grand Theft Auto V', 'Action', true, true),
  game('rocket-league', 'Rocket League', 'Sports', true, true),
  game('forza-horizon-5', 'Forza Horizon 5', 'Racing', true, true),
  game('f1-25', 'F1 25', 'Racing', true, true),
  game('tekken-8', 'Tekken 8', 'Fighting', true, true),
  game('pubg', 'PUBG: Battlegrounds', 'Action', true, false),
  game('dota-2', 'Dota 2', 'Strategy', true, false),
  game('it-takes-two', 'It Takes Two', 'Adventure', true, true),
];
