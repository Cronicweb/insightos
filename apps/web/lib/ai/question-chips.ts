/**
 * "Questions you can ask" - built strictly from the columns the profiler found.
 *
 * Under Strict Grounding a question about a dimension the dataset does not have
 * is suppressed, which reads as the product being broken rather than as the user
 * having asked the wrong thing. The cure is not to loosen the guard: it is to
 * show, up front, the questions this particular dataset can actually answer.
 *
 * Every chip is a pure function of the schema, so a chip can never suggest a
 * column that does not exist, and the list changes with the dataset rather than
 * being a fixed demo script.
 */
/**
 * Structural view of the schema, so this module works with both the full
 * DatasetSchema and the trimmed AnalysisLike the analyst workspace carries.
 */
export interface ChipSchema {
  columns?: Array<{ name?: string }>;
  measures?: string[];
  dimensions?: string[];
  time_columns?: string[];
}

export interface QuestionChip {
  id: string;
  /** The exact text placed into the Ask box. */
  question: string;
  /** Columns this question is grounded in - shown as the chip's tooltip. */
  columns: string[];
}

/** Human-facing column name: "total_revenue_usd" reads better as "total revenue usd". */
function pretty(column: string): string {
  return column.replace(/[_-]+/g, ' ').trim();
}

function push(out: QuestionChip[], seen: Set<string>, question: string, columns: string[]): void {
  const key = question.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ id: `chip-${out.length}`, question, columns });
}

/**
 * Up to `limit` questions, ordered so the most answerable come first:
 * trend (needs a measure + a time column), then breakdown (measure + dimension),
 * then single-column questions, then always-safe dataset-level questions.
 */
export function buildQuestionChips(schema: ChipSchema | undefined, limit = 8): QuestionChip[] {
  const out: QuestionChip[] = [];
  const seen = new Set<string>();
  if (!schema) return out;

  const names = new Set(
    (schema.columns ?? [])
      .map((c) => c?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0),
  );
  const keep = (list: string[] | undefined) => (list ?? []).filter((c) => names.has(c));

  const measures = keep(schema.measures);
  const dimensions = keep(schema.dimensions);
  const times = keep(schema.time_columns);

  const m0 = measures[0];
  const m1 = measures[1];
  const d0 = dimensions[0];
  const d1 = dimensions[1];
  const t0 = times[0];

  if (m0 && t0) {
    push(out, seen, `How did ${pretty(m0)} change over ${pretty(t0)}?`, [m0, t0]);
  }
  if (m0 && d0) {
    push(out, seen, `Which ${pretty(d0)} contributes most to ${pretty(m0)}?`, [m0, d0]);
  }
  if (m0 && d1) {
    push(out, seen, `Break ${pretty(m0)} down by ${pretty(d1)}.`, [m0, d1]);
  }
  if (m1 && d0) {
    push(out, seen, `Compare ${pretty(m1)} across ${pretty(d0)}.`, [m1, d0]);
  }
  if (m1 && m0) {
    push(out, seen, `Is ${pretty(m0)} related to ${pretty(m1)}?`, [m0, m1]);
  }
  if (m0) {
    push(out, seen, `What is unusual about ${pretty(m0)}?`, [m0]);
  }
  if (t0 && m0) {
    push(out, seen, `What is the outlook for ${pretty(m0)}?`, [m0, t0]);
  }
  if (d0) {
    push(out, seen, `How is the data distributed across ${pretty(d0)}?`, [d0]);
  }
  // Always answerable: these read the quality and profile artifacts, not a column.
  push(out, seen, 'What data quality issues affect these conclusions?', []);
  push(out, seen, 'What can this dataset not tell me?', []);

  return out.slice(0, limit);
}
