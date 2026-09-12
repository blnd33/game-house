import { CircleCheck, LoaderCircle } from 'lucide-react';
import type { LibraryGame } from '../../../../packages/contracts/src/index.ts';
import { Artwork } from './Artwork.tsx';

interface Props {
  game: LibraryGame;
  phase: 'requesting' | 'starting';
  sample: boolean;
  onHide(): void;
}

function Step({ state, children }: { state: 'done' | 'current' | 'todo'; children: string }) {
  return (
    <li className={`step ${state}`}>
      {state === 'done' ? <CircleCheck aria-hidden="true" /> : state === 'current'
        ? <LoaderCircle className="spin" aria-hidden="true" /> : <span className="step-dot" aria-hidden="true" />}
      {children}
    </li>
  );
}

export function LaunchOverlay({ game, phase, sample, onHide }: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="launch-title"
      onKeyDown={event => { if (event.key === 'Escape') onHide(); }}>
      <div className="dialog launch">
        <Artwork game={game} variant="cover" />
        <div>
          <div className="eyebrow warn">Starting</div>
          <h2 id="launch-title">{game.title}</h2>
          <ol className="steps" aria-live="polite">
            <Step state={phase === 'requesting' ? 'current' : 'done'}>Checking your session with Padel House</Step>
            <Step state={phase === 'starting' ? 'current' : 'todo'}>Opening the game</Step>
          </ol>
          {sample && <p className="sim-note">Simulated launch: no game actually opens in this build.</p>}
          <button className="btn-secondary" onClick={onHide} autoFocus>Keep browsing</button>
        </div>
      </div>
    </div>
  );
}
