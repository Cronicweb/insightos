'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { buildQuestionChips, type ChipSchema } from '@/lib/ai/question-chips';

/**
 * Renders the schema-derived question suggestions above the Ask box.
 *
 * Clicking a chip fills the input rather than submitting, so the user can edit
 * it first - a suggestion should be a starting point, not a command.
 */
export function QuestionChips({
  schema,
  onPick,
  disabled,
}: {
  schema: ChipSchema | undefined;
  onPick: (question: string) => void;
  disabled?: boolean;
}) {
  const chips = React.useMemo(() => buildQuestionChips(schema), [schema]);
  if (chips.length === 0) return null;

  return (
    <div className="rounded-xl border border-line bg-elevated/40 p-3">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-subtle">
        <Sparkles className="h-3 w-3" aria-hidden />
        Questions you can ask about this dataset
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="list">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="listitem"
            disabled={disabled}
            onClick={() => onPick(chip.question)}
            title={
              chip.columns.length
                ? `Grounded in: ${chip.columns.join(', ')}`
                : 'Answered from the quality and profile artifacts'
            }
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-xs text-muted transition hover:border-accent/40 hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60"
          >
            {chip.question}
          </button>
        ))}
      </div>
      <p className="mt-2 text-2xs text-subtle">
        Built from the columns this dataset actually has, so Strict Grounding will not suppress them.
      </p>
    </div>
  );
}
