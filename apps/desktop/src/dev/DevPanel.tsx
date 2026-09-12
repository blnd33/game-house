import { Wrench, X } from 'lucide-react';
import { useState } from 'react';
import type { ConnectionState, StationState } from '../../../../packages/contracts/src/index.ts';
import { SAMPLE_GRACE_OPTIONS, SAMPLE_LAUNCH_OUTCOMES, type SampleControls, type SampleSettings } from './sample-station.ts';

const OUTCOME_LABEL: Readonly<Record<SampleSettings['nextLaunch'], string>> = {
  succeeds: 'Game opens', timeout: 'Times out', not_installed: 'Not installed', login_required: 'Needs sign-in',
  process_unreliable: 'Detection unreliable', start_failed: 'Fails to start', communication_lost: 'Connection lost',
};
const CONNECTIONS: readonly ConnectionState[] = ['connected', 'stale', 'disconnected'];

export function DevToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button className="dev-toggle" aria-expanded={open} aria-controls="dev-panel" onClick={onToggle}
      title="Development controls (Ctrl+Shift+D)">
      <Wrench aria-hidden="true" />Simulated
    </button>
  );
}

// Development-only stand-in for the cashier and backend. Never rendered for a
// native station, and excluded from the player UI and installer.
export function DevPanel({ controls, state, onClose }: { controls: SampleControls; state: StationState | null; onClose(): void }) {
  const [settings, setSettings] = useState(controls.settings());
  const update = (patch: Partial<SampleSettings>) => { controls.update(patch); setSettings(controls.settings()); };
  const session = state?.snapshot?.snapshot.session;
  const live = session?.state === 'pending' || session?.state === 'active';
  const lockPending = state?.snapshot?.snapshot.restriction.state === 'pending';
  return (
    <aside id="dev-panel" className="dev" aria-label="Development controls">
      <button className="dev-close" aria-label="Close development controls" onClick={onClose}><X aria-hidden="true" /></button>
      <h2>Development controls</h2>
      <p className="dev-note">Sample cashier and backend for UI work. Not part of the player app or installer.</p>
      <fieldset>
        <legend>Cashier</legend>
        <div className="dev-row">
          <button className="dev-btn" onClick={() => controls.authorize()} disabled={live || lockPending || !state?.snapshot}>Authorize customer</button>
          <button className="dev-btn" onClick={() => controls.endSession()} disabled={!live}>End session</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Station</legend>
        <div className="dev-row">
          <button className="dev-btn" onClick={() => controls.closeGame()} disabled={!state?.running_game_ids.length}>Close running game</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Connection</legend>
        <div className="dev-row">
          {CONNECTIONS.map(value => (
            <button key={value} className="dev-btn" aria-pressed={state?.connection === value} onClick={() => controls.setConnection(value)}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="dev-field">Grace for the next session (sample backend policy)
        <select value={settings.graceSeconds} onChange={event => update({ graceSeconds: Number(event.target.value) })}>
          {SAMPLE_GRACE_OPTIONS.map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
        </select>
      </label>
      <label className="dev-field">Next launch
        <select value={settings.nextLaunch}
          onChange={event => update({ nextLaunch: SAMPLE_LAUNCH_OUTCOMES.find(o => o === event.target.value) ?? 'succeeds' })}>
          {SAMPLE_LAUNCH_OUTCOMES.map(outcome => <option key={outcome} value={outcome}>{OUTCOME_LABEL[outcome]}</option>)}
        </select>
      </label>
      <label className="dev-field">Station lock result
        <select value={settings.lockOutcome} onChange={event => update({ lockOutcome: event.target.value === 'failed' ? 'failed' : 'verified' })}>
          <option value="verified">Locks and verifies</option>
          <option value="failed">Fails</option>
        </select>
      </label>
      <label className="dev-check">
        <input type="checkbox" checked={settings.supplyAmount} onChange={event => update({ supplyAmount: event.target.checked })} />
        Backend sends a fictional charge (1,000 IQD)
      </label>
    </aside>
  );
}
