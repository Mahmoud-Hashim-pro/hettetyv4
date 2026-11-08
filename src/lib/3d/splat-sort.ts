/**
 * Back-to-front ordering for Gaussian splats.
 *
 * Alpha compositing of splats is order dependent, so the renderer must draw
 * them far-to-near relative to the camera. A comparison sort is O(n log n) and
 * allocates per call, which is why the old renderer simply stopped sorting
 * above 100k splats. This module uses a single-pass 16-bit counting sort over
 * view-space depth, which is O(n), allocation-free when buffers are reused, and
 * fast enough for multi-million splat scenes — especially when run inside the
 * companion Web Worker (splat-sort.worker.ts) so it never blocks rendering.
 */

/** Scenes above this are refused by the viewer instead of rendered poorly. */
export const MAX_RENDERABLE_SPLATS = 6_000_000;

/** Below this, sorting synchronously on the main thread is cheaper than a worker round trip. */
export const SYNC_SORT_THRESHOLD = 60_000;

const DEPTH_BUCKETS = 65536;

export interface SplatSortBuffers {
  depths: Int32Array;
  counts: Uint32Array;
  order: Uint32Array;
}

export const createSplatSortBuffers = (count: number): SplatSortBuffers => ({
  depths: new Int32Array(count),
  counts: new Uint32Array(DEPTH_BUCKETS),
  order: new Uint32Array(count),
});

/**
 * Computes a far-to-near draw order.
 *
 * @param positions xyz triplets
 * @param count number of splats
 * @param camPos camera position in the same space as positions
 * @param camDir normalised camera forward vector
 * @param buffers reusable scratch buffers (created if omitted)
 * @returns permutation: order[i] = source index to draw at slot i
 */
export const computeSplatSortOrder = (
  positions: Float32Array,
  count: number,
  camPos: [number, number, number],
  camDir: [number, number, number],
  buffers?: SplatSortBuffers
): Uint32Array => {
  const n = Math.max(0, Math.min(count, Math.floor(positions.length / 3)));
  const buf =
    buffers && buffers.depths.length >= n && buffers.order.length >= n
      ? buffers
      : createSplatSortBuffers(n);
  const { depths, counts, order } = buf;

  if (n === 0) return order.subarray(0, 0);

  const [cx, cy, cz] = camPos;
  const [dx, dy, dz] = camDir;

  // 1. View-space depth along the camera forward axis.
  let minD = Infinity;
  let maxD = -Infinity;
  const fdepth = new Float32Array(depths.buffer, depths.byteOffset, n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const d = (positions[o] - cx) * dx + (positions[o + 1] - cy) * dy + (positions[o + 2] - cz) * dz;
    fdepth[i] = d;
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }

  const range = maxD - minD;
  if (!Number.isFinite(range) || range <= 0) {
    for (let i = 0; i < n; i++) order[i] = i;
    return order.subarray(0, n);
  }

  // 2. Quantise so the farthest splat lands in bucket 0 (drawn first).
  const scale = (DEPTH_BUCKETS - 1) / range;
  counts.fill(0);
  for (let i = 0; i < n; i++) {
    const q = Math.min(DEPTH_BUCKETS - 1, Math.max(0, ((maxD - fdepth[i]) * scale) | 0));
    depths[i] = q;
    counts[q]++;
  }

  // 3. Prefix sums -> bucket start offsets.
  let running = 0;
  for (let b = 0; b < DEPTH_BUCKETS; b++) {
    const c = counts[b];
    counts[b] = running;
    running += c;
  }

  // 4. Scatter (stable).
  for (let i = 0; i < n; i++) {
    order[counts[depths[i]]++] = i;
  }

  return order.subarray(0, n);
};

export interface SplatAttributeArrays {
  positions: Float32Array;
  colors: Float32Array;
  opacities: Float32Array;
  scales: Float32Array;
  rotations: Float32Array;
}

/** Writes source attributes into destination arrays in draw order. */
export const applySplatOrder = (
  order: ArrayLike<number>,
  src: SplatAttributeArrays,
  dst: SplatAttributeArrays
): void => {
  const n = order.length;
  const sp = src.positions, sc = src.colors, so = src.opacities, ss = src.scales, sr = src.rotations;
  const dp = dst.positions, dc = dst.colors, dop = dst.opacities, ds = dst.scales, dr = dst.rotations;
  for (let i = 0; i < n; i++) {
    const j = order[i];
    const i3 = i * 3, j3 = j * 3, i4 = i * 4, j4 = j * 4;
    dp[i3] = sp[j3]; dp[i3 + 1] = sp[j3 + 1]; dp[i3 + 2] = sp[j3 + 2];
    dc[i3] = sc[j3]; dc[i3 + 1] = sc[j3 + 1]; dc[i3 + 2] = sc[j3 + 2];
    dop[i] = so[j];
    ds[i3] = ss[j3]; ds[i3 + 1] = ss[j3 + 1]; ds[i3 + 2] = ss[j3 + 2];
    dr[i4] = sr[j4]; dr[i4 + 1] = sr[j4 + 1]; dr[i4 + 2] = sr[j4 + 2]; dr[i4 + 3] = sr[j4 + 3];
  }
};

/**
 * Whether the camera moved enough since the last sort to change ordering.
 * Avoids re-sorting millions of splats while the camera is still.
 */
export const cameraMovedSignificantly = (
  prevPos: [number, number, number] | null,
  prevDir: [number, number, number] | null,
  pos: [number, number, number],
  dir: [number, number, number],
  posEpsilon = 0.01,
  dirEpsilon = 0.0005
): boolean => {
  if (!prevPos || !prevDir) return true;
  const dp = Math.hypot(pos[0] - prevPos[0], pos[1] - prevPos[1], pos[2] - prevPos[2]);
  const dot = dir[0] * prevDir[0] + dir[1] * prevDir[1] + dir[2] * prevDir[2];
  return dp > posEpsilon || 1 - dot > dirEpsilon;
};
