import { TriangleAlert, WifiOff, X } from 'lucide-react';
import type { ConnectionState, LaunchFailureReason } from '../../../../packages/contracts/src/index.ts';
import { LAUNCH_FAILURE_TEXT } from '../station/display.ts';

interface Props {
  connection: ConnectionState;
  failure: { title: string; reason: LaunchFailureReason; billingNotStarted: boolean } | null;
  playError: boolean;
  onDismiss(): void;
}

/** One exceptional message at a time: connection first, then launch problems. */
export function Banner({ connection, failure, playError, onDismiss }: Props) {
  if (connection === 'disconnected' || connection === 'stale') {
    return (
      <div className="banner warn" role="status">
        <WifiOff aria-hidden="true" />
        <span><strong>{connection === 'stale' ? 'Connection is unstable.' : 'Connection to Padel House lost.'}</strong>{' '}
          Your session continues. Times may be out of date, and new games can start once the connection is back.</span>
      </div>
    );
  }
  if (!failure && !playError) return null;
  return (
    <div className="banner danger" role="alert">
      <TriangleAlert aria-hidden="true" />
      <span>
        {failure ? <><strong>{failure.title} didn’t start.</strong> {LAUNCH_FAILURE_TEXT[failure.reason]}
          {failure.billingNotStarted && ' Billable time has not started.'}</>
          : <><strong>The game couldn’t be started.</strong> Please ask staff for help.</>}
      </span>
      <button className="banner-close" aria-label="Dismiss message" onClick={onDismiss}><X aria-hidden="true" /></button>
    </div>
  );
}
