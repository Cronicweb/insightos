'use client';

// InsightOS — Decision Replay panel (§26). Replay a saved investigation workflow against the
// CURRENT dataset and show which concepts re-bound vs. remained unmapped. Deterministic-first:
// the panel shows the re-bound SQL; execution + old/new comparison run through the facade + engine.

import * as React from 'react';
import type { AnalystFacade, SerializedInvestigation } from '@/lib/ai';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge } from '@/components/ui/primitives';

export function DecisionReplayPanel({ facade }: { facade: AnalystFacade }) {
  const [raw, setRaw] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [plan, setPlan] = React.useState<{ reboundSql: Array<{ question: string; sql?: string }>; unmapped: string[] } | null>(null);

  const run = () => {
    setError(null);
    setPlan(null);
    let parsed: SerializedInvestigation;
    try {
      parsed = JSON.parse(raw) as SerializedInvestigation;
    } catch {
      setError('Invalid investigation JSON.');
      return;
    }
    try {
      setPlan(facade.planReplay(parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replay failed.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Decision Replay</CardTitle>
          <CardSubtitle>
            Replay a saved investigation against this dataset. Concepts re-bind to the current
            semantic model; unmapped concepts are reported, never guessed.
          </CardSubtitle>
        </div>
        <Badge tone="accent">§26</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        <label className="block text-xs text-muted">
          Serialized investigation (JSON)
          <textarea
            aria-label="Serialized investigation JSON"
            className="mt-1 h-28 w-full rounded-lg border border-line bg-surface p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent/50"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='{"version":"replay-v1","steps":[ ... ]}'
          />
        </label>
        <button
          type="button"
          onClick={run}
          className="min-h-[44px] rounded-xl bg-accent px-4 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          Plan replay
        </button>

        {error && <p className="text-sm text-negative">{error}</p>}

        {plan && (
          <div className="space-y-3">
            {plan.unmapped.length > 0 && (
              <div className="rounded-lg border border-negative/40 bg-negative/5 p-2 text-xs">
                <p className="font-semibold text-negative">Unmapped concepts (not in this dataset)</p>
                <p className="mt-1 text-muted">{plan.unmapped.join(', ')}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-muted">Re-bound steps</p>
              <ul className="mt-1 space-y-2">
                {plan.reboundSql.map((s, i) => (
                  <li key={i} className="rounded-lg border border-line p-2">
                    <p className="text-sm font-medium">{s.question}</p>
                    {s.sql ? (
                      <pre className="mt-1 overflow-x-auto rounded bg-elevated/50 p-2 font-mono text-xs">{s.sql}</pre>
                    ) : (
                      <p className="mt-1 text-xs text-muted">No SQL for this step.</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
