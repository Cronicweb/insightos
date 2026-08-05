// InsightOS — Extension hooks (§25). Typed seams with safe defaults. NOT implemented as features;
// present so future work (parsers/auth/cloud/collab/scheduling/RAG) needs no facade/UI changes.

import type { DatasetMetadata, SemanticModelDraft } from './types';

/** Multiple/pluggable semantic parsers. */
export interface SemanticParser {
  id: string;
  parse(metadata: DatasetMetadata): Promise<SemanticModelDraft>;
}

/** Enterprise authentication seam. Default: anonymous/local. */
export interface AuthProvider {
  id: string;
  getToken(): Promise<string | null>;
}

/** Cloud/local execution backend. Default: local DuckDB-WASM. */
export interface ExecutionBackend {
  id: string;
  runSql(sql: string): Promise<unknown>;
}

/** Collaborative investigations (share/subscribe). Default: no-op. */
export interface CollaborationAdapter {
  id: string;
  publish(graphJson: string): Promise<void>;
}

/** Scheduled analyses. Default: no-op. */
export interface Scheduler {
  id: string;
  schedule(cron: string, investigationJson: string): Promise<void>;
}

/** RAG document packs. Default: empty retriever. */
export interface Retriever {
  id: string;
  retrieve(query: string): Promise<Array<{ source: string; snippet: string }>>;
}

/** Optional session/persistent investigation store. Default: in-memory no-op. */
export interface InvestigationStore {
  save(id: string, graphJson: string): Promise<void>;
  load(id: string): Promise<string | null>;
  list(): Promise<string[]>;
}

/** Safe defaults so the app runs with zero configuration and no external calls. */
export const defaultHooks = {
  auth: { id: 'anonymous', async getToken() { return null; } } as AuthProvider,
  execution: { id: 'local-duckdb', async runSql() { return null; } } as ExecutionBackend,
  collaboration: { id: 'noop', async publish() {} } as CollaborationAdapter,
  scheduler: { id: 'noop', async schedule() {} } as Scheduler,
  retriever: { id: 'empty', async retrieve() { return []; } } as Retriever,
  store: (() => {
    const mem = new Map<string, string>();
    return {
      async save(id: string, json: string) { mem.set(id, json); },
      async load(id: string) { return mem.get(id) ?? null; },
      async list() { return Array.from(mem.keys()); },
    } as InvestigationStore;
  })(),
};
