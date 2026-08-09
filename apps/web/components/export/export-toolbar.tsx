'use client';

import * as React from 'react';
import { Download, FileText, Image as ImageIcon, Printer } from 'lucide-react';
import type { Analysis } from '@/lib/types';
import { downloadAnalysisCsv, printReport } from '@/lib/export/report-export';
import { downloadAllPng } from '@/lib/export/png-export';

/**
 * One export control, reused by every panel that has something worth taking away.
 *
 * Each format answers a different need and none of them ships a renderer:
 *   CSV   - the figures, for someone who wants to check the arithmetic.
 *   PDF   - the browser's print pipeline against the print stylesheet.
 *   PNG   - the live chart SVG painted onto a canvas, for slides.
 *
 * `targetRef` points at the subtree whose charts should be exported, so the
 * button on the root-cause panel does not silently export the whole page.
 */
export function ExportToolbar({
  analysis,
  targetRef,
  label,
  showPng = true,
  className,
}: {
  analysis: Analysis;
  targetRef?: React.RefObject<HTMLElement>;
  /** Names the PNG files, e.g. "root-cause". */
  label: string;
  showPng?: boolean;
  className?: string;
}) {
  const [note, setNote] = React.useState<string | null>(null);

  const say = React.useCallback((message: string) => {
    setNote(message);
    window.setTimeout(() => setNote(null), 2600);
  }, []);

  const png = React.useCallback(async () => {
    try {
      // Without a scoped target the whole document is the panel, which is what
      // the brief's toolbar wants: every chart currently on screen.
      const scope = targetRef?.current ?? (typeof document === 'undefined' ? null : document.body);
      const count = await downloadAllPng(scope, `${analysis.dataset}-${label}`);
      say(count === 0 ? 'No chart on this panel to export as an image.' : `Saved ${count} image${count === 1 ? '' : 's'}.`);
    } catch (err) {
      say(err instanceof Error ? err.message : 'The image could not be created.');
    }
  }, [analysis.dataset, label, targetRef, say]);

  const BTN =
    'inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-semibold text-muted transition hover:border-accent/40 hover:text-accent';

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5 print:hidden">
        <button type="button" className={BTN} onClick={() => downloadAnalysisCsv(analysis)}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          CSV
        </button>
        <button type="button" className={BTN} onClick={() => printReport()} title="Opens the print dialog - choose 'Save as PDF'">
          <FileText className="h-3.5 w-3.5" aria-hidden />
          PDF
        </button>
        {showPng ? (
          <button type="button" className={BTN} onClick={() => void png()}>
            <ImageIcon className="h-3.5 w-3.5" aria-hidden />
            PNG
          </button>
        ) : null}
      </div>
      {note ? (
        <p className="mt-1 text-2xs text-subtle print:hidden" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** Print-only variant for panels too narrow for three buttons. */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => printReport()}
      className={className ?? 'inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-semibold text-muted hover:text-accent print:hidden'}
    >
      <Printer className="h-3.5 w-3.5" aria-hidden />
      Print / PDF
    </button>
  );
}
