// InsightOS AI layer - provider registry.
// Maps provider ids to factories. Consumers depend only on the AIProvider
// interface, so adding a vendor here is the whole integration.

import type { AIProvider } from "./provider";
import type { AISettings } from "./types";
import { createGroqProvider } from "./providers/groq";
import { createOpenAIProvider } from "./providers/openai";
import { createGeminiProvider } from "./providers/gemini";
import { createClaudeProvider } from "./providers/claude";
import { createOllamaProvider } from "./providers/ollama";

export const PROVIDER_REGISTRY: Record<string, (s: AISettings) => AIProvider> = {
  groq: createGroqProvider,
  openai: createOpenAIProvider,
  gemini: createGeminiProvider,
  claude: createClaudeProvider,
  ollama: createOllamaProvider,
};

export const AVAILABLE_PROVIDERS = [
  { id: "groq", label: "Groq", implemented: true, needsKey: true, local: false },
  { id: "openai", label: "OpenAI", implemented: true, needsKey: true, local: false },
  { id: "gemini", label: "Gemini", implemented: true, needsKey: true, local: false },
  { id: "claude", label: "Claude", implemented: true, needsKey: true, local: false },
  // Local runtime: the model runs on the user's machine, so there is no key and
  // no dataset-bearing request ever leaves the laptop.
  { id: "ollama", label: "Ollama (local)", implemented: true, needsKey: false, local: true },
] as const;
