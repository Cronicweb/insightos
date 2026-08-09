// InsightOS AI layer - OpenAI provider.
// Same wire format as Groq (OpenAI-compatible chat completions), so it is a spec
// over the shared transport rather than a second copy of the same class.
//
// Browser note: OpenAI serves permissive CORS on api.openai.com, so a key pasted
// into AI Settings works directly from a static page with no proxy.
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

export const OPENAI_SPEC: ChatSpec = {
  id: 'openai',
  label: 'OpenAI',
  needsKey: true,
  defaultBaseUrl: 'https://api.openai.com/v1',
  baseUrlHint: 'Any OpenAI-compatible endpoint, e.g. an Azure OpenAI or gateway URL.',
  chatUrl: (base) => `${base}/chat/completions`,
  modelsUrl: (base) => `${base}/models`,
  headers: (s) => ({ Authorization: `Bearer ${s.apiKey ?? ''}` }),
  body: openAiBody,
  text: openAiText,
  models: openAiModels,
};

export const createOpenAIProvider = createProviderFromSpec(OPENAI_SPEC);

export function testOpenAIConnection(settings: AISettings): Promise<ConnectionResult> {
  return testChatConnection(OPENAI_SPEC, settings);
}
