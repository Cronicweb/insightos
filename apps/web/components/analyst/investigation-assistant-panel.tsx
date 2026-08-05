'use client';

// InsightOS — Investigation Assistant panel (§29). The deliberately-visible "where the AI lives"
// surface. Proactively shows Observations, Suggested Investigations, and Templates derived from
// deterministic analytics. Clicking any item seeds the Investigation Graph via the facade — no typing.

import * as React from 'react';
import type { AnalystFacade } from '@/lib/ai';
import {
  generateObservations,
  generateSuggestions,
  generateTemplates,
  type DeterministicSummary,
  type Suggestion,
  type InvestigationTemplate,
} from '@/lib/ai';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge } from '@/components/ui/primitives';

export function InvestigationAssistantPanel({
  facade,
  summary,
  onSeeded,
}: {
  facade: AnalystFacade;
  summary: DeterministicSummary;
  onSeeded?: (nodeId: string, question: string) => void;
}) {
  const observations = React.useMemo(() => generateObservations(summary), [summary]);
  const suggestions = React.useMemo(() => generateSuggestions(summary), [summary]);
  const templates = React.useMemo(() => generateTemplates(summary), [summary]);

  const seed = (title: string, focus: Suggestion['focus']) => {
    // Start (or reuse) an investigation and create the first node from the clicked suggestion.
    if (!facade.getGraph()) facade.startInvestigation({ analysisKey: 'current', question: title, focus });
    const graph = facade.getGraph()!;
    const { nodeId } = facade.branch(graph.rootId, title, focus);
    onSeeded?.(nodeId, title);
  };

  const applyTemplate = (tpl: InvestigationTemplate) => {
    const first = tpl.steps[0];
    facade.startInvestigation({ analysisKey: 'current', question: first.question, focus: first.focus });
    const graph = facade.getGraph()!;
    let parent = graph.rootId;
    for (const step of tpl.steps.slice(1)) {
      parent = facade.branch(parent, step.question, step.focus).nodeId;
    }
    onSeeded?.(graph.rootId, first.question);
  };

  return (
    <Card aria-label="Insight Analyst">
      <CardHeader>
        <div>
          <CardTitle>Insight Analyst</CardTitle>
          <CardSubtitle>Proactive, evidence-grounded investigation guidance — this is where the AI lives.</CardSubtitle>
        </div>
        <Badge tone="accent">AI</Badge>
      </CardHeader>
      <CardBody className="space-y-5">
        {observations.length > 0 && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Observations · {observations.length} finding{observations.length === 1 ? '' : 's'}
            </p>
            <ul className="mt-2 space-y-1.5">
              {observations.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => seed(o.title, o.focus)}
                    title={o.rationale}
                    className="flex min-h-[44px] w-full items-center justify-between rounded-lg border border-line px-3 text-left text-sm hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    <span>{o.title}</span>
                    <span className="text-xs text-muted">Investigate →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Suggested investigations</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => seed(s.title, s.focus)}
                className="min-h-[44px] rounded-full border border-line px-3 text-sm hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                {s.title}
              </button>
            ))}
          </div>
        </section>

        {templates.length > 0 && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Investigation templates</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="min-h-[44px] rounded-lg border border-line p-3 text-left hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{t.description}</p>
                  <p className="mt-1 text-[11px] text-muted">{t.steps.length}-step graph</p>
                </button>
              ))}
            </div>
          </section>
        )}
      </CardBody>
    </Card>
  );
}
