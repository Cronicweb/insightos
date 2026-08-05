'use client';

// InsightOS — AI Settings panel (Phase 1).
// Configures the additive, vendor-agnostic AI layer. ALL AI is OFF by default.
// The API key is stored ONLY in browser localStorage and never leaves the device
// except directly to the user's chosen provider. See docs/ai-architecture.md §3, §9, §13.

import * as React from 'react';
import {
  DEFAULT_AI_SETTINGS,
  GROQ_MODEL_OPTIONS,
  loadAISettings,
  saveAISettings,
  clearAISettings,
  type AISettings,
} from '@/lib/ai';
import { AVAILABLE_PROVIDERS } from '@/lib/ai/registry';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const FIELD_LABEL = 'block text-xs font-semibold text-muted mb-1.5';
const INPUT =
  'w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent';

function Toggle({
  id,
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-surface',
          checked ? 'bg-accent' : 'bg-elevated border border-line',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function AISettingsPanel() {
  const [settings, setSettings] = React.useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [showKey, setShowKey] = React.useState(false);

  React.useEffect(() => {
    setSettings(loadAISettings());
  }, []);

  const update = React.useCallback((patch: Partial<AISettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveAISettings(next);
      setSavedAt(Date.now());
      return next;
    });
  }, []);

  const reset = React.useCallback(() => {
    clearAISettings();
    setSettings({ ...DEFAULT_AI_SETTINGS });
    setSavedAt(Date.now());
  }, []);

  const aiOff = !settings.enabled;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>AI Settings</CardTitle>
            <CardSubtitle>
              Optional, grounded AI features. Deterministic analytics are always the source of truth.
            </CardSubtitle>
          </div>
          <Badge tone={settings.enabled ? 'accent' : 'neutral'}>
            {settings.enabled ? 'AI enabled' : 'AI disabled'}
          </Badge>
        </CardHeader>
        <CardBody>
          <div className="rounded-xl border border-line bg-elevated/50 p-3 text-xs text-muted">
            Your data never leaves your device. All analysis runs locally. When AI is enabled, only
            <span className="font-medium text-ink"> metadata</span> (column names, inferred types,
            masked sample values, summary statistics) is sent to your chosen provider &mdash; never the
            full dataset or raw personal information.
          </div>

          <div className="mt-2 divide-y divide-line">
            <Toggle
              id="ai-enabled"
              checked={settings.enabled}
              onChange={(v) => update({ enabled: v })}
              label="Enable AI features"
              description="Master switch. When off, InsightOS behaves exactly as the deterministic build."
            />
            <Toggle
              id="ai-strict"
              checked={settings.strictGrounding}
              onChange={(v) => update({ strictGrounding: v })}
              label="Strict grounding"
              description="Suppress any AI claim whose figures are not traceable to the engine."
              disabled={aiOff}
            />
            <Toggle
              id="ai-rewrite"
              checked={settings.enableExecutiveRewrite}
              onChange={(v) => update({ enableExecutiveRewrite: v })}
              label="Enable executive rewrite"
              description="Let AI rephrase the executive report for tone only. Numbers are never changed."
              disabled={aiOff}
            />
            <Toggle
              id="ai-semantic"
              checked={settings.enableSemanticParser}
              onChange={(v) => update({ enableSemanticParser: v })}
              label="Enable semantic parser"
              description="Advisory column understanding from metadata only. Low-confidence mappings need confirmation."
              disabled={aiOff}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <label htmlFor="ai-provider" className={FIELD_LABEL}>
              Provider
            </label>
            <select
              id="ai-provider"
              className={INPUT}
              value={settings.providerId}
              disabled={aiOff}
              onChange={(e) => update({ providerId: e.target.value })}
            >
              {AVAILABLE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.implemented}>
                  {p.label}
                  {p.implemented ? '' : ' (coming soon)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ai-model" className={FIELD_LABEL}>
              Model
            </label>
            <input
              id="ai-model"
              className={INPUT}
              list="ai-model-options"
              value={settings.model}
              disabled={aiOff}
              onChange={(e) => update({ model: e.target.value })}
            />
            <datalist id="ai-model-options">
              {GROQ_MODEL_OPTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="ai-temp" className={FIELD_LABEL}>
              Temperature: {settings.temperature.toFixed(2)}
            </label>
            <input
              id="ai-temp"
              type="range"
              min={0}
              max={1}
              step={0.05}
              className="w-full accent-accent"
              value={settings.temperature}
              disabled={aiOff}
              onChange={(e) => update({ temperature: Number(e.target.value) })}
              aria-valuetext={settings.temperature.toFixed(2)}
            />
            <p className="mt-1 text-xs text-muted">Lower is more stable and deterministic-friendly.</p>
          </div>

          <div>
            <label htmlFor="ai-key" className={FIELD_LABEL}>
              API key (stored in this browser only)
            </label>
            <div className="flex gap-2">
              <input
                id="ai-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your provider API key"
                className={INPUT}
                value={settings.apiKey ?? ''}
                disabled={aiOff}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
              <button
                type="button"
                className={cn(
                  'min-h-[44px] rounded-xl border border-line px-3 text-xs font-medium',
                  'focus:outline-none focus:ring-2 focus:ring-accent/50',
                )}
                aria-pressed={showKey}
                disabled={aiOff}
                onClick={() => setShowKey((s) => !s)}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              Never committed or uploaded. Cleared when you reset or clear browser storage.
            </p>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={reset}
          className={cn(
            'min-h-[44px] rounded-xl border border-line px-4 text-sm font-medium',
            'focus:outline-none focus:ring-2 focus:ring-accent/50',
          )}
        >
          Reset to defaults
        </button>
        <p className="text-xs text-muted" aria-live="polite">
          {savedAt ? 'Saved to this browser' : 'Changes save automatically'}
        </p>
      </div>
    </div>
  );
}
