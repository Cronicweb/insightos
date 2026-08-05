// InsightOS AI layer — settings persistence (browser localStorage only).
// The API key never leaves the browser and is never committed. See docs/ai-architecture.md §3, §9.

import type { AISettings } from "./types";
import { DEFAULT_AI_SETTINGS } from "./types";

const STORAGE_KEY = "insightos.ai.settings.v1";

/** Read settings from localStorage, falling back to safe defaults (AI off). SSR-safe. */
export function loadAISettings(): AISettings {
  if (typeof window === "undefined") return { ...DEFAULT_AI_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    return { ...DEFAULT_AI_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

/** Persist settings to localStorage. No-op during SSR. */
export function saveAISettings(settings: AISettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode/quota): silently keep in-memory defaults.
  }
}

/** Clear stored settings (including any API key). */
export function clearAISettings(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
