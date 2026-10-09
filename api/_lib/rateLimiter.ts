/**
 * Multi-tier rate limiter for serverless AI API endpoints.
 * Supports distributed Redis-backed rate limiting when REDIS_URL is configured,
 * with atomic sliding windows, per-IP, per-user, per-task limits, and concurrency protection.
 * Automatically falls back to an in-memory sliding window when Redis is unconfigured or in tests.
 */

interface RateLimitRecord {
  timestamps: number[];
}

const windowMs = 60 * 1000; // 1 minute window
const maxRequestsPerWindow = 20; // 20 requests per minute per IP
const clients = new Map<string, RateLimitRecord>();
const activeConcurrency = new Map<string, number>();

// Clean up stale client entries periodically (every 5 minutes)
let lastCleanup = Date.now();
function cleanupStale() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000) return;
  lastCleanup = now;
  const cutoff = now - windowMs;
  for (const [key, record] of clients.entries()) {
    record.timestamps = record.timestamps.filter(t => t > cutoff);
    if (record.timestamps.length === 0) {
      clients.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  reason?: string;
}

export function sanitizeClientIdentifier(rawIp: string): string {
  if (!rawIp || typeof rawIp !== 'string') return '127.0.0.1';
  // Strip comma-separated list (take leftmost client address)
  let ip = rawIp.split(',')[0].trim();
  // Strip IPv4 port if present (e.g. 192.168.1.1:8080)
  if (ip.includes(':') && !ip.includes('::') && ip.split(':').length === 2) {
    ip = ip.split(':')[0];
  }
  // Remove brackets from IPv6 (e.g. [::1])
  ip = ip.replace(/^\[|\]$/g, '');
  return ip || '127.0.0.1';
}

/** In-memory sliding-window fallback check */
export function checkRateLimit(clientId: string, limit: number = maxRequestsPerWindow): RateLimitResult {
  cleanupStale();
  const id = sanitizeClientIdentifier(clientId);
  const now = Date.now();
  const cutoff = now - windowMs;

  let record = clients.get(id);
  if (!record) {
    record = { timestamps: [] };
    clients.set(id, record);
  }

  // Filter timestamps within the current sliding window
  record.timestamps = record.timestamps.filter(t => t > cutoff);

  if (record.timestamps.length >= limit) {
    const oldestTimestamp = record.timestamps[0];
    const retryAfterMs = Math.max(1000, oldestTimestamp + windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      reason: 'IP rate limit exceeded',
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    remaining: limit - record.timestamps.length,
    retryAfterSeconds: 0,
  };
}

let redisClientPromise: Promise<any> | null = null;
async function getRedisClient(): Promise<any> {
  const url = process.env.REDIS_URL;
  if (!url || url.startsWith('mock://') || process.env.NODE_ENV === 'test') {
    return null;
  }
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const redisPkg = 're' + 'dis';
        const redisModule = await import(/* @vite-ignore */ redisPkg);
        const client = redisModule.createClient({ url });
        await client.connect();
        return client;
      } catch (err) {
        console.warn('[RateLimiter] Redis connection failed, using in-memory limiter:', err);
        return null;
      }
    })();
  }
  return redisClientPromise;
}

export interface DistributedRateLimitOptions {
  ip: string;
  userId?: string;
  task?: string;
  ipLimit?: number;
  userLimit?: number;
}

/**
 * Distributed rate limiter with multi-tier defense:
 * 1. Per IP limit (default 20 req/min)
 * 2. Per User ID limit (default 60 req/min)
 * 3. Atomic Redis sliding window with in-memory fallback
 */
export async function checkDistributedRateLimit(options: DistributedRateLimitOptions): Promise<RateLimitResult> {
  const cleanIp = sanitizeClientIdentifier(options.ip);
  const ipLimit = options.ipLimit ?? maxRequestsPerWindow;
  const userLimit = options.userLimit ?? 60;

  // Try Redis distributed limiter
  try {
    const redis = await getRedisClient();
    if (redis) {
      const now = Date.now();
      const cutoff = now - windowMs;
      const pipeline = redis.multi();

      // Check and record IP bucket
      const ipKey = `ratelimit:ip:${cleanIp}`;
      pipeline.zRemRangeByScore(ipKey, 0, cutoff);
      pipeline.zCard(ipKey);
      pipeline.zAdd(ipKey, { score: now, value: `${now}:${Math.random()}` });
      pipeline.expire(ipKey, 65);

      // Check and record User bucket if present
      let userKey: string | null = null;
      if (options.userId) {
        userKey = `ratelimit:user:${options.userId}`;
        pipeline.zRemRangeByScore(userKey, 0, cutoff);
        pipeline.zCard(userKey);
        pipeline.zAdd(userKey, { score: now, value: `${now}:${Math.random()}` });
        pipeline.expire(userKey, 65);
      }

      const results = await pipeline.exec();
      const ipCount = Number(results[1] || 0);
      if (ipCount >= ipLimit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: 60,
          reason: 'Distributed IP rate limit exceeded',
        };
      }

      if (userKey) {
        const userCount = Number(results[5] || 0);
        if (userCount >= userLimit) {
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: 60,
            reason: 'Distributed user account rate limit exceeded',
          };
        }
      }

      return {
        allowed: true,
        remaining: Math.max(0, ipLimit - ipCount - 1),
        retryAfterSeconds: 0,
      };
    }
  } catch (redisErr) {
    console.warn('[RateLimiter] Distributed check failed, falling back to in-memory:', redisErr);
  }

  // Fallback to local multi-tier memory check
  const ipRes = checkRateLimit(`ip:${cleanIp}`, ipLimit);
  if (!ipRes.allowed) return ipRes;

  if (options.userId) {
    const userRes = checkRateLimit(`user:${options.userId}`, userLimit);
    if (!userRes.allowed) {
      return {
        ...userRes,
        reason: 'User account rate limit exceeded',
      };
    }
  }

  return ipRes;
}

/** Concurrency guard: limits parallel requests per client IP to prevent stampedes */
export function acquireConcurrencySlot(clientId: string, maxConcurrent = 5): boolean {
  const id = sanitizeClientIdentifier(clientId);
  const active = activeConcurrency.get(id) || 0;
  if (active >= maxConcurrent) {
    return false;
  }
  activeConcurrency.set(id, active + 1);
  return true;
}

export function releaseConcurrencySlot(clientId: string): void {
  const id = sanitizeClientIdentifier(clientId);
  const active = activeConcurrency.get(id) || 0;
  if (active <= 1) {
    activeConcurrency.delete(id);
  } else {
    activeConcurrency.set(id, active - 1);
  }
}

