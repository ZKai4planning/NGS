import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { createHash } from "crypto";
import type { RoofParams } from "../types";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;
  _redis = Redis.fromEnv(); // expects UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
  return _redis;
}

/**
 * Stable hash of normalized params -- used both as the Upstash cache key
 * and as roof_configs.params_hash in Supabase, so the two layers agree on
 * identity without a round trip.
 */
export function hashRoofParams(params: RoofParams): string {
  const normalized = JSON.stringify(params, Object.keys(params).sort());
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

const ENGINE_CACHE_TTL_SECONDS = 60 * 60 * 24; // 1 day; geometry is deterministic from params

/**
 * Caches the full generateAll() output of a roof so repeated identical
 * requests (e.g. a UI slider being nudged back to a previous value, or
 * multiple users configuring the same stock roof size) skip recomputation.
 * The compute itself is cheap, but this also protects the DB write path --
 * callers should check the cache before hitting Supabase at all.
 */
export async function getCachedRoofResult<T>(paramsHash: string): Promise<T | null> {
  const redis = getRedis();
  const cached = await redis.get<T>(`roof:result:${paramsHash}`);
  return cached ?? null;
}

export async function setCachedRoofResult<T>(paramsHash: string, result: T): Promise<void> {
  const redis = getRedis();
  await redis.set(`roof:result:${paramsHash}`, result, { ex: ENGINE_CACHE_TTL_SECONDS });
}

/**
 * Rate limiter for the generate/nesting API routes -- nesting in particular
 * can be CPU-heavy, so this is worth gating per-user/IP even before
 * optimizing the algorithm itself. Sliding window, 20 requests/minute.
 */
export function getApiRateLimiter(): Ratelimit {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    prefix: "ratelimit:parametric-engine",
  });
}

// ============================================================================
// Nesting job queue
// ============================================================================
// True nesting (SVGnest/Deepnest-grade, no-fit-polygon) can take seconds for
// large part counts -- too slow to run synchronously inside a Next.js API
// route on some hosts. The pattern below queues the job in Redis and lets a
// separate worker (a Next.js route hit by Upstash QStash, or a standalone
// worker process) pick it up and write the result back, so the client polls
// or subscribes instead of holding a request open.

export interface NestingJobRecord {
  id: string;
  roofConfigId: string;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: string;
  result?: unknown;
  error?: string;
}

export async function queueNestingJob(roofConfigId: string, payload: unknown): Promise<string> {
  const redis = getRedis();
  const id = createHash("sha256").update(`${roofConfigId}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16);

  const record: NestingJobRecord = { id, roofConfigId, status: "queued", createdAt: new Date().toISOString() };
  await redis.set(`nesting:job:${id}`, record, { ex: 60 * 60 }); // 1hr TTL
  await redis.lpush("nesting:queue", JSON.stringify({ id, roofConfigId, payload }));

  return id;
}

export async function getNestingJobStatus(id: string): Promise<NestingJobRecord | null> {
  const redis = getRedis();
  return (await redis.get<NestingJobRecord>(`nesting:job:${id}`)) ?? null;
}

export async function completeNestingJob(id: string, result: unknown): Promise<void> {
  const redis = getRedis();
  const existing = await getNestingJobStatus(id);
  if (!existing) return;
  await redis.set(`nesting:job:${id}`, { ...existing, status: "completed", result }, { ex: 60 * 60 });
}

export async function failNestingJob(id: string, error: string): Promise<void> {
  const redis = getRedis();
  const existing = await getNestingJobStatus(id);
  if (!existing) return;
  await redis.set(`nesting:job:${id}`, { ...existing, status: "failed", error }, { ex: 60 * 60 });
}
