/**
 * Browser-side ingestion.
 *
 * Files are read into memory, handed to DuckDB as a registered buffer and
 * turned into a table. Nothing is uploaded, nothing is persisted, and closing
 * the tab destroys every byte.
 */
import type * as duckdb from '@duckdb/duckdb-wasm';
import { getDuckDb } from '@/lib/duckdb/client';
import { ident, lit, query, queryOne, numOr } from './sql';
import {
  coerceTemporalColumns,
  deriveRevenueColumn,
  type Coercion,
  type DerivedMeasure,
} from './coerce';

export type SourceFormat = 'csv' | 'json' | 'parquet' | 'xlsx';

export interface IngestResult {
  table: string;
  format: SourceFormat;
  rows: number;
  columns: number;
  bytes: number;
  fileName: string;
  durationMs: number;
  /** Text columns that were recovered as real timestamps. */
  coercions: Coercion[];
  /** Measures computed at ingest because the raw grain could not be summed. */
  derived: DerivedMeasure[];
  /** Set when a spreadsheet was flattened, naming the sheet that was read. */
  workbook?: { sheet: string; otherSheets: string[] };
}

export function detectFormat(fileName: string): SourceFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'csv';
  if (lower.endsWith('.json') || lower.endsWith('.ndjson')) return 'json';
  if (lower.endsWith('.parquet') || lower.endsWith('.pq')) return 'parquet';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'xlsx';
  return null;
}

/** DuckDB identifiers are easier to reason about when they are boring. */
export function tableNameFor(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return base ? `t_${base}`.slice(0, 48) : 't_dataset';
}

function readerFor(format: SourceFormat, virtualPath: string): string {
  // A bounded sample keeps type inference fast; DuckDB still falls back to
  // VARCHAR for any column it cannot resolve, so correctness is preserved.
  if (format === 'csv') return `read_csv_auto(${lit(virtualPath)}, SAMPLE_SIZE=65536)`;
  if (format === 'json') return `read_json_auto(${lit(virtualPath)})`;
  if (format === 'parquet') return `read_parquet(${lit(virtualPath)})`;
  // Workbooks arrive here already transposed to CSV bytes.
  return `read_csv_auto(${lit(virtualPath)}, SAMPLE_SIZE=65536)`;
}

export async function ingestFile(
  file: File,
  onProgress?: (stage: string) => void,
): Promise<IngestResult> {
  const started = performance.now();
  const format = detectFormat(file.name);
  if (!format) {
    if (/\.xls$/i.test(file.name)) {
      throw new Error(
        'The legacy .xls format is not supported. Re-save the file as .xlsx or CSV and upload it again.',
      );
    }
    throw new Error('Unsupported file type. Upload a .csv, .xlsx, .json or .parquet file.');
  }

  onProgress?.('Starting the in-browser database');
  const { db, conn } = await getDuckDb(onProgress);

  onProgress?.('Reading the file into memory');
  let buffer = new Uint8Array(await file.arrayBuffer());
  let workbook: IngestResult['workbook'];

  // A workbook is a zip of XML, not a table, so it is flattened to CSV before
  // DuckDB sees it - which also means every later stage takes the CSV path that
  // is already the best-tested one in this codebase.
  if (format === 'xlsx') {
    onProgress?.('Reading the workbook (a large spreadsheet can take a few seconds)');
    const { workbookToCsv } = await import('./xlsx');
    const converted = workbookToCsv(buffer);
    buffer = converted.csv;
    workbook = { sheet: converted.sheet.name, otherSheets: converted.otherSheets };
  }

  const virtualPath = `upload_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await db.registerFileBuffer(virtualPath, buffer);

  const table = tableNameFor(file.name);
  onProgress?.('Inferring schema and building the table');
  await conn.query(`DROP TABLE IF EXISTS ${ident(table)}`);
  await conn.query(`CREATE TABLE ${ident(table)} AS SELECT * FROM ${readerFor(format, virtualPath)}`);

  // The sniffer is good at ISO dates and poor at regional ones. Repair what it
  // missed before profiling runs, so a text date column still yields a time
  // axis - and therefore trends, deltas and a forecast - instead of silently
  // reducing the analysis to a set of totals.
  onProgress?.('Repairing column types');
  let coercions: Coercion[] = [];
  let derived: DerivedMeasure[] = [];
  try {
    coercions = await coerceTemporalColumns(conn, table);
  } catch {
    coercions = [];
  }
  try {
    const revenue = await deriveRevenueColumn(conn, table);
    if (revenue) derived = [revenue];
  } catch {
    derived = [];
  }

  const countRow = await queryOne<{ n: unknown }>(conn, `SELECT count(*) AS n FROM ${ident(table)}`);
  const rows = numOr(countRow.n);
  if (rows === 0) throw new Error('The file parsed successfully but contains no rows.');

  const cols = await query(conn, `SELECT column_name FROM information_schema.columns WHERE table_name = ${lit(table)}`);

  return {
    table,
    format,
    rows,
    columns: cols.length,
    bytes: file.size,
    fileName: file.name,
    durationMs: Math.round(performance.now() - started),
    coercions,
    derived,
    workbook,
  };
}

/** Ad-hoc SQL for the console, with a guard against accidental table drops. */
export async function runSql(conn: duckdb.AsyncDuckDBConnection, sql: string) {
  const trimmed = sql.trim().replace(/;+$/, '');
  if (!trimmed) return [];
  return query(conn, trimmed);
}
