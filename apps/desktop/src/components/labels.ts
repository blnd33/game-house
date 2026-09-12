import { Castle, Compass, Crosshair, Flag, Gamepad2, Puzzle, Swords, Trophy, type LucideIcon } from 'lucide-react';
import type { ConnectionState } from '../../../../packages/contracts/src/index.ts';

export type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'muted';

export const CONNECTION: Readonly<Record<ConnectionState, { text: string; short: string; tone: Tone }>> = {
  connecting: { text: 'Connecting to Padel House…', short: 'Connecting', tone: 'warn' },
  connected: { text: 'Connected to Padel House', short: 'Connected', tone: 'ok' },
  stale: { text: 'Connection to Padel House is unstable', short: 'Unstable', tone: 'warn' },
  disconnected: { text: 'Connection to Padel House lost', short: 'Offline', tone: 'danger' },
};

const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  action: Crosshair, sports: Trophy, racing: Flag, fighting: Swords, strategy: Castle, adventure: Compass, puzzle: Puzzle,
};

export const categoryIcon = (category: string): LucideIcon => CATEGORY_ICONS[category.toLowerCase()] ?? Gamepad2;
