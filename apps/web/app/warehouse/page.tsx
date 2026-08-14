// InsightOS - Warehouse Mode route (additive static route, mirrors /settings).
// Renders the dbt-marts dashboard: the browser connects to a user-supplied
// InsightOS API URL and reads the tested marts (fct_campaign_performance,
// fct_caller_id_pool_health) that `dbt build` materialises in PostgreSQL.
// Nothing here touches the browser-only DuckDB-WASM pipeline.

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { WarehousePanel } from '@/components/warehouse/warehouse-panel';

export const metadata: Metadata = {
  title: 'Warehouse \u2014 InsightOS',
  description:
    'Warehouse mode: InsightOS reads dbt-modelled, test-guarded marts (staging \u2192 intermediate \u2192 marts over PostgreSQL) through the InsightOS API.',
};

export default function WarehousePage() {
  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto mb-6 w-full max-w-5xl">
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
              Warehouse
            </li>
          </ol>
        </nav>
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line px-3 text-sm text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Dashboard
        </Link>
      </div>
      <WarehousePanel />
    </main>
  );
}
