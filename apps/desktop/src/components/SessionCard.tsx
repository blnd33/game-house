import { CircleCheck, Headset, LoaderCircle } from 'lucide-react';
import type { HelpStatus } from '../../../../packages/contracts/src/index.ts';
import type { Billable, SessionDisplay, SessionPhase } from '../station/display.ts';
import { formatBusinessTime, formatCountdown, formatDuration } from '../station/format.ts';
import type { Tone } from './labels.ts';

const PHASE: Readonly<Record<SessionPhase, [string, Tone]>> = {
  connecting: ['Connecting', 'muted'], waiting: ['No session', 'muted'], authorized: ['Ready', 'accent'],
  grace: ['Starting', 'warn'], active: ['Active', 'ok'], ended: ['Ended', 'muted'],
};

function billableView(billable: Billable, graceRemaining: number | null): { value: string; note: string; tone: '' | 'muted' | 'warn' } {
  switch (billable.kind) {
    case 'not_started':
      return { value: 'Not started', tone: 'muted',
        note: graceRemaining ? `Grace period ends in ${formatCountdown(graceRemaining)}` : 'Waiting for Padel House to confirm the game' };
    case 'counting': return { value: formatDuration(billable.seconds), note: 'Confirmed by Padel House', tone: '' };
    case 'stale': return { value: formatDuration(billable.seconds), note: 'Last confirmed — reconnecting', tone: 'warn' };
    case 'final': return { value: formatDuration(billable.seconds), note: 'Final, set by Padel House', tone: '' };
    case 'unknown': return { value: '—', note: 'Waiting for Padel House', tone: 'muted' };
    case 'none': return { value: '—', note: '', tone: 'muted' };
  }
}

interface Props {
  display: SessionDisplay;
  help: HelpStatus;
  sample: boolean;
  onRequestHelp(): void;
}

export function SessionCard({ display, help, sample, onRequestHelp }: Props) {
  const [label, tone] = PHASE[display.phase];
  const timed = display.phase === 'grace' || display.phase === 'active' || display.phase === 'ended';
  const billable = billableView(display.billable, display.graceRemainingSeconds);
  return (
    <section className="session" aria-label="Your session">
      <div className="session-head">
        <span>Your session</span>
        <span className="state"><span className={`dot ${tone}`} />{label}</span>
      </div>
      {!timed && (
        <p className="session-hint">
          {display.phase === 'authorized' ? 'Your session is authorized. Pick a game and press Play.'
            : display.phase === 'connecting' ? 'Connecting to Padel House…'
              : 'Ask the cashier to start your session. You can browse games while you wait.'}
        </p>
      )}
      {timed && (
        <>
          <div className="timer-label">Billable time</div>
          <div className={`timer ${billable.tone}`}>{billable.value}</div>
          <div className={`timer-note ${billable.tone === 'warn' ? 'warn' : ''}`}>{billable.note}</div>
          <dl className="session-rows">
            <dt>Station time</dt><dd>{display.stationSeconds === null ? '—' : formatDuration(display.stationSeconds)}</dd>
            {display.session && <><dt>Started</dt><dd>{formatBusinessTime(display.session.accepted_first_play_at)}</dd></>}
            {display.amount && <><dt>{display.amount.is_final ? 'Charge' : 'Estimated charge'}</dt><dd>{display.amount.display_text}</dd></>}
          </dl>
        </>
      )}
      {sample && <button className="help-btn" onClick={onRequestHelp} disabled={help === 'sending'}>
        {help === 'sending' ? <LoaderCircle className="spin" aria-hidden="true" />
          : help === 'requested' ? <CircleCheck aria-hidden="true" /> : <Headset aria-hidden="true" />}
        {help === 'sending' ? 'Sending…' : help === 'requested' ? 'Staff notified' : help === 'failed' ? 'Not sent — try again' : 'Request help'}
      </button>}
      <p className="help-note" aria-live="polite">
        {help === 'requested' ? `Someone is on the way. Your time keeps running.${sample ? ' (Simulated)' : ''}` : ''}
      </p>
    </section>
  );
}
