import { CircleCheck, Gamepad2, Heart, LoaderCircle, Play, Users } from 'lucide-react';
import type { LibraryGame } from '../../../../packages/contracts/src/index.ts';
import type { SessionDisplay } from '../station/display.ts';
import { Artwork } from './Artwork.tsx';
import type { Tone } from './labels.ts';

interface Props {
  game: LibraryGame;
  display: SessionDisplay;
  running: boolean;
  starting: boolean;
  favorite: boolean;
  onPlay(gameId: string): void;
  onToggleFavorite(gameId: string): void;
}

function eyebrow({ display, running, starting }: Props): [string, Tone] {
  if (running) return ['Now playing', 'ok'];
  if (starting) return ['Starting', 'warn'];
  if (display.canPlay) return ['Ready to play', 'accent'];
  if (display.phase === 'connecting') return ['Connecting', 'muted'];
  if (display.phase === 'waiting') return ['Waiting for cashier', 'muted'];
  return ['Featured', 'muted'];
}

export function FeaturedGame(props: Props) {
  const { game, display, running, starting, favorite, onPlay, onToggleFavorite } = props;
  const [label, tone] = eyebrow(props);
  return (
    <section className="hero" aria-label="Featured game">
      <Artwork game={game} variant="hero" />
      <div className="hero-body">
        <div className={`eyebrow ${tone}`}>{label}</div>
        <h2 className="hero-title">{game.title}</h2>
        <div className="hero-meta">
          <span>{game.category}</span>
          {game.multiplayer && <><span className="sep" /><span className="meta-tag"><Users aria-hidden="true" />Multiplayer</span></>}
          {game.controller && <><span className="sep" /><span className="meta-tag"><Gamepad2 aria-hidden="true" />Controller</span></>}
        </div>
        <div className="hero-actions">
          <button className="btn-play" disabled={!display.canPlay || running || starting} onClick={() => onPlay(game.game_id)}>
            {running ? <><CircleCheck aria-hidden="true" />Playing</>
              : starting ? <><LoaderCircle className="spin" aria-hidden="true" />Starting…</>
                : <><Play aria-hidden="true" />Play game</>}
          </button>
          <button className="btn-ghost" aria-pressed={favorite} onClick={() => onToggleFavorite(game.game_id)}
            aria-label={favorite ? `Remove ${game.title} from favorites` : `Add ${game.title} to favorites`}>
            <Heart aria-hidden="true" />
          </button>
        </div>
        {!display.canPlay && !running && !starting && display.playHint && <p className="hero-hint">{display.playHint}</p>}
      </div>
    </section>
  );
}
