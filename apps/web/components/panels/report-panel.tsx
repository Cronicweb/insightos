'use client';

import * as React from 'react';
import { FileText, Download, Sparkles } from 'lucide-react';
import type { ExecutiveReport } from '@/lib/types';
import { fixed, formatSignedPct } from '@/lib/format';
import { SectionLabel, Badge } from '../ui/primitives';
import { cn } from '@/lib/utils';

/** The board-ready summary. Composed from computed facts, never generated free-form. */
export function ReportPanel({ report }: { report: ExecutiveReport }) {
  const download = React.useCallback(() => {
    const md = toMarkdown(report);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.dataset.toLowerCase().replace(/\s+/g, '-')}-executive-report.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              <SectionLabel>Executive report</SectionLabel>
            </div>
            <h2 className="mt-2 max-w-3xl text-xl font-semibold leading-snug tracking-tight">
              {report.headline}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{report.period}</Badge>
              <Badge tone="neutral">vs {report.comparison}</Badge>
              <Badge tone="accent">Confidence {fixed(report.confidence * 100, 0)}%</Badge>
              <Badge tone={report.polished ? 'accent' : 'neutral'}>
                <Sparkles className="mr-1 inline h-3 w-3" />
                {report.polished ? 'LLM-polished wording' : 'Deterministic wording'}
              </Badge>
            </div>
          </div>
          <button
            onClick={download}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs font-medium hover:bg-elevated"
          >
            <Download className="h-3.5 w-3.5" />
            Markdown
          </button>
        </div>

        <div className="border-b border-line p-6">
          <p className="max-w-4xl text-[15px] leading-[1.75]">{report.summary}</p>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          {report.key_numbers.map((k) => (
            <div key={k.id} className="bg-surface p-5">
              <div className="text-2xs text-subtle">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight tabular">
                {k.formatted}
              </div>
              {k.delta_pct !== null ? (
                <div
                  className={cn(
                    'mt-1 text-xs font-semibold tabular',
                    k.favourable === false
                      ? 'text-negative'
                      : k.favourable === true
                        ? 'text-positive'
                        : 'text-muted',
                  )}
                >
                  {formatSignedPct(k.delta_pct)} vs {report.comparison}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {report.sections.map((s) => (
            <section
              key={s.id}
              className="rounded-2xl border border-line bg-surface p-6 shadow-card"
            >
              <h3 className="text-[15px] font-semibold tracking-tight">{s.title}</h3>
              <div className="mt-3 space-y-3">
                {s.paragraphs.map((p, i) => (
                  <p key={i} className="text-[14px] leading-[1.7] text-muted">
                    {p}
                  </p>
                ))}
              </div>
              {s.bullets.length ? (
                <ul className="mt-4 space-y-2 border-t border-line pt-4">
                  {s.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
            <SectionLabel>Limitations</SectionLabel>
            <ul className="mt-3 space-y-2.5">
              {report.limitations.map((item, i) => (
                <li key={i} className="flex gap-2.5 text-2xs leading-relaxed text-muted">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-warning" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-line pt-3 text-2xs text-subtle">
              Generated {new Date(report.generated_at).toLocaleString()} &middot; {report.domain}{' '}
              domain
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function toMarkdown(r: ExecutiveReport): string {
  const lines: string[] = [];
  lines.push(`# ${r.dataset} \u2014 Executive Report`, '');
  lines.push(`**${r.headline}**`, '');
  lines.push(
    `_${r.period} vs ${r.comparison} \u00b7 confidence ${fixed(r.confidence * 100, 0)}%_`,
    '',
  );
  lines.push('## Business Summary', '', r.summary, '');
  lines.push('## Key Numbers', '', '| Metric | Value | Change |', '| --- | ---: | ---: |');
  for (const k of r.key_numbers) {
    lines.push(
      `| ${k.label} | ${k.formatted} | ${
        k.delta_pct === null ? '\u2014' : formatSignedPct(k.delta_pct)
      } |`,
    );
  }
  lines.push('');
  for (const s of r.sections) {
    lines.push(`## ${s.title}`, '');
    for (const p of s.paragraphs) lines.push(p, '');
    for (const b of s.bullets) lines.push(`- ${b}`);
    if (s.bullets.length) lines.push('');
  }
  lines.push('## Limitations', '');
  for (const item of r.limitations) lines.push(`- ${item}`);
  lines.push('', `_Generated by InsightOS at ${r.generated_at}._`);
  return lines.join('\n');
}
