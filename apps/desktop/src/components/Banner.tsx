import { TriangleAlert, WifiOff, X } from 'lucide-react';
import type { ConnectionState, LaunchFailureReason } from '../../../../packages/contracts/src/index.ts';
import { LAUNCH_FAILURE_TEXT } from '../station/display.ts';

interface Props {
  connection: ConnectionState;
  /** A session exists, so the message must say it keeps running while offline. */
  hasSession: boolean;
  /** No backend state has ever arrived: this PC is not set up yet. */
  unconfigured: boolean;
  failure: { title: string; reason: LaunchFailureReason; billingNotStarted: boolean } | null;
  playError: boolean;
  onDismiss(): void;
}

/** One exceptional message at a time: connection first, then launch problems. */
export function Banner({ connection, hasSession, unconfigured, failure, playError, onDismiss }: Props) {
  if (connection === 'disconnected' || connection === 'stale') {
    return (
      <div className="banner warn" role="status">
        <WifiOff aria-hidden="true" />
        <span>
          {unconfigured
            ? <><strong>This PC is not set up yet.</strong> It has not been connected to Padel House, so no games are
              available. Staff need to finish setting it up.</>
            : hasSession
              ? <><strong>{connection === 'stale' ? 'Connection is unstable.' : 'Connection to Padel House lost.'}</strong>{' '}
                Your session continues. Times may be out of date, and new games can start once the connection is back.</>
              : <><strong>{connection === 'stale' ? 'Connection is unstable.' : 'Not connected to Padel House.'}</strong>{' '}
                You can browse games. Play works again once the connection is back.</>}
        </span>
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
