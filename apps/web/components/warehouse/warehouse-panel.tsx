'use client';

// Warehouse Mode panel.
//
// InsightOS's second analytics architecture: instead of analysing an uploaded
// file in the browser (DuckDB-WASM), this panel reads *modelled, test-guarded*
// marts that dbt materialises in PostgreSQL (staging -> intermediate -> marts)
// through the InsightOS API's /warehouse endpoints.
//
// Design rules honoured here:
// * Purely additive - no shared state with the browser pipeline.
// * All figures come from the marts; the API's /warehouse/trends endpoint does
//   the monthly rollup in SQL, so nothing is recomputed client-side and the
//   dbt models (and their tests) remain the single source of truth. The
//   browser only *selects* (filters by month / campaign) - it never aggregates.
// * The API URL is stored on-device only (localStorage), matching how AI
//   provider settings are handled.

import * as React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Database,
  Filter,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'insightos.warehouse.apiUrl';
const DEFAULT_URL = 'http://localhost:8000';
const TRAILING_MONTHS = 18;

type TrendRow = {
  call_month: string;
  dials: number;
  connects: number;
  qualified_leads: number;
  conversions: number;
  spend: number;
  revenue: number;
  connect_rate: number;
  qualification_rate: number | null;
  close_rate: number | null;
  conversion_rate: number;
  roas: number;
};

type PoolRow = {
  call_month: string;
  caller_id_pool: string;
  pool_description: string | null;
  dials: number;
  connects: number;
  connect_rate: number;
  prev_connect_rate: number | null;
  connect_rate_mom_change: number | null;
  spam_flag_risk: boolean;
};

type CampaignRow = {
  call_month: string;
  campaign: string;
  business_line: string | null;
  offering: string | null;
  dials: number;
  connects: number;
  qualified_leads: number;
  conversions: number;
  connect_rate: number;
  conversion_rate: number;
  spend: number;
  revenue: number;
  cpa: number;
  roas: number;
};

type State =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      trends: TrendRow[];
      pools: PoolRow[];
      campaigns: CampaignRow[];
      latestMonth: string;
    };

const int = (n: number) => Math.round(n).toLocaleString('en-IN');
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);

const compact = (n: number) => {
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
};

const monthLabel = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function describeError(err: unknown, url: string): string {
  if (err instanceof TypeError) {
    return (
      `Could not reach ${url}. Check that the InsightOS API is running ` +
      '(`docker compose --profile warehouse up` starts Postgres, runs dbt and serves the API) ' +
      'and that its CORS settings allow this origin.'
    );
  }
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------ mini charts ------------------------------ */

type SeriesDef = { key: string; label: string; color: string; format: (n: number) => string };

function TrendChart({
  title,
  data,
  series,
  selectedLabel,
  yFormat,
  height = 190,
}: {
  title: string;
  data: Record<string, number | string>[];
  series: SeriesDef[];
  selectedLabel: string;
  yFormat: (n: number) => string;
  height?: number;
}) {
  const axis = { stroke: 'transparent', tickLine: false, axisLine: false } as const;
  return (
    <div className="card p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-muted">{title}</h3>
        <div className="flex items-center gap-3">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1 text-2xs text-subtle">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgb(var(--line))" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={28} tick={{ fontSize: 11, fill: 'rgb(var(--subtle))' }} />
          <YAxis {...axis} width={46} tickFormatter={(v: number) => yFormat(v)} tick={{ fontSize: 11, fill: 'rgb(var(--subtle))' }} />
          <Tooltip
            cursor={{ stroke: 'rgb(var(--line))', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
                  <div className="text-2xs text-subtle">{label}</div>
                  {payload.map((p) => {
                    const def = series.find((s) => s.key === p.dataKey);
                    if (!def) return null;
                    return (
                      <div key={String(p.dataKey)} className="flex items-center gap-1.5 text-[13px] tabular-nums">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: def.color }} aria-hidden />
                        <span className="text-muted">{def.label}</span>
                        <span className="font-semibold text-ink">{def.format(Number(p.value))}</span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; payload?: { label?: string } }) => {
                const sel = props.payload?.label === selectedLabel;
                return (
                  <circle
                    key={`${s.key}-${props.payload?.label}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={sel ? 4 : 1.5}
                    fill={s.color}
                    stroke={sel ? 'rgb(var(--surface))' : 'none'}
                    strokeWidth={sel ? 1.5 : 0}
                  />
                );
              }}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* --------------------------------- panel --------------------------------- */

export function WarehousePanel() {
  const [url, setUrl] = React.useState(DEFAULT_URL);
  const [state, setState] = React.useState<State>({ phase: 'idle' });
  const [month, setMonth] = React.useState<string>('');
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setUrl(saved);
  }, []);

  const connect = React.useCallback(async (raw: string) => {
    const base = raw.trim().replace(/\/+$/, '');
    if (!base) return;
    setState({ phase: 'connecting' });
    try {
      const get = async (path: string) => {
        const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          let detail = `${res.status} ${res.statusText}`;
          try {
            const body = (await res.json()) as { detail?: string };
            if (body?.detail) detail = body.detail;
          } catch {
            /* non-JSON error body - keep the status line */
          }
          throw new Error(detail);
        }
        return res.json();
      };
      const health = (await get('/warehouse/health')) as { latest_month: string };
      const [trends, pools, campaigns] = await Promise.all([
        get(`/warehouse/trends?months=${TRAILING_MONTHS}`) as Promise<{ rows: TrendRow[] }>,
        get(`/warehouse/pool-health?months=${TRAILING_MONTHS}`) as Promise<{ rows: PoolRow[] }>,
        get(`/warehouse/campaign-performance?months=${TRAILING_MONTHS}`) as Promise<{ rows: CampaignRow[] }>,
      ]);
      window.localStorage.setItem(STORAGE_KEY, base);
      setMonth(health.latest_month);
      setExpanded(null);
      setState({
        phase: 'ready',
        trends: trends.rows,
        pools: pools.rows,
        campaigns: campaigns.rows,
        latestMonth: health.latest_month,
      });
    } catch (err) {
      setState({ phase: 'error', message: describeError(err, base) });
    }
  }, []);

  const ready = state.phase === 'ready' ? state : null;
  const months = React.useMemo(
    () => (ready ? [...ready.trends.map((t) => t.call_month)].reverse() : []),
    [ready],
  );
  const kpi = ready ? ready.trends.find((t) => t.call_month === month) ?? null : null;
  const poolRows = ready ? ready.pools.filter((p) => p.call_month === month) : [];
  const risks = poolRows.filter((p) => p.spam_flag_risk);
  const campaignRows = ready ? ready.campaigns.filter((c) => c.call_month === month) : [];
  const chartData = React.useMemo(
    () =>
      ready
        ? ready.trends.map((t) => ({
            label: monthLabel(t.call_month),
            dials: t.dials,
            connects: t.connects,
            revenue: t.revenue,
            spend: t.spend,
            roas: t.roas,
            connect_rate: t.connect_rate * 100,
          }))
        : [],
    [ready],
  );
  const drill = React.useMemo(() => {
    if (!ready || !expanded) return null;
    const rows = ready.campaigns
      .filter((c) => c.campaign === expanded)
      .sort((a, b) => a.call_month.localeCompare(b.call_month));
    return {
      rows,
      chart: rows.map((r) => ({
        label: monthLabel(r.call_month),
        revenue: r.revenue,
        spend: r.spend,
        roas: r.roas,
      })),
    };
  }, [ready, expanded]);

  const funnel = kpi
    ? [
        { label: 'Dials', value: kpi.dials, rate: null as number | null },
        { label: 'Connects', value: kpi.connects, rate: kpi.connect_rate },
        { label: 'Qualified leads', value: kpi.qualified_leads, rate: kpi.qualification_rate },
        { label: 'Conversions', value: kpi.conversions, rate: kpi.close_rate },
      ]
    : [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {/* Header + connect */}
      <section className="card p-5" data-testid="warehouse-connect">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-elevated">
            <Database className="h-5 w-5 text-accent" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-ink">Warehouse Mode</h1>
            <p className="mt-1 text-sm text-muted">
              Reads dbt-modelled marts (staging → intermediate → marts over PostgreSQL) through the
              InsightOS API. Every figure below comes from{' '}
              <code className="rounded bg-elevated px-1 py-0.5 text-xs">fct_campaign_performance</code> and{' '}
              <code className="rounded bg-elevated px-1 py-0.5 text-xs">fct_caller_id_pool_health</code>,
              guarded by 37 dbt tests — nothing is recomputed in the browser.
            </p>
          </div>
        </div>

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void connect(url);
          }}
        >
          <label htmlFor="warehouse-api-url" className="sr-only">
            InsightOS API URL
          </label>
          <input
            id="warehouse-api-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={DEFAULT_URL}
            autoComplete="off"
            spellCheck={false}
            className="min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          <button
            type="submit"
            disabled={state.phase === 'connecting'}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {state.phase === 'connecting' ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="h-4 w-4" aria-hidden />
            )}
            {state.phase === 'connecting' ? 'Connecting…' : state.phase === 'ready' ? 'Refresh' : 'Connect'}
          </button>
        </form>
        <p className="mt-2 text-xs text-subtle">
          The URL is stored on this device only. Quick start:{' '}
          <code className="rounded bg-elevated px-1 py-0.5">docker compose --profile warehouse up</code>{' '}
          then connect to <code className="rounded bg-elevated px-1 py-0.5">http://localhost:8000</code>.
        </p>

        {state.phase === 'error' ? (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-negative/40 bg-negative/10 p-3 text-sm text-ink"
            data-testid="warehouse-error"
          >
            {state.message}
          </div>
        ) : null}
      </section>

      {ready && kpi ? (
        <>
          {/* Month selector + KPI cards */}
          <section aria-label="Monthly KPIs" data-testid="warehouse-kpis">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-muted">
                Month · {monthLabel(month)}
                {month === ready.latestMonth ? (
                  <span className="ml-1.5 rounded-md bg-accent/10 px-1.5 py-0.5 text-2xs font-semibold text-accent">
                    Latest
                  </span>
                ) : null}
              </h2>
              <label className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Filter className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">Month</span>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  data-testid="warehouse-month-select"
                  className="min-h-[36px] rounded-xl border border-line bg-surface px-2.5 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Dials', value: int(kpi.dials) },
                { label: 'Connects', value: int(kpi.connects) },
                { label: 'Connect rate', value: pct(kpi.connect_rate) },
                { label: 'Conversions', value: int(kpi.conversions) },
                { label: 'Revenue', value: money(kpi.revenue) },
                { label: 'ROAS', value: `${kpi.roas.toFixed(2)}×` },
              ].map((k) => (
                <div key={k.label} className="card p-4">
                  <div className="text-xs text-muted">{k.label}</div>
                  <div className="mt-1 truncate text-lg font-semibold tracking-tight text-ink">{k.value}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Spam-flag banner - straight from fct_caller_id_pool_health */}
          <section
            className={cn(
              'card flex items-start gap-3 p-4',
              risks.length ? 'border-negative/40' : 'border-positive/40',
            )}
            data-testid="warehouse-risk-banner"
          >
            {risks.length ? (
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-negative" aria-hidden />
            ) : (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-positive" aria-hidden />
            )}
            <div className="text-sm">
              {risks.length ? (
                <>
                  <span className="font-semibold text-ink">
                    Spam-flag risk: {risks.map((r) => r.caller_id_pool).join(', ')}.
                  </span>{' '}
                  <span className="text-muted">
                    {risks
                      .map(
                        (r) =>
                          `${r.caller_id_pool} connect rate ${pct(r.connect_rate)} (${pct(
                            r.connect_rate_mom_change,
                          )} MoM)`,
                      )
                      .join('; ')}
                    . Flagged by the dbt mart when a pool&rsquo;s connect rate drops more than 30% month-over-month.
                  </span>
                </>
              ) : (
                <span className="text-muted">
                  No caller-ID pool is showing spam-flag risk in {monthLabel(month)}.
                </span>
              )}
            </div>
          </section>

          {/* Funnel - selected month, straight from /warehouse/trends */}
          <section className="card p-4" data-testid="warehouse-funnel">
            <h2 className="mb-3 text-sm font-semibold text-ink">
              Monthly funnel · {monthLabel(month)}
            </h2>
            <div className="flex flex-col gap-2">
              {funnel.map((s, i) => (
                <div key={s.label} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-xs text-muted sm:w-36">{s.label}</div>
                  <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-elevated">
                    <div
                      className={cn('h-full rounded-lg', i === funnel.length - 1 ? 'bg-positive/70' : 'bg-accent/70')}
                      style={{ width: `${Math.max((s.value / funnel[0].value) * 100, 1.5)}%` }}
                    />
                    <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold tabular-nums text-ink">
                      {int(s.value)}
                    </span>
                  </div>
                  <div className="w-24 shrink-0 text-right text-xs tabular-nums text-subtle">
                    {s.rate == null ? '—' : `${pct(s.rate)} of prev.`}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-2xs text-subtle">
              Dials → connects → qualified leads → conversions, aggregated in SQL by{' '}
              <code className="rounded bg-elevated px-1 py-0.5">/warehouse/trends</code>.
            </p>
          </section>

          {/* Trend charts - trailing months from the marts */}
          <section aria-label="Trends" data-testid="warehouse-trends" className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted">
              Trends · trailing {ready.trends.length} months
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <TrendChart
                title="Call volumes"
                data={chartData}
                selectedLabel={monthLabel(month)}
                yFormat={compact}
                series={[
                  { key: 'dials', label: 'Dials', color: 'rgb(var(--accent))', format: int },
                  { key: 'connects', label: 'Connects', color: 'rgb(var(--positive))', format: int },
                ]}
              />
              <TrendChart
                title="Revenue vs spend"
                data={chartData}
                selectedLabel={monthLabel(month)}
                yFormat={compact}
                series={[
                  { key: 'revenue', label: 'Revenue', color: 'rgb(var(--accent))', format: money },
                  { key: 'spend', label: 'Spend', color: 'rgb(var(--warning))', format: money },
                ]}
              />
              <TrendChart
                title="ROAS"
                data={chartData}
                selectedLabel={monthLabel(month)}
                yFormat={(n) => `${n.toFixed(0)}×`}
                series={[{ key: 'roas', label: 'ROAS', color: 'rgb(var(--accent))', format: (n) => `${n.toFixed(2)}×` }]}
              />
              <TrendChart
                title="Connect rate"
                data={chartData}
                selectedLabel={monthLabel(month)}
                yFormat={(n) => `${n.toFixed(0)}%`}
                series={[
                  {
                    key: 'connect_rate',
                    label: 'Connect rate',
                    color: 'rgb(var(--positive))',
                    format: (n) => `${n.toFixed(1)}%`,
                  },
                ]}
              />
            </div>
          </section>

          {/* Pool health table - selected month */}
          <section className="card overflow-hidden" data-testid="warehouse-pools">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
              Caller-ID pool health · fct_caller_id_pool_health · {monthLabel(month)}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Pool</th>
                    <th className="px-4 py-2 font-medium">Dials</th>
                    <th className="px-4 py-2 font-medium">Connects</th>
                    <th className="px-4 py-2 font-medium">Connect rate</th>
                    <th className="px-4 py-2 font-medium">MoM change</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {poolRows.map((p) => (
                    <tr key={`${p.call_month}-${p.caller_id_pool}`} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{p.caller_id_pool}</div>
                        {p.pool_description ? (
                          <div className="text-xs text-subtle">{p.pool_description}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{int(p.dials)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{int(p.connects)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-ink">{pct(p.connect_rate)}</td>
                      <td
                        className={cn(
                          'px-4 py-2.5 tabular-nums',
                          (p.connect_rate_mom_change ?? 0) < 0 ? 'text-negative' : 'text-positive',
                        )}
                      >
                        <span className="inline-flex items-center gap-1">
                          {(p.connect_rate_mom_change ?? 0) < 0 ? (
                            <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {pct(p.connect_rate_mom_change)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {p.spam_flag_risk ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-negative/10 px-2 py-0.5 text-xs font-semibold text-negative">
                            <ShieldAlert className="h-3 w-3" aria-hidden />
                            Spam-flag risk
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-positive/10 px-2 py-0.5 text-xs font-medium text-positive">
                            Healthy
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Campaign performance table - selected month, expandable drill-down */}
          <section className="card overflow-hidden" data-testid="warehouse-campaigns">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">
                Campaign performance · fct_campaign_performance · {monthLabel(month)}
              </h2>
              <p className="mt-0.5 text-2xs text-subtle">Click a campaign to see its monthly history.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Campaign</th>
                    <th className="px-4 py-2 font-medium">Connect rate</th>
                    <th className="px-4 py-2 font-medium">Conversions</th>
                    <th className="px-4 py-2 font-medium">Spend</th>
                    <th className="px-4 py-2 font-medium">Revenue</th>
                    <th className="px-4 py-2 font-medium">CPA</th>
                    <th className="px-4 py-2 font-medium">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignRows.map((c) => (
                    <React.Fragment key={`${c.call_month}-${c.campaign}`}>
                      <tr
                        className={cn(
                          'cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-elevated/60',
                          expanded === c.campaign && 'bg-elevated/60',
                        )}
                        onClick={() => setExpanded((cur) => (cur === c.campaign ? null : c.campaign))}
                        data-testid={`warehouse-campaign-row-${c.campaign}`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5 font-medium text-ink">
                            {expanded === c.campaign ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                            )}
                            {c.campaign}
                          </div>
                          {c.offering ? <div className="pl-5 text-xs text-subtle">{c.offering}</div> : null}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-muted">{pct(c.connect_rate)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted">{int(c.conversions)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted">{money(c.spend)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-ink">{money(c.revenue)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted">{money(c.cpa)}</td>
                        <td className="px-4 py-2.5 tabular-nums font-semibold text-ink">{`${c.roas.toFixed(2)}×`}</td>
                      </tr>
                      {expanded === c.campaign && drill ? (
                        <tr className="border-b border-line/60 last:border-0">
                          <td colSpan={7} className="bg-elevated/40 px-4 py-4" data-testid="warehouse-drilldown">
                            <div className="grid gap-3 lg:grid-cols-2">
                              <TrendChart
                                title={`${c.campaign} · revenue vs spend`}
                                data={drill.chart}
                                selectedLabel={monthLabel(month)}
                                yFormat={compact}
                                height={170}
                                series={[
                                  { key: 'revenue', label: 'Revenue', color: 'rgb(var(--accent))', format: money },
                                  { key: 'spend', label: 'Spend', color: 'rgb(var(--warning))', format: money },
                                ]}
                              />
                              <TrendChart
                                title={`${c.campaign} · ROAS`}
                                data={drill.chart}
                                selectedLabel={monthLabel(month)}
                                yFormat={(n) => `${n.toFixed(0)}×`}
                                height={170}
                                series={[
                                  {
                                    key: 'roas',
                                    label: 'ROAS',
                                    color: 'rgb(var(--positive))',
                                    format: (n) => `${n.toFixed(2)}×`,
                                  },
                                ]}
                              />
                            </div>
                            <div className="mt-3 overflow-x-auto">
                              <table className="w-full min-w-[640px] text-xs">
                                <thead>
                                  <tr className="border-b border-line text-left text-2xs text-muted">
                                    <th className="px-3 py-1.5 font-medium">Month</th>
                                    <th className="px-3 py-1.5 font-medium">Dials</th>
                                    <th className="px-3 py-1.5 font-medium">Connects</th>
                                    <th className="px-3 py-1.5 font-medium">Conversions</th>
                                    <th className="px-3 py-1.5 font-medium">Spend</th>
                                    <th className="px-3 py-1.5 font-medium">Revenue</th>
                                    <th className="px-3 py-1.5 font-medium">ROAS</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {drill.rows.map((r) => (
                                    <tr
                                      key={r.call_month}
                                      className={cn(
                                        'border-b border-line/50 last:border-0',
                                        r.call_month === month && 'bg-accent/5 font-medium',
                                      )}
                                    >
                                      <td className="px-3 py-1.5 text-ink">{monthLabel(r.call_month)}</td>
                                      <td className="px-3 py-1.5 tabular-nums text-muted">{int(r.dials)}</td>
                                      <td className="px-3 py-1.5 tabular-nums text-muted">{int(r.connects)}</td>
                                      <td className="px-3 py-1.5 tabular-nums text-muted">{int(r.conversions)}</td>
                                      <td className="px-3 py-1.5 tabular-nums text-muted">{money(r.spend)}</td>
                                      <td className="px-3 py-1.5 tabular-nums text-ink">{money(r.revenue)}</td>
                                      <td className="px-3 py-1.5 tabular-nums font-semibold text-ink">
                                        {`${r.roas.toFixed(2)}×`}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-xs text-subtle">
            Lineage: raw.telesales_call_blocks → stg_telesales__call_blocks → int_telesales__monthly_funnel /
            int_telesales__pool_monthly → marts. Models, tests and docs live in{' '}
            <code className="rounded bg-elevated px-1 py-0.5">dbt/insightos_warehouse</code>.
          </p>
        </>
      ) : null}
    </div>
  );
}
