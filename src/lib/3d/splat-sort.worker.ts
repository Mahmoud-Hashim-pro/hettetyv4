/**
 * Off-main-thread depth sort for large Gaussian splat scenes.
 * Receives positions once, then camera poses; replies with a draw order.
 */
import { computeSplatSortOrder, createSplatSortBuffers, SplatSortBuffers } from './splat-sort';

interface InitMessage {
  type: 'init';
  positions: Float32Array;
  count: number;
}

interface SortMessage {
  type: 'sort';
  requestId: number;
  camPos: [number, number, number];
  camDir: [number, number, number];
}

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<InitMessage | SortMessage>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

let positions: Float32Array | null = null;
let count = 0;
let buffers: SplatSortBuffers | null = null;

ctx.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    positions = msg.positions;
    count = msg.count;
    buffers = createSplatSortBuffers(count);
    return;
  }
  if (msg.type === 'sort' && positions && buffers) {
    const order = computeSplatSortOrder(positions, count, msg.camPos, msg.camDir, buffers);
    // Copy so the scratch buffer can be reused for the next request.
    const out = new Uint32Array(order);
    ctx.postMessage({ type: 'sorted', requestId: msg.requestId, order: out }, [out.buffer]);
  }
};
