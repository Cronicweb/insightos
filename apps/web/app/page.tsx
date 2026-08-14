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
import { GovernancePanel } from '@/components/panels/governance-panel';
import { ExecutiveBrief } from '@/components/panels/executive-brief';
import { ReportPanel } from '@/components/panels/report-panel';
import { QualityPanel } from '@/components/panels/quality-panel';
import { AnomaliesPanel } from '@/components/panels/anomalies-panel';
import { ForecastPanel } from '@/components/panels/forecast-panel';
import { LedgerPanel } from '@/components/panels/ledger-panel';
import { CaseStudyPanel } from '@/components/panels/case-study-panel';
import { downloadAnalysisCsv, printReport } from '@/lib/export/report-export';
import { Badge, SectionLabel, Skeleton } from '@/components/ui/primitives';
import { fixed, formatInt, formatPct, titleCase } from '@/lib/format';
import { UploadDialog } from '@/components/upload/upload-dialog';
import { LandingPage } from '@/components/landing/landing-page';
import { MobileNav } from '@/components/mobile-nav';
import { AlertCircle, Compass, Download, Printer, Upload } from 'lucide-react';
import { modeNotice, resolveMode } from '@/lib/mode-copy';
import { InsightAnalystWorkspace } from '@/components/analyst/insight-analyst-workspace';
import { SemanticReviewDialog } from '@/components/semantic/semantic-review-dialog';
import { ProductTour, useProductTour } from '@/components/onboarding/product-tour';
import {
  AnalystFacade,
  loadAISettings,
  draftToProposals,
  requiresReview,
  type SemanticMappingProposal,
  type SemanticModelDraft,
} from '@/lib/ai';

// Route to the additive AI Settings page. basePath-safe for the static export.
function goToSettings() {
  if (typeof window === 'undefined') return;
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  window.location.assign(`${base}/settings/`);
}

// Route to the additive Warehouse Mode page (dbt marts over PostgreSQL via the API).
function goToWarehouse() {
  if (typeof window === 'undefined') return;
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  window.location.assign(`${base}/warehouse/`);
}

// Wiring-only Semantic Review entry point (§14.4). Reuses the existing SemanticModelDraft shape,
// draftToProposals + requiresReview, and AnalystFacade.ensureSemanticModel/commitSemanticModel.
// No new abstractions; the deterministic engine remains authoritative.

/** Build the advisory SemanticModelDraft from the deterministic schema (metadata only, no provider call). */
function draftFromAnalysis(a: Analysis): SemanticModelDraft {
  const schema = a.schema;
  const measures = new Set(schema.measures ?? []);
  const times = new Set(schema.time_columns ?? []);
  const ids = new Set([...(schema.identifiers ?? []), ...(schema.primary_key ?? [])]);
  const columns = (schema.columns ?? []).map((c) => {
    const roleHint: SemanticModelDraft['columns'][number]['roleHint'] = times.has(c.name)
      ? 'time'
      : ids.has(c.name)
        ? 'identifier'
        : measures.has(c.name)
          ? 'measure'
          : 'dimension';
    // Confidence from the deterministic profile: a clean, well-typed column is high-confidence;
    // ambiguous/constant/mostly-missing columns fall below the review threshold so the user confirms.
    const missingPenalty = Math.min(Math.max(c.missing_pct ?? 0, 0), 100) / 100;
    let confidence = 0.9 - missingPenalty * 0.5;
    if (c.is_constant) confidence = Math.min(confidence, 0.4);
    if ((c.semantic_type ?? '') === '' || c.semantic_type === 'unknown') confidence = Math.min(confidence, 0.55);
    confidence = Math.max(0.05, Math.min(0.99, confidence));
    return {
      name: c.name,
      conceptLabel: c.name,
      roleHint,
      confidence,
    };
  });
  return { domainHint: schema.name, columns };
}



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
  const tour = useProductTour();
  // An uploaded dataset is held only in memory; it is never added to the demo index.
  const [uploaded, setUploaded] = React.useState<{ label: string; analysis: Analysis } | null>(null);
  // The landing page is the default surface; the workspace mounts once a
  // dataset has been chosen. #workspace deep-links straight into it.
  const [entered, setEntered] = React.useState(false);
  // Optional AI-gated semantic review, shown between upload and analytics when AI is enabled.
  const [review, setReview] = React.useState<{ analysisKey: string; proposals: SemanticMappingProposal[] } | null>(null);

  // Entry point for Semantic Review (wiring only). Returns true if a review dialog was opened,
  // so the caller can defer navigation. When AI is OFF this is a no-op returning false, which
  // preserves the exact deterministic Upload → Overview behaviour.
  const beginSemanticReview = React.useCallback((a: Analysis): boolean => {
    if (!loadAISettings().enabled) return false;
    const draft = draftFromAnalysis(a);
    const proposals = draftToProposals(draft);
    // Evaluate confidence. If nothing needs confirmation, commit silently and continue to Overview.
    if (!requiresReview(proposals)) {
      const facade = new AnalystFacade(a.key);
      facade.ensureSemanticModel(draft); // caches a committed model (no review needed)
      return false;
    }
    setReview({ analysisKey: a.key, proposals });
    return true;
  }, []);

  React.useEffect(() => {
    if (window.location.hash === '#workspace') setEntered(true);
  }, []);

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
    if (!entered || !activeKey || uploaded) return;
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
  }, [entered, activeKey, uploaded]);

  const kpi = React.useMemo(() => {
    if (!analysis) return null;
    return (
      analysis.scorecard.kpis.find((k) => k.id === selectedKpi) ??
      analysis.scorecard.kpis[0] ??
      null
    );
  }, [analysis, selectedKpi]);

  if (!entered) {
    return (
      <>
        <LandingPage
          datasets={datasets}
          engineVersion={engineVersion}
          onTryDemo={(key) => {
            if (key) setActiveKey(key);
            setUploaded(null);
            setTab('overview');
            setEntered(true);
          }}
          onUpload={() => setUploadOpen(true)}
        />
        <UploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onAnalysed={(a, label) => {
            setUploaded({ label, analysis: a });
            setAnalysis(a);
            setSelectedKpi(a.scorecard.primary_kpi_id ?? a.scorecard.kpis[0]?.id ?? null);
            setError(null);
            setLoading(false);
            setEntered(true);
            // AI ON → maybe Semantic Review; AI OFF → straight to Overview (unchanged behaviour).
            if (!beginSemanticReview(a)) setTab('overview');
          }}
        />
      </>
    );
  }

  return (
    <div className="print-flow canvas-gradient flex min-h-screen flex-col text-ink">
      <a
        href="#workspace-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to analysis
      </a>
      <TopNav
        tab={tab}
        onTabChange={setTab}
        engineVersion={engineVersion}
        onMenu={() => setNavOpen(true)}
        onHome={() => {
          if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
          setEntered(false);
        }}
        onSettings={goToSettings}
        onWarehouse={goToWarehouse}
      />

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onAnalysed={(a, label) => {
          setUploaded({ label, analysis: a });
          setAnalysis(a);
          setSelectedKpi(a.scorecard.primary_kpi_id ?? a.scorecard.kpis[0]?.id ?? null);
          setError(null);
          setLoading(false);
          // AI ON → maybe Semantic Review; AI OFF → straight to Overview (unchanged behaviour).
          if (!beginSemanticReview(a)) setTab('overview');
        }}
      />

      <div className="print-flow flex flex-1 flex-col lg:flex-row">
        <Sidebar
          datasets={datasets}
          activeKey={activeKey}
          uploadedLabel={uploaded?.label ?? null}
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

        <main id="workspace-main" className="min-w-0 flex-1 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setUploadOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-elevated"
            >
              <Upload className="h-4 w-4" />
              Upload dataset
            </button>
            <button
              onClick={tour.reopen}
              title="How to read this workspace"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-elevated"
            >
              <Compass className="h-4 w-4" />
              How it works
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
                CSV, Excel, JSON or Parquet. Your data never leaves your device.
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
            {modeNotice(resolveMode({ uploaded: Boolean(uploaded), demo: IS_DEMO }))}
          </span>
          <span className="lg:ml-auto">
            MIT licensed &middot; every number on this page was computed, not written.
          </span>
        </div>
      </footer>

      {review ? (
        <SemanticReviewDialog
          proposals={review.proposals}
          onCancel={() => {
            setReview(null);
            setTab('overview');
          }}
          onConfirm={(resolved) => {
            // Reuse the existing semantic model builder + facade cache; no new logic.
            const facade = new AnalystFacade(review.analysisKey);
            facade.commitSemanticModel(resolved);
            setReview(null);
            setTab('analyst');
          }}
        />
      ) : null}

      <ProductTour open={tour.open} onClose={tour.close} />

      <MobileNav tab={tab} onTabChange={setTab} />
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
        <ExecutiveBrief analysis={analysis} onTab={onTab} />
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
              <RootCausePanel tree={tree} analysis={analysis} />
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

  if (tab === 'governance') {
    return (
      <div className="space-y-4">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        {analysis.governance || analysis.privacy ? (
          <GovernancePanel governance={analysis.governance} privacy={analysis.privacy} />
        ) : (
          <EmptyState message="This analysis was produced before the governance layer existed, so no lineage or privacy metadata is attached." />
        )}
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

  if (tab === 'ledger') {
    return (
      <div className="space-y-4">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        {analysis.ledger ? (
          <LedgerPanel ledger={analysis.ledger} />
        ) : (
          <EmptyState message="This dataset is not an invoice- or transaction-grain extract, so the ledger audit does not apply. It needs an order identifier together with either a line total or a quantity and a unit price." />
        )}
      </div>
    );
  }

  if (tab === 'case-study') {
    return (
      <div className="space-y-4">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        <CaseStudyPanel analysis={analysis} />
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

  if (tab === 'analyst') {
    const analysisKey = (analysis as { key?: string }).key ?? analysis.dataset ?? 'analysis';
    return (
      <div className="space-y-4">
        <DatasetHeader analysis={analysis} onTab={onTab} />
        <InsightAnalystWorkspace
          analysisKey={analysisKey}
          analysis={analysis as unknown as import('@/lib/ai/context').AnalysisLike}
          onOpenSettings={goToSettings}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DatasetHeader analysis={analysis} onTab={onTab} />
      <ExportBar analysis={analysis} />
      <ReportPanel report={analysis.report} />
    </div>
  );
}

/**
 * Export controls.
 *
 * `print-hidden` keeps the buttons out of the PDF they produce - printing a
 * page that shows a "Download PDF" button looks like a screenshot rather than
 * a report.
 */
function ExportBar({ analysis }: { analysis: Analysis }) {
  return (
    <div className="print-hidden flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="min-w-0 flex-1">
        <SectionLabel>Download report</SectionLabel>
        <p className="mt-1 text-2xs leading-relaxed text-muted">
          CSV exports every figure in long form with its scope and formula, so the numbers can be checked
          in a spreadsheet. PDF prints this analysis through the browser, keeping the export identical to
          what is on screen.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          onClick={() => downloadAnalysisCsv(analysis)}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-xs font-medium text-fg transition hover:border-accent/40 hover:text-accent"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
        <button
          type="button"
          onClick={() => printReport()}
          className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium text-accent transition hover:bg-accent/15"
        >
          <Printer className="h-3.5 w-3.5" />
          PDF
        </button>
      </div>
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
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading analysis…</span>
      <Skeleton className="h-28 w-full" aria-hidden />
      <Skeleton className="h-80 w-full" aria-hidden />
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-64 w-full" aria-hidden />
        <Skeleton className="h-64 w-full" aria-hidden />
        <Skeleton className="h-64 w-full" aria-hidden />
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