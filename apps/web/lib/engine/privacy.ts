/**
 * Sensitive-field detection and masking.
 *
 * The browser engine never shows a raw identifier. Columns that look like
 * personal data are masked at the point of display, and the analysis is forced
 * to stay aggregate unless the user explicitly opts into drill-down.
 */
import type { ColumnProfile } from '@/lib/types';

export type SensitiveCategory =
  | 'email'
  | 'phone'
  | 'payment_card'
  | 'national_id'
  | 'address'
  | 'person_name'
  | 'account_id'
  | 'health';

export interface SensitiveField {
  column: string;
  category: SensitiveCategory;
  label: string;
  confidence: number;
  detected_by: 'name' | 'value' | 'name+value';
  strategy: 'hash' | 'redact' | 'partial' | 'bucket';
  sample_masked: string;
  rationale: string;
}

export interface PrivacyReport {
  enabled: boolean;
  fields: SensitiveField[];
  masked_columns: string[];
  aggregate_only: boolean;
  notice: string;
  categories: { category: SensitiveCategory; label: string; count: number }[];
}

const NAME_RULES: { re: RegExp; category: SensitiveCategory; label: string; strategy: SensitiveField['strategy'] }[] = [
  { re: /(e[-_]?mail)/i, category: 'email', label: 'Email address', strategy: 'partial' },
  { re: /(phone|mobile|msisdn|telephone|contact_no)/i, category: 'phone', label: 'Phone number', strategy: 'partial' },
  { re: /(card|pan|iban|acct_no|account_number|cvv)/i, category: 'payment_card', label: 'Payment card', strategy: 'partial' },
  { re: /(ssn|nino|aadhaar|passport|national_id|tax_id|pan_no)/i, category: 'national_id', label: 'National identifier', strategy: 'redact' },
  { re: /(address|street|postcode|zip|city_line|geo_point|lat$|lon$|latitude|longitude)/i, category: 'address', label: 'Address / location', strategy: 'bucket' },
  { re: /(first_name|last_name|full_name|customer_name|patient_name|employee_name|^name$)/i, category: 'person_name', label: 'Person name', strategy: 'hash' },
  { re: /(customer_id|member_id|patient_id|employee_id|user_id|account_id|merchant_id|client_id)/i, category: 'account_id', label: 'Account identifier', strategy: 'hash' },
  { re: /(diagnosis|icd|condition|treatment|procedure_code|medication)/i, category: 'health', label: 'Health attribute', strategy: 'bucket' },
];

const VALUE_RULES: { re: RegExp; category: SensitiveCategory; label: string; strategy: SensitiveField['strategy'] }[] = [
  { re: /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i, category: 'email', label: 'Email address', strategy: 'partial' },
  { re: /^(\+?\d[\d\s-]{8,15})$/, category: 'phone', label: 'Phone number', strategy: 'partial' },
  { re: /^(\d{4}[ -]?){3}\d{4}$/, category: 'payment_card', label: 'Payment card', strategy: 'partial' },
  { re: /^\d{3}-\d{2}-\d{4}$/, category: 'national_id', label: 'National identifier', strategy: 'redact' },
];

/** Deterministic, non-reversible short hash - enough to keep rows distinguishable. */
export function pseudonymise(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7);
}

export function maskValue(value: unknown, strategy: SensitiveField['strategy']): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (!raw) return '';
  switch (strategy) {
    case 'redact':
      return '•'.repeat(Math.min(raw.length, 10));
    case 'partial': {
      if (raw.includes('@')) {
        const [user, domain] = raw.split('@');
        return `${user.slice(0, 1)}•••@${domain}`;
      }
      return raw.length <= 4 ? '••••' : `••••${raw.slice(-4)}`;
    }
    case 'bucket':
      return `${raw.slice(0, 2).toUpperCase()}•••`;
    case 'hash':
    default:
      return `ID-${pseudonymise(raw)}`;
  }
}

/**
 * Value-shape rules only make sense on free text and identifiers.
 *
 * Running them over a date column is how `2026-01-03` ends up flagged as a
 * phone number: it is a digit followed by nine characters of digits and
 * hyphens, which is exactly what a loose phone pattern accepts. Dates,
 * numbers and booleans are therefore never value-scanned - their semantics
 * are already known from profiling.
 */
const VALUE_SCANNABLE: ColumnProfile['semantic_type'][] = ['identifier', 'categorical', 'text'];

/** ISO-8601-ish date shapes that must never be mistaken for personal data. */
const DATE_SHAPE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([T ]|$)|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/;

export function detectSensitiveFields(columns: ColumnProfile[]): PrivacyReport {
  const fields: SensitiveField[] = [];

  for (const col of columns) {
    const byName = NAME_RULES.find((r) => r.re.test(col.name));
    const samples = col.sample_values.map((v) => String(v ?? '')).filter(Boolean);
    const scannable =
      VALUE_SCANNABLE.includes(col.semantic_type) && !samples.some((s) => DATE_SHAPE.test(s));
    const byValue = !scannable
      ? undefined
      : VALUE_RULES.find(
          (r) => samples.length > 0 && samples.filter((s) => r.re.test(s)).length / samples.length >= 0.6,
        );
    if (!byName && !byValue) continue;

    const rule = byValue ?? byName!;
    const detectedBy = byName && byValue ? 'name+value' : byValue ? 'value' : 'name';
    const confidence = detectedBy === 'name+value' ? 0.98 : detectedBy === 'value' ? 0.92 : 0.78;
    fields.push({
      column: col.name,
      category: rule.category,
      label: rule.label,
      confidence,
      detected_by: detectedBy,
      strategy: rule.strategy,
      sample_masked: maskValue(samples[0] ?? col.name, rule.strategy),
      rationale:
        detectedBy === 'name'
          ? `Column name matches the ${rule.label.toLowerCase()} pattern.`
          : `${Math.round((samples.filter((s) => (byValue ?? rule).re.test(s)).length / Math.max(samples.length, 1)) * 100)}% of sampled values match a ${rule.label.toLowerCase()}.`,
    });
  }

  const categories = Array.from(new Set(fields.map((f) => f.category))).map((category) => ({
    category,
    label: fields.find((f) => f.category === category)!.label,
    count: fields.filter((f) => f.category === category).length,
  }));

  return {
    enabled: true,
    fields,
    masked_columns: fields.map((f) => f.column),
    aggregate_only: fields.length > 0,
    notice: fields.length
      ? `${fields.length} sensitive field${fields.length === 1 ? '' : 's'} detected and masked automatically. Raw identifiers are never rendered.`
      : 'No sensitive fields detected. All columns are safe to display.',
    categories,
  };
}
