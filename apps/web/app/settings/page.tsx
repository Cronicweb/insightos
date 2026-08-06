// InsightOS — AI Settings route (Phase 1).
// Additive static route. Does not alter any existing page or the deterministic pipeline.
// AI remains OFF by default; this page only lets a user opt in on their own device.
//
// NAVIGATION (this change only): adds a breadcrumb and a "Back to Dashboard" control at the
// top of the page so users can return to the main dashboard without the browser Back button.
// Uses next/link for client-side navigation — no full reload, so any dataset held in browser
// memory (DuckDB-WASM / localStorage) is preserved. No page redesign, no AI or settings changes.

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AISettingsPanel } from '@/components/settings/ai-settings-panel';

export const metadata: Metadata = {
  title: 'AI Settings \u2014 InsightOS',
  description:
    'Configure optional, grounded AI features for InsightOS. Deterministic analytics remain the single source of truth; only metadata is ever sent to a provider.',
};

export default function SettingsPage() {
  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto mb-6 w-full max-w-2xl">
        {/* Breadcrumb: "InsightOS" returns to the dashboard; current page is AI Settings. */}
        <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link
                href="/"
                className="rounded-sm text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                InsightOS
              </Link>
            </li>
            <li aria-hidden className="text-subtle">
              /
            </li>
            <li aria-current="page" className="font-medium text-ink">
              AI Settings
            </li>
          </ol>
        </nav>

        {/* Primary "Back to Dashboard" control — client-side navigation, no reload. */}
        <Link
          href="/"
          className="-ml-1 mb-4 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-1 py-1 text-sm text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Dashboard
        </Link>

        <h1 className="text-xl font-semibold tracking-tight">AI Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Optional AI assistance for explaining analytics. Everything is off by default and fully
          grounded in the deterministic engine.
        </p>
      </div>
      <AISettingsPanel />
    </main>
  );
}
