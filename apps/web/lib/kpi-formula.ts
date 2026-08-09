/**
 * One shared explanation of a KPI's arithmetic, so the hover text on the hero
 * metric and on a sidebar row can never drift apart. Selection only - every line
 * is copied from the KPI the engine already computed, nothing is invented here.
 */
import type { Kpi } from './types';
import { formatValue } from './format';

export function formulaTooltip(kpi: Kpi): string {
  const lines: string[] = [];
  if (kpi.formula) lines.push(`Formula: ${kpi.formula}`);
  lines.push(`Value: ${formatValue(kpi.value, kpi.unit)} (${kpi.period_label})`);
  if (kpi.previous_value != null) {
    lines.push(
      `Compared with: ${formatValue(kpi.previous_value, kpi.unit)} (${kpi.comparison_label})`,
    );
  }
  if (kpi.description) lines.push(kpi.description);
  return lines.join('\n');
}
