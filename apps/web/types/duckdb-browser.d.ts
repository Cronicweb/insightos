/**
 * DuckDB-WASM ships a browser-only ESM entry point that has no sibling
 * declaration file. Importing the package root instead would pull in the Node
 * build and make webpack emit a "critical dependency" warning, so we import the
 * browser entry directly and borrow the package's own published types.
 */
declare module '@duckdb/duckdb-wasm/dist/duckdb-browser.mjs' {
  export * from '@duckdb/duckdb-wasm';
}
