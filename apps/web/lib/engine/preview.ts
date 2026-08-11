/**
 * Pre-ingestion preview: read the first few kilobytes of a delimited file and
 * work out, in plain JavaScript, what it looks like.
 *
 * This deliberately does NOT use DuckDB. The point of the preview is to let the
 * user correct the parse *before* a table is built, so it has to run before the
 * database is even started, and it has to be cheap enough to re-run on every
 * change to the delimiter or header setting.
 */
import type { ColumnTypeOverride, IngestOptions } from './ingest';

/** Delimiters offered in the UI, in the order they are tried when sniffing. */
export const DELIMITERS: Array<{ value: string; label: string }> = [
  { value: ',', label: 'Comma  ,' },
  { value: ';', label: 'Semicolon  ;' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe  |' },
];

export const COLUMN_TYPES: ColumnTypeOverride[] = [
  'VARCHAR',
  'DOUBLE',
  'BIGINT',
  'DATE',
  'TIMESTAMP',
  'BOOLEAN',
];

export interface PreviewColumn {
  name: string;
  /** What this module inferred; the user may override it. */
  detected: ColumnTypeOverride;
  /** Coarse bucket shown to the user - numeric columns can be aggregated. */
  kind: 'numeric' | 'temporal' | 'boolean' | 'categorical';
  samples: string[];
}

export interface PreviewResult {
  delimiter: string;
  header: boolean;
  skipRows: number;
  columns: PreviewColumn[];
  /** Parsed data rows (header excluded), capped for display. */
  rows: string[][];
  /** True when the sample was cut off mid-file. */
  truncated: boolean;
  /** Non-fatal things worth telling the user about. */
  warnings: string[];
}

const MAX_BYTES = 256 * 1024;
const MAX_ROWS = 20;

/** RFC4180-ish splitter: handles quoted fields containing the delimiter. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/).filter((l, i, arr) => l.length > 0 || i < arr.length - 1);
}

/**
 * Pick the delimiter that yields the most columns *consistently* across lines.
 * Consistency matters more than count: prose full of commas scores badly
 * because its field count jumps around.
 */
export function sniffDelimiter(lines: string[]): string {
  let best = ',';
  let bestScore = -1;
  for (const { value } of DELIMITERS) {
    const counts = lines.slice(0, 10).map((l) => splitDelimited(l, value).length);
    if (counts.length === 0) continue;
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.every((c) => c === first);
    const score = (consistent ? 1000 : 0) + first;
    if (score > bestScore) {
      bestScore = score;
      best = value;
    }
  }
  return best;
}

const TRUE_FALSE = new Set(['true', 'false', 'yes', 'no', 't', 'f', '0', '1']);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/;

function looksNumeric(v: string): boolean {
  if (v === '') return false;
  // Tolerate thousands separators, currency symbols and trailing percent signs.
  const cleaned = v.replace(/[\s,$£€%]/g, '');
  return cleaned !== '' && cleaned !== '-' && Number.isFinite(Number(cleaned));
}

function isIntegerLike(v: string): boolean {
  const cleaned = v.replace(/[\s,]/g, '');
  return /^-?\d+$/.test(cleaned);
}

/** A column is only given a type if (nearly) every non-blank value agrees. */
export function inferColumn(name: string, values: string[]): PreviewColumn {
  const filled = values.filter((v) => v !== '' && v.toLowerCase() !== 'null' && v.toLowerCase() !== 'na');
  const samples = filled.slice(0, 3);
  const agree = (fn: (v: string) => boolean) =>
    filled.length > 0 && filled.filter(fn).length / filled.length >= 0.9;

  if (agree((v) => DATE_TIME.test(v))) {
    return { name, detected: 'TIMESTAMP', kind: 'temporal', samples };
  }
  if (agree((v) => DATE_ONLY.test(v))) {
    return { name, detected: 'DATE', kind: 'temporal', samples };
  }
  if (agree((v) => TRUE_FALSE.has(v.toLowerCase())) && !agree(isIntegerLike)) {
    return { name, detected: 'BOOLEAN', kind: 'boolean', samples };
  }
  if (agree(looksNumeric)) {
    const integral = agree(isIntegerLike);
    return { name, detected: integral ? 'BIGINT' : 'DOUBLE', kind: 'numeric', samples };
  }
  return { name, detected: 'VARCHAR', kind: 'categorical', samples };
}

/** Column names DuckDB would invent when told there is no header row. */
function positionalNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `column${i}`);
}

/**
 * Build a preview from raw text. `settings` lets the UI re-run the preview with
 * the user's chosen delimiter/header/skip without re-reading the file.
 */
export function previewText(
  text: string,
  settings?: { delimiter?: string; header?: boolean; skipRows?: number },
): PreviewResult {
  const warnings: string[] = [];
  const truncated = text.length >= MAX_BYTES;
  const allLines = splitLines(text).filter((l) => l.trim() !== '');
  const skipRows = Math.max(0, Math.floor(settings?.skipRows ?? 0));
  const lines = allLines.slice(skipRows);

  if (lines.length === 0) {
    return {
      delimiter: settings?.delimiter ?? ',',
      header: settings?.header ?? true,
      skipRows,
      columns: [],
      rows: [],
      truncated,
      warnings: ['No readable rows were found after skipping the rows you chose.'],
    };
  }

  const delimiter = settings?.delimiter ?? sniffDelimiter(lines);
  const grid = lines.slice(0, MAX_ROWS + 1).map((l) => splitDelimited(l, delimiter));
  const width = grid[0].length;
  if (grid.some((r) => r.length !== width)) {
    warnings.push('Some rows have a different number of fields - check the delimiter.');
  }

  // Header detection: a header row is text and does not repeat below it.
  const headerGiven = settings?.header;
  const firstRow = grid[0];
  const autoHeader =
    firstRow.every((c) => c !== '' && !looksNumeric(c)) && grid.length > 1;
  const header = headerGiven ?? autoHeader;

  const names = header
    ? firstRow.map((c, i) => (c === '' ? `column${i}` : c))
    : positionalNames(width);
  if (header && new Set(names).size !== names.length) {
    warnings.push('Duplicate column names were found in the header row.');
  }

  const body = header ? grid.slice(1) : grid;
  const columns = names.map((name, i) => inferColumn(name, body.map((r) => r[i] ?? '')));

  return { delimiter, header, skipRows, columns, rows: body.slice(0, MAX_ROWS), truncated, warnings };
}

/** Read only the head of a file - a 200 MB CSV must not be pulled into memory. */
export async function readHead(file: File, bytes = MAX_BYTES): Promise<string> {
  const slice = file.slice(0, bytes);
  const buf = await slice.arrayBuffer();
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

/** True for formats whose parse the preview can actually influence. */
export function isPreviewable(fileName: string): boolean {
  return /\.(csv|tsv|txt)$/i.test(fileName);
}

/** Turn the preview state into the options ingest understands. */
export function optionsFromPreview(
  preview: PreviewResult,
  overrides: Record<string, ColumnTypeOverride>,
): IngestOptions {
  const columnTypes: Record<string, ColumnTypeOverride> = {};
  for (const col of preview.columns) {
    const chosen = overrides[col.name];
    if (chosen && chosen !== col.detected) columnTypes[col.name] = chosen;
  }
  return {
    delimiter: preview.delimiter,
    header: preview.header,
    skipRows: preview.skipRows || undefined,
    columnTypes: Object.keys(columnTypes).length ? columnTypes : undefined,
  };
}
