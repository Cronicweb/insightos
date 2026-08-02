/**
 * Footer/status copy for the three ways InsightOS can be running. Kept out of
 * the page component so the distinction between "your file, in this tab" and
 * "our pre-computed demo" is a tested contract rather than an inline string.
 */
export type AppMode = 'local' | 'demo' | 'live';

export function resolveMode(opts: { uploaded: boolean; demo: boolean }): AppMode {
  if (opts.uploaded) return 'local';
  return opts.demo ? 'demo' : 'live';
}

const NOTICE: Record<AppMode, string> = {
  local: 'Local mode: your file was parsed, queried and analysed in this browser tab.',
  demo: 'Demo mode: rendering pre-computed engine output, no server required.',
  live: 'Live mode: connected to the InsightOS API.',
};

export function modeNotice(mode: AppMode): string {
  return NOTICE[mode];
}
