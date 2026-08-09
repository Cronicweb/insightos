// InsightOS AI layer - Ollama provider (local, keyless).
//
// This is the offline-privacy path: the model runs on the user's own machine
// beside DuckDB-WASM, so a dataset never leaves the laptop even when the AI
// layer is on. Ollama exposes an OpenAI-compatible surface at /v1, which means
// it reuses the same spec shape as OpenAI and needs no bespoke transport.
//
// Ollama must be started with this origin allowed, e.g.
//   OLLAMA_ORIGINS=https://cronicweb.github.io ollama serve
// otherwise the browser blocks the request before Ollama ever sees it.
import type { AISettings } from '../types';
import {
  createProviderFromSpec,
  openAiBody,
  openAiModels,
  openAiText,
  testChatConnection,
  type ChatSpec,
} from './chat';
import type { ConnectionResult } from './groq';

export const OLLAMA_SPEC: ChatSpec = {
  id: 'ollama',
  label: 'Ollama (local)',
  needsKey: false,
  defaultBaseUrl: 'http://localhost:11434/v1',
  baseUrlHint: 'Where Ollama is listening. Start it with OLLAMA_ORIGINS set to this site.',
  chatUrl: (base) => `${base}/chat/completions`,
  modelsUrl: (base) => `${base}/models`,
  // No Authorization header: a local runtime has no key to send.
  headers: () => ({}),
  body: openAiBody,
  text: openAiText,
  models: openAiModels,
};

export const createOllamaProvider = createProviderFromSpec(OLLAMA_SPEC);

export function testOllamaConnection(settings: AISettings): Promise<ConnectionResult> {
  return testChatConnection(OLLAMA_SPEC, settings);
}
