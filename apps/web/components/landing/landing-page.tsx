'use client';

import * as React from 'react';
import type { DatasetSummary } from '@/lib/types';
import { Badge, SectionLabel } from '@/components/ui/primitives';
import { formatInt } from '@/lib/format';
import {
  ArrowRight,
  BarChart3,
  Building2,
  Factory,
  FileText,
  GitBranch,
  Github,
  HeartPulse,
  Lightbulb,
  Lock,
  Megaphone,
  ShoppingCart,
  Store,
  Upload,
  Users,
} from 'lucide-react';

const REPO_URL = 'https://github.com/Cronicweb/insightos';

const PIPELINE = [
  { icon: Upload, title: 'Upload', detail: 'CSV, JSON or Parquet parsed in your browser with DuckDB-WASM.' },
  { icon: BarChart3, title: 'Automatic KPI discovery', detail: 'The domain is inferred, then the KPIs that matter for it are derived.' },
  { icon: GitBranch, title: 'Root cause analysis', detail: 'Every driver is tested for significance and ranked by contribution.' },
  { icon: Lightbulb, title: 'Executive recommendations', detail: 'Deterministic rules produce owned, auditable actions.' },
  { icon: FileText, title: 'Report', detail: 'A written executive brief you could send without editing.' },
];

const DOMAIN_ICON: Record<string, typeof Building2> = {
  banking: Building2,
  sales: ShoppingCart,
  marketing: Megaphone,
  retail: Store,
  healthcare: HeartPulse,
  hr: Users,
  manufacturing: Factory,
};

function iconFor(dataset: DatasetSummary) {
  const byKey = DOMAIN_ICON[dataset.key.toLowerCase()];
  if (byKey) return byKey;
  return DOMAIN_ICON[dataset.domain.toLowerCase()] ?? BarChart3;
}

export function LandingPage({
  datasets,
  onTryDemo,
  onUpload,
  engineVersion,
}: {
  datasets: DatasetSummary[];
  onTryDemo: (key: string) => void;
  onUpload: () => void;
  engineVersion?: string;
}) {
  const featured = datasets[0];

  return (
    <div className="canvas-gradient min-h-screen text-ink">
      <a
        href="#playground"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to the dataset playground
      </a>

      <header className="border-b border-line/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-md bg-accent text-[13px] font-bold text-white"
            >
              iO
            </span>
            <span className="text-[15px] font-semibold tracking-tight">InsightOS</span>
            {engineVersion ? (
              <span className="hidden text-[11px] text-subtle sm:inline">engine v{engineVersion}</span>
            ) : null}
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md px-3 text-[13px] font-medium text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Github className="h-4 w-4" aria-hidden />
            GitHub
          </a>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-14 pt-14 sm:px-6 sm:pt-20">
          <Badge tone="accent">Explainable analytics engine</Badge>
          <h1 className="mt-5 max-w-4xl text-[30px] font-semibold leading-[1.15] tracking-tight sm:text-[44px] lg:text-[52px]">
            Power BI tells you what happened.
            <span className="mt-2 block text-accent">
              InsightOS tells you why it happened and what to do next.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-base">
            Point it at a dataset and it profiles the schema, infers the business domain,
            derives the KPIs that matter, tests every candidate driver for statistical
            significance, and writes the executive brief. No dashboard authoring, no
            configuration, no backend.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() => onTryDemo(featured?.key ?? '')}
              disabled={!featured}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md bg-accent px-6 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
            >
              Try the demo
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onUpload}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md border border-line bg-elevated px-6 text-[14px] font-semibold text-ink transition-colors hover:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Upload className="h-4 w-4" aria-hidden />
              Upload your dataset
            </button>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md border border-line px-6 text-[14px] font-semibold text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Github className="h-4 w-4" aria-hidden />
              View source
            </a>
          </div>

          <p className="mt-5 inline-flex items-center gap-2 text-[12.5px] text-subtle">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Your data never leaves your device. All analysis runs locally in your browser.
          </p>
        </section>

        <section aria-labelledby="pipeline-heading" className="border-y border-line/70 bg-elevated/40">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <h2 id="pipeline-heading" className="sr-only">
              How InsightOS analyses a dataset
            </h2>
            <SectionLabel>The pipeline</SectionLabel>
            <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {PIPELINE.map((step, i) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.title}
                    className="rounded-lg border border-line bg-surface p-4"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-accent" aria-hidden />
                      <span className="text-[11px] font-semibold tabular-nums text-subtle">
                        0{i + 1}
                      </span>
                    </div>
                    <h3 className="mt-2.5 text-[13.5px] font-semibold leading-snug">{step.title}</h3>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{step.detail}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section id="playground" aria-labelledby="playground-heading" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionLabel>Dataset playground</SectionLabel>
          <h2 id="playground-heading" className="mt-2 text-[22px] font-semibold tracking-tight sm:text-[26px]">
            Bring nothing. Every dataset below is already analysed.
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
            Each one carries a real analytical story: a planted regression that the engine
            has to find on its own. Pick a domain to open the workspace.
          </p>

          <ul className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {datasets.map((d) => {
              const Icon = iconFor(d);
              return (
                <li key={d.key}>
                  <button
                    type="button"
                    onClick={() => onTryDemo(d.key)}
                    className="group flex h-full w-full flex-col rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-elevated"
                        >
                          <Icon className="h-4 w-4 text-accent" />
                        </span>
                        <span className="text-[13.5px] font-semibold leading-tight">{d.name}</span>
                      </div>
                      <Badge tone="neutral">{d.qualityGrade}</Badge>
                    </div>

                    <p className="mt-3 flex-1 text-[12.5px] leading-relaxed text-muted">
                      {d.description}
                    </p>

                    <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line/70 pt-3 text-[11px]">
                      <div>
                        <dt className="text-subtle">Rows</dt>
                        <dd className="mt-0.5 font-medium tabular-nums">{formatInt(d.rows)}</dd>
                      </div>
                      <div>
                        <dt className="text-subtle">KPIs</dt>
                        <dd className="mt-0.5 font-medium tabular-nums">{d.kpiCount}</dd>
                      </div>
                      <div>
                        <dt className="text-subtle">Actions</dt>
                        <dd className="mt-0.5 font-medium tabular-nums">{d.recommendationCount}</dd>
                      </div>
                    </dl>

                    <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent">
                      Open workspace
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </button>
                </li>
              );
            })}

            <li>
              <button
                type="button"
                onClick={onUpload}
                className="flex h-full w-full flex-col justify-center rounded-lg border border-dashed border-line bg-surface/50 p-4 text-left transition-colors hover:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span
                  aria-hidden
                  className="grid h-8 w-8 place-items-center rounded-md border border-line bg-elevated"
                >
                  <Upload className="h-4 w-4 text-accent" />
                </span>
                <span className="mt-3 text-[13.5px] font-semibold">Use your own data</span>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                  CSV, JSON or Parquet up to several hundred thousand rows. Parsed and
                  queried entirely in this tab; nothing is uploaded and nothing is stored.
                </p>
              </button>
            </li>
          </ul>
        </section>

        <section aria-labelledby="depth-heading" className="border-t border-line/70 bg-elevated/40">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 id="depth-heading" className="text-[22px] font-semibold tracking-tight">
              What makes it different
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  title: 'Nothing is a black box',
                  body: 'Every recommendation exposes the evidence rows, the statistical test used, the rules that fired, the alternatives that were rejected and a timestamped audit trail.',
                },
                {
                  title: 'Statistics, not vibes',
                  body: 'Drivers are ranked by contribution and screened with Poisson, chi-square, Mann-Whitney and Mann-Kendall tests, with Benjamini-Hochberg correction across the candidate set.',
                },
                {
                  title: 'Governed by design',
                  body: 'Datasets are scored for quality, freshness and trust, then assigned a decision-readiness level. Poor data caps the confidence of every recommendation derived from it.',
                },
                {
                  title: 'Private by default',
                  body: 'Sensitive columns are detected by name and by value, masked automatically, and excluded from drill-down until you explicitly allow it.',
                },
                {
                  title: 'Real SQL, in the browser',
                  body: 'DuckDB-WASM registers your file as a table. The analytics run as SQL you can read, and the SQL console lets you query the same tables directly.',
                },
                {
                  title: 'A framework, not an app',
                  body: 'The analytics core is a reusable Python package with per-domain plugins that supply KPIs, dimensions, root-cause rules and forecast settings.',
                },
              ].map((f) => (
                <article key={f.title} className="rounded-lg border border-line bg-surface p-4">
                  <h3 className="text-[13.5px] font-semibold">{f.title}</h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-[12px] text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>InsightOS - open-source explainable analytics. MIT licensed.</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Github className="h-3.5 w-3.5" aria-hidden />
            github.com/Cronicweb/insightos
          </a>
        </div>
      </footer>
    </div>
  );
}
