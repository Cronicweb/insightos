// InsightOS AI layer - Anthropic Claude provider.
//
// Claude's Messages API differs from the OpenAI shape in three ways that matter
// here: the system prompt is a top-level field, max_tokens is mandatory, and the
// key travels in x-api-key. Browser calls additionally require the explicit
// anthropic-dangerous-direct-browser-access opt-in - which is exactly the
// trade-off this app already makes for every provider: the key stays in the
// user's browser and never touches a server we run.
import type { AISettings } from '../types';
import { createProviderFromSpec, testChatConnection, type ChatSpec } from './chat';
import type { ConnectionResult } from './groq';

const MAX_TOKENS = 2048;
const ANTHROPIC_VERSION = '2023-06-01';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export const CLAUDE_SPEC: ChatSpec = {
  id: 'claude',
  label: 'Claude',
  needsKey: true,
  defaultBaseUrl: 'https://api.anthropic.com/v1',
  baseUrlHint: 'Anthropic Messages API base, or a compatible gateway.',
  chatUrl: (base) => `${base}/messages`,
  modelsUrl: (base) => `${base}/models?limit=100`,
  headers: (s) => ({
    'x-api-key': s.apiKey ?? '',
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  }),
  body: (s, system, user, jsonMode) => ({
    model: s.model,
    max_tokens: MAX_TOKENS,
    temperature: s.temperature,
    system,
    messages: [
      {
        role: 'user',
        // Claude has no response_format switch, so JSON mode is instructed.
        content: jsonMode
          ? `${user}\n\nReply with a single valid JSON object and nothing else - no prose, no code fences.`
          : user,
      },
    ],
  }),
  text: (payload) => {
    const content = asRecord(payload).content;
    if (!Array.isArray(content)) return '';
    return content
      .map((block) => {
        const text = asRecord(block).text;
        return typeof text === 'string' ? text : '';
      })
      .join('')
      // JSON mode is instructed rather than enforced, so strip a fence if one appears.
      .replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  },
  models: (payload) => {
    const data = asRecord(payload).data;
    if (!Array.isArray(data)) return [];
    return data
      .map((m) => asRecord(m).id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  },
};

export const createClaudeProvider = createProviderFromSpec(CLAUDE_SPEC);

export function testClaudeConnection(settings: AISettings): Promise<ConnectionResult> {
  return testChatConnection(CLAUDE_SPEC, settings);
}
