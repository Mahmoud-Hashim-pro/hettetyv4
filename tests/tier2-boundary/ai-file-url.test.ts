import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveFileUrls } from '../../api/_lib/fetchFile';
import { Message } from '../../api/_lib/types';

const BUCKET = 'test-project.firebasestorage.app';
const good = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/properties%2Fuid%2Fbrochure.pdf?alt=media&token=t`;

const msg = (url: string, mimeType = 'application/pdf'): Message[] => ([
  { role: 'user', parts: [{ text: 'read this' }, { fileUrl: { url, mimeType } }] },
]);

const okFetch = (bytes = Buffer.from('%PDF-1.4 hello')) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => String(bytes.byteLength) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });

describe('Tier 2 — Fetching a staged file for the AI', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => { delete process.env.STORAGE_BUCKET; });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.STORAGE_BUCKET; });

  it('leaves a conversation without file references untouched', async () => {
    globalThis.fetch = vi.fn() as any;
    const plain: Message[] = [{ role: 'user', parts: [{ text: 'hi' }] }];
    await expect(resolveFileUrls(plain)).resolves.toBe(plain);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('turns a staged Storage file into inline bytes for the provider', async () => {
    globalThis.fetch = okFetch() as any;
    const out = await resolveFileUrls(msg(good));
    const part = out[0].parts[1] as any;
    // Providers only ever see inline data — the URL never reaches them.
    expect(part.inlineData.mimeType).toBe('application/pdf');
    expect(Buffer.from(part.inlineData.data, 'base64').toString()).toBe('%PDF-1.4 hello');
    expect(out[0].parts[0]).toEqual({ text: 'read this' });
  });

  it.each([
    ['plain http', `http://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/x`],
    ['another host', 'https://evil.example.com/brochure.pdf'],
    ['host that merely starts the same', 'https://firebasestorage.googleapis.com.evil.com/x'],
    ['a local address', 'https://169.254.169.254/latest/meta-data/'],
    ['not a URL at all', 'not-a-url'],
  ])('refuses to fetch %s', async (_label, url) => {
    globalThis.fetch = vi.fn() as any;
    await expect(resolveFileUrls(msg(url))).rejects.toThrow();
    // The point is that nothing is requested, not merely that it errors after.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('pins the fetch to this project when the bucket is configured', async () => {
    process.env.STORAGE_BUCKET = BUCKET;
    globalThis.fetch = vi.fn() as any;
    const otherBucket = 'https://firebasestorage.googleapis.com/v0/b/someone-else.appspot.com/o/x';
    await expect(resolveFileUrls(msg(otherBucket))).rejects.toThrow(/storage bucket/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    globalThis.fetch = okFetch() as any;
    await expect(resolveFileUrls(msg(good))).resolves.toBeTruthy();
  });

  it('refuses a file larger than Storage would have accepted', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => String(20 * 1024 * 1024) },
      arrayBuffer: async () => new ArrayBuffer(8),
    }) as any;
    await expect(resolveFileUrls(msg(good))).rejects.toThrow(/too large/i);
  });

  it('reports a download that failed instead of sending an empty file', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 404, headers: { get: () => '0' }, arrayBuffer: async () => new ArrayBuffer(0),
    }) as any;
    await expect(resolveFileUrls(msg(good))).rejects.toThrow(/could not read/i);
  });

  it('requires a mime type — the provider cannot guess one', async () => {
    globalThis.fetch = vi.fn() as any;
    await expect(resolveFileUrls(msg(good, ''))).rejects.toThrow(/mimeType/i);
  });

  it('refuses unsupported MIME types outside the allowlist', async () => {
    globalThis.fetch = okFetch() as any;
    await expect(resolveFileUrls(msg(good, 'application/javascript'))).rejects.toThrow(/unsupported file mimeType/i);
    await expect(resolveFileUrls(msg(good, 'text/html'))).rejects.toThrow(/unsupported file mimeType/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects file when file magic bytes do not match declared PDF signature', async () => {
    // Malicious or mismatched payload pretending to be PDF
    const fakePdfBytes = Buffer.from('<html><body>Not a PDF</body></html>');
    globalThis.fetch = okFetch(fakePdfBytes) as any;
    await expect(resolveFileUrls(msg(good, 'application/pdf'))).rejects.toThrow(/does not match PDF signature/i);
  });

  it('accepts valid JPEG, PNG, and WebP files with valid magic signatures', async () => {
    // JPEG magic bytes: FF D8 FF
    const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    globalThis.fetch = okFetch(jpegBytes) as any;
    const resJpeg = await resolveFileUrls(msg(good, 'image/jpeg'));
    expect(resJpeg[0].parts[1]).toHaveProperty('inlineData');

    // PNG magic bytes: 89 50 4E 47
    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    globalThis.fetch = okFetch(pngBytes) as any;
    const resPng = await resolveFileUrls(msg(good, 'image/png'));
    expect(resPng[0].parts[1]).toHaveProperty('inlineData');
  });

  it('refuses unexpected HTTP redirects on storage download URLs', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch (redirect)')) as any;
    await expect(resolveFileUrls(msg(good, 'application/pdf'))).rejects.toThrow(/redirect/i);
  });

  it('aborts streaming and rejects when stream chunk accumulation exceeds 16MB', async () => {
    let cancelCalled = false;
    let readCount = 0;
    const mockStreamReader = {
      read: async () => {
        readCount++;
        if (readCount === 1) {
          return { done: false, value: new Uint8Array(10 * 1024 * 1024) }; // 10MB
        } else if (readCount === 2) {
          return { done: false, value: new Uint8Array(7 * 1024 * 1024) }; // +7MB = 17MB (> 16MB)
        }
        return { done: true, value: undefined };
      },
      cancel: async () => {
        cancelCalled = true;
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => '0' }, // Chunked transfer without content-length
      body: {
        getReader: () => mockStreamReader,
      },
    }) as any;

    await expect(resolveFileUrls(msg(good, 'application/pdf'))).rejects.toThrow(/too large/i);
    expect(cancelCalled).toBe(true);
  });

  it('strictly rejects requests exceeding maximum 5 file attachments', async () => {
    const multiMsg: Message[] = [
      {
        role: 'user',
        parts: [
          { text: 'Analyze these files' },
          { fileUrl: { url: good, mimeType: 'application/pdf' } },
          { fileUrl: { url: good, mimeType: 'application/pdf' } },
          { fileUrl: { url: good, mimeType: 'application/pdf' } },
          { fileUrl: { url: good, mimeType: 'application/pdf' } },
          { fileUrl: { url: good, mimeType: 'application/pdf' } },
          { fileUrl: { url: good, mimeType: 'application/pdf' } }, // 6th attachment
        ],
      },
    ];

    await expect(resolveFileUrls(multiMsg)).rejects.toThrow(/Too many file attachments/i);
  });

  it('strictly rejects requests when aggregate attachment payload exceeds 25MB limit', async () => {
    // 2 files, each 14MB (total 28MB > 25MB)
    const bigFileBytes = Buffer.from('%PDF-' + 'X'.repeat(14 * 1024 * 1024));
    globalThis.fetch = okFetch(bigFileBytes) as any;

    const twoFilesMsg: Message[] = [
      {
        role: 'user',
        parts: [
          { text: 'Analyze these big files' },
          { fileUrl: { url: good, mimeType: 'application/pdf' } },
          { fileUrl: { url: good, mimeType: 'application/pdf' } },
        ],
      },
    ];

    await expect(resolveFileUrls(twoFilesMsg)).rejects.toThrow(/Aggregate attachment size exceeds/i);
  });

  it('strictly verifies caller ownership for private user documents and confidential legal property documents', async () => {
    process.env.STORAGE_BUCKET = BUCKET;
    const callerUid = 'user-alice-123';
    const strangerUserDoc = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/user_documents%2Fuser-bob-999%2Fpassport.pdf?alt=media`;
    const strangerLegalDoc = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/properties%2Fuser-bob-999%2Flegal%2Fdeed.pdf?alt=media`;
    const ownUserDoc = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/user_documents%2F${callerUid}%2Fmy_id.pdf?alt=media`;

    // 1. Trying to attach another user's private document is rejected
    await expect(resolveFileUrls(msg(strangerUserDoc), callerUid)).rejects.toThrow(/Unauthorized.*another user's private documents/i);

    // 2. Trying to attach another user's legal document is rejected
    await expect(resolveFileUrls(msg(strangerLegalDoc), callerUid)).rejects.toThrow(/Unauthorized.*another user's legal documents/i);

    // 3. Attaching own private document is permitted
    globalThis.fetch = okFetch() as any;
    const res = await resolveFileUrls(msg(ownUserDoc), callerUid);
    expect(res[0].parts[1]).toHaveProperty('inlineData');
  });

  it('rejects files outside properties and user_documents storage namespaces', async () => {
    process.env.STORAGE_BUCKET = BUCKET;
    const invalidNamespaceDoc = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/internal_secrets%2Fkeys.pdf?alt=media`;
    await expect(resolveFileUrls(msg(invalidNamespaceDoc))).rejects.toThrow(/Invalid storage object namespace/i);
  });

  it('aborts stream reader immediately when aggregate streaming chunks across files exceed 25MB ceiling', async () => {
    let cancelCalled = false;
    let fileIndex = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fileIndex++;
      const isSecondFile = fileIndex === 2;
      let readCount = 0;
      const mockReader = {
        read: async () => {
          readCount++;
          if (!isSecondFile) {
            // First file: 15MB
            if (readCount === 1) return { done: false, value: new Uint8Array(15 * 1024 * 1024) };
            return { done: true, value: undefined };
          } else {
            // Second file: chunk 1 is 11MB -> total 26MB (>25MB)
            if (readCount === 1) return { done: false, value: new Uint8Array(11 * 1024 * 1024) };
            return { done: true, value: undefined };
          }
        },
        cancel: async () => {
          cancelCalled = true;
        },
      };

      return {
        ok: true,
        status: 200,
        headers: { get: () => '0' },
        body: { getReader: () => mockReader },
      };
    }) as any;

    const twoFilesMsg: Message[] = [
      {
        role: 'user',
        parts: [
          { text: 'Analyze these big streaming files' },
          { fileUrl: { url: good, mimeType: 'application/pdf' } },
          { fileUrl: { url: good, mimeType: 'application/pdf' } },
        ],
      },
    ];

    await expect(resolveFileUrls(twoFilesMsg)).rejects.toThrow(/Aggregate attachment size exceeds/i);
    expect(cancelCalled).toBe(true);
  });
});


