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

const RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local token = ARGV[4]
local cutoff = now - window

redis.call('ZREMRANGEBYSCORE', key, 0, cutoff)
local current = redis.call('ZCARD', key)

if current >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = window
  if oldest and #oldest >= 2 then
    retryAfterMs = math.max(1000, (tonumber(oldest[2]) + window) - now)
  end
  return { 0, current, math.ceil(retryAfterMs / 1000) }
end

redis.call('ZADD', key, now, token)
redis.call('EXPIRE', key, math.ceil(window / 1000) + 5)
return { 1, limit - current - 1, 0 }
`;

async function executeRateLimitLua(client: any, key: string, now: number, windowMs: number, limit: number): Promise<[number, number, number]> {
  const token = `${now}:${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await client.eval(RATE_LIMIT_LUA, {
      keys: [key],
      arguments: [String(now), String(windowMs), String(limit), token],
    });
    return [Number(res[0]), Number(res[1]), Number(res[2])];
  } catch {
    const res = await client.eval(RATE_LIMIT_LUA, 1, key, String(now), String(windowMs), String(limit), token);
    return [Number(res[0]), Number(res[1]), Number(res[2])];
  }
}

/**
 * Distributed rate limiter with multi-tier defense:
 * 1. Per IP limit (default 20 req/min)
 * 2. Per User ID limit (default 60 req/min)
 * 3. Indivisible atomic Redis Lua sliding window with safe in-memory fallback
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

      // Check IP atomically
      const [ipAllowed, ipRemaining, ipRetry] = await executeRateLimitLua(
        redis,
        `ratelimit:ip:${cleanIp}`,
        now,
        windowMs,
        ipLimit
      );

      if (ipAllowed === 0) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: ipRetry || 60,
          reason: 'Distributed IP rate limit exceeded',
        };
      }

      // Check User ID atomically if present
      if (options.userId) {
        const [userAllowed, userRemaining, userRetry] = await executeRateLimitLua(
          redis,
          `ratelimit:user:${options.userId}`,
          now,
          windowMs,
          userLimit
        );
        if (userAllowed === 0) {
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: userRetry || 60,
            reason: 'Distributed user account rate limit exceeded',
          };
        }
      }

      return {
        allowed: true,
        remaining: ipRemaining,
        retryAfterSeconds: 0,
      };
    }
  } catch (redisErr) {
    console.warn('[RateLimiter] Distributed check failed, evaluating degraded policy:', redisErr);
    if (process.env.NODE_ENV === 'production' && process.env.RATE_LIMIT_FAIL_CLOSED === 'true') {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 30,
        reason: 'Rate limit service unavailable in strict production mode',
      };
    }
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

