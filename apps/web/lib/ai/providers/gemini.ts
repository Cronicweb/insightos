// InsightOS AI layer - Google Gemini provider.
//
// Gemini is the furthest from the OpenAI shape: the model id is part of the URL
// rather than the body, the key is a query parameter, roles are "contents" with
// "parts", and JSON mode is requested through responseMimeType. All of that is
// contained in this spec, so nothing outside this file knows about it.
import type { AISettings } from '../types';
import { createProviderFromSpec, testChatConnection, type ChatSpec } from './chat';
import type { ConnectionResult } from './groq';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Gemini names models "models/gemini-…"; the UI and the URL both want the bare id. */
function bareModelId(name: string): string {
  return name.replace(/^models\//, '');
}

export const GEMINI_SPEC: ChatSpec = {
  id: 'gemini',
  label: 'Gemini',
  needsKey: true,
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  baseUrlHint: 'Google Generative Language API base.',
  chatUrl: (base, s) =>
    `${base}/models/${encodeURIComponent(bareModelId(s.model))}:generateContent?key=${encodeURIComponent(s.apiKey ?? '')}`,
  modelsUrl: (base, s) => `${base}/models?pageSize=200&key=${encodeURIComponent(s.apiKey ?? '')}`,
  // The key rides in the query string, so no auth header is needed.
  headers: () => ({}),
  body: (s, system, user, jsonMode) => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: s.temperature,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  }),
  text: (payload) => {
    const candidates = asRecord(payload).candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return '';
    const parts = asRecord(asRecord(candidates[0]).content).parts;
    if (!Array.isArray(parts)) return '';
    return parts
      .map((p) => {
        const text = asRecord(p).text;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  },
  models: (payload) => {
    const models = asRecord(payload).models;
    if (!Array.isArray(models)) return [];
    return models
      .filter((m) => {
        const methods = asRecord(m).supportedGenerationMethods;
        // An embedding model in the dropdown would only produce a confusing 400.
        return !Array.isArray(methods) || methods.includes('generateContent');
      })
      .map((m) => asRecord(m).name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .map(bareModelId);
  },
};

export const createGeminiProvider = createProviderFromSpec(GEMINI_SPEC);

export function testGeminiConnection(settings: AISettings): Promise<ConnectionResult> {
  return testChatConnection(GEMINI_SPEC, settings);
}
