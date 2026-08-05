// InsightOS AI layer — provider registry.
// Maps provider ids to factories. Add OpenAI/Gemini/Claude/Ollama here in future phases
// without touching any consumer code (they only depend on the AIProvider interface).

import type { AIProvider } from "./provider";
import type { AISettings } from "./types";
import { createGroqProvider } from "./providers/groq";

export const PROVIDER_REGISTRY: Record<string, (s: AISettings) => AIProvider> = {
  groq: createGroqProvider,
  // openai:  createOpenAIProvider,   // Phase: future
  // gemini:  createGeminiProvider,   // Phase: future
  // claude:  createClaudeProvider,   // Phase: future
  // ollama:  createOllamaProvider,   // Phase: future
};

export const AVAILABLE_PROVIDERS = [
  { id: "groq", label: "Groq", implemented: true },
  { id: "openai", label: "OpenAI", implemented: false },
  { id: "gemini", label: "Gemini", implemented: false },
  { id: "claude", label: "Claude", implemented: false },
  { id: "ollama", label: "Ollama", implemented: false },
] as const;
