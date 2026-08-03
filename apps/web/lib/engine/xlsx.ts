/**
 * A minimal XLSX reader: workbook bytes in, CSV bytes out.
 *
 * Spreadsheets are how business data actually moves between teams, so refusing
 * .xlsx means refusing most real datasets. The conversion target is CSV rather
 * than a bespoke ingestion path because DuckDB's CSV reader is already the
 * best-tested route in this codebase - the workbook becomes a normal upload the
 * moment it is transposed, and every downstream stage (type repair, profiling,
 * SQL) is reached unchanged.
 *
 * Why hand-rolled rather than a spreadsheet library: the readers on npm carry
 * an entire write path, formula evaluation and chart model for a job that is
 * four files inside a zip. What is actually needed is `sharedStrings.xml`,
 * `styles.xml` (only to tell a date from the number that encodes it),
 * `workbook.xml` for sheet order and one worksheet part. That is small enough
 * to read, test and audit, which a 900 kB dependency is not.
 *
 * Deliberately out of scope: the pre-2007 binary `.xls` format, which shares no
 * structure with this one and is rejected with an explanatory message instead
 * of being half-supported.
 */
import { Unzip, UnzipInflate, unzipSync, strFromU8 } from 'fflate';

export interface SheetSummary {
  name: string;
  rows: number;
  columns: number;
}

export interface WorkbookConversion {
  csv: Uint8Array;
  sheet: SheetSummary;
  /** Other sheets present in the workbook, which are not converted. */
  otherSheets: string[];
}

/** `BC` -> 54. Column refs are bijective base-26, not zero-indexed base-26. */
export function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** Resolve the five XML entities plus numeric character references. */
export function decodeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** Concatenate every `<t>` run inside a fragment, which is how rich text reads. */
function textRuns(fragment: string): string {
  let out = '';
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) out += decodeXml(m[1] ?? '');
  return out;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(textRuns(m[1] ?? ''));
  return out;
}

/**
 * Excel does not have a date type: a date is a number wearing a number format.
 * Recovering the distinction requires the style table, because `40544` is
 * either 2011-01-19 or the integer forty thousand depending on it alone.
 */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Does a format code contain date/time tokens outside its quoted literals? */
export function isDateFormatCode(code: string): boolean {
  let inQuote = false;
  let inBracket = false;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (inQuote) {
      if (ch === '"') inQuote = false;
      continue;
    }
    if (inBracket) {
      if (ch === ']') inBracket = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === '[') inBracket = true;
    else if (ch === '\\') i += 1;
    else if ('yYmMdDhHsS'.includes(ch)) return true;
  }
  return false;
}

/** Style index -> "this cell holds a date". */
function parseDateStyles(xml: string | undefined): Set<number> {
  const dateStyles = new Set<number>();
  if (!xml) return dateStyles;

  const custom = new Map<number, boolean>();
  const fmtRe = /<numFmt\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = fmtRe.exec(xml)) !== null) {
    const id = Number(attr(m[0], 'numFmtId'));
    const code = decodeXml(attr(m[0], 'formatCode') ?? '');
    if (Number.isFinite(id)) custom.set(id, isDateFormatCode(code));
  }

  // Only cellXfs is the cell-level table; cellStyleXfs above it is a template
  // layer that cells do not index into directly.
  const block = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!block) return dateStyles;

  const xfRe = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;
  let i = 0;
  while ((m = xfRe.exec(block[1])) !== null) {
    const id = Number(attr(m[0], 'numFmtId') ?? '0');
    const isDate = custom.has(id) ? custom.get(id) === true : BUILTIN_DATE_FORMATS.has(id);
    if (isDate) dateStyles.add(i);
    i += 1;
  }
  return dateStyles;
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
}

/**
 * Excel serial -> ISO text.
 *
 * The epoch is 1899-12-30 rather than 1900-01-01 because the 1900 workbook mode
 * deliberately reproduces Lotus 1-2-3's belief that 1900 was a leap year; the
 * two-day offset absorbs both that phantom day and the 1-based numbering.
 */
export function serialToIso(serial: number, date1904 = false): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86400000);
  const d = new Date(epoch + ms);
  if (Number.isNaN(d.getTime())) return String(serial);

  const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const secondsIntoDay = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  if (secondsIntoDay === 0) return ymd;
  return `${ymd} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function csvField(v: string): string {
  if (v === '') return '';
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

interface SheetEntry {
  name: string;
  path: string;
}

/** Resolve sheet display names to their part paths via the workbook rels. */
function listSheets(workbookXml: string, relsXml: string | undefined): SheetEntry[] {
  const targets = new Map<string, string>();
  if (relsXml) {
    const re = /<Relationship\b[^>]*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(relsXml)) !== null) {
      const id = attr(m[0], 'Id');
      const target = attr(m[0], 'Target');
      if (id && target) {
        const clean = decodeXml(target).replace(/^\/xl\//, '').replace(/^\.\//, '');
        targets.set(id, clean.startsWith('xl/') ? clean : `xl/${clean}`);
      }
    }
  }

  const sheets: SheetEntry[] = [];
  const re = /<sheet\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  let ordinal = 0;
  while ((m = re.exec(workbookXml)) !== null) {
    ordinal += 1;
    const name = decodeXml(attr(m[0], 'name') ?? `Sheet${ordinal}`);
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id');
    // Fall back to positional naming when the rels part is missing or partial;
    // sheetN.xml is the conventional layout and is right far more often than
    // giving up would be.
    const path = (rid && targets.get(rid)) || `xl/worksheets/sheet${ordinal}.xml`;
    sheets.push({ name, path });
  }
  return sheets;
}

function cellText(
  cellTag: string,
  inner: string,
  shared: string[],
  dateStyles: Set<number>,
  date1904: boolean,
): string {
  const type = attr(cellTag, 't') ?? 'n';

  if (type === 'inlineStr') return textRuns(inner);
  if (type === 'e') return '';

  const vm = inner.match(/<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/);
  const raw = decodeXml(vm?.[1] ?? '');
  if (raw === '') return '';

  if (type === 's') {
    const idx = Number(raw);
    return Number.isInteger(idx) && idx >= 0 && idx < shared.length ? shared[idx] : '';
  }
  if (type === 'str') return raw;
  if (type === 'b') return raw === '1' ? 'true' : 'false';
  if (type === 'd') return raw;

  const styleIdx = Number(attr(cellTag, 's') ?? '');
  const n = Number(raw);
  if (Number.isFinite(n) && Number.isInteger(styleIdx) && dateStyles.has(styleIdx)) {
    return serialToIso(n, date1904);
  }
  return raw;
}

/**
 * Feed one zip entry through inflate in slices, handing decoded text to `onText`.
 *
 * A worksheet inflates to roughly twenty times the size of the row data it
 * holds, so the whole part is deliberately never materialised: pushing the
 * archive in slices keeps only a window of it alive at any moment, which is the
 * difference between a 500k-row export loading and the tab being killed.
 *
 * Returns false when the entry is absent from the archive.
 */
function streamEntry(zip: Uint8Array, path: string, onText: (chunk: string) => void): boolean {
  const decoder = new TextDecoder('utf-8');
  let found = false;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (file.name !== path) return;
    found = true;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      // `stream: true` keeps a multi-byte character split across an inflate
      // boundary intact instead of decoding it to a replacement character.
      if (chunk.length) onText(decoder.decode(chunk, { stream: !final }));
    };
    file.start();
  };

  const SLICE = 1 << 18;
  for (let i = 0; i < zip.length; i += SLICE) {
    const end = Math.min(i + SLICE, zip.length);
    unzip.push(zip.subarray(i, end), end === zip.length);
  }
  return found;
}

const ROW_RE = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const REF_RE = /\sr="([A-Z]{1,3})\d+"/g;

/**
 * Widest column used anywhere in the sheet.
 *
 * Taken from the cell references rather than from `<dimension>`, which some
 * writers emit stale or omit entirely, and rather than from the header row,
 * which would silently truncate any row running wider than its header.
 */
function scanWidth(zip: Uint8Array, path: string): number {
  let width = 0;
  // A reference can straddle a chunk boundary, so a short tail is carried
  // forward. Re-reading a few characters is harmless because only a maximum is
  // being taken.
  let carry = '';
  const found = streamEntry(zip, path, (chunk) => {
    const text = carry + chunk;
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(text)) !== null) {
      const idx = columnIndex(m[1]) + 1;
      if (idx > width) width = idx;
    }
    carry = text.slice(-16);
  });
  return found ? width : 0;
}

/**
 * Convert the first populated worksheet of an .xlsx workbook to CSV bytes.
 *
 * Only one sheet is converted, and the caller is told which - a workbook is a
 * folder of tables, and silently concatenating or silently picking one would
 * make the row count unexplainable. The first sheet with data is the
 * overwhelmingly common intent for an exported dataset.
 */
export function workbookToCsv(bytes: Uint8Array): WorkbookConversion {
  // Only the parts actually needed are inflated. Sheets are usually the bulk of
  // the archive and are streamed separately below.
  const META = new Set([
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/sharedStrings.xml',
    'xl/styles.xml',
  ]);

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => META.has(f.name) });
  } catch {
    throw new Error(
      'This file is not a readable .xlsx workbook. Legacy .xls files must be re-saved as .xlsx or CSV first.',
    );
  }

  const text = (path: string): string | undefined =>
    files[path] ? strFromU8(files[path]) : undefined;

  const workbookXml = text('xl/workbook.xml');
  if (!workbookXml) {
    throw new Error('The workbook is missing xl/workbook.xml, so it cannot be read.');
  }

  const date1904 = /\bdate1904\s*=\s*"(1|true)"/i.test(workbookXml);
  const shared = parseSharedStrings(text('xl/sharedStrings.xml'));
  const dateStyles = parseDateStyles(text('xl/styles.xml'));
  const sheets = listSheets(workbookXml, text('xl/_rels/workbook.xml.rels'));
  if (!sheets.length) throw new Error('The workbook declares no worksheets.');

  // Everything parsed into a lookup is dead weight from here on.
  files = {};

  for (let s = 0; s < sheets.length; s += 1) {
    const path = sheets[s].path;
    const width = scanWidth(bytes, path);
    if (!width) continue;

    // Rows are encoded to bytes as they are produced rather than collected into
    // a grid: a 500k-row export would otherwise be held three times over - cell
    // strings, joined lines, then the encoded buffer.
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let pending: string[] = [];
    let total = 0;
    let dataRows = 0;

    const flush = () => {
      if (!pending.length) return;
      const encoded = encoder.encode(pending.join(''));
      chunks.push(encoded);
      total += encoded.length;
      pending = [];
    };

    const emitRow = (body: string) => {
      const cells: string[] = new Array(width).fill('');
      let cursor = 0;
      let populated = false;
      CELL_RE.lastIndex = 0;
      let cm: RegExpExecArray | null;
      while ((cm = CELL_RE.exec(body)) !== null) {
        const tag = `<c${cm[1]}>`;
        const ref = attr(tag, 'r');
        // Omitted cells are not written at all, so position comes from the
        // reference; without this every blank shifts the row left by one.
        const at = ref ? columnIndex(ref) : cursor;
        const idx = at >= 0 ? at : cursor;
        cursor = idx + 1;
        if (idx >= width) continue;
        const value = cellText(tag, cm[2] ?? '', shared, dateStyles, date1904);
        cells[idx] = value;
        if (value !== '') populated = true;
      }
      if (!populated) return;
      for (let i = 0; i < width; i += 1) cells[i] = csvField(cells[i]);
      pending.push(cells.join(','), '\n');
      dataRows += 1;
      if (pending.length >= 4096) flush();
    };

    // Only complete `<row>` elements are consumed; a trailing partial row is
    // carried into the next chunk, which is why the regex requires the closing
    // tag rather than matching greedily to the end of the buffer.
    let buffer = '';
    streamEntry(bytes, path, (chunk) => {
      buffer += chunk;
      ROW_RE.lastIndex = 0;
      let consumed = 0;
      let rm: RegExpExecArray | null;
      while ((rm = ROW_RE.exec(buffer)) !== null) {
        if (rm[2]) emitRow(rm[2]);
        consumed = ROW_RE.lastIndex;
      }
      if (consumed) buffer = buffer.slice(consumed);
    });
    flush();

    if (!dataRows) continue;

    const csv = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      csv.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      csv,
      sheet: { name: sheets[s].name, rows: Math.max(dataRows - 1, 0), columns: width },
      otherSheets: sheets.filter((_, i) => i !== s).map((x) => x.name),
    };
  }

  throw new Error('Every worksheet in this workbook is empty.');
}
