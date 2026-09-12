import type { ComponentType } from 'react';
import type { StationClient, StationState } from '../../../../packages/contracts/src/index.ts';
import type { SampleControls } from '../dev/sample-station.ts';
import type { NativeLauncher } from './native.ts';
import { nativeAdmin, type AdminApi } from './admin.ts';
import { createAgentStation } from './agent-station.ts';

export interface HostInfo {
  readonly shell: 'electron' | 'browser';
  readonly nativeLaunchAvailable: boolean;
}

export interface DevPanelProps {
  controls: SampleControls;
  state: StationState | null;
  nativeLaunch: boolean;
  onClose(): void;
}

/** Development-only sample controls and their panel. */
export interface DevTools {
  readonly controls: SampleControls;
  readonly Panel: ComponentType<DevPanelProps>;
  readonly Toggle: ComponentType<{ open: boolean; onToggle(): void }>;
}

export interface ConnectedStation {
  readonly client: StationClient;
  /** Null for a native station. */
  readonly dev: DevTools | null;
  readonly host: HostInfo;
  /** Staff-password-protected game list editor; null when no agent is reachable. */
  readonly admin: AdminApi | null;
  /** 'native': games really launch through the agent. 'simulated': nothing launches. */
  readonly launchMode: 'native' | 'simulated';
  /** A host problem the operator must see, e.g. the agent refusing its catalog. */
  readonly problem: string | null;
}

interface Bridge {
  hostInfo(): Promise<{ nativeLaunchAvailable: boolean; sampleMode?: boolean }>;
  native?: NativeLauncher;
}
declare global { interface Window { gamingHouse?: Bridge } }

async function hostInfo(): Promise<HostInfo> {
  try {
    const info = await window.gamingHouse?.hostInfo();
    if (info) return { shell: 'electron', nativeLaunchAvailable: info.nativeLaunchAvailable === true };
  } catch {
    // Bridge refused or missing: report a plain browser host.
  }
  return { shell: 'browser', nativeLaunchAvailable: false };
}

export async function connectStation(): Promise<ConnectedStation> {
  const host = await hostInfo();
  const info = await window.gamingHouse?.hostInfo().catch(() => null);
  const native = window.gamingHouse?.native;
  if (!__SAMPLE_BUILD__ || !info?.sampleMode) {
    return {
      client: createAgentStation(native), dev: null, host, launchMode: 'native', problem: null,
      admin: native ? nativeAdmin(native) : null,
    };
  }
  // Phases 2–3: the cashier and session are the development sample (the backend
  // arrives in Phase 4). It loads as a separate chunk; Phase 5 packaging excludes it.
  const dev = await import('../dev/index.ts');
  const tools = (controls: SampleControls): DevTools => ({ controls, Panel: dev.DevPanel, Toggle: dev.DevToggle });
  const admin = dev.createSampleAdmin();
  const { client, controls } = dev.createSampleStation({ catalog: admin.library });
  return { client, dev: tools(controls), host, launchMode: 'simulated', problem: null, admin: admin.api };
}
