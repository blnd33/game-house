import type { ConnectionState } from '../../../../packages/contracts/src/index.ts';
import type { HostInfo } from '../station/connect.ts';
import { CONNECTION } from './labels.ts';

interface Props {
  connection: ConnectionState;
  host: HostInfo;
  sample: boolean;
  developmentBackend: boolean;
}

export function StatusBar({ connection, host, sample, developmentBackend }: Props) {
  const status = CONNECTION[connection];
  return (
    <footer className="statusbar">
      <span className={`dot ${status.tone}`} />
      <span>{developmentBackend ? `Development backend · ${connection}` : status.text}{sample && ' (simulated)'}</span>
      <span className="grow" />
      {sample && <span className="sim-text sim-detail">Sample games and session · no real launch, billing or lock</span>}
      {developmentBackend && <span className="sim-text sim-detail">Development session · Windows restriction disabled</span>}
      {host.shell === 'browser' && <span className="sim-text">Browser preview</span>}
      <span className="statusbar-brand">Gaming House</span>
    </footer>
  );
}
