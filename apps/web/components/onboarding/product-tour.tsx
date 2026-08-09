'use client';

import * as React from 'react';
import { X, ArrowRight, ArrowLeft, Compass } from 'lucide-react';

/**
 * A first-run explanation of the three ideas a new reader trips over: the
 * evidence tree, the six data-quality dimensions, and strict grounding.
 *
 * Deliberately not a spotlight-on-elements tour - element positions change with
 * the dataset and the viewport, and a tour that points at the wrong box is worse
 * than no tour. This is a plain, dismissible dialog; the "seen" flag lives in
 * localStorage so it never reappears, and the Help button re-opens it on demand.
 */

const SEEN_KEY = 'insightos.tour.v1';

interface Step {
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: 'Everything here is computed in your browser',
    body: (
      <>
        Your file is parsed and queried by DuckDB-WASM inside this tab. No row of
        your data is uploaded anywhere, which is why the app works offline and
        why closing the tab clears it.
      </>
    ),
  },
  {
    title: 'The Evidence Tree',
    body: (
      <>
        Every headline claim decomposes into the segments that caused it. A node
        shows the contribution of one slice of the data to the movement above it,
        so you can walk from &ldquo;revenue fell 8%&rdquo; down to the specific
        region or product that did it - each level re-derived from the table, not
        summarised by a model.
      </>
    ),
  },
  {
    title: 'The six data-quality dimensions',
    body: (
      <>
        Before any analysis runs, the profiler scores the dataset on completeness,
        validity, consistency, uniqueness, timeliness and accuracy. A low score
        does not block the analysis - it annotates it, so a conclusion drawn from
        a column that is 40% null says so.
      </>
    ),
  },
  {
    title: 'Strict grounding',
    body: (
      <>
        With strict grounding on, any number an AI answer states that cannot be
        traced to a computed fact is suppressed rather than shown. If your
        question named a column the dataset does not have, the reply now tells you
        exactly which one was missing. Turn it off in AI settings to see raw model
        output - clearly marked as ungrounded.
      </>
    ),
  },
];

export function ProductTour({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex items-start gap-3">
          <Compass className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
              Getting started &middot; {step + 1} of {STEPS.length}
            </p>
            <h2 id="tour-title" className="mt-1 text-base font-semibold tracking-tight">
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tour"
            className="rounded-lg p-1.5 text-muted transition-colors hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-muted">{current.body}</p>

        <div className="mt-5 flex items-center gap-2">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={
                  i === step
                    ? 'h-1.5 w-5 rounded-full bg-accent'
                    : 'h-1.5 w-1.5 rounded-full bg-line'
                }
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-2.5 py-2 text-[13px] text-muted transition-colors hover:text-fg"
          >
            Skip
          </button>
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] transition-colors hover:bg-elevated"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => (last ? onClose() : setStep((s) => s + 1))}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            {last ? 'Start exploring' : 'Next'}
            {last ? null : <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Remembers whether this browser has already seen the tour. */
export function useProductTour() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) !== '1') setOpen(true);
    } catch {
      // Private mode with storage disabled: simply never auto-open.
    }
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Ignore - the tour reopening once more is harmless.
    }
  }, []);

  const reopen = React.useCallback(() => setOpen(true), []);

  return { open, close, reopen };
}
