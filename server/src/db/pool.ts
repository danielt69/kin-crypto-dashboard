import pg from 'pg';

/**
 * NUMERIC columns arrive from pg as strings (arbitrary precision doesn't fit
 * a JS number in general). For display prices, float64 precision is fine —
 * we parse once here instead of sprinkling parseFloat through the repo.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, parseFloat);

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export type { Pool } from 'pg';
