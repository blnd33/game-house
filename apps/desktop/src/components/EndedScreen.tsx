import { LoaderCircle, Lock, ShieldAlert } from 'lucide-react';
import type { SessionDisplay } from '../station/display.ts';
import { formatDuration } from '../station/format.ts';

interface Props {
  display: SessionDisplay;
  stationLabel: string;
  sample: boolean;
}

export function EndedScreen({ display, stationLabel, sample }: Props) {
  const { billable, amount, restriction, stationSeconds } = display;
  return (
    <div className="lock" role="alertdialog" aria-modal="true" aria-labelledby="ended-title" aria-describedby="ended-text">
      <div className="lock-inner">
        <div className="brand lock-brand"><img src="./brand/gaming-house-logo.png" alt="Gaming House" draggable={false} /></div>
        <h1 id="ended-title">Session ended</h1>
        <p id="ended-text">Thanks for playing. Please see the cashier at the front desk.</p>
        <dl className="summary">
          <div><dt>Billable time</dt><dd>{billable.kind === 'final' ? formatDuration(billable.seconds) : '—'}</dd></div>
          <div><dt>Station time</dt><dd>{stationSeconds === null ? '—' : formatDuration(stationSeconds)}</dd></div>
          {amount && <div><dt>{amount.is_final ? 'Charge' : 'Estimated charge'}</dt><dd>{amount.display_text}</dd></div>}
        </dl>
        <div className={`lock-status ${restriction === 'failed' ? 'danger' : ''}`} role="status">
          {restriction === 'restricted' ? <><Lock aria-hidden="true" />{stationLabel} is locked</>
            : restriction === 'failed' ? <><ShieldAlert aria-hidden="true" />{stationLabel} could not lock automatically. Staff have been notified.</>
              : <><LoaderCircle className="spin" aria-hidden="true" />Locking {stationLabel}…</>}
        </div>
        {sample && <p className="sim-note">Simulated: this PC is not actually locked.</p>}
      </div>
    </div>
  );
}
