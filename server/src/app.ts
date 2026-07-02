import Fastify, { type FastifyInstance } from 'fastify';
import { HISTORY_WINDOWS, type HistoryWindow } from '@kin/types';
import type { MarketRepo } from './db/repo.js';
import type { RefreshLoop } from './refresh-loop.js';

export interface AppDeps {
  loop: RefreshLoop;
  repo: MarketRepo;
  /** Injectable clock, mirrors the loop's. */
  now?: () => Date;
}

// --- Response schemas -------------------------------------------------------
// Fastify uses these for fast serialization AND as an enforced contract:
// anything not in the schema never leaks to the client.

const coinSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    symbol: { type: 'string' },
    name: { type: 'string' },
    image: { type: 'string' },
    priceUsd: { type: 'number' },
    change24h: { type: ['number', 'null'] },
    marketCap: { type: ['number', 'null'] },
    rank: { type: 'integer' },
    updatedAt: { type: 'string' },
  },
  required: ['id', 'symbol', 'name', 'image', 'priceUsd', 'rank', 'updatedAt'],
} as const;

const metaSchema = {
  type: 'object',
  properties: {
    lastSuccessAt: { type: ['string', 'null'] },
    ageMs: { type: ['number', 'null'] },
    degraded: { type: 'boolean' },
    stale: { type: 'boolean' },
  },
  required: ['lastSuccessAt', 'ageMs', 'degraded', 'stale'],
} as const;

const snapshotSchema = {
  type: 'object',
  properties: { data: { type: 'array', items: coinSchema }, meta: metaSchema },
  required: ['data', 'meta'],
} as const;

export function buildApp(deps: AppDeps): FastifyInstance {
  const { loop, repo } = deps;
  const now = deps.now ?? (() => new Date());
  const app = Fastify({ logger: false });

  /**
   * Current market state. Served entirely from the loop's in-memory
   * last-known-good snapshot — handling this request performs zero upstream
   * calls and zero DB queries, so request volume can't create upstream cost.
   */
  app.get('/api/coins', { schema: { response: { 200: snapshotSchema } } }, async () =>
    loop.snapshot()
  );

  /**
   * Price history for one coin, read from OUR price_snapshots table
   * (a range scan on the (coin_id, fetched_at) index). This endpoint never
   * calls the upstream — history is whatever the refresh loop has recorded.
   */
  app.get<{ Params: { id: string }; Querystring: { window?: HistoryWindow } }>(
    '/api/coins/:id/history',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string', minLength: 1 } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: { window: { type: 'string', enum: Object.keys(HISTORY_WINDOWS) } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              coin: coinSchema,
              points: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { priceUsd: { type: 'number' }, fetchedAt: { type: 'string' } },
                  required: ['priceUsd', 'fetchedAt'],
                },
              },
            },
            required: ['coin', 'points'],
          },
        },
      },
    },
    async (req, reply) => {
      const coin = await repo.getCoin(req.params.id);
      if (!coin) {
        return reply.code(404).send({ error: `unknown coin: ${req.params.id}` });
      }
      const windowMs = HISTORY_WINDOWS[req.query.window ?? '1h'];
      const since = new Date(now().getTime() - windowMs);
      const points = await repo.getHistory(coin.id, since);
      return { coin, points };
    }
  );

  /**
   * SSE stream. Every connected client shares the same refresh loop output:
   * a new subscriber costs one entry in a listener set, not an upstream call.
   */
  app.get('/api/stream', (req, reply) => {
    // We write the raw response ourselves from here on.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      // Belt-and-braces for proxies that buffer by default.
      'x-accel-buffering': 'no',
    });
    // Tell EventSource how long to wait before auto-reconnecting.
    reply.raw.write('retry: 5000\n\n');

    const send = (snapshot: unknown) =>
      reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

    // New clients get the current state immediately instead of waiting a tick.
    send(loop.snapshot());
    const unsubscribe = loop.onSnapshot(send);

    // Comment-only frames keep idle proxies/load-balancers from killing the
    // connection during long backoff periods.
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);

    req.raw.on('close', () => {
      unsubscribe();
      clearInterval(ping);
    });
  });

  /** Liveness + feed health, e.g. for container orchestration or uptime checks. */
  app.get('/health', async () => {
    const meta = loop.snapshot().meta;
    return { status: 'ok' as const, degraded: meta.degraded, lastSuccessAt: meta.lastSuccessAt };
  });

  return app;
}
