'use client';

import * as React from 'react';
import { BookOpen, Download, ShieldAlert, Wrench } from 'lucide-react';
import type { Analysis } from '@/lib/types';
import { Badge, SectionLabel } from '../ui/primitives';
import { downloadAnalysisCsv, printReport } from '@/lib/export/report-export';

/**
 * The portfolio view.
 *
 * Everything here is rendered from values the engine already computed, so the
 * case study can never drift from the analysis it describes. Rewriting the
 * findings by hand is how a portfolio ends up claiming something the numbers
 * stopped supporting three datasets ago.
 */
export function CaseStudyPanel({ analysis }: { analysis: Analysis }) {
  const study = analysis.case_study;
  const limits = analysis.limitations;

  if (!study && !limits) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-muted shadow-card">
        The case study is generated once the analysis completes.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {study ? (
        <>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
            <div className="flex flex-wrap items-start gap-3">
              <BookOpen className="mt-1 h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold tracking-tight text-fg">{study.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">{study.subtitle}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => downloadAnalysisCsv(analysis)}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-xs font-medium text-fg transition hover:border-accent/40 hover:text-accent"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download CSV
                </button>
                <button
                  type="button"
                  onClick={() => printReport()}
                  className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium text-accent transition hover:bg-accent/15"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download PDF
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {study.sections.map((s) => (
              <section key={s.id} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                <SectionLabel>{s.title}</SectionLabel>
                <p className="mt-3 text-sm leading-relaxed text-muted">{s.body}</p>
                {s.bullets.length ? (
                  <ul className="mt-3 space-y-2 border-t border-line pt-3">
                    {s.bullets.map((b, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-accent" />
              <SectionLabel>Technical skills demonstrated</SectionLabel>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {study.skills.map((g) => (
                <div key={g.group}>
                  <p className="text-2xs font-semibold uppercase tracking-wide text-subtle">{g.group}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {g.items.map((it) => (
                      <Badge key={it} tone="neutral">
                        {it}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {limits ? <LimitationsBlock limits={limits} /> : null}
    </div>
  );
}

function LimitationsBlock({ limits }: { limits: NonNullable<Analysis['limitations']> }) {
  return (
    <div className="rounded-2xl border border-warning/30 bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <ShieldAlert className="h-4 w-4 text-warning" />
        <h3 className="text-[15px] font-semibold tracking-tight">Analyst notes and limitations</h3>
      </div>

      <div className="space-y-5 px-5 py-5">
        <div>
          <SectionLabel>What this dataset is</SectionLabel>
          <p className="mt-2 text-sm leading-relaxed text-muted">{limits.what_this_is}</p>
        </div>

        {limits.what_this_is_not.length ? (
          <div>
            <SectionLabel>What it is not</SectionLabel>
            <ul className="mt-2 space-y-2">
              {limits.what_this_is_not.map((w, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {limits.cannot_conclude.length ? (
          <div>
            <SectionLabel>Claims this data cannot support</SectionLabel>
            <div className="mt-2 space-y-3">
              {limits.cannot_conclude.map((c) => (
                <div key={c.id} className="rounded-xl border border-line bg-elevated p-4">
                  <p className="text-xs font-semibold text-fg">{c.claim}</p>
                  <p className="mt-1.5 text-2xs leading-relaxed text-muted">{c.why}</p>
                  {c.required_data.length ? (
                    <div className="mt-2.5 border-t border-line pt-2.5">
                      <p className="text-2xs uppercase tracking-wide text-subtle">Data required</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.required_data.map((d) => (
                          <Badge key={d} tone="neutral">
                            {d}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {limits.caveats.length ? (
          <div>
            <SectionLabel>Caveats on the figures shown</SectionLabel>
            <ul className="mt-2 space-y-2">
              {limits.caveats.map((c, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-subtle" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
