// InsightOS — AI Settings route (Phase 1).
// Additive static route. Does not alter any existing page or the deterministic pipeline.
// AI remains OFF by default; this page only lets a user opt in on their own device.

import type { Metadata } from 'next';
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
