import { Redis } from "@upstash/redis";
import { Client as QStashClient } from "@upstash/qstash";

// Cache: roof geometry recalculation, webhook rate-limiting.
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Queue: CAD export jobs that would risk a Vercel function timeout if run inline.
export const qstash = new QStashClient({
  token: process.env.QSTASH_TOKEN!,
});

/**
 * Simple fixed-window rate limit, e.g. for the Strata webhook endpoint.
 * Returns true if the request should be allowed.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}
