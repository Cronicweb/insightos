'use client';
// InsightOS — AI Settings panel (Phase 1).
// Configures the additive, vendor-agnostic AI layer. ALL AI is OFF by default.
// The API key is stored ONLY in browser localStorage and never leaves the device
// except directly to the user's chosen provider. See docs/ai-architecture.md §3, §9, §13.
import * as React from 'react';
import {
  DEFAULT_AI_SETTINGS,
  loadAISettings,
  saveAISettings,
  clearAISettings,
  type AISettings,
} from '@/lib/ai';
import { AVAILABLE_PROVIDERS } from '@/lib/ai/registry';
import type { ConnectionResult, ConnectionState } from '@/lib/ai/providers/groq';
import {
  testConnection as testProviderConnection,
  providerNeedsKey,
  defaultBaseUrlFor,
  baseUrlHintFor,
} from '@/lib/ai/connection';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody, Badge } from '@/components/ui/primitives';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
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

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  not_connected: 'Not Connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  invalid_key: 'Invalid API Key',
  invalid_model: 'Invalid Model',
  unreachable: 'Provider Unreachable',
  network_error: 'Network Error',
};

function connectionTone(state: ConnectionState): 'positive' | 'negative' | 'warning' | 'neutral' | 'accent' {
  if (state === 'connected') return 'positive';
  if (state === 'connecting') return 'accent';
  if (state === 'not_connected') return 'neutral';
  return 'negative';
}


// Preferred default model per provider, chosen ONLY from the live list the
// provider itself returned. Lets "paste key -> Connect" complete in one step
// without the user having to know vendor model names. Never hardcodes a model
// that the key cannot actually use.
const MODEL_PREFERENCE: Record<string, RegExp[]> = {
  groq: [/llama-3\.3-70b-versatile/i, /llama-3/i, /llama/i],
  openai: [/^gpt-4o-mini$/i, /^gpt-4o/i, /^gpt-4/i, /^o\d/i],
  gemini: [/flash/i, /gemini-1\.5/i, /gemini/i],
  claude: [/sonnet/i, /haiku/i, /claude/i],
  ollama: [/llama3/i, /llama/i, /mistral/i],
};

function pickDefaultModel(providerId: string, models: string[]): string {
  for (const re of MODEL_PREFERENCE[providerId] ?? []) {
    const hit = models.find((m) => re.test(m));
    if (hit) return hit;
  }
  return models[0] ?? '';
}

export function AISettingsPanel() {
  const [settings, setSettings] = React.useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [showKey, setShowKey] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [conn, setConn] = React.useState<ConnectionResult>({
    state: 'not_connected',
    provider: 'groq',
    model: DEFAULT_AI_SETTINGS.model,
  });
  const [testing, setTesting] = React.useState(false);
  // Live model list from the last successful Test Connection. Never hardcoded;
  // sourced only from GET /openai/v1/models via ConnectionResult.availableModels.
  const [availableModels, setAvailableModels] = React.useState<string[]>([]);

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
    setConn({ state: 'not_connected', provider: 'groq', model: DEFAULT_AI_SETTINGS.model });
    setAvailableModels([]);
  }, []);

  // Test the current provider/key WITHOUT sending any data. Browser-only; the key is never logged.
  const testConnection = React.useCallback(async () => {
    setTesting(true);
    setConn((c) => ({ ...c, state: 'connecting', provider: settings.providerId, model: settings.model }));
    try {
      let result = await testProviderConnection(settings);
      const models = result.availableModels ?? [];
      // One-step connect: if no model is chosen yet (or the saved one is not in
      // the live list), auto-select a sensible default FROM THAT LIVE LIST and
      // validate again, so pasting a key + one click yields a working setup.
      if (models.length > 0 && (settings.model === '' || !models.includes(settings.model))) {
        const picked = pickDefaultModel(settings.providerId, models);
        if (picked) {
          update({ model: picked });
          const retry = await testProviderConnection({ ...settings, model: picked });
          result = { ...retry, availableModels: retry.availableModels ?? models };
        }
      }
      setConn(result);
      // Populate the dropdown ONLY from the live list returned by the provider.
      setAvailableModels(result.availableModels ?? models);
      // If the model is STILL invalid after auto-pick, clear it and force
      // a re-selection. Never silently continue with an invalid model.
      if (result.state === 'invalid_model' && settings.model) {
        update({ model: '' });
      }
    } finally {
      setTesting(false);
    }
  }, [settings, update]);

  // Any edit to provider/model/key invalidates a prior successful validation.
  const invalidateConn = React.useCallback(() => {
    setConn((c) => (c.state === 'not_connected' ? c : { ...c, state: 'not_connected', latencyMs: undefined, validatedAt: undefined }));
  }, []);

  const aiOff = !settings.enabled;
  // Local runtimes (Ollama) authenticate by being reachable, so the key field is moot.
  const needsKey = providerNeedsKey(settings.providerId);
  const hasModels = availableModels.length > 0;
  const modelInvalid = hasModels && settings.model !== '' && !availableModels.includes(settings.model);

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
              onChange={(e) => { update({ providerId: e.target.value }); invalidateConn(); }}
            >
              {AVAILABLE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.implemented}>
                  {p.label}
                  {p.implemented ? '' : ' (coming soon)'}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              {needsKey
                ? 'Requests go straight from this browser to the provider. No InsightOS server sees your data.'
                : 'Local runtime: the model runs on your machine, so no dataset or key leaves it. Start it with this site allowed as an origin.'}
            </p>
          </div>
          <div>
            <label htmlFor="ai-base-url" className={FIELD_LABEL}>
              Endpoint (optional)
            </label>
            <input
              id="ai-base-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              className={INPUT}
              placeholder={defaultBaseUrlFor(settings.providerId) || 'Provider default'}
              value={settings.baseUrl ?? ''}
              disabled={aiOff}
              onChange={(e) => { update({ baseUrl: e.target.value }); invalidateConn(); }}
            />
            <p className="mt-1 text-xs text-muted">
              {baseUrlHintFor(settings.providerId) || 'Leave blank to use the provider default.'}
            </p>
          </div>
          <div>
            <label htmlFor="ai-model" className={FIELD_LABEL}>
              Model
            </label>
            <select
              id="ai-model"
              className={INPUT}
              value={settings.model}
              disabled={aiOff || !hasModels}
              onChange={(e) => { update({ model: e.target.value }); invalidateConn(); }}
            >
              {/* Placeholder until a model is chosen. No hardcoded model default. */}
              <option value="" disabled>
                Select a model
              </option>
              {/* Populated ONLY from the live Groq model list after a successful test. */}
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {!hasModels ? (
              <p className="mt-1 text-xs text-muted">
                Paste your API key and hit <span className="font-medium text-ink">Connect</span>
                &mdash; the model list loads from your provider and a default is picked automatically.
              </p>
            ) : modelInvalid || settings.model === '' ? (
              <p className="mt-1 text-xs text-negative">
                Select a model from the available list to continue.
              </p>
            ) : null}
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
              {needsKey ? 'API key (stored in this browser only)' : 'API key (not required for a local runtime)'}
            </label>
            <div className="flex gap-2">
              <input
                id="ai-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder={needsKey ? 'Paste your provider API key' : 'Not required'}
                className={INPUT}
                value={settings.apiKey ?? ''}
                disabled={aiOff || !needsKey}
                onChange={(e) => { update({ apiKey: e.target.value }); invalidateConn(); }}
              />
              <button
                type="button"
                className={cn(
                  'grid min-h-[44px] w-11 place-items-center rounded-xl border border-line',
                  'focus:outline-none focus:ring-2 focus:ring-accent/50',
                )}
                aria-pressed={showKey}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                title={showKey ? 'Hide API key' : 'Show API key'}
                disabled={aiOff}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
              <button
                type="button"
                className={cn(
                  'grid min-h-[44px] w-11 place-items-center rounded-xl border border-line',
                  'focus:outline-none focus:ring-2 focus:ring-accent/50',
                )}
                aria-label="Copy API key"
                title="Copy API key"
                disabled={aiOff || !settings.apiKey}
                onClick={async () => {
                  if (!settings.apiKey) return;
                  try {
                    await navigator.clipboard.writeText(settings.apiKey);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* clipboard unavailable: no-op, never expose the key elsewhere */
                  }
                }}
              >
                {copied ? <Check className="h-4 w-4 text-positive" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              Never committed or uploaded. Cleared when you reset or clear browser storage.
            </p>
            {/* Test Connection + status indicator */}
            <div className="mt-3 rounded-xl border border-line bg-elevated/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      conn.state === 'connected'
                        ? 'bg-positive'
                        : conn.state === 'connecting'
                        ? 'bg-accent animate-pulse'
                        : conn.state === 'not_connected'
                        ? 'bg-subtle'
                        : 'bg-negative',
                    )}
                    aria-hidden
                  />
                  <span className="text-xs font-semibold" aria-live="polite">
                    {CONNECTION_LABEL[conn.state]}
                  </span>
                  <Badge tone={connectionTone(conn.state)}>{conn.state === 'connected' ? 'Ready' : 'Status'}</Badge>
                </div>
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={aiOff || testing || (needsKey && !settings.apiKey)}
                  className={cn(
                    'min-h-[44px] rounded-xl border border-line px-3 text-xs font-medium',
                    'focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60',
                  )}
                >
                  {testing ? 'Connecting…' : 'Connect'}
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-muted/70">Provider</dt>
                  <dd className="truncate font-medium">{conn.provider}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted/70">Model</dt>
                  <dd className="truncate font-medium">{conn.model || '—'}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted/70">Latency</dt>
                  <dd className="truncate font-medium">{conn.latencyMs != null ? `${conn.latencyMs} ms` : '—'}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted/70">Last validated</dt>
                  <dd className="truncate font-medium">
                    {conn.validatedAt ? new Date(conn.validatedAt).toLocaleTimeString() : '—'}
                  </dd>
                </div>
              </dl>
              {conn.detail && conn.state !== 'connected' && conn.state !== 'not_connected' ? (
                <p className="mt-2 text-xs text-negative">{conn.detail}</p>
              ) : null}
            </div>
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
