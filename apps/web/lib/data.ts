import type { Analysis, DemoIndex } from './types';

/**
 * Demo-mode data access.
 *
 * InsightOS runs in two modes:
 *   - **live**   : talks to the FastAPI service (`NEXT_PUBLIC_API_URL`)
 *   - **demo**   : reads pre-computed engine output from `/demo/*.json`
 *
 * Demo mode is what makes the GitHub Pages deployment possible: the identical
 * payload the API would return is committed as a static artifact, so the whole
 * product is explorable with no server at all.
 */

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
export const IS_DEMO = !API_URL;

function demoUrl(file: string): string {
  return `${BASE_PATH}/demo/${file}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return (await res.json()) as T;
}

export async function fetchIndex(): Promise<DemoIndex> {
  if (!IS_DEMO) return getJson<DemoIndex>(`${API_URL}/datasets`);
  return getJson<DemoIndex>(demoUrl('index.json'));
}

export async function fetchAnalysis(key: string): Promise<Analysis> {
  if (!IS_DEMO) return getJson<Analysis>(`${API_URL}/datasets/${key}/analysis`);
  return getJson<Analysis>(demoUrl(`${key}.json`));
}

export async function fetchSample(key: string): Promise<Record<string, unknown>[]> {
  const url = IS_DEMO ? demoUrl(`${key}.sample.json`) : `${API_URL}/datasets/${key}/sample`;
  try {
    const payload = await getJson<{ rows?: Record<string, unknown>[] } | Record<string, unknown>[]>(
      url,
    );
    if (Array.isArray(payload)) return payload;
    return payload.rows ?? [];
  } catch {
    return [];
  }
}
