/**
 * In-memory sliding-window rate limiter for serverless API endpoints.
 * Limits requests per client identifier (IP address) to prevent API abuse and quota exhaustion.
 */

interface RateLimitRecord {
  timestamps: number[];
}

const windowMs = 60 * 1000; // 1 minute window
const maxRequestsPerWindow = 20; // 20 requests per minute per IP
const clients = new Map<string, RateLimitRecord>();

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
}

export function checkRateLimit(clientId: string, limit: number = maxRequestsPerWindow): RateLimitResult {
  cleanupStale();
  const now = Date.now();
  const cutoff = now - windowMs;

  let record = clients.get(clientId);
  if (!record) {
    record = { timestamps: [] };
    clients.set(clientId, record);
  }

  // Filter timestamps within the current sliding window
  record.timestamps = record.timestamps.filter(t => t > cutoff);

  if (record.timestamps.length >= limit) {
    const oldestTimestamp = record.timestamps[0];
    const retryAfterMs = Math.max(1000, oldestTimestamp + windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    remaining: limit - record.timestamps.length,
    retryAfterSeconds: 0
  };
}
