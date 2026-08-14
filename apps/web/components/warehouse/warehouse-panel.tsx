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
// * All figures come from the marts; nothing is recomputed client-side, so the
//   dbt models (and their 37 tests) remain the single source of truth.
// * The API URL is stored on-device only (localStorage), matching how AI
//   provider settings are handled.

import * as React from 'react';
import {
  Database,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'insightos.warehouse.apiUrl';
const DEFAULT_URL = 'http://localhost:8000';

type Summary = {
  latest_month: {
    call_month: string;
    dials: number;
    connects: number;
    qualified_leads: number;
    conversions: number;
    spend: number;
    revenue: number;
    connect_rate: number;
    conversion_rate: number;
    roas: number;
  } | null;
  spam_flag_risks: {
    caller_id_pool: string;
    pool_description: string | null;
    connect_rate: number;
    connect_rate_mom_change: number;
  }[];
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
  | { phase: 'ready'; summary: Summary; pools: PoolRow[]; campaigns: CampaignRow[]; latestMonth: string };

const int = (n: number) => Math.round(n).toLocaleString('en-IN');
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);

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

export function WarehousePanel() {
  const [url, setUrl] = React.useState(DEFAULT_URL);
  const [state, setState] = React.useState<State>({ phase: 'idle' });

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
      const [summary, pools, campaigns] = await Promise.all([
        get('/warehouse/summary') as Promise<Summary>,
        get('/warehouse/pool-health?months=1') as Promise<{ rows: PoolRow[] }>,
        get('/warehouse/campaign-performance?months=1') as Promise<{ rows: CampaignRow[] }>,
      ]);
      window.localStorage.setItem(STORAGE_KEY, base);
      setState({
        phase: 'ready',
        summary,
        pools: pools.rows,
        campaigns: campaigns.rows,
        latestMonth: health.latest_month,
      });
    } catch (err) {
      setState({ phase: 'error', message: describeError(err, base) });
    }
  }, []);

  const m = state.phase === 'ready' ? state.summary.latest_month : null;
  const risks = state.phase === 'ready' ? state.summary.spam_flag_risks : [];

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

      {state.phase === 'ready' && m ? (
        <>
          {/* KPI cards - latest month across all campaigns */}
          <section aria-label="Latest month KPIs" data-testid="warehouse-kpis">
            <h2 className="mb-2 text-sm font-semibold text-muted">
              Latest month · {state.latestMonth}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Dials', value: int(m.dials) },
                { label: 'Connects', value: int(m.connects) },
                { label: 'Connect rate', value: pct(m.connect_rate) },
                { label: 'Conversions', value: int(m.conversions) },
                { label: 'Revenue', value: money(m.revenue) },
                { label: 'ROAS', value: `${m.roas.toFixed(2)}×` },
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
                    . Flagged by the dbt mart when a pool’s connect rate drops more than 30% month-over-month.
                  </span>
                </>
              ) : (
                <span className="text-muted">
                  No caller-ID pool is showing spam-flag risk in the latest month.
                </span>
              )}
            </div>
          </section>

          {/* Pool health table */}
          <section className="card overflow-hidden" data-testid="warehouse-pools">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
              Caller-ID pool health · fct_caller_id_pool_health
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
                  {state.pools.map((p) => (
                    <tr key={p.caller_id_pool} className="border-b border-line/60 last:border-0">
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

          {/* Campaign performance table */}
          <section className="card overflow-hidden" data-testid="warehouse-campaigns">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
              Campaign performance · fct_campaign_performance
            </h2>
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
                  {state.campaigns.map((c) => (
                    <tr key={c.campaign} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{c.campaign}</div>
                        {c.offering ? <div className="text-xs text-subtle">{c.offering}</div> : null}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{pct(c.connect_rate)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{int(c.conversions)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{money(c.spend)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-ink">{money(c.revenue)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{money(c.cpa)}</td>
                      <td className="px-4 py-2.5 tabular-nums font-semibold text-ink">{c.roas.toFixed(2)}×</td>
                    </tr>
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
