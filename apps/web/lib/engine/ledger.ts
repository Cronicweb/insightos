/**
 * Transaction-ledger audit.
 *
 * A general-purpose profiler treats an invoice extract as "some rows with some
 * numbers in them". That is not good enough for money. Transaction data carries
 * conventions the profiler cannot know - a leading `C` on an invoice number
 * means the sale was reversed, a negative quantity means stock came back, a
 * zero price means the line is an adjustment rather than a sale - and every one
 * of those conventions changes the answer to "what was revenue?".
 *
 * This module encodes those conventions explicitly. It runs only when the table
 * actually looks like a transaction ledger, and it publishes three things the
 * rest of the product cannot: the exact scope each figure was computed over,
 * the row-by-row cost of every cleaning rule, and the SQL that produced each
 * number so a reviewer can re-run it.
 *
 * Nothing here overrides the general pipeline. It is an additional, stricter
 * reading of the same table.
 */
import type * as duckdb from '@duckdb/duckdb-wasm';
import type {
  ColumnProfile, LedgerAudit, LedgerColumns, LedgerKpi, LedgerQualityRule,
  LedgerScope, LedgerTrend, LedgerTrendPoint, ParetoBlock, ParetoEntry,
  RepeatBlock, RfmBlock, RfmSegment,
} from '@/lib/types';
import { ident, num, query, str } from './sql';

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

const INVOICE_RE = /(invoice|order[_ ]?(no|id|num)|transaction[_ ]?(no|id)|receipt|bill[_ ]?no|^order$|ordernumber)/i;
const QUANTITY_RE = /(quantity|^qty$|units?$|item[_ ]?count)/i;
const PRICE_RE = /(unit[_ ]?price|price[_ ]?per|^price$|_price$|unit[_ ]?cost)/i;
const REVENUE_RE = /^(revenue|line[_ ]?total|extended[_ ]?price|net[_ ]?sales|sales[_ ]?amount|total[_ ]?amount)$/i;
const CUSTOMER_RE = /(customer|client|member|account|shopper|buyer)/i;
const CUSTOMER_EXCLUDE_RE = /(segment|tier|band|type|class|grade|group|category|cohort|status|since|age|score|rating|name|country)/i;
const COUNTRY_RE = /(country|region|market|territory|geo)/i;
const PRODUCT_RE = /(stock[_ ]?code|sku|product[_ ]?(code|id)|item[_ ]?(code|id)|^product$|^item$)/i;
const DESCRIPTION_RE = /(description|product[_ ]?name|item[_ ]?name|title)/i;

function pick(columns: ColumnProfile[], re: RegExp, kinds?: string[], exclude?: RegExp): string | null {
  for (const c of columns) {
    if (!re.test(c.name)) continue;
    if (exclude?.test(c.name)) continue;
    if (kinds && !kinds.includes(c.semantic_type)) continue;
    return c.name;
  }
  return null;
}

/**
 * Decide whether this table is a transaction ledger.
 *
 * The bar is deliberately high: an invoice identifier plus a way to compute
 * money at line level. Without both, every figure below would be a guess, and a
 * guessed revenue number is worse than no revenue number.
 */
export function detectLedger(columns: ColumnProfile[]): LedgerColumns | null {
  // The kinds allowlist is what stops `InvoiceDate` being read as the invoice
  // key when `InvoiceNo` is absent: the name matches, but a timestamp is not an
  // identifier, and grouping revenue by it would silently produce one "order"
  // per second.
  const invoice = pick(columns, INVOICE_RE, ['identifier', 'categorical', 'text', 'numeric', 'count']);
  const quantity = pick(columns, QUANTITY_RE, ['count', 'numeric']);
  const price = pick(columns, PRICE_RE, ['currency', 'numeric']);
  const revenue = pick(columns, REVENUE_RE, ['currency', 'numeric']);

  if (!invoice) return null;
  // Money must be derivable: either a line total exists, or quantity x price.
  if (!revenue && !(quantity && price)) return null;

  return {
    invoice,
    quantity,
    price,
    revenue,
    customer: pick(columns, CUSTOMER_RE, ['identifier', 'categorical', 'numeric', 'count'], CUSTOMER_EXCLUDE_RE),
    country: pick(columns, COUNTRY_RE, ['categorical']),
    product: pick(columns, PRODUCT_RE),
    description: pick(columns, DESCRIPTION_RE),
    date: pick(columns, /.*/, ['datetime']),
  };
}

/**
 * The money expression, stated once.
 *
 * Revenue on a line-item extract is quantity x unit price. Summing the price
 * column alone is a category error - a price is per unit and does not add up -
 * and it is the single most common way a transaction dashboard reports a
 * confidently wrong number.
 */
export function revenueExpr(cols: LedgerColumns): string | null {
  if (cols.revenue) return `CAST(${ident(cols.revenue)} AS DOUBLE)`;
  if (cols.quantity && cols.price) {
    return `CAST(${ident(cols.quantity)} AS DOUBLE) * CAST(${ident(cols.price)} AS DOUBLE)`;
  }
  return null;
}

export function revenueFormula(cols: LedgerColumns): string {
  if (cols.revenue) return `SUM(${cols.revenue})`;
  return `SUM(${cols.quantity} x ${cols.price})`;
}

/** Cancellation predicate: the leading-C convention on invoice numbers. */
export function cancelExpr(cols: LedgerColumns): string {
  return `upper(CAST(${ident(cols.invoice)} AS VARCHAR)) LIKE 'C%'`;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const round = (v: number, dp = 2) => Number(v.toFixed(dp));
const pct = (part: number, whole: number) => (whole ? round((part / whole) * 100, 3) : 0);

function fmtDate(iso: string | null): string {
  if (!iso) return 'n/a';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* ------------------------------------------------------------------ *
 * The audit
 * ------------------------------------------------------------------ */

export async function buildLedgerAudit(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
  columns: ColumnProfile[],
): Promise<LedgerAudit | null> {
  const cols = detectLedger(columns);
  if (!cols) return null;
  const rev = revenueExpr(cols);
  if (!rev) return null;

  const cancelled = cancelExpr(cols);
  const t = ident(table);

  /* -- 1. Row census -------------------------------------------------- */
  // Every cleaning rule is counted on the same pass so the percentages all
  // share one denominator and cannot drift apart.
  const qtyNeg = cols.quantity ? `CAST(${ident(cols.quantity)} AS DOUBLE) < 0` : 'false';
  const qtyZero = cols.quantity ? `CAST(${ident(cols.quantity)} AS DOUBLE) = 0` : 'false';
  const priceBad = cols.price ? `CAST(${ident(cols.price)} AS DOUBLE) <= 0` : 'false';
  const custNull = cols.customer ? `${ident(cols.customer)} IS NULL` : 'false';
  const descNull = cols.description ? `${ident(cols.description)} IS NULL` : 'false';

  const censusRows = await query<Record<string, unknown>>(
    conn,
    `SELECT count(*) AS total,
            sum(CASE WHEN ${cancelled} THEN 1 ELSE 0 END) AS cancelled_rows,
            count(DISTINCT CASE WHEN ${cancelled} THEN CAST(${ident(cols.invoice)} AS VARCHAR) END) AS cancelled_invoices,
            sum(CASE WHEN ${qtyNeg} THEN 1 ELSE 0 END) AS neg_qty,
            sum(CASE WHEN ${qtyNeg} AND NOT ${cancelled} THEN 1 ELSE 0 END) AS neg_qty_uncancelled,
            sum(CASE WHEN ${qtyZero} THEN 1 ELSE 0 END) AS zero_qty,
            sum(CASE WHEN ${priceBad} THEN 1 ELSE 0 END) AS bad_price,
            sum(CASE WHEN ${custNull} THEN 1 ELSE 0 END) AS missing_customer,
            sum(CASE WHEN ${descNull} THEN 1 ELSE 0 END) AS missing_description,
            sum(${rev}) AS net_revenue,
            sum(CASE WHEN ${cancelled} THEN ${rev} ELSE 0 END) AS cancelled_revenue
       FROM ${t}`,
  );
  const census = censusRows[0] ?? {};
  const total = num(census.total) ?? 0;
  if (!total) return null;

  // Exact duplicates need their own pass; DuckDB cannot count them inline.
  // Exact duplicates need a second pass: build one hashable key per row from
  // every column, then compare distinct keys against the row count.
  let duplicates = 0;
  const allCols = columns.map((c) => `coalesce(CAST(${ident(c.name)} AS VARCHAR), '\\u0000')`).join(" || '\\u001f' || ");
  try {
    const dupRows = await query<{ n: unknown }>(
      conn,
      `SELECT count(*) - count(DISTINCT ${allCols}) AS n FROM ${t}`,
    );
    duplicates = Math.max(0, num(dupRows[0]?.n) ?? 0);
  } catch {
    duplicates = 0;
  }

  /* -- 2. Analysis scope ---------------------------------------------- */
  // Completed sales only, and only lines that can carry a defensible price.
  const scopeParts = [`NOT ${cancelled}`];
  if (cols.quantity) scopeParts.push(`CAST(${ident(cols.quantity)} AS DOUBLE) > 0`);
  if (cols.price) scopeParts.push(`CAST(${ident(cols.price)} AS DOUBLE) > 0`);
  const scopeSql = scopeParts.join(' AND ');

  let dateMin: string | null = null;
  let dateMax: string | null = null;
  if (cols.date) {
    const d = await query<{ lo: unknown; hi: unknown }>(
      conn,
      `SELECT min(CAST(${ident(cols.date)} AS TIMESTAMP)) AS lo,
              max(CAST(${ident(cols.date)} AS TIMESTAMP)) AS hi
         FROM ${t} WHERE ${scopeSql}`,
    );
    dateMin = str(d[0]?.lo) || null;
    dateMax = str(d[0]?.hi) || null;
  }

  /* -- 3. Headline KPIs ------------------------------------------------ */
  const custExpr = cols.customer ? `count(DISTINCT ${ident(cols.customer)})` : 'NULL';
  const qtyExpr = cols.quantity ? `sum(CAST(${ident(cols.quantity)} AS DOUBLE))` : 'NULL';

  const kpiRows = await query<Record<string, unknown>>(
    conn,
    `SELECT sum(${rev}) AS revenue,
            count(DISTINCT CAST(${ident(cols.invoice)} AS VARCHAR)) AS orders,
            ${qtyExpr} AS units,
            ${custExpr} AS customers,
            count(*) AS lines
       FROM ${t} WHERE ${scopeSql}`,
  );
  const k = kpiRows[0] ?? {};
  const revenue = num(k.revenue) ?? 0;
  const orders = num(k.orders) ?? 0;
  const units = num(k.units);
  const customers = num(k.customers);
  const lines = num(k.lines) ?? 0;

  const scopeLabel = cols.date && dateMin && dateMax
    ? `Completed sales, ${fmtDate(dateMin)} to ${fmtDate(dateMax)}`
    : 'Completed sales, whole file';

  // A trailing partial period makes the last bar look like a collapse. The
  // check is cheap and it prevents the most common false headline in this
  // kind of extract.
  let partial = false;
  let partialNote: string | null = null;
  if (cols.date && dateMax) {
    const last = new Date(dateMax);
    if (!Number.isNaN(last.getTime())) {
      const hour = last.getUTCHours();
      const dayOfMonth = last.getUTCDate();
      if (hour < 23) {
        partial = true;
        partialNote =
          `The final timestamp is ${fmtDate(dateMax)} ${String(hour).padStart(2, '0')}:${String(last.getUTCMinutes()).padStart(2, '0')} UTC, ` +
          `so the last day is truncated mid-trading. The last month (day ${dayOfMonth} of it) is therefore a partial period: ` +
          'any month-on-month fall at the right-hand edge of a chart is a data cutoff, not a business event.';
      }
    }
  }

  const scope: LedgerScope = {
    label: scopeLabel,
    filter_sql: scopeSql,
    rows: lines,
    rows_pct: pct(lines, total),
    date_column: cols.date,
    date_min: dateMin,
    date_max: dateMax,
    last_period_partial: partial,
    partial_note: partialNote,
  };

  const kpis: LedgerKpi[] = [];
  const push = (kpi: LedgerKpi) => kpis.push(kpi);

  push({
    id: 'revenue', label: 'Revenue', value: round(revenue), unit: 'currency',
    scope: 'dataset', scope_label: scopeLabel,
    formula: revenueFormula(cols),
    sql: `SELECT sum(${rev}) FROM ${table} WHERE ${scopeSql}`,
    numerator: null, denominator: null,
    note: cols.revenue
      ? null
      : 'Money is stored per unit in this file, so revenue is quantity x unit price. Summing the price column alone would be arithmetic on an intensive quantity.',
  });

  push({
    id: 'orders', label: 'Orders', value: orders, unit: 'number',
    scope: 'dataset', scope_label: scopeLabel,
    formula: `COUNT(DISTINCT ${cols.invoice})`,
    sql: `SELECT count(DISTINCT ${cols.invoice}) FROM ${table} WHERE ${scopeSql}`,
    numerator: null, denominator: null,
    note: `${lines.toLocaleString('en-GB')} rows collapse to ${orders.toLocaleString('en-GB')} orders because this file is one row per line item, not one row per order.`,
  });

  if (units !== null) {
    push({
      id: 'units', label: 'Units', value: round(units, 0), unit: 'number',
      scope: 'dataset', scope_label: scopeLabel,
      formula: `SUM(${cols.quantity})`,
      sql: `SELECT sum(${cols.quantity}) FROM ${table} WHERE ${scopeSql}`,
      numerator: null, denominator: null, note: null,
    });
  }

  if (customers !== null) {
    push({
      id: 'customers', label: 'Customers', value: customers, unit: 'number',
      scope: 'dataset', scope_label: scopeLabel,
      formula: `COUNT(DISTINCT ${cols.customer})`,
      sql: `SELECT count(DISTINCT ${cols.customer}) FROM ${table} WHERE ${scopeSql}`,
      numerator: null, denominator: null,
      note:
        `Distinct customers (${customers.toLocaleString('en-GB')}) is not the same measure as orders (${orders.toLocaleString('en-GB')}). ` +
        'One customer places many invoices, so counting invoices and calling the result "customers" overstates the base by roughly ' +
        `${orders && customers ? (orders / customers).toFixed(1) : 'n'}x on this file.`,
    });
  }

  if (orders) {
    push({
      id: 'aov', label: 'Average order value', value: round(revenue / orders), unit: 'currency',
      scope: 'dataset', scope_label: scopeLabel,
      formula: 'Revenue / Orders',
      sql: `SELECT sum(${rev}) / count(DISTINCT ${cols.invoice}) FROM ${table} WHERE ${scopeSql}`,
      numerator: { label: 'Revenue', value: round(revenue) },
      denominator: { label: 'Distinct invoices', value: orders },
      note: 'A ratio, so it is recomputed from its components rather than averaged across periods.',
    });
  }

  /* -- 4. Repeat customers -------------------------------------------- */
  let repeat: RepeatBlock | null = null;
  if (cols.customer) {
    const rRows = await query<Record<string, unknown>>(
      conn,
      `WITH per_customer AS (
         SELECT ${ident(cols.customer)} AS cust,
                count(DISTINCT CAST(${ident(cols.invoice)} AS VARCHAR)) AS orders,
                sum(${rev}) AS revenue
           FROM ${t}
          WHERE ${scopeSql} AND ${ident(cols.customer)} IS NOT NULL
          GROUP BY 1)
       SELECT count(*) AS identified,
              sum(CASE WHEN orders > 1 THEN 1 ELSE 0 END) AS repeat_customers,
              sum(CASE WHEN orders > 1 THEN revenue ELSE 0 END) AS repeat_revenue,
              sum(revenue) AS identified_revenue
         FROM per_customer`,
    );
    const r = rRows[0] ?? {};
    const identified = num(r.identified) ?? 0;
    const repeatCustomers = num(r.repeat_customers) ?? 0;
    const repeatRevenue = num(r.repeat_revenue) ?? 0;
    const identifiedRevenue = num(r.identified_revenue) ?? 0;

    const aRows = await query<Record<string, unknown>>(
      conn,
      `SELECT count(*) AS rows, sum(${rev}) AS revenue
         FROM ${t} WHERE ${scopeSql} AND ${ident(cols.customer)} IS NULL`,
    );
    const anonRows = num(aRows[0]?.rows) ?? 0;
    const anonRevenue = num(aRows[0]?.revenue) ?? 0;

    repeat = {
      identified_customers: identified,
      repeat_customers: repeatCustomers,
      one_time_customers: identified - repeatCustomers,
      repeat_rate_pct: pct(repeatCustomers, identified),
      repeat_revenue: round(repeatRevenue),
      repeat_revenue_share_pct: pct(repeatRevenue, identifiedRevenue),
      anonymous_rows: anonRows,
      anonymous_pct: pct(anonRows, lines),
      anonymous_revenue: round(anonRevenue),
      note:
        `${pct(anonRows, lines).toFixed(1)}% of in-scope rows carry no customer identifier and are excluded from every customer-level figure. ` +
        'The repeat rate below is therefore a rate among identified customers only - it is not a rate across the whole book, and the two must not be quoted interchangeably.',
    };

    push({
      id: 'repeat_rate', label: 'Repeat-customer rate',
      value: repeat.repeat_rate_pct, unit: 'percent',
      scope: 'dataset', scope_label: `${scopeLabel} - identified customers only`,
      formula: 'Customers with >1 distinct invoice / customers with any invoice',
      sql: `WITH per_customer AS (SELECT ${cols.customer}, count(DISTINCT ${cols.invoice}) AS orders FROM ${table} WHERE ${scopeSql} AND ${cols.customer} IS NOT NULL GROUP BY 1) SELECT 100.0 * sum(CASE WHEN orders > 1 THEN 1 ELSE 0 END) / count(*) FROM per_customer`,
      numerator: { label: 'Customers with more than one order', value: repeatCustomers },
      denominator: { label: 'Identified customers', value: identified },
      note: repeat.note,
    });
  }

  /* -- 5. Cancellation rate -------------------------------------------- */
  const cancelledRows = num(census.cancelled_rows) ?? 0;
  const cancelledInvoices = num(census.cancelled_invoices) ?? 0;
  const cancelledRevenue = num(census.cancelled_revenue) ?? 0;
  const allInvoiceRows = await query<{ n: unknown }>(
    conn, `SELECT count(DISTINCT CAST(${ident(cols.invoice)} AS VARCHAR)) AS n FROM ${t}`,
  );
  const allInvoices = num(allInvoiceRows[0]?.n) ?? 0;

  push({
    id: 'cancellation_rate', label: 'Cancellation rate',
    value: pct(cancelledInvoices, allInvoices), unit: 'percent',
    scope: 'dataset', scope_label: 'Whole file, before any scope filter',
    formula: 'Distinct cancelled invoices / distinct invoices',
    sql: `SELECT 100.0 * count(DISTINCT CASE WHEN ${cancelled} THEN ${cols.invoice} END) / count(DISTINCT ${cols.invoice}) FROM ${table}`,
    numerator: { label: 'Cancelled invoices', value: cancelledInvoices },
    denominator: { label: 'All invoices', value: allInvoices },
    note:
      `Measured on invoices, not rows: ${cancelledRows.toLocaleString('en-GB')} rows (${pct(cancelledRows, total).toFixed(2)}% of the file) belong to ` +
      `${cancelledInvoices.toLocaleString('en-GB')} cancelled invoices. Reversals carry ${round(cancelledRevenue).toLocaleString('en-GB')} of negative value.`,
  });

  /* -- 6. Quality ledger ------------------------------------------------ */
  const rules: LedgerQualityRule[] = [];
  const rule = (
    id: string, label: string, detection: string, rows: number, treatment: string, impact: string | null,
  ) => {
    if (rows <= 0) return;
    rules.push({ id, rule: label, detection, rows, pct: pct(rows, total), treatment, impact });
  };

  rule('cancelled', 'Cancelled invoices',
    `${cols.invoice} begins with "C"`,
    cancelledRows,
    'Held out of the analysis scope and reported separately.',
    `Removing them raises gross revenue by ${Math.abs(round(cancelledRevenue)).toLocaleString('en-GB')}, because reversals carry negative value.`);

  const negUncancelled = num(census.neg_qty_uncancelled) ?? 0;
  rule('negative_quantity', 'Negative quantity outside cancellations',
    `${cols.quantity ?? 'quantity'} < 0 and the invoice is not a cancellation`,
    negUncancelled,
    'Excluded from scope.',
    'These are write-offs, damages and stock adjustments rather than reversed sales. Treating them as cancellations would understate the cancellation rate; treating them as sales would net them wrongly against revenue.');

  rule('zero_quantity', 'Zero quantity', `${cols.quantity ?? 'quantity'} = 0`,
    num(census.zero_qty) ?? 0, 'Excluded from scope.', 'Contributes no revenue but inflates line counts.');

  rule('non_positive_price', 'Zero or negative unit price',
    `${cols.price ?? 'price'} <= 0`,
    num(census.bad_price) ?? 0,
    'Excluded from scope.',
    'Free samples, manual adjustments and bad-debt entries. Left in, they drag average order value down while adding no revenue.');

  rule('missing_customer', 'Missing customer identifier',
    `${cols.customer ?? 'customer'} IS NULL`,
    num(census.missing_customer) ?? 0,
    'Kept for revenue, excluded from every customer-level measure.',
    'Customer counts, repeat rate, RFM and cohorts are computed on the identified subset only. Dropping these rows entirely would silently delete real revenue.');

  rule('missing_description', 'Missing product description',
    `${cols.description ?? 'description'} IS NULL`,
    num(census.missing_description) ?? 0,
    'Kept; the product code still identifies the item.',
    'Affects labelling only, not any monetary figure.');

  rule('duplicates', 'Exact duplicate rows',
    'every column identical to another row',
    duplicates,
    'Reported, not removed.',
    'A repeated line can be a genuine re-scan of the same item on one invoice. Silently de-duplicating would destroy real units, so this is surfaced for a human decision instead.');

  const netRevenue = num(census.net_revenue) ?? 0;
  const reconciliation = [
    { label: 'All rows in file', rows: total, revenue: round(netRevenue), note: 'Cancellations included, so revenue here is net of reversals.' },
    {
      label: 'Less cancelled invoices', rows: total - cancelledRows, revenue: round(netRevenue - cancelledRevenue),
      note: 'Reversals removed. Revenue rises because the reversals were negative.',
    },
    {
      label: 'Less non-positive quantity and price', rows: lines, revenue: round(revenue),
      note: 'The analysis scope used by every figure on this page.',
    },
  ];

  const qualitySummary =
    `${total.toLocaleString('en-GB')} rows in, ${lines.toLocaleString('en-GB')} in scope ` +
    `(${pct(lines, total).toFixed(2)}%). ${(total - lines).toLocaleString('en-GB')} rows ` +
    `(${pct(total - lines, total).toFixed(2)}%) were held out by the rules below, each one stated as an executable predicate.`;

  /* -- 7. Trends -------------------------------------------------------- */
  const trends: LedgerTrend[] = [];
  if (cols.date) {
    for (const grain of ['day', 'week', 'month'] as const) {
      try {
        const rows = await query<Record<string, unknown>>(
          conn,
          `SELECT CAST(date_trunc('${grain}', CAST(${ident(cols.date)} AS TIMESTAMP)) AS VARCHAR) AS period,
                  sum(${rev}) AS revenue,
                  count(DISTINCT CAST(${ident(cols.invoice)} AS VARCHAR)) AS orders,
                  ${qtyExpr} AS units,
                  ${custExpr} AS customers
             FROM ${t} WHERE ${scopeSql} AND ${ident(cols.date)} IS NOT NULL
            GROUP BY 1 ORDER BY 1`,
        );
        if (rows.length < 2) continue;
        const points: LedgerTrendPoint[] = rows.map((r) => ({
          period: str(r.period),
          label: labelFor(str(r.period), grain),
          revenue: round(num(r.revenue) ?? 0),
          orders: num(r.orders) ?? 0,
          units: round(num(r.units) ?? 0, 0),
          customers: num(r.customers) ?? 0,
        }));
        trends.push({
          grain,
          points,
          periods: points.length,
          partial_last: partial,
          note: partial
            ? `The final ${grain} is incomplete - the file stops at ${fmtDate(dateMax)} - so its bar is short for a mechanical reason.`
            : `${points.length} complete ${grain} periods.`,
        });
      } catch { /* a grain that fails is simply not offered */ }
    }
  }

  /* -- 8. Pareto -------------------------------------------------------- */
  const pareto: ParetoBlock[] = [];
  const paretoTargets: { column: string | null; label: string; kind: string }[] = [
    { column: cols.product, label: 'Products', kind: 'product' },
    { column: cols.customer, label: 'Customers', kind: 'customer' },
    { column: cols.country, label: 'Countries', kind: 'country' },
  ];
  for (const target of paretoTargets) {
    if (!target.column) continue;
    try {
      const block = await paretoFor(conn, table, target.column, target.label, target.kind, rev, scopeSql);
      if (block) pareto.push(block);
    } catch { /* skip */ }
  }

  /* -- 9. RFM ----------------------------------------------------------- */
  let rfm: RfmBlock | null = null;
  if (cols.customer && cols.date && dateMax) {
    try {
      rfm = await buildRfm(conn, table, cols, rev, scopeSql, dateMax);
    } catch { rfm = null; }
  }

  const notes: string[] = [
    `Revenue is ${revenueFormula(cols)}. Every figure on this page was produced by the SQL shown beside it.`,
    'Scope is stated on every card. A figure labelled "whole file" and a figure labelled "completed sales" are different measurements and are never mixed.',
  ];
  if (partialNote) notes.push(partialNote);
  if (repeat) notes.push(repeat.note);

  return {
    detected: true,
    columns: cols,
    grain_note:
      `One row per line item. ${lines.toLocaleString('en-GB')} in-scope rows resolve to ` +
      `${orders.toLocaleString('en-GB')} invoices` +
      (customers !== null ? ` and ${customers.toLocaleString('en-GB')} identified customers.` : '.'),
    scope,
    kpis,
    quality_rules: rules,
    quality_summary: qualitySummary,
    reconciliation,
    trends,
    pareto,
    rfm,
    repeat,
    notes,
  };
}

function labelFor(iso: string, grain: 'day' | 'week' | 'month'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  if (grain === 'month') return `${m} ${d.getUTCFullYear()}`;
  if (grain === 'week') return `w/c ${d.getUTCDate()} ${m}`;
  return `${d.getUTCDate()} ${m}`;
}

/* ------------------------------------------------------------------ *
 * Pareto
 * ------------------------------------------------------------------ */

async function paretoFor(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
  column: string,
  label: string,
  kind: string,
  rev: string,
  scopeSql: string,
): Promise<ParetoBlock | null> {
  const rows = await query<{ name: unknown; value: unknown }>(
    conn,
    `SELECT CAST(${ident(column)} AS VARCHAR) AS name, sum(${rev}) AS value
       FROM ${ident(table)}
      WHERE ${scopeSql} AND ${ident(column)} IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC NULLS LAST`,
  );
  if (rows.length < 3) return null;

  const parsed = rows
    .map((r) => ({ name: str(r.name) || '(blank)', value: num(r.value) ?? 0 }))
    .filter((r) => r.value > 0);
  const total = parsed.reduce((a, r) => a + r.value, 0);
  if (!total) return null;

  let cumulative = 0;
  let entitiesFor80 = 0;
  const entries: ParetoEntry[] = [];
  parsed.forEach((r, i) => {
    cumulative += r.value;
    const cumPct = (cumulative / total) * 100;
    if (!entitiesFor80 && cumPct >= 80) entitiesFor80 = i + 1;
    if (i < 15) {
      entries.push({
        rank: i + 1, name: r.name, value: round(r.value),
        share_pct: pct(r.value, total), cumulative_pct: round(cumPct, 2),
      });
    }
  });
  if (!entitiesFor80) entitiesFor80 = parsed.length;

  const sharePct = pct(entitiesFor80, parsed.length);
  const topShare = entries.length ? entries[0].share_pct : 0;

  return {
    dimension: column,
    label,
    kind,
    total: round(total),
    entities: parsed.length,
    entries,
    entities_for_80pct: entitiesFor80,
    entities_for_80pct_share: sharePct,
    top1_share_pct: topShare,
    headline:
      `${entitiesFor80.toLocaleString('en-GB')} of ${parsed.length.toLocaleString('en-GB')} ${label.toLowerCase()} ` +
      `(${sharePct.toFixed(1)}%) generate 80% of in-scope revenue.`,
  };
}

/* ------------------------------------------------------------------ *
 * RFM
 * ------------------------------------------------------------------ */

/**
 * RFM scoring by rank percentile rather than `NTILE`.
 *
 * Transaction data has a hard mode at frequency = 1 - most customers buy once -
 * which spans several quintile boundaries. `NTILE` then splits identical
 * customers across different scores purely on row order, which is arbitrary and
 * not reproducible. Ranking first and cutting on the rank percentile keeps ties
 * together.
 */
async function buildRfm(
  conn: duckdb.AsyncDuckDBConnection,
  table: string,
  cols: LedgerColumns,
  rev: string,
  scopeSql: string,
  asOf: string,
): Promise<RfmBlock | null> {
  const customer = cols.customer!;
  const date = cols.date!;

  const rows = await query<Record<string, unknown>>(
    conn,
    `WITH base AS (
       SELECT ${ident(customer)} AS cust,
              date_diff('day', max(CAST(${ident(date)} AS TIMESTAMP)), CAST('${asOf.replace(/'/g, "''")}' AS TIMESTAMP)) AS recency,
              count(DISTINCT CAST(${ident(cols.invoice)} AS VARCHAR)) AS frequency,
              sum(${rev}) AS monetary
         FROM ${ident(table)}
        WHERE ${scopeSql} AND ${ident(customer)} IS NOT NULL AND ${ident(date)} IS NOT NULL
        GROUP BY 1),
     scored AS (
       SELECT cust, recency, frequency, monetary,
              percent_rank() OVER (ORDER BY recency DESC) AS r_pct,
              percent_rank() OVER (ORDER BY frequency ASC) AS f_pct,
              percent_rank() OVER (ORDER BY monetary ASC) AS m_pct
         FROM base),
     banded AS (
       SELECT *,
              CAST(floor(r_pct * 5) AS INTEGER) + 1 AS r,
              CAST(floor(f_pct * 5) AS INTEGER) + 1 AS f,
              CAST(floor(m_pct * 5) AS INTEGER) + 1 AS m
         FROM scored)
     SELECT CASE
              WHEN r >= 4 AND f >= 4 AND m >= 4 THEN 'Champions'
              WHEN r >= 3 AND f >= 3 THEN 'Loyal'
              WHEN r >= 4 AND f <= 2 THEN 'New / promising'
              WHEN r >= 3 AND m >= 4 THEN 'Big spenders'
              WHEN r = 2 AND f >= 3 THEN 'At risk'
              WHEN r = 2 THEN 'Cooling'
              WHEN r = 1 AND m >= 4 THEN 'Lost high value'
              ELSE 'Dormant'
            END AS segment,
            count(*) AS customers,
            sum(monetary) AS revenue,
            avg(recency) AS avg_recency,
            avg(frequency) AS avg_frequency,
            avg(monetary) AS avg_monetary
       FROM banded GROUP BY 1 ORDER BY 3 DESC`,
  );
  if (!rows.length) return null;

  const totalCustomers = rows.reduce((a, r) => a + (num(r.customers) ?? 0), 0);
  const totalRevenue = rows.reduce((a, r) => a + (num(r.revenue) ?? 0), 0);

  const ACTIONS: Record<string, string> = {
    Champions: 'Protect. Early access and referral asks; do not discount - they already pay full price.',
    Loyal: 'Grow basket. Cross-sell adjacent categories rather than cutting price.',
    'New / promising': 'Convert to a second purchase. The first repeat is the highest-leverage moment in the lifecycle.',
    'Big spenders': 'Retain individually. High value but not yet frequent - account-managed contact beats a mass campaign.',
    'At risk': 'Intervene now. Frequent buyers who have gone quiet are the cheapest revenue to win back.',
    Cooling: 'Re-engage with a reason to return, before recency decays further.',
    'Lost high value': 'Win-back with a personal approach. Diagnose why they left before spending on an offer.',
    Dormant: 'Lowest priority. Suppress from paid channels to protect campaign efficiency.',
  };

  const segments: RfmSegment[] = rows.map((r) => {
    const seg = str(r.segment) || 'Unclassified';
    const cust = num(r.customers) ?? 0;
    const revenueVal = num(r.revenue) ?? 0;
    return {
      segment: seg,
      customers: cust,
      share_pct: pct(cust, totalCustomers),
      revenue: round(revenueVal),
      revenue_share_pct: pct(revenueVal, totalRevenue),
      avg_recency_days: round(num(r.avg_recency) ?? 0, 1),
      avg_frequency: round(num(r.avg_frequency) ?? 0, 2),
      avg_monetary: round(num(r.avg_monetary) ?? 0),
      action: ACTIONS[seg] ?? 'Review.',
    };
  });

  return {
    as_of: asOf,
    customers: totalCustomers,
    revenue: round(totalRevenue),
    segments,
    method: [
      `Recency is days from a customer's last in-scope invoice to ${fmtDate(asOf)}, the latest timestamp in the file.`,
      'Frequency counts distinct invoices, not rows, so a large basket does not masquerade as loyalty.',
      'Scores are rank percentiles cut into five bands. Ranking before banding keeps tied customers together - most customers buy exactly once, and NTILE would split that tie arbitrarily.',
      'Customers without an identifier cannot be scored and are excluded; their revenue is still counted in the totals elsewhere.',
    ],
  };
}
