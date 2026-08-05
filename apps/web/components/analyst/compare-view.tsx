'use client';

// InsightOS — Compare View (§21). Generic side-by-side diff with automatic highlighting.
// Renders any CompareResult (nodes / semantic / periods / SQL / recommendations).

import * as React from 'react';
import type { CompareResult, CompareRow } from '@/lib/ai';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<CompareRow['status'], 'neutral' | 'warning' | 'positive' | 'negative'> = {
  same: 'neutral',
  changed: 'warning',
  added: 'positive',
  removed: 'negative',
};

export function CompareView({
  result,
  labelA = 'A',
  labelB = 'B',
  onClose,
}: {
  result: CompareResult;
  labelA?: string;
  labelB?: string;
  onClose?: () => void;
}) {
  const changed = result.rows.filter((r) => r.status !== 'same').length;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Compare · {result.kind}</CardTitle>
          <CardSubtitle>
            {changed === 0 ? 'No differences' : `${changed} difference${changed === 1 ? '' : 's'} highlighted`}
          </CardSubtitle>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-line px-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            Close
          </button>
        )}
      </CardHeader>
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 pr-3 font-semibold">Field</th>
                <th className="py-2 pr-3 font-semibold">{labelA}</th>
                <th className="py-2 pr-3 font-semibold">{labelB}</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.field}
                  className={cn(
                    'border-t border-line align-top',
                    row.status === 'changed' && 'bg-warning/5',
                    row.status === 'added' && 'bg-positive/5',
                    row.status === 'removed' && 'bg-negative/5',
                  )}
                >
                  <td className="py-2 pr-3 font-medium">{row.field}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{row.a ?? '—'}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{row.b ?? '—'}</td>
                  <td className="py-2">
                    <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
