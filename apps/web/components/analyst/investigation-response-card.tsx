'use client';

// InsightOS — Insight Analyst response card (Phase 3, §15.1).
// Renders the fixed, labelled sections of an InvestigationResponse. NOT a chat bubble.

import * as React from 'react';
import type { InvestigationResponse } from '@/lib/ai';
import { Card, CardHeader, CardTitle, CardBody, Badge } from '@/components/ui/primitives';
import { AITracePanel } from './ai-trace-panel';
import { MarkdownText } from './markdown-text';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <div className="mt-1 text-sm">{children}</div>
    </section>
  );
}

export function InvestigationResponseCard({
  question,
  response,
  onRerunSql,
  onNext,
}: {
  question: string;
  response: InvestigationResponse;
  onRerunSql?: (sql: string) => void;
  onNext?: (q: string) => void;
}) {
  const [sql, setSql] = React.useState(response.sql?.sql ?? '');
  const toneForLevel = response.confidence.level === 'high' ? 'positive' : response.confidence.level === 'low' ? 'negative' : 'warning';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{question}</CardTitle>
        <Badge tone={toneForLevel}>{response.confidence.level} confidence</Badge>
      </CardHeader>
      <CardBody>
        <Section title="Summary"><MarkdownText text={response.summary} /></Section>

        <Section title="Evidence">
          <ul className="space-y-1">
            {response.evidence.map((e) => (
              <li key={e.id} className="flex justify-between gap-3">
                <span className="text-muted">{e.label}</span>
                <span className="font-medium">{String(e.value)}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Confidence">{response.confidence.basis}</Section>

        {response.supportingCharts.length > 0 && (
          <Section title="Supporting charts">
            <div className="flex flex-wrap gap-2">
              {response.supportingCharts.map((id) => (
                <Badge key={id} tone="neutral">
                  {id}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {response.sql && (
          <Section title="SQL">
            <textarea
              aria-label="Generated SQL"
              className="h-28 w-full rounded-lg border border-line bg-surface p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent/50"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(sql)}
                className="min-h-[44px] rounded-lg border border-line px-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => onRerunSql?.(sql)}
                className="min-h-[44px] rounded-lg bg-accent px-3 text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                Rerun locally
              </button>
            </div>
            {response.sql.notes.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-muted">
                {response.sql.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {response.statisticalTests.length > 0 && (
          <Section title="Statistical tests">
            <div className="flex flex-wrap gap-2">
              {response.statisticalTests.map((t) => (
                <Badge key={t} tone="accent">
                  {t}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {response.nextInvestigation.length > 0 && (
          <Section title="Suggested next investigation">
            <div className="flex flex-wrap gap-2">
              {response.nextInvestigation.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onNext?.(q)}
                  className="min-h-[44px] rounded-lg border border-line px-3 text-xs font-medium hover:bg-elevated focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  {q}
                </button>
              ))}
            </div>
          </Section>
        )}

        <AITracePanel trace={response.trace} />
      </CardBody>
    </Card>
  );
}
