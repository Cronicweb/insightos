'use client';

import * as React from 'react';
import {
  Upload,
  ShieldCheck,
  X,
  Loader2,
  FileWarning,
  ClipboardPaste,
  Link2,
  ArrowLeft,
  Table2,
} from 'lucide-react';
import type { Analysis } from '@/lib/types';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import {
  COLUMN_TYPES,
  DELIMITERS,
  isPreviewable,
  optionsFromPreview,
  previewText,
  readHead,
  type PreviewResult,
} from '@/lib/engine/preview';
import type { ColumnTypeOverride, IngestOptions } from '@/lib/engine/ingest';

/** Everything needed to re-run the preview without touching the file again. */
interface PendingPreview {
  file: File;
  /** Head of the file, decoded once. */
  text: string;
  result: PreviewResult;
  overrides: Record<string, ColumnTypeOverride>;
}

const KIND_LABEL: Record<PreviewResult['columns'][number]['kind'], string> = {
  numeric: 'Numeric',
  temporal: 'Date / time',
  boolean: 'Boolean',
  categorical: 'Categorical',
};

const KIND_TONE: Record<PreviewResult['columns'][number]['kind'], string> = {
  numeric: 'text-accent',
  temporal: 'text-positive',
  boolean: 'text-warning',
  categorical: 'text-subtle',
};

const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,.json,.ndjson,.parquet,.pq';

type Source = 'file' | 'paste' | 'url';

const SOURCES: { id: Source; label: string; icon: typeof Upload }[] = [
  { id: 'file', label: 'File', icon: Upload },
  { id: 'paste', label: 'Paste', icon: ClipboardPaste },
  { id: 'url', label: 'URL', icon: Link2 },
];

/**
 * Pasted text has no file name, so the extension - which is what the ingest
 * layer keys its reader off - is inferred from the text itself. Delimiter
 * sniffing still happens inside DuckDB; this only has to pick the right reader.
 */
function nameForPastedText(text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'pasted-data.json';
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  if (tabs > commas && tabs > semis) return 'pasted-data.tsv';
  return 'pasted-data.csv';
}

const CONTENT_TYPE_EXTENSION: [RegExp, string][] = [
  [/parquet/i, '.parquet'],
  [/(spreadsheetml|ms-excel)/i, '.xlsx'],
  [/(ndjson|x-jsonlines)/i, '.ndjson'],
  [/json/i, '.json'],
  [/(tab-separated|tsv)/i, '.tsv'],
  [/(csv|text\/plain)/i, '.csv'],
];

/**
 * A URL rarely ends in a tidy file name, so the last path segment is used when
 * it already carries a known extension and the response Content-Type is the
 * fallback. Anything else is rejected loudly rather than guessed at.
 */
function nameForRemote(url: string, contentType: string | null): string | null {
  let lastSegment = '';
  try {
    lastSegment = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    lastSegment = '';
  }
  const cleaned = lastSegment.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (/\.(csv|tsv|txt|xlsx|xlsm|json|ndjson|parquet|pq)$/i.test(cleaned)) return cleaned;

  const match = CONTENT_TYPE_EXTENSION.find(([pattern]) => pattern.test(contentType ?? ''));
  if (!match) return null;
  const base = cleaned.replace(/\.[^.]+$/, '') || 'remote-dataset';
  return `${base}${match[1]}`;
}

export function UploadDialog({
  open,
  onClose,
  onAnalysed,
}: {
  open: boolean;
  onClose: () => void;
  onAnalysed: (analysis: Analysis, label: string) => void;
}) {
  const [stage, setStage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [source, setSource] = React.useState<Source>('file');
  const [pasted, setPasted] = React.useState('');
  const [pending, setPending] = React.useState<PendingPreview | null>(null);
  const [url, setUrl] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const busy = stage !== null;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const handleFile = React.useCallback(
    async (file: File, options?: IngestOptions) => {
      setError(null);
      setPending(null);
      setStage('Preparing');
      try {
        // Loaded on demand so the 18 MB WASM runtime never touches the
        // critical path for visitors who only browse the demo datasets.
        const [{ ingestFile }, { analyseInBrowser }] = await Promise.all([
          import('@/lib/engine/ingest'),
          import('@/lib/engine'),
        ]);
        const ingest = await ingestFile(file, setStage, options);
        const analysis = await analyseInBrowser(ingest, setStage);
        onAnalysed(analysis, file.name);
        setStage(null);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStage(null);
      }
    },
    [onAnalysed, onClose],
  );

  /**
   * Delimited files get a preview step first: a wrong delimiter or a title row
   * above the header silently produces one giant text column, and the only
   * moment that is cheap to fix is before the table is built.
   *
   * Formats that carry their own schema (JSON, Parquet, xlsx) have nothing to
   * preview, so they go straight to ingest exactly as before.
   */
  const startFile = React.useCallback(
    async (file: File) => {
      setError(null);
      if (!isPreviewable(file.name)) {
        void handleFile(file);
        return;
      }
      try {
        const text = await readHead(file);
        const result = previewText(text);
        if (result.columns.length === 0) {
          void handleFile(file);
          return;
        }
        setPending({ file, text, result, overrides: {} });
      } catch {
        // A preview is a convenience, never a gate: fall back to direct ingest.
        void handleFile(file);
      }
    },
    [handleFile],
  );

  /** Re-parse the same text with changed settings - no file access needed. */
  const repreview = React.useCallback(
    (patch: { delimiter?: string; header?: boolean; skipRows?: number }) => {
      setPending((prev) => {
        if (!prev) return prev;
        const next = previewText(prev.text, {
          delimiter: patch.delimiter ?? prev.result.delimiter,
          header: patch.header ?? prev.result.header,
          skipRows: patch.skipRows ?? prev.result.skipRows,
        });
        // Overrides are keyed by column name, which a re-parse can change.
        const names = new Set(next.columns.map((c) => c.name));
        const overrides = Object.fromEntries(
          Object.entries(prev.overrides).filter(([k]) => names.has(k)),
        ) as Record<string, ColumnTypeOverride>;
        return { ...prev, result: next, overrides };
      });
    },
    [],
  );

  // Pasted text and remote responses are turned into a File and handed to the
  // exact same ingest path as a picked file, so there is one code path to trust.
  const handlePaste = React.useCallback(() => {
    const text = pasted.trim();
    if (!text) {
      setError('Paste some delimited text or JSON first.');
      return;
    }
    const name = nameForPastedText(pasted);
    void startFile(new File([pasted], name, { type: 'text/plain' }));
  }, [pasted, startFile]);

  const handleUrl = React.useCallback(async () => {
    const target = url.trim();
    if (!target) {
      setError('Enter the URL of a CSV, JSON, Parquet or Excel file.');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      setError('That is not a valid URL. Include the scheme, for example https://example.com/data.csv');
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      setError('Only http and https URLs can be fetched from the browser.');
      return;
    }

    setError(null);
    setStage('Fetching the dataset');
    let response: Response;
    try {
      response = await fetch(parsed.toString(), { mode: 'cors', redirect: 'follow' });
    } catch {
      // The fetch is made by this tab, so the host must allow cross-origin
      // reads. There is no server to proxy through by design.
      setStage(null);
      setError(
        'The browser could not fetch that URL. The host must allow cross-origin requests (CORS); InsightOS has no backend to proxy through. Download the file and use the File tab instead.',
      );
      return;
    }
    if (!response.ok) {
      setStage(null);
      setError(`The host responded with ${response.status} ${response.statusText || 'error'}.`);
      return;
    }

    const name = nameForRemote(parsed.toString(), response.headers.get('content-type'));
    if (!name) {
      setStage(null);
      setError(
        'Could not tell what format that URL returns. Use a link that ends in .csv, .tsv, .json, .ndjson, .parquet, .xlsx or .xlsm.',
      );
      return;
    }
    const blob = await response.blob();
    if (blob.size === 0) {
      setStage(null);
      setError('That URL returned an empty response.');
      return;
    }
    setStage(null);
    void startFile(new File([blob], name, { type: blob.type }));
  }, [url, startFile]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-title"
    >
      <div className="w-full max-w-xl rounded-t-2xl border border-line bg-surface shadow-card sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 id="upload-title" className="text-[15px] font-semibold">
              Analyse your own dataset
            </h2>
            <p className="mt-1 text-xs text-subtle">
              Drop a file, paste raw text or point at a URL. The full engine runs on your machine.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close upload dialog"
            className="rounded-lg border border-line p-2 text-subtle hover:bg-elevated disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {pending || busy ? null : (
          <div role="tablist" aria-label="Data source" className="mb-3 flex gap-1 rounded-xl border border-line bg-elevated p-1">
            {SOURCES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={source === id}
                disabled={busy}
                onClick={() => {
                  setSource(id);
                  setError(null);
                }}
                className={cn(
                  'flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors disabled:opacity-40',
                  source === id ? 'bg-surface text-ink shadow-card' : 'text-subtle hover:text-ink',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          )}

          {busy ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-elevated p-8 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <p className="mt-3 text-[13px] font-semibold">{stage}</p>
              <p className="mt-1 text-xs text-subtle">
                Profiling, KPI discovery, root cause, forecasting - all in this tab.
              </p>
            </div>
          ) : pending ? (
            <div className="rounded-xl border border-line bg-elevated p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <Table2 className="h-3.5 w-3.5 text-accent" aria-hidden />
                    Check the parse before analysing
                  </p>
                  <p className="mt-1 text-xs text-subtle">
                    {pending.file.name} &middot; {pending.result.columns.length} columns detected
                    {pending.result.truncated ? ' from the first 256 KB' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="flex items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs text-subtle hover:bg-surface"
                >
                  <ArrowLeft className="h-3 w-3" aria-hidden />
                  Back
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label htmlFor="preview-delimiter" className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
                    Delimiter
                  </label>
                  <select
                    id="preview-delimiter"
                    value={pending.result.delimiter}
                    onChange={(e) => repreview({ delimiter: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-[13px] text-ink outline-none focus:border-accent"
                  >
                    {DELIMITERS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="preview-skip" className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
                    Skip leading rows
                  </label>
                  <input
                    id="preview-skip"
                    type="number"
                    min={0}
                    max={50}
                    value={pending.result.skipRows}
                    onChange={(e) => repreview({ skipRows: Math.max(0, Number(e.target.value) || 0) })}
                    className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex min-h-[38px] w-full cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={pending.result.header}
                      onChange={(e) => repreview({ header: e.target.checked })}
                      className="h-4 w-4 accent-accent"
                    />
                    First row is the header
                  </label>
                </div>
              </div>

              {pending.result.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {pending.result.warnings.map((warning) => (
                    <li key={warning} className="text-xs text-warning">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-line bg-surface">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line">
                      <th className="p-2 font-semibold">Column</th>
                      <th className="p-2 font-semibold">Detected</th>
                      <th className="p-2 font-semibold">Read as</th>
                      <th className="p-2 font-semibold">Sample</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.result.columns.map((col) => (
                      <tr key={col.name} className="border-b border-line/60 last:border-0">
                        <td className="p-2 font-medium text-ink">{col.name}</td>
                        <td className={cn('p-2', KIND_TONE[col.kind])}>{KIND_LABEL[col.kind]}</td>
                        <td className="p-2">
                          <select
                            aria-label={`Type for ${col.name}`}
                            value={pending.overrides[col.name] ?? col.detected}
                            onChange={(e) =>
                              setPending((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      overrides: {
                                        ...prev.overrides,
                                        [col.name]: e.target.value as ColumnTypeOverride,
                                      },
                                    }
                                  : prev,
                              )
                            }
                            className="w-full rounded border border-line bg-elevated p-1 text-xs text-ink outline-none focus:border-accent"
                          >
                            {COLUMN_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2 font-mono text-subtle">
                          {col.samples.join('  ') || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-subtle">
                  {pending.result.rows.length.toLocaleString()} sample rows parsed. Types you change
                  here are enforced when the table is built.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void handleFile(
                      pending.file,
                      optionsFromPreview(pending.result, pending.overrides),
                    )
                  }
                  className="min-h-[44px] shrink-0 rounded-xl bg-accent px-4 text-[13px] font-semibold text-white hover:opacity-90"
                >
                  Analyse with these settings
                </button>
              </div>
            </div>
          ) : source === 'file' ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file && !busy) void startFile(file);
              }}
              className={cn(
                'flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors',
                dragging ? 'border-accent bg-accent/[0.06]' : 'border-line bg-elevated',
              )}
            >
              <Upload className="h-6 w-6 text-subtle" />
              <p className="mt-3 text-[13px] font-semibold">Drop a file here</p>
              <p className="mt-1 text-xs text-subtle">or</p>
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-3 min-h-[44px] rounded-xl bg-accent px-4 text-[13px] font-semibold text-white hover:opacity-90"
              >
                Choose a file
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void startFile(file);
                  e.target.value = '';
                }}
              />
            </div>
          ) : source === 'paste' ? (
            <div className="rounded-xl border border-line bg-elevated p-3">
              <label htmlFor="upload-paste" className="text-[13px] font-semibold">
                Paste rows of data
              </label>
              <p className="mt-1 text-xs text-subtle">
                CSV, TSV, semicolon-delimited text or JSON. Keep the header row - it names the columns.
              </p>
              <textarea
                id="upload-paste"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                spellCheck={false}
                rows={8}
                placeholder={'order_date,region,units,revenue\n2026-01-04,North,12,480.00\n2026-01-05,South,7,265.50'}
                className="mt-3 w-full resize-y rounded-lg border border-line bg-surface p-3 font-mono text-xs text-ink outline-none placeholder:text-subtle/70 focus:border-accent"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-subtle">
                  {pasted.trim()
                    ? `${pasted.trim().split(/\r?\n/).length.toLocaleString()} lines`
                    : 'Nothing pasted yet'}
                </p>
                <button
                  type="button"
                  onClick={handlePaste}
                  disabled={!pasted.trim()}
                  className="min-h-[44px] rounded-xl bg-accent px-4 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  Analyse pasted data
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-elevated p-3">
              <label htmlFor="upload-url" className="text-[13px] font-semibold">
                Fetch from a URL
              </label>
              <p className="mt-1 text-xs text-subtle">
                A direct link to a .csv, .tsv, .json, .ndjson, .parquet or .xlsx file. The host must
                allow cross-origin requests - the fetch happens in this tab, not on a server.
              </p>
              <input
                id="upload-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && url.trim()) void handleUrl();
                }}
                placeholder="https://example.com/sales.csv"
                className="mt-3 w-full rounded-lg border border-line bg-surface p-3 text-[13px] text-ink outline-none placeholder:text-subtle/70 focus:border-accent"
              />
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleUrl()}
                  disabled={!url.trim()}
                  className="min-h-[44px] rounded-xl bg-accent px-4 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  Fetch and analyse
                </button>
              </div>
            </div>
          )}

          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-negative/40 bg-negative/[0.06] p-3">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-negative" />
              <p className="text-xs text-negative">{error}</p>
            </div>
          ) : null}

          <div className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-elevated p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
            <div className="text-xs text-subtle">
              <p className="font-semibold text-ink">
                Your data never leaves your device. All analysis runs locally.
              </p>
              <p className="mt-1">
                The file is parsed by DuckDB compiled to WebAssembly inside this tab. There is no
                upload, no server call and no storage - closing the tab destroys every byte. A URL you
                supply is fetched by this tab directly and never sent anywhere else. Columns that look
                like identifiers are detected and masked before anything is displayed.
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="neutral">DuckDB WASM</Badge>
            <Badge tone="neutral">Apache Arrow</Badge>
            <Badge tone="neutral">Zero backend</Badge>
            <Badge tone="neutral">Up to ~500k rows</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
