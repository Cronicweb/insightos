'use client';

import * as React from 'react';
import type { Analysis, DatasetSummary } from '@/lib/types';
import { fetchAnalysis, fetchIndex, IS_DEMO } from '@/lib/data';
import { TopNav, type WorkspaceTab } from '@/components/top-nav';
import { Sidebar } from '@/components/sidebar';
import { HeroMetric } from '@/components/panels/hero-metric';
import { ChartRenderer } from '@/components/charts/chart-renderer';
import { RootCausePanel } from '@/components/panels/root-cause-panel';
import { RecommendationsPanel } from '@/components/panels/recommendations-panel';
import { SqlPanel } from '@/components/panels/sql-panel';
import { ReportPanel } from '@/components/panels/report-panel';
import { QualityPanel } from '@/components/panels/quality-panel';
import { AnomaliesPanel } from '@/components/panels/anomalies-panel';
import { ForecastPanel } from '@/components/panels/forecast-panel';
import { Badge, SectionLabel, Skeleton } from '@/components/ui/primitives';
import { fixed, formatInt, formatPct, titleCase } from '@/lib/format';
import { UploadDialog } from '@/components/upload/upload-dialog';
import { AlertCircle, Upload } from 'lucide-react';

export default function Page() {
  const [datasets, setDatasets] = React.useState<DatasetSummary[]>([]);
  const [engineVersion, setEngineVersion] = React.useState<string>();
  const [activeKey, setActiveKey] = React.useState<string>('');
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [tab, setTab] = React.useState<WorkspaceTab>('overview');
  const [selectedKpi, setSelectedKpi] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [navOpen, setNavOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  // An uploaded dataset is held only in memory; it is never added to the demo index.
  const [uploaded, setUploaded] = React.useState<{ label: string; analysis: Analysis } | null>(null);

  // While the mobile drawer is open the page behind it must not scroll away.
  React.useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  React.useEffect(() => {
    let cancelled = false;
    fetchIndex()
      .then((idx) => {
        if (cancelled) return;
        setDatasets(idx.datasets);
        setEngineVersion(idx.engineVersion);
        setActiveKey((k) => k || idx.datasets[0]?.key || '');
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!activeKey || uploaded) return;
    let cancelled = false;
    setLoading(true);
    fetchAnalysis(activeKey)
      .then((a) => {
        if (cancelled) return;
        setAnalysis(a);
        setSelectedKpi(a.scorecard.primary_kpi_id ?? a.scorecard.kpis[0]?.id ?? null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeKey, uploaded]);

  const kpi = React.useMemo(() => {
    if (!analysis) return null;
    return (
      analysis.scorecard.kpis.find((k) => k.id === selectedKpi) ??
      analysis.scorecard.kpis[0] ??
      null
    );
  }, [analysis, selectedKpi]);

  return (
    <div className="canvas-gradient flex min-h-screen flex-col text-ink">
      <TopNav
        tab={tab}
        onTabChange={setTab}
        engineVersion={engineVersion}
        onMenu={() => setNavOpen(true)}
      />

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onAnalysed={(a, label) => {
          setUploaded({ label, analysis: a });
          setAnalysis(a);
          setSelectedKpi(a.scorecard.primary_kpi_id ?? a.scorecard.kpis[0]?.id ?? null);
          setTab('overview');
          setError(null);
          setLoading(false);
        }}
      />

      <div className="flex flex-1 flex-col lg:flex-row">
        <Sidebar
          datasets={datasets}
          activeKey={activeKey}
          onSelect={(k) => {
            setUploaded(null);
            setActiveKey(k);
          }}
          analysis={analysis}
          selectedKpi={selectedKpi}
          onSelectKpi={(id) => {
            setSelectedKpi(id);
            setTab('overview');
          }}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />

        <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setUploadOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-elevated"
            >
              <Upload className="h-4 w-4" />
              Upload dataset
            </button>
            {uploaded ? (
              <>
                <Badge tone="accent">Analysed locally: {uploaded.label}</Badge>
                <span className="text-2xs text-subtle">
                  Computed in your browser - nothing was uploaded.
                </span>
              </>
            ) : (
              <span className="text-2xs text-subtle">
                CSV, JSON or Parquet. Your data never leaves your device.
              </span>
            )}
          </div>
          {error ? <ErrorState message={error} /> : null}
          {!error && (loading || !analysis) ? <LoadingState /> : null}
          {!error && analysis && !loading ? (
            <Workspace analysis={analysis} tab={tab} kpiId={kpi?.id ?? null} onTab={setTab} />
          ) : null}
        </main>
      </div>

      <footer className="border-t border-line px-3 py-5 sm:px-4 lg:px-6 text-2xs text-subtle">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            InsightOS &mdash; deterministic analytics engine
            {engineVersion ? ` v${engineVersion}` : ''}.
          </span>
          <span>
            {IS_DEMO
              ? 'Demo mode: rendering pre-computed engine output, no server required.'
              : 'Live mode: connected to the InsightOS API.'}
          </span>
          <span className="lg:ml-auto">
            MIT licensed &middot; every number on this page was computed, not written.
          </span>
        </div>
      </footer>
    </div>
  );
}

function Workspace({
  analysis,
  tab,
  kpiId,
  onTab,
}: {
  analysis: Analysis;
  tab: WorkspaceTab;
  kpiId: string | null;
  onTab: (t: WorkspaceTab) => void;
}) {
  const chart = (id: string) => analysis.charts.find((c) => c.id === id);
  const byKind = (kind: string) => analysis.charts.filter((c) => c.kind === kind);

  if (tab === 'overview') {
    const kpi = analysis.scorecard.kpis.find((k) => k.id === kpiId) ?? analysis.scorecard.kpis[0];
    const hero = kpi ? chart(`hero.${kpi.id}`) : undefined;
    const marimekko = byKind('marimekko')[0];
    const donuts = byKind('donut');
    const tables = byKind('table');

    return (
      <div className="space-y-4">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        {kpi ? <HeroMetric kpi={kpi} spec={hero} analysis={analysis} /> : null}

        {marimekko ? <ChartRenderer spec={marimekko} height={300} /> : null}

        <div className="grid gap-4 xl:grid-cols-3">
          {donuts.map((d) => (
            <ChartRenderer key={d.id} spec={d} height={230} />
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {tables.map((t) => (
            <ChartRenderer key={t.id} spec={t} />
          ))}
        </div>

        <AnomaliesPanel report={analysis.anomalies} />
      </div>
    );
  }

  if (tab === 'root-cause') {
    const waterfalls = byKind('waterfall');
    return (
      <div className="space-y-6">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        {analysis.root_causes.length ? (
          analysis.root_causes.map((tree, i) => (
            <div key={tree.metric} className="space-y-4">
              <RootCausePanel tree={tree} />
              {waterfalls[i] ? <ChartRenderer spec={waterfalls[i]} height={280} /> : null}
            </div>
          ))
        ) : (
          <EmptyState message="No metric moved enough between periods to warrant a root-cause investigation." />
        )}
      </div>
    );
  }

  if (tab === 'quality') {
    return (
      <div className="space-y-4">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        <QualityPanel analysis={analysis} chart={chart('quality.dimensions')} />
      </div>
    );
  }

  if (tab === 'forecast') {
    return (
      <div className="space-y-4">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        <ForecastPanel analysis={analysis} />
      </div>
    );
  }

  if (tab === 'sql') {
    return (
      <div className="space-y-4">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        <SqlPanel analysis={analysis} />
      </div>
    );
  }

  if (tab === 'actions') {
    return (
      <div className="space-y-4">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        <RecommendationsPanel set={analysis.recommendations} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DatasetHeader analysis={analysis} onTab={onTab} />
      <ReportPanel report={analysis.report} />
    </div>
  );
}

function DatasetHeader({
  analysis,
  onTab,
}: {
  analysis: Analysis;
  onTab: (t: WorkspaceTab) => void;
}) {
  const totalMs = Object.values(analysis.timings_ms).reduce((a, b) => a + b, 0);

  return (
    <header className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <SectionLabel>Dataset</SectionLabel>
          <h1 className="mt-1.5 text-lg font-semibold tracking-tight sm:text-xl">{analysis.dataset}</h1>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted">
            {analysis.story}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="accent">
            {titleCase(analysis.domain.domain)} &middot;{' '}
            {formatPct(analysis.domain.confidence * 100, 0)} confidence
          </Badge>
          <Badge tone="neutral">{formatInt(analysis.rows)} rows</Badge>
          <Badge tone="neutral">{analysis.columns} columns</Badge>
          <button onClick={() => onTab('quality')}>
            <Badge tone={analysis.quality.score >= 90 ? 'positive' : 'warning'}>
              Quality {fixed(analysis.quality.score, 1)} ({analysis.quality.grade})
            </Badge>
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-2xs text-subtle">
        <span>{analysis.domain.rationale}</span>
        <span className="sm:ml-auto">Full pipeline computed in {fixed(totalMs / 1000, 2)}s</span>
      </div>

      {analysis.warnings.length ? (
        <div className="mt-3 flex gap-2 rounded-xl border border-warning/40 bg-warning/5 px-3 py-2">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
          <div className="text-2xs text-muted">{analysis.warnings.join(' \u00b7 ')}</div>
        </div>
      ) : null}
    </header>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-80 w-full" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-12 text-center text-sm text-subtle">
      {message}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-negative/40 bg-negative/5 p-6">
      <div className="flex items-center gap-2 text-negative">
        <AlertCircle className="h-4 w-4" />
        <h2 className="text-[15px] font-semibold">Could not load engine output</h2>
      </div>
      <p className="mt-2 text-[13px] text-muted">{message}</p>
      <p className="mt-2 text-2xs text-subtle">
        In demo mode the app reads static JSON from <code>/demo/</code>. Run{' '}
        <code>python -m insightos.cli demo build</code> to regenerate it.
      </p>
    </div>
  );
}
