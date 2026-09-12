import { useState, type CSSProperties } from 'react';
import type { LibraryGame } from '../../../../packages/contracts/src/index.ts';

// Approved local artwork lives at public/artwork/<asset>/{cover,hero}.jpg (see
// assets/README.md). Anything else, including a missing file, falls back to a
// placeholder that is visibly temporary. Remote images are never loaded.
const SAFE_ASSET = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HUES = [8, 24, 42, 150, 176, 196, 214, 236, 262, 286, 318, 340];

function hueFor(id: string): number {
  let hash = 0x811c9dc5; // FNV-1a: stable per game ID, well spread
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return HUES[hash % HUES.length] ?? 24;
}

export function Artwork({ game, variant }: { game: LibraryGame; variant: 'cover' | 'hero' }) {
  const asset = game.artwork_asset;
  const [failed, setFailed] = useState<string | null>(null);
  if (asset !== null && SAFE_ASSET.test(asset) && failed !== asset) {
    return <img className={`art art-${variant}`} src={`./artwork/${asset}/${variant}.jpg`} alt="" draggable={false}
      onError={() => setFailed(asset)} />;
  }
  return (
    <div className={`art art-${variant} art-placeholder`} style={{ '--hue': hueFor(game.game_id) } as CSSProperties} aria-hidden="true">
      <span className="art-title">{game.title}</span>
      <span className="art-tag">{variant === 'hero' ? 'Placeholder art' : 'Placeholder'}</span>
    </div>
  );
}
