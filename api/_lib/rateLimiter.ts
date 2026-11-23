/**
 * Multi-tier rate limiter for serverless AI API endpoints.
 * Backends (in priority order):
 *   1. Redis (when REDIS_URL is configured) — indivisible Lua multi-tier sliding window
 *   2. Neon Serverless PostgreSQL (`rate_limit_buckets`) — atomic multi-tier SQL transaction
 *   3. In-memory sliding window (non-production local dev / tests ONLY)
 *
 * Strict security invariant:
 *   In production (`NODE_ENV === 'production'`), if NEITHER Redis NOR Neon Postgres is
 *   configured, requests strictly fail closed with HTTP 429 and never fall back to local memory.
 */

import { isNeonConfigured, checkNeonDistributedRateLimit } from './neon.js';

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

function hasValidRedisUrl(): boolean {
  const url = process.env.REDIS_URL;
  return Boolean(url && !url.startsWith('mock://'));
}

/** Reports the active rate-limiter storage backend for health checks & Admin Ops. */
export function getActiveRateLimiterBackend(): 'redis' | 'neon_postgres' | 'memory' {
  if (testRedisClient || hasValidRedisUrl()) return 'redis';
  if (isNeonConfigured()) return 'neon_postgres';
  return 'memory';
}

/** In-memory sliding-window fallback check (synchronous) */
export function checkRateLimit(clientId: string, limit: number = maxRequestsPerWindow): RateLimitResult {
  if (
    process.env.NODE_ENV === 'production' &&
    !testRedisClient &&
    !hasValidRedisUrl() &&
    !isNeonConfigured()
  ) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
      reason: 'Rate limit service is not configured in production',
    };
  }

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

let testRedisClient: any = null;
let testRedisError: Error | null = null;

export function setRedisClientForTesting(client: any, error: Error | null = null): void {
  testRedisClient = client;
  testRedisError = error;
  redisClientPromise = null;
}

export function resetRedisClientForTesting(): void {
  testRedisClient = null;
  testRedisError = null;
  redisClientPromise = null;
}

let redisClientPromise: Promise<any> | null = null;
async function getRedisClient(): Promise<any> {
  if (testRedisError) {
    throw testRedisError;
  }
  if (testRedisClient) {
    return testRedisClient;
  }

  const url = process.env.REDIS_URL;
  if (!url || url.startsWith('mock://')) {
    return null;
  }
  if (process.env.NODE_ENV === 'test' && !testRedisClient) {
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
        redisClientPromise = null;
        console.warn('[RateLimiter] Redis connection failed:', err);
        if (process.env.RATE_LIMIT_FAIL_CLOSED === 'true' || process.env.NODE_ENV === 'production') {
          throw err;
        }
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
  taskLimit?: number;
}

/**
 * Atomic Multi-Tier Redis Lua Script:
 * Evaluates all provided tiers (IP, User ID, Task) in an indivisible transaction.
 * If ANY tier exceeds its limit, NO tokens are consumed from any tier!
 * Tokens are recorded on all keys ONLY when all tiers have sufficient quota.
 */
const MULTI_TIER_RATE_LIMIT_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local token = ARGV[3]
local cutoff = now - window

-- 1. Check phase: verify all keys have capacity
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[3 + i])
  redis.call('ZREMRANGEBYSCORE', key, 0, cutoff)
  local current = redis.call('ZCARD', key)
  if current >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfterMs = window
    if oldest and #oldest >= 2 then
      retryAfterMs = math.max(1000, (tonumber(oldest[2]) + window) - now)
    end
    -- Returns 0, index of rejecting tier (1=IP, 2=User, 3=Task), retryAfterSeconds
    return { 0, i, math.ceil(retryAfterMs / 1000) }
  end
end

-- 2. Commit phase: capacity confirmed on all keys, record token on all keys
local minRemaining = 999999
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[3 + i])
  redis.call('ZADD', key, now, token)
  redis.call('EXPIRE', key, math.ceil(window / 1000) + 5)
  local current = redis.call('ZCARD', key)
  local rem = limit - current
  if rem < minRemaining then
    minRemaining = rem
  end
end

return { 1, minRemaining, 0 }
`;

async function executeMultiTierRateLimitLua(
  client: any,
  keys: string[],
  limits: number[],
  now: number,
  windowMs: number
): Promise<[number, number, number]> {
  const token = `${now}:${Math.random().toString(36).slice(2, 8)}`;
  const args = [String(now), String(windowMs), token, ...limits.map(String)];
  try {
    const res = await client.eval(MULTI_TIER_RATE_LIMIT_LUA, {
      keys,
      arguments: args,
    });
    return [Number(res[0]), Number(res[1]), Number(res[2])];
  } catch {
    const res = await client.eval(MULTI_TIER_RATE_LIMIT_LUA, keys.length, ...keys, ...args);
    return [Number(res[0]), Number(res[1]), Number(res[2])];
  }
}

/** In-memory simulate check (does not record) */
function simulateRateLimit(key: string, limit: number): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  cleanupStale();
  const now = Date.now();
  const cutoff = now - windowMs;
  const record = clients.get(key);
  const validTimestamps = record ? record.timestamps.filter(t => t > cutoff) : [];
  if (validTimestamps.length >= limit) {
    const oldest = validTimestamps[0];
    const retryAfterMs = Math.max(1000, oldest + windowMs - now);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }
  return { allowed: true, remaining: limit - validTimestamps.length - 1, retryAfterSeconds: 0 };
}

/** In-memory commit record */
function commitRateLimit(key: string): void {
  const now = Date.now();
  let record = clients.get(key);
  if (!record) {
    record = { timestamps: [] };
    clients.set(key, record);
  }
  record.timestamps.push(now);
}

/**
 * Distributed rate limiter with atomic multi-tier defense:
 * 1. Per IP limit (default 20 req/min)
 * 2. Per User ID limit (default 60 req/min)
 * 3. Per Task limit (default 10 req/min)
 * 4. Atomic Redis Lua OR atomic Neon Postgres (`rate_limit_buckets`) — zero partial consumption!
 * 5. Strict fail-closed production policy when neither Redis nor Neon Postgres is configured/reachable.
 */
export async function checkDistributedRateLimit(options: DistributedRateLimitOptions): Promise<RateLimitResult> {
  const cleanIp = sanitizeClientIdentifier(options.ip);
  const ipLimit = options.ipLimit ?? maxRequestsPerWindow;
  const userLimit = options.userLimit ?? 60;
  const taskLimit = options.taskLimit ?? 10;
  const isStrictFailClosed = process.env.RATE_LIMIT_FAIL_CLOSED === 'true' || process.env.NODE_ENV === 'production';
  const neonAvailable = isNeonConfigured();

  // Strict Fail-Closed in production when NEITHER Redis NOR Neon Postgres is configured
  if (
    process.env.NODE_ENV === 'production' &&
    !testRedisClient &&
    !testRedisError &&
    !hasValidRedisUrl() &&
    !neonAvailable
  ) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
      reason: 'Rate limit service is not configured in production',
    };
  }

  // 1. Primary: Redis distributed limiter (when REDIS_URL or test Redis hook is active)
  if (testRedisError || testRedisClient || hasValidRedisUrl()) {
    try {
      const redis = await getRedisClient();
      if (redis) {
        const now = Date.now();
        const keys: string[] = [`ratelimit:ip:${cleanIp}`];
        const limits: number[] = [ipLimit];

        if (options.userId) {
          keys.push(`ratelimit:user:${options.userId}`);
          limits.push(userLimit);
        }
        if (options.task) {
          keys.push(`ratelimit:task:${options.task}:${cleanIp}`);
          limits.push(taskLimit);
        }

        const [allowed, info, retrySeconds] = await executeMultiTierRateLimitLua(
          redis,
          keys,
          limits,
          now,
          windowMs
        );

        if (allowed === 0) {
          let reason = 'Distributed IP rate limit exceeded';
          if (info === 2 && options.userId) {
            reason = 'Distributed user account rate limit exceeded';
          } else if ((info === 3 && options.task) || (info === 2 && !options.userId && options.task)) {
            reason = `Distributed task rate limit exceeded: ${options.task}`;
          }
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: retrySeconds || 60,
            reason,
          };
        }

        return {
          allowed: true,
          remaining: info,
          retryAfterSeconds: 0,
        };
      }
    } catch (redisErr) {
      console.warn('[RateLimiter] Redis distributed check failed:', redisErr);
      // If a Redis failure is explicitly injected for testing, or Neon is not configured, respect fail-closed
      if (testRedisError || !neonAvailable) {
        if (isStrictFailClosed) {
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: 30,
            reason: 'Rate limit service unavailable in strict production mode',
          };
        }
      }
    }
  }

  // 2. Native Serverless Backend: Neon Postgres (`rate_limit_buckets`) atomic multi-tier rate limiting
  if (neonAvailable && process.env.NODE_ENV !== 'test') {
    try {
      return await checkNeonDistributedRateLimit({
        ip: cleanIp,
        userId: options.userId,
        task: options.task,
        ipLimit,
        userLimit,
        taskLimit,
        windowMs,
      });
    } catch (neonErr) {
      console.warn('[RateLimiter] Neon Postgres distributed check failed:', neonErr);
      if (isStrictFailClosed) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: 30,
          reason: 'Rate limit service unavailable in strict production mode',
        };
      }
    }
  }

  // In production or strict fail-closed mode, NEVER fall through to local memory
  if (isStrictFailClosed || process.env.NODE_ENV === 'production') {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
      reason: 'Rate limit service unavailable in strict production mode',
    };
  }

  // 3. Local dev / test in-memory atomic multi-tier fallback (check all, then commit all)
  const ipSim = simulateRateLimit(`ip:${cleanIp}`, ipLimit);
  if (!ipSim.allowed) {
    return { ...ipSim, reason: 'IP rate limit exceeded' };
  }

  let userSim: any = null;
  if (options.userId) {
    userSim = simulateRateLimit(`user:${options.userId}`, userLimit);
    if (!userSim.allowed) {
      return { ...userSim, reason: 'User account rate limit exceeded' };
    }
  }

  let taskSim: any = null;
  if (options.task) {
    taskSim = simulateRateLimit(`task:${options.task}:${cleanIp}`, taskLimit);
    if (!taskSim.allowed) {
      return { ...taskSim, reason: `Task '${options.task}' rate limit exceeded` };
    }
  }

  // All tiers have capacity: commit to all
  commitRateLimit(`ip:${cleanIp}`);
  if (options.userId) commitRateLimit(`user:${options.userId}`);
  if (options.task) commitRateLimit(`task:${options.task}:${cleanIp}`);

  const minRem = Math.min(
    ipSim.remaining,
    userSim ? userSim.remaining : Infinity,
    taskSim ? taskSim.remaining : Infinity
  );

  return {
    allowed: true,
    remaining: minRem,
    retryAfterSeconds: 0,
  };
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
