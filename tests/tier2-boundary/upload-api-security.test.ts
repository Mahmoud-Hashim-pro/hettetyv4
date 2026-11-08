import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import uploadHandler from '../../api/upload';
import { resolveFileUrls } from '../../api/_lib/fetchFile';
import { Message } from '../../api/_lib/types';
import { mockPropertiesStore } from '../../api/reconstruction';

const BUCKET = 'test-project.firebasestorage.app';

describe('Tier 2 — Security & Upload Hardening Audit (api/upload.ts & api/_lib/fetchFile.ts)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    mockPropertiesStore.clear();
    delete process.env.STORAGE_BUCKET;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.STORAGE_BUCKET;
  });

  describe('api/upload.ts Signed Upload Minter Security', () => {
    it('strictly rejects unauthenticated requests with 401', async () => {
      let resStatus = 0;
      let resJson: any = null;
      const mockRes = {
        status: (s: number) => {
          resStatus = s;
          return { json: (d: any) => { resJson = d; return d; } };
        },
      };

      await uploadHandler(
        {
          method: 'POST',
          headers: {},
          body: {
            propertyId: 'prop_test_1',
            files: [{ name: 'pic.jpg', sizeBytes: 1000, mimeType: 'image/jpeg' }],
          },
        },
        mockRes
      );

      expect(resStatus).toBe(401);
      expect(resJson.error).toContain('AUTHENTICATION_REQUIRED');
    });

    it('strictly rejects callers who do not own the property with 403', async () => {
      mockPropertiesStore.set('prop_victim_1', {
        authorUid: 'user_legitimate_owner',
      });

      let resStatus = 0;
      let resJson: any = null;
      const mockRes = {
        status: (s: number) => {
          resStatus = s;
          return { json: (d: any) => { resJson = d; return d; } };
        },
      };

      await uploadHandler(
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer attacker_token',
            'x-user-id': 'user_attacker_999',
          },
          body: {
            propertyId: 'prop_victim_1',
            files: [{ name: 'frame.jpg', sizeBytes: 1000, mimeType: 'image/jpeg' }],
          },
        },
        mockRes
      );

      expect(resStatus).toBe(403);
      expect(resJson.error).toContain('FORBIDDEN');
      expect(resJson.error).toContain('You do not own this property');
    });

    it('strictly rejects path traversal injection in propertyId and jobId', async () => {
      let resStatus = 0;
      let resJson: any = null;
      const mockRes = {
        status: (s: number) => {
          resStatus = s;
          return { json: (d: any) => { resJson = d; return d; } };
        },
      };

      // Path traversal in propertyId
      await uploadHandler(
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer test_token',
            'x-user-id': 'test-owner-uid',
          },
          body: {
            propertyId: '../../etc/passwd',
            files: [{ name: 'pic.jpg', sizeBytes: 1000, mimeType: 'image/jpeg' }],
          },
        },
        mockRes
      );

      expect(resStatus).toBe(400);
      expect(resJson.error).toContain('INVALID_REQUEST');

      // Path traversal in jobId
      await uploadHandler(
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer test_token',
            'x-user-id': 'test-owner-uid',
          },
          body: {
            propertyId: 'prop-test-ok',
            jobId: '../job_evil',
            files: [{ name: 'pic.jpg', sizeBytes: 1000, mimeType: 'image/jpeg' }],
          },
        },
        mockRes
      );

      expect(resStatus).toBe(400);
      expect(resJson.error).toContain('INVALID_REQUEST');
    });

    it('strictly sanitizes and prevents path traversal in uploaded filenames', async () => {
      mockPropertiesStore.set('prop_safe_owner', {
        authorUid: 'user_legit',
      });

      let resStatus = 0;
      let resJson: any = null;
      const mockRes = {
        status: (s: number) => {
          resStatus = s;
          return { json: (d: any) => { resJson = d; return d; } };
        },
      };

      await uploadHandler(
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer legit_token',
            'x-user-id': 'user_legit',
          },
          body: {
            propertyId: 'prop_safe_owner',
            jobId: 'job_clean_1',
            files: [
              { name: '../../../etc/passwd.jpg', sizeBytes: 1000, mimeType: 'image/jpeg' },
            ],
          },
        },
        mockRes
      );

      expect(resStatus).toBe(400);
      expect(resJson.error).toContain('PATH_TRAVERSAL_DETECTED');
    });

    it('strictly enforces Content-Type whitelisting for images and mp4 videos', async () => {
      mockPropertiesStore.set('prop_mime_test', {
        authorUid: 'user_mime_owner',
      });

      let resStatus = 0;
      let resJson: any = null;
      const mockRes = {
        status: (s: number) => {
          resStatus = s;
          return { json: (d: any) => { resJson = d; return d; } };
        },
      };

      // 1. Rejects dangerous executable or script types
      await uploadHandler(
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer token',
            'x-user-id': 'user_mime_owner',
          },
          body: {
            propertyId: 'prop_mime_test',
            files: [{ name: 'exploit.exe', sizeBytes: 500, mimeType: 'application/x-msdownload' }],
          },
        },
        mockRes
      );
      expect(resStatus).toBe(400);
      expect(resJson.error).toContain('INVALID_FILE_TYPE');

      // 2. Accepts valid JPEG, PNG, WebP images
      await uploadHandler(
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer token',
            'x-user-id': 'user_mime_owner',
          },
          body: {
            propertyId: 'prop_mime_test',
            files: [
              { name: 'photo1.jpg', sizeBytes: 1000, mimeType: 'image/jpeg' },
              { name: 'photo2.png', sizeBytes: 2000, mimeType: 'image/png' },
            ],
          },
        },
        mockRes
      );
      expect(resStatus).toBe(200);
      expect(resJson.success).toBe(true);
      expect(resJson.destinations.length).toBe(2);

      // 3. Accepts valid MP4 video
      await uploadHandler(
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer token',
            'x-user-id': 'user_mime_owner',
          },
          body: {
            propertyId: 'prop_mime_test',
            type: 'video',
            files: [{ name: 'walkthrough.mp4', sizeBytes: 15 * 1024 * 1024, mimeType: 'video/mp4' }],
          },
        },
        mockRes
      );
      expect(resStatus).toBe(200);
      expect(resJson.destinations[0].storagePath).toContain('walkthrough.mp4');
      expect(resJson.destinations[0].uploadUrl).toBeDefined();
      expect(resJson.uploadSessionExpiresAt).toBeDefined();
    });
  });

  describe('api/_lib/fetchFile.ts Defenses & MP4 Support', () => {
    it('strictly rejects path traversal attempts with 400', async () => {
      process.env.STORAGE_BUCKET = BUCKET;
      const callerUid = 'user_123';

      const traversalUrl1 = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/properties%2F${callerUid}%2F..%2F..%2Fvictim_secret.pdf?alt=media`;
      const msg1: Message[] = [{ role: 'user', parts: [{ fileUrl: { url: traversalUrl1, mimeType: 'application/pdf' } }] }];
      await expect(resolveFileUrls(msg1, callerUid)).rejects.toThrow(/Path traversal detected/i);

      const traversalUrl2 = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/properties%2F..%2Fuser_documents%2Fsecret.pdf?alt=media`;
      const msg2: Message[] = [{ role: 'user', parts: [{ fileUrl: { url: traversalUrl2, mimeType: 'application/pdf' } }] }];
      await expect(resolveFileUrls(msg2, callerUid)).rejects.toThrow(/Path traversal detected/i);
    });

    it('accepts valid video/mp4 with ftyp signature', async () => {
      process.env.STORAGE_BUCKET = BUCKET;
      const callerUid = 'user_mp4_ok';
      const mp4Url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/properties%2F${callerUid}%2Ftour.mp4?alt=media`;

      // Construct MP4 header: 4-byte length + 'ftyp' + 'mp42'
      const mp4Bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6D, 0x70, 0x34, 0x32]);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => String(mp4Bytes.byteLength) },
        arrayBuffer: async () => mp4Bytes.buffer.slice(mp4Bytes.byteOffset, mp4Bytes.byteOffset + mp4Bytes.byteLength),
      }) as any;

      const msg: Message[] = [{ role: 'user', parts: [{ fileUrl: { url: mp4Url, mimeType: 'video/mp4' } }] }];
      const out = await resolveFileUrls(msg, callerUid);
      expect(out[0].parts[0]).toHaveProperty('inlineData');
      const part = out[0].parts[0] as any;
      expect(part.inlineData.mimeType).toBe('video/mp4');
    });

    it('rejects video/mp4 when file content lacks ftyp signature', async () => {
      process.env.STORAGE_BUCKET = BUCKET;
      const callerUid = 'user_mp4_bad';
      const mp4Url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/properties%2F${callerUid}%2Ffake.mp4?alt=media`;

      // Corrupted or fake payload
      const fakeBytes = Buffer.from('NOT_AN_MP4_FILE_HERE');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => String(fakeBytes.byteLength) },
        arrayBuffer: async () => fakeBytes.buffer.slice(fakeBytes.byteOffset, fakeBytes.byteOffset + fakeBytes.byteLength),
      }) as any;

      const msg: Message[] = [{ role: 'user', parts: [{ fileUrl: { url: mp4Url, mimeType: 'video/mp4' } }] }];
      await expect(resolveFileUrls(msg, callerUid)).rejects.toThrow(/does not match MP4 signature/i);
    });
  });
});
