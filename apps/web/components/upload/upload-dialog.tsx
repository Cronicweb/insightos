'use client';

import * as React from 'react';
import { Upload, ShieldCheck, X, Loader2, FileWarning } from 'lucide-react';
import type { Analysis } from '@/lib/types';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,.json,.ndjson,.parquet,.pq';

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
    async (file: File) => {
      setError(null);
      setStage('Preparing');
      try {
        // Loaded on demand so the 18 MB WASM runtime never touches the
        // critical path for visitors who only browse the demo datasets.
        const [{ ingestFile }, { analyseInBrowser }] = await Promise.all([
          import('@/lib/engine/ingest'),
          import('@/lib/engine'),
        ]);
        const ingest = await ingestFile(file, setStage);
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
              CSV, Excel, JSON or Parquet. The full engine runs on your machine.
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
              if (file && !busy) void handleFile(file);
            }}
            className={cn(
              'flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors',
              dragging ? 'border-accent bg-accent/[0.06]' : 'border-line bg-elevated',
            )}
          >
            {busy ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
                <p className="mt-3 text-[13px] font-semibold">{stage}</p>
                <p className="mt-1 text-xs text-subtle">
                  Profiling, KPI discovery, root cause, forecasting - all in this tab.
                </p>
              </>
            ) : (
              <>
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
                    if (file) void handleFile(file);
                    e.target.value = '';
                  }}
                />
              </>
            )}
          </div>

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
                upload, no server call and no storage - closing the tab destroys every byte. Columns
                that look like identifiers are detected and masked before anything is displayed.
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
