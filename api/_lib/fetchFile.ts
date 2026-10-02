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

async function fetchAsInline(url: URL, mimeType: string) {
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new ProviderError(`Could not read the uploaded file (${res.status})`, 400, false);
  }
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_FETCH_BYTES) {
    throw new ProviderError('That file is too large to read', 413, false);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_FETCH_BYTES) {
    throw new ProviderError('That file is too large to read', 413, false);
  }
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
