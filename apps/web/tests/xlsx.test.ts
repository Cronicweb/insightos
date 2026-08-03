import { describe, expect, it } from 'vitest';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { columnIndex, decodeXml, isDateFormatCode, serialToIso, workbookToCsv } from '@/lib/engine/xlsx';

/**
 * Workbooks are assembled here rather than checked in as binary fixtures, so
 * the exact bytes under test are readable in the diff - which matters for a
 * format whose traps (omitted cells, dates as styled numbers, shared strings)
 * are invisible in a checked-in blob.
 */
function xlsx(parts: Record<string, string>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [path, body] of Object.entries(parts)) files[path] = strToU8(body);
  return zipSync(files);
}

const WORKBOOK = `<?xml version="1.0"?>
<workbook xmlns:r="x"><sheets>
  <sheet name="Orders" sheetId="1" r:id="rId1"/>
  <sheet name="Notes" sheetId="2" r:id="rId2"/>
</sheets></workbook>`;

const RELS = `<?xml version="1.0"?>
<Relationships>
  <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
</Relationships>`;

// numFmtId 14 is the built-in short date; 0 is General.
const STYLES = `<?xml version="1.0"?>
<styleSheet>
  <numFmts><numFmt numFmtId="200" formatCode="dd/mm/yyyy hh:mm"/></numFmts>
  <cellStyleXfs><xf numFmtId="14"/></cellStyleXfs>
  <cellXfs>
    <xf numFmtId="0"/>
    <xf numFmtId="14"/>
    <xf numFmtId="200"/>
    <xf numFmtId="44"/>
  </cellXfs>
</styleSheet>`;

const SHARED = `<?xml version="1.0"?>
<sst>
  <si><t>invoice</t></si>
  <si><t>ordered</t></si>
  <si><t>amount</t></si>
  <si><t>region</t></si>
  <si><r><t>North</t></r><r><t xml:space="preserve"> East</t></r></si>
  <si><t>Bl&#233;riot, S.A. "Ltd"</t></si>
</sst>`;

function sheet(rows: string): string {
  return `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
}

function build(rows: string, extra: Record<string, string> = {}): Uint8Array {
  return xlsx({
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/styles.xml': STYLES,
    'xl/sharedStrings.xml': SHARED,
    'xl/worksheets/sheet1.xml': sheet(rows),
    'xl/worksheets/sheet2.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>ignore me</t></is></c></row>'),
    ...extra,
  });
}

const HEADER =
  '<row r="1">' +
  '<c r="A1" t="s"><v>0</v></c>' +
  '<c r="B1" t="s"><v>1</v></c>' +
  '<c r="C1" t="s"><v>2</v></c>' +
  '<c r="D1" t="s"><v>3</v></c>' +
  '</row>';

function csvOf(bytes: Uint8Array): string[] {
  return strFromU8(workbookToCsv(bytes).csv).trimEnd().split('\n');
}

describe('column references', () => {
  it('decodes bijective base-26', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA1')).toBe(26);
    expect(columnIndex('BC12')).toBe(54);
  });
});

describe('XML entities', () => {
  it('resolves named and numeric references', () => {
    expect(decodeXml('a &amp; b')).toBe('a & b');
    expect(decodeXml('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeXml('Bl&#233;riot')).toBe('Blériot');
    expect(decodeXml('&#x20AC;5')).toBe('€5');
  });
});

describe('date format detection', () => {
  it('sees date tokens outside quoted literals', () => {
    expect(isDateFormatCode('dd/mm/yyyy')).toBe(true);
    expect(isDateFormatCode('yyyy-mm-dd hh:mm:ss')).toBe(true);
    expect(isDateFormatCode('#,##0.00')).toBe(false);
  });

  it('does not mistake letters inside literals or colour tags for a date', () => {
    // The `d` is inside a quoted literal and the `[Red]` is a colour section,
    // so a currency format must not be read as a date.
    expect(isDateFormatCode('"Sold"#,##0')).toBe(false);
    expect(isDateFormatCode('[Red]#,##0.00;-#,##0.00')).toBe(false);
  });
});

describe('serial dates', () => {
  it('uses the 1899-12-30 epoch that absorbs the 1900 leap-year bug', () => {
    expect(serialToIso(40562)).toBe('2011-01-19');
    expect(serialToIso(1)).toBe('1899-12-31');
  });

  it('emits a time component only when the serial has one', () => {
    expect(serialToIso(40562.5)).toBe('2011-01-19 12:00:00');
    expect(serialToIso(40562)).toBe('2011-01-19');
  });

  it('honours the 1904 workbook epoch', () => {
    expect(serialToIso(0, true)).toBe('1904-01-01');
  });
});

describe('workbook conversion', () => {
  it('reads shared strings, styled dates and numbers into CSV', () => {
    const lines = csvOf(
      build(
        HEADER +
          '<row r="2">' +
          '<c r="A2"><v>536365</v></c>' +
          '<c r="B2" s="2"><v>40562.3513888889</v></c>' +
          '<c r="C2" s="3"><v>15.3</v></c>' +
          '<c r="D2" t="s"><v>4</v></c>' +
          '</row>',
      ),
    );
    expect(lines[0]).toBe('invoice,ordered,amount,region');
    expect(lines[1]).toBe('536365,2011-01-19 08:26:00,15.3,North East');
  });

  it('keeps a numeric column numeric when its format is not a date', () => {
    // Style 3 is numFmtId 44 (accounting). Treating every number as a serial
    // would silently turn every price into a date in the 1970s.
    const lines = csvOf(build(HEADER + '<row r="2"><c r="C2" s="3"><v>40544</v></c></row>'));
    expect(lines[1]).toBe(',,40544,');
  });

  it('places cells by reference so omitted blanks do not shift the row', () => {
    // B and C are absent entirely, which is how Excel writes empty cells.
    const lines = csvOf(build(HEADER + '<row r="2"><c r="A2"><v>7</v></c><c r="D2" t="s"><v>4</v></c></row>'));
    expect(lines[1]).toBe('7,,,North East');
  });

  it('quotes fields containing commas or quotes', () => {
    const lines = csvOf(build(HEADER + '<row r="2"><c r="A2" t="s"><v>5</v></c></row>'));
    expect(lines[1]).toBe('"Bleriot, S.A. ""Ltd"""'.replace('Bleriot', 'Bl\u00e9riot') + ',,,');
  });

  it('reads inline strings and booleans', () => {
    const lines = csvOf(
      build(
        HEADER +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>ad hoc</t></is></c>' +
          '<c r="B2" t="b"><v>1</v></c><c r="C2" t="b"><v>0</v></c></row>',
      ),
    );
    expect(lines[1]).toBe('ad hoc,true,false,');
  });

  it('names the sheet it read and the sheets it skipped', () => {
    const out = workbookToCsv(build(HEADER + '<row r="2"><c r="A2"><v>1</v></c></row>'));
    expect(out.sheet.name).toBe('Orders');
    expect(out.sheet.rows).toBe(1);
    expect(out.sheet.columns).toBe(4);
    expect(out.otherSheets).toEqual(['Notes']);
  });

  it('skips a leading empty sheet rather than reporting an empty dataset', () => {
    const bytes = xlsx({
      'xl/workbook.xml': WORKBOOK,
      'xl/_rels/workbook.xml.rels': RELS,
      'xl/styles.xml': STYLES,
      'xl/sharedStrings.xml': SHARED,
      'xl/worksheets/sheet1.xml': sheet('<row r="1"><c r="A1"/></row>'),
      'xl/worksheets/sheet2.xml': sheet(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>kept</t></is></c></row>',
      ),
    });
    const out = workbookToCsv(bytes);
    expect(out.sheet.name).toBe('Notes');
    expect(strFromU8(out.csv).trim()).toBe('kept');
  });

  it('rejects a file that is not a zip with an actionable message', () => {
    expect(() => workbookToCsv(strToU8('Invoice,Amount\n1,2\n'))).toThrow(/\.xls/);
  });

  it('rejects an empty workbook rather than creating a zero-column table', () => {
    const bytes = xlsx({
      'xl/workbook.xml': WORKBOOK,
      'xl/_rels/workbook.xml.rels': RELS,
      'xl/worksheets/sheet1.xml': sheet(''),
      'xl/worksheets/sheet2.xml': sheet(''),
    });
    expect(() => workbookToCsv(bytes)).toThrow(/empty/i);
  });
});
