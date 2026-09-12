export const BUSINESS_TIMEZONE = 'Asia/Baghdad';

const pad = (value: number) => String(value).padStart(2, '0');

/** Elapsed seconds as HH:MM:SS; hours may exceed 24. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** Remaining seconds as M:SS. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

const clock = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIMEZONE, hour: 'numeric', minute: '2-digit' });

/** Wall-clock time of a UTC instant in the venue's business timezone, e.g. "3:00 PM". */
export function formatBusinessTime(isoUtc: string): string {
  const ms = Date.parse(isoUtc);
  return Number.isNaN(ms) ? '—' : clock.format(ms).replace(/\s/g, ' ');
}
