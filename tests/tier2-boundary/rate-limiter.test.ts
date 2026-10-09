import { describe, it, expect, beforeEach } from 'vitest';
import {
  sanitizeClientIdentifier,
  checkRateLimit,
  checkDistributedRateLimit,
  acquireConcurrencySlot,
  releaseConcurrencySlot,
} from '../../api/_lib/rateLimiter';

describe('Tier 2 — AI Rate Limiter & Concurrency Protection', () => {
  describe('sanitizeClientIdentifier', () => {
    it('normalizes standard IPv4 addresses', () => {
      expect(sanitizeClientIdentifier('192.168.1.10')).toBe('192.168.1.10');
    });

    it('strips port from IPv4 address', () => {
      expect(sanitizeClientIdentifier('192.168.1.10:8080')).toBe('192.168.1.10');
    });

    it('extracts leftmost client IP from X-Forwarded-For proxy chain', () => {
      expect(sanitizeClientIdentifier('203.0.113.195, 70.41.3.18, 150.172.238.178')).toBe('203.0.113.195');
    });

    it('strips brackets from IPv6 addresses', () => {
      expect(sanitizeClientIdentifier('[2001:db8::1]')).toBe('2001:db8::1');
    });

    it('falls back safely to 127.0.0.1 for empty or invalid inputs', () => {
      expect(sanitizeClientIdentifier('')).toBe('127.0.0.1');
      expect(sanitizeClientIdentifier(null as any)).toBe('127.0.0.1');
      expect(sanitizeClientIdentifier(undefined as any)).toBe('127.0.0.1');
    });
  });

  describe('checkRateLimit (Sliding Window)', () => {
    it('permits requests within configured window limits', () => {
      const clientId = 'client-test-permit-' + Math.random();
      for (let i = 0; i < 5; i++) {
        const res = checkRateLimit(clientId, 10);
        expect(res.allowed).toBe(true);
        expect(res.remaining).toBe(10 - (i + 1));
      }
    });

    it('blocks requests once limit is exceeded and returns Retry-After', () => {
      const clientId = 'client-test-block-' + Math.random();
      for (let i = 0; i < 3; i++) {
        checkRateLimit(clientId, 3);
      }
      const blockedRes = checkRateLimit(clientId, 3);
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.remaining).toBe(0);
      expect(blockedRes.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe('checkDistributedRateLimit (Multi-Tier)', () => {
    it('enforces multi-tier defense across IP and authenticated user accounts', async () => {
      const testIp = '198.51.100.22';
      const testUser = 'user-auth-vip-42';

      // Within limit
      const res = await checkDistributedRateLimit({
        ip: testIp,
        userId: testUser,
        ipLimit: 5,
        userLimit: 5,
      });
      expect(res.allowed).toBe(true);

      // Exceed user limit
      const heavyUser = 'user-spammer-' + Math.random();
      for (let i = 0; i < 3; i++) {
        await checkDistributedRateLimit({
          ip: `198.51.100.${i}`,
          userId: heavyUser,
          ipLimit: 10,
          userLimit: 3,
        });
      }
      const blockedUserRes = await checkDistributedRateLimit({
        ip: '198.51.100.99',
        userId: heavyUser,
        ipLimit: 10,
        userLimit: 3,
      });
      expect(blockedUserRes.allowed).toBe(false);
      expect(blockedUserRes.reason).toMatch(/user/i);
    });
  });

  describe('Concurrency Guard (Slot Acquisition)', () => {
    it('enforces maximum concurrent in-flight requests per client IP', () => {
      const ip = '203.0.113.50';
      const maxSlots = 3;

      // Acquire up to limit
      expect(acquireConcurrencySlot(ip, maxSlots)).toBe(true);
      expect(acquireConcurrencySlot(ip, maxSlots)).toBe(true);
      expect(acquireConcurrencySlot(ip, maxSlots)).toBe(true);

      // 4th concurrent attempt rejected
      expect(acquireConcurrencySlot(ip, maxSlots)).toBe(false);

      // Release one slot
      releaseConcurrencySlot(ip);

      // Now 1 more can be acquired
      expect(acquireConcurrencySlot(ip, maxSlots)).toBe(true);
      expect(acquireConcurrencySlot(ip, maxSlots)).toBe(false);

      // Release all
      releaseConcurrencySlot(ip);
      releaseConcurrencySlot(ip);
      releaseConcurrencySlot(ip);
    });
  });
});
