import { Gamepad2, Heart, LoaderCircle, Play, Users } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import type { LibraryGame } from '../../../../packages/contracts/src/index.ts';
import { Artwork } from './Artwork.tsx';

interface CardProps {
  game: LibraryGame;
  selected: boolean;
  favorite: boolean;
  running: boolean;
  starting: boolean;
  canPlay: boolean;
  playHint: string | null;
  onSelect(gameId: string): void;
  onPlay(gameId: string): void;
  onToggleFavorite(gameId: string): void;
}

const GameCard = memo(function GameCard({ game, selected, favorite, running, starting, canPlay, playHint, onSelect, onPlay, onToggleFavorite }: CardProps) {
  return (
    <li className={`card${selected ? ' selected' : ''}`} aria-label={game.title}>
      <button className="card-hit" aria-label={`Show ${game.title}`} aria-pressed={selected} onClick={() => onSelect(game.game_id)} />
      <Artwork game={game} variant="cover" />
      <button className="fav" aria-pressed={favorite} onClick={() => onToggleFavorite(game.game_id)}
        aria-label={favorite ? `Remove ${game.title} from favorites` : `Add ${game.title} to favorites`}>
        <Heart aria-hidden="true" />
      </button>
      <div className="card-info">
        <div className="card-text">
          <div className="card-title" title={game.title}>{game.title}</div>
          <div className="card-status">
            <span className={`dot ${running ? 'accent' : 'ok'}`} />{running ? 'Playing' : 'Installed'}
            <span className="card-tags">
              {game.controller && <Gamepad2 role="img" aria-label="Controller supported" />}
              {game.multiplayer && <Users role="img" aria-label="Multiplayer" />}
            </span>
          </div>
        </div>
        <button className="play-round" aria-label={`Play ${game.title}`} disabled={!canPlay || running || starting}
          title={canPlay ? undefined : playHint ?? undefined} onClick={() => onPlay(game.game_id)}>
          {starting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
      </div>
    </li>
  );
});

interface GridProps extends Omit<CardProps, 'game' | 'selected' | 'favorite' | 'running' | 'starting'> {
  games: readonly LibraryGame[];
  selectedId: string | null;
  favorites: ReadonlySet<string>;
  runningIds: readonly string[];
  startingId: string | null;
  empty: ReactNode;
}

export function GameGrid({ games, selectedId, favorites, runningIds, startingId, empty, ...shared }: GridProps) {
  if (games.length === 0) return <div className="empty" role="status">{empty}</div>;
  return (
    <ul className="grid" aria-label="Games">
      {games.map(game => (
        <GameCard key={game.game_id} game={game} selected={game.game_id === selectedId} favorite={favorites.has(game.game_id)}
          running={runningIds.includes(game.game_id)} starting={game.game_id === startingId} {...shared} />
      ))}
    </ul>
  );
}
