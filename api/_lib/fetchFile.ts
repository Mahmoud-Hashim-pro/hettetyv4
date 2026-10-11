/**
 * Turns { fileUrl } parts into { inlineData } by fetching them server-side.
 *
 * Only Firebase Storage download URLs are fetched. That host is Google's own and
 * the app already stores every upload there, so this is not a general-purpose
 * fetcher: an arbitrary URL is refused rather than proxied.
 */
import { Message, Part, ProviderError } from './types.js';

const STORAGE_HOST = 'firebasestorage.googleapis.com';
/** Storage rules cap a PDF at 15MB; refuse anything larger before buffering it. */
const MAX_FETCH_BYTES = 16 * 1024 * 1024;
/** Bound aggregate payload size across all attachments in a single request (25MB). */
const MAX_AGGREGATE_FETCH_BYTES = 25 * 1024 * 1024;
/** Maximum number of file attachments allowed per AI request. */
const MAX_FILE_ATTACHMENTS = 5;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function assertFetchable(raw: string, callerUid?: string, isAdmin?: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError('`fileUrl.url` is not a valid URL', 400);
  }
  if (url.protocol !== 'https:') throw new ProviderError('`fileUrl.url` must be https', 400);
  if (url.hostname !== STORAGE_HOST) {
    throw new ProviderError(`Only ${STORAGE_HOST} files can be fetched`, 400);
  }
  // When the bucket is configured, pin to it as well — otherwise any public
  // Firebase file in the world would be fetchable through this function.
  // In production, fallback to the project's official bucket if not explicitly passed in env.
  const bucket = process.env.STORAGE_BUCKET || (process.env.NODE_ENV === 'production' ? 'gen-lang-client-0748002195.firebasestorage.app' : undefined);
  if (bucket && !url.pathname.startsWith(`/v0/b/${bucket}/`)) {
    throw new ProviderError('That file is not in this project\'s storage bucket', 400);
  }

  // Verify storage object namespace: only /properties/ and /user_documents/ are allowed
  const decodedPath = decodeURIComponent(url.pathname);
  if (!/\/o\/(properties|user_documents)\//.test(decodedPath)) {
    throw new ProviderError('Invalid storage object namespace: only properties and user_documents are permitted', 400, false);
  }

  // Ownership verification for private/confidential paths
  if (callerUid && !isAdmin) {
    // 1. Private user documents: /v0/b/.../o/user_documents/{userId}/...
    const userDocMatch = decodedPath.match(/\/o\/user_documents\/([^/]+)/);
    if (userDocMatch && userDocMatch[1] !== callerUid) {
      throw new ProviderError('Unauthorized: You cannot attach another user\'s private documents', 403, false);
    }
    // 2. Private legal property documents: /v0/b/.../o/properties/{ownerUid}/legal/...
    const legalDocMatch = decodedPath.match(/\/o\/properties\/([^/]+)\/legal\//);
    if (legalDocMatch && legalDocMatch[1] !== callerUid) {
      throw new ProviderError('Unauthorized: You cannot attach another user\'s legal documents', 403, false);
    }
  }

  return url;
}

function verifyFileSignature(buf: Buffer, mimeType: string) {
  if (buf.length < 4) {
    throw new ProviderError('File is too small or truncated', 400, false);
  }
  if (mimeType === 'application/pdf') {
    if (buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) {
      throw new ProviderError('File content does not match PDF signature (%PDF-)', 400, false);
    }
  } else if (mimeType === 'image/jpeg') {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) {
      throw new ProviderError('File content does not match JPEG signature', 400, false);
    }
  } else if (mimeType === 'image/png') {
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
      throw new ProviderError('File content does not match PNG signature', 400, false);
    }
  } else if (mimeType === 'image/webp') {
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
      throw new ProviderError('File content does not match WebP signature', 400, false);
    }
  } else if (mimeType === 'image/gif') {
    if (buf.length < 6 || !buf.toString('ascii', 0, 6).startsWith('GIF8')) {
      throw new ProviderError('File content does not match GIF signature', 400, false);
    }
  }
}

class AggregateByteTracker {
  private totalBytes = 0;
  constructor(private readonly maxBytes: number = MAX_AGGREGATE_FETCH_BYTES) {}

  addAndCheck(chunkBytes: number, reader?: { cancel: () => Promise<any> | any }): void {
    this.totalBytes += chunkBytes;
    if (this.totalBytes > this.maxBytes) {
      if (reader && typeof reader.cancel === 'function') {
        try {
          reader.cancel();
        } catch {
          // ignore error on reader cancel
        }
      }
      throw new ProviderError(
        `Aggregate attachment size exceeds maximum allowed ${Math.round(this.maxBytes / (1024 * 1024))}MB limit`,
        413,
        false
      );
    }
  }

  getTotal(): number {
    return this.totalBytes;
  }
}

async function readStreamWithLimit(
  res: any,
  maxBytes: number,
  tracker?: AggregateByteTracker
): Promise<Buffer> {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let fileBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          fileBytes += value.byteLength;
          if (fileBytes > maxBytes) {
            await reader.cancel();
            throw new ProviderError('That file is too large to read', 413, false);
          }
          if (tracker) {
            tracker.addAndCheck(value.byteLength, reader);
          }
          chunks.push(value);
        }
      }
    } catch (err: any) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`Error streaming file: ${err?.message || err}`, 400, false);
    }
    return Buffer.concat(chunks);
  }

  // Fallback for mock environments / non-streaming response objects
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new ProviderError('That file is too large to read', 413, false);
  }
  if (tracker) {
    tracker.addAndCheck(buf.byteLength);
  }
  return buf;
}

async function fetchAsInline(url: URL, mimeType: string, tracker?: AggregateByteTracker) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ProviderError(`Unsupported file mimeType "${mimeType}"`, 400, false);
  }

  let res: any;
  try {
    res = await fetch(url.toString(), {
      redirect: 'error',
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(15000) : undefined,
    });
  } catch (fetchErr: any) {
    if (fetchErr?.name === 'TimeoutError') {
      throw new ProviderError('File download timed out after 15 seconds', 504, true);
    }
    if (fetchErr?.message?.includes('redirect') || fetchErr?.name === 'TypeError') {
      throw new ProviderError('Refusing unexpected redirect on storage download URL', 400, false);
    }
    throw new ProviderError(`Could not fetch file: ${fetchErr?.message || fetchErr}`, 400, false);
  }

  if (!res.ok) {
    throw new ProviderError(`Could not read the uploaded file (${res.status})`, 400, false);
  }
  const declared = Number(res.headers?.get ? res.headers.get('content-length') : 0);
  if (declared > MAX_FETCH_BYTES) {
    throw new ProviderError('That file is too large to read', 413, false);
  }
  if (tracker && declared > 0 && tracker.getTotal() + declared > MAX_AGGREGATE_FETCH_BYTES) {
    throw new ProviderError(
      `Aggregate attachment size exceeds maximum allowed ${Math.round(MAX_AGGREGATE_FETCH_BYTES / (1024 * 1024))}MB limit`,
      413,
      false
    );
  }

  const buf = await readStreamWithLimit(res, MAX_FETCH_BYTES, tracker);
  verifyFileSignature(buf, mimeType);

  return { inlineData: { mimeType, data: buf.toString('base64') } } as Part;
}

/** Resolves every fileUrl part in the conversation, leaving other parts untouched. */
export async function resolveFileUrls(
  contents: Message[],
  callerUid?: string,
  isAdmin?: boolean
): Promise<Message[]> {
  const fileParts: { url: string; mimeType: string }[] = [];
  for (const m of contents) {
    for (const p of m.parts) {
      if ('fileUrl' in p && p.fileUrl) {
        fileParts.push(p.fileUrl);
      }
    }
  }

  if (fileParts.length === 0) return contents;

  if (fileParts.length > MAX_FILE_ATTACHMENTS) {
    throw new ProviderError(`Too many file attachments (maximum ${MAX_FILE_ATTACHMENTS} permitted per AI request)`, 400, false);
  }

  const tracker = new AggregateByteTracker(MAX_AGGREGATE_FETCH_BYTES);

  return Promise.all(
    contents.map(async (m) => ({
      ...m,
      parts: await Promise.all(
        m.parts.map(async (part) => {
          if (!('fileUrl' in part)) return part;
          const { url, mimeType } = part.fileUrl;
          if (typeof mimeType !== 'string' || !mimeType) {
            throw new ProviderError('`fileUrl.mimeType` is required', 400);
          }
          const inlinePart = await fetchAsInline(assertFetchable(url, callerUid, isAdmin), mimeType, tracker);
          return inlinePart;
        })
      ),
    }))
  );
}
