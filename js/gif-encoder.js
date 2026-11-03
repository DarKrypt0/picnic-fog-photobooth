/**
 * Minimal animated GIF89a encoder (no dependencies, works offline).
 * - One shared 256-colour palette built with median-cut over all frames
 * - Light 4x4 ordered dithering to reduce banding on skin tones / gradients
 * - Standard variable-width LZW compression, loops forever
 *
 * encodeGif(frames, { delayMs }) -> Uint8Array
 *   frames: ImageData[] (all the same width/height)
 */

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 10);

function buildPalette(frames, maxColors = 256) {
  // Sample up to ~120k pixels across all frames.
  const total = frames.reduce((n, f) => n + f.width * f.height, 0);
  const step = Math.max(1, Math.floor(total / 120000));
  const samples = [];
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4 * step) samples.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }

  const boxes = [samples];
  const range = (box) => {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const c of box) {
      const r = c >> 16, g = (c >> 8) & 255, b = c & 255;
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    }
    const rr = rMax - rMin, gr = gMax - gMin, br = bMax - bMin;
    if (gr >= rr && gr >= br) return { ch: 8, size: gr };
    if (rr >= br) return { ch: 16, size: rr };
    return { ch: 0, size: br };
  };

  while (boxes.length < maxColors) {
    // Split the box with the widest colour range (weighted by population).
    let best = -1, bestScore = 0, bestCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const { ch, size } = range(boxes[i]);
      const score = size * Math.sqrt(boxes[i].length);
      if (score > bestScore) { bestScore = score; best = i; bestCh = ch; }
    }
    if (best < 0) break;
    const box = boxes[best];
    box.sort((a, b) => ((a >> bestCh) & 255) - ((b >> bestCh) & 255));
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }

  const palette = new Uint8Array(256 * 3);
  boxes.forEach((box, i) => {
    let r = 0, g = 0, b = 0;
    for (const c of box) { r += c >> 16; g += (c >> 8) & 255; b += c & 255; }
    const n = box.length || 1;
    palette[i * 3] = Math.round(r / n); palette[i * 3 + 1] = Math.round(g / n); palette[i * 3 + 2] = Math.round(b / n);
  });
  return { palette, count: Math.max(1, boxes.length) };
}

function makeMapper(palette, count) {
  const cache = new Int16Array(32768).fill(-1); // 5 bits per channel
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key];
    if (idx >= 0) return idx;
    let bestD = Infinity;
    for (let i = 0; i < count; i++) {
      const dr = palette[i * 3] - r, dg = palette[i * 3 + 1] - g, db = palette[i * 3 + 2] - b;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bestD) { bestD = d; idx = i; }
    }
    cache[key] = idx;
    return idx;
  };
}

function indexFrame(frame, map) {
  const { width: w, height: h, data: d } = frame;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4, t = BAYER4[((y & 3) << 2) | (x & 3)];
      const r = Math.max(0, Math.min(255, d[i] + t));
      const g = Math.max(0, Math.min(255, d[i + 1] + t));
      const b = Math.max(0, Math.min(255, d[i + 2] + t));
      out[p] = map(r, g, b);
    }
  }
  return out;
}

function lzw(indices, out, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize, eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1, nextCode = eoiCode + 1;
  let dict = new Map();
  const block = [];
  let cur = 0, curBits = 0;

  const flushBlock = () => {
    out.push(block.length, ...block);
    block.length = 0;
  };
  const emit = (code) => {
    cur |= code << curBits; curBits += codeSize;
    while (curBits >= 8) {
      block.push(cur & 255); cur >>>= 8; curBits -= 8;
      if (block.length === 255) flushBlock();
    }
  };

  out.push(minCodeSize);
  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = dict.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      dict = new Map(); nextCode = eoiCode + 1; codeSize = minCodeSize + 1;
    } else {
      if (nextCode >= (1 << codeSize)) codeSize++;
      dict.set(key, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (curBits > 0) { block.push(cur & 255); if (block.length === 255) flushBlock(); }
  if (block.length) flushBlock();
  out.push(0); // block terminator
}

export function encodeGif(frames, { delayMs = 800 } = {}) {
  if (!frames.length) throw new Error('No frames to encode');
  const w = frames[0].width, h = frames[0].height;
  const { palette, count } = buildPalette(frames);
  const map = makeMapper(palette, count);
  const delay = Math.max(2, Math.round(delayMs / 10));

  const out = [];
  const u16 = (v) => out.push(v & 255, (v >> 8) & 255);
  const str = (s) => { for (const ch of s) out.push(ch.charCodeAt(0)); };

  str('GIF89a');
  u16(w); u16(h);
  out.push(0xF7, 0, 0); // global colour table, 8 bits, 256 entries
  for (let i = 0; i < palette.length; i++) out.push(palette[i]);

  // Loop forever (NETSCAPE2.0 extension)
  out.push(0x21, 0xFF, 0x0B); str('NETSCAPE2.0'); out.push(0x03, 0x01, 0, 0, 0);

  for (const f of frames) {
    out.push(0x21, 0xF9, 0x04, 0x04); u16(delay); out.push(0, 0); // GCE: do-not-dispose
    out.push(0x2C); u16(0); u16(0); u16(w); u16(h); out.push(0);  // image descriptor
    lzw(indexFrame(f, map), out);
  }
  out.push(0x3B);
  return Uint8Array.from(out);
}
