/**
 * Lazily-instantiated DuckDB-WASM singleton.
 *
 * Everything here runs in the visitor's browser. No dataset byte ever crosses
 * the network: the database lives in WASM linear memory inside a Web Worker and
 * dies with the tab.
 */
import * as duckdb from '@duckdb/duckdb-wasm/dist/duckdb-browser.mjs';

/** Public path prefix (`/insightos` on GitHub Pages, `''` locally). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function asset(file: string): string {
  return `${BASE_PATH}/duckdb/${file}`;
}

/**
 * Bundles served from our own origin rather than jsDelivr.
 *
 * `selectBundle` feature-detects WebAssembly exception handling and picks `eh`
 * where available (every current browser), falling back to the larger `mvp`
 * build elsewhere. Only the selected bundle is ever downloaded.
 */
const STATIC_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: asset('duckdb-mvp.wasm'),
    mainWorker: asset('duckdb-browser-mvp.worker.js'),
  },
  eh: {
    mainModule: asset('duckdb-eh.wasm'),
    mainWorker: asset('duckdb-browser-eh.worker.js'),
  },
};

export interface DuckDbHandle {
  db: duckdb.AsyncDuckDB;
  /** One long-lived connection per tab - opening one per query is wasteful. */
  conn: duckdb.AsyncDuckDBConnection;
  worker: Worker;
  bundle: string;
}

let pending: Promise<DuckDbHandle> | null = null;

/** Boot DuckDB once per tab and reuse it for every subsequent query. */
export function getDuckDb(onProgress?: (stage: string) => void): Promise<DuckDbHandle> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('DuckDB is only available in the browser.'));
  }
  if (!pending) {
    pending = (async () => {
      onProgress?.('Selecting WebAssembly bundle');
      const bundle = await duckdb.selectBundle(STATIC_BUNDLES);
      onProgress?.('Starting analytics worker');
      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.VoidLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      onProgress?.('Loading SQL engine');
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      await db.open({
        path: ':memory:',
        query: { castBigIntToDouble: true, castTimestampToDate: true },
      });
      const flavour = bundle.mainModule.includes('eh') ? 'eh' : 'mvp';
      onProgress?.('Ready');
      const conn = await db.connect();
      return { db, conn, worker, bundle: flavour };
    })().catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

/** Drop every table so a new upload starts from a clean database. */
export async function resetDatabase(): Promise<void> {
  if (!pending) return;
  const { db } = await pending;
  const conn = await db.connect();
  try {
    const tables = await conn.query<{ name: never }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main'",
    );
    for (const row of tables.toArray()) {
      const name = String((row as unknown as { name: string }).name);
      await conn.query(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
    }
  } finally {
    await conn.close();
  }
}

/** Tear the engine down entirely (used when the user clears their session). */
export async function terminateDuckDb(): Promise<void> {
  if (!pending) return;
  const handle = await pending.catch(() => null);
  pending = null;
  if (!handle) return;
  await handle.db.terminate();
  handle.worker.terminate();
}
