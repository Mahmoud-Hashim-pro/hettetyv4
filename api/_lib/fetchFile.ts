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

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function assertFetchable(raw: string): URL {
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

async function readStreamWithLimit(res: any, maxBytes: number): Promise<Buffer> {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw new ProviderError('That file is too large to read', 413, false);
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
  return buf;
}

async function fetchAsInline(url: URL, mimeType: string) {
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

  const buf = await readStreamWithLimit(res, MAX_FETCH_BYTES);
  verifyFileSignature(buf, mimeType);

  return { inlineData: { mimeType, data: buf.toString('base64') } } as Part;
}

/** Resolves every fileUrl part in the conversation, leaving other parts untouched. */
export async function resolveFileUrls(contents: Message[]): Promise<Message[]> {
  const needsWork = contents.some((m) => m.parts.some((p) => 'fileUrl' in p));
  if (!needsWork) return contents;

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
          return fetchAsInline(assertFetchable(url), mimeType);
        })
      ),
    }))
  );
}
