// Pure JS ISO/IEC 18004 QR Code SVG Generator (Versions 1-6, Byte mode, ECC Level L)

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Uint8Array(data.length + ecCount);
  res.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// Version specs for ECC Level L
const VERSION_SPECS = [
  null,
  { v: 1, size: 21, dataBytes: 19, ecPerBlock: 7, blocks: 1, align: [] },
  { v: 2, size: 25, dataBytes: 34, ecPerBlock: 10, blocks: 1, align: [6, 18] },
  { v: 3, size: 29, dataBytes: 55, ecPerBlock: 15, blocks: 1, align: [6, 22] },
  { v: 4, size: 33, dataBytes: 80, ecPerBlock: 20, blocks: 1, align: [6, 26] },
  { v: 5, size: 37, dataBytes: 108, ecPerBlock: 26, blocks: 1, align: [6, 30] },
  { v: 6, size: 41, dataBytes: 136, ecPerBlock: 18, blocks: 2, align: [6, 34] }
];

// Format info 15-bit integers for ECC Level L (01) and masks 0..7
function computeFormatBits(mask) {
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

export function encodeQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  const spec = VERSION_SPECS.find((s) => s && bytes.length + 2 <= s.dataBytes);
  if (!spec) throw new Error('Text too long for QR V1-V6');

  // Build bit stream: Byte mode (0100), 8-bit length, payload, terminator, pad bytes
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = spec.dataBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | bits[i + j];
    dataBytes.push(val);
  }
  const padCycle = [0xec, 0x11];
  let pi = 0;
  while (dataBytes.length < spec.dataBytes) {
    dataBytes.push(padCycle[pi % 2]);
    pi++;
  }

  // Split into blocks & compute Reed-Solomon EC
  const blockLen = spec.dataBytes / spec.blocks;
  const dataBlocks = [];
  const ecBlocks = [];
  for (let b = 0; b < spec.blocks; b++) {
    const slice = new Uint8Array(dataBytes.slice(b * blockLen, (b + 1) * blockLen));
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, spec.ecPerBlock));
  }

  const finalBytes = [];
  for (let i = 0; i < blockLen; i++) {
    for (let b = 0; b < spec.blocks; b++) finalBytes.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) finalBytes.push(ecBlocks[b][i]);
  }

  const finalBits = [];
  for (const b of finalBytes) {
    for (let i = 7; i >= 0; i--) finalBits.push((b >> i) & 1);
  }

  const n = spec.size;
  const mat = Array.from({ length: n }, () => new Int8Array(n).fill(-1));
  const reserved = Array.from({ length: n }, () => new Uint8Array(n));

  const setFixed = (r, c, val) => {
    if (r >= 0 && r < n && c >= 0 && c < n) {
      mat[r][c] = val ? 1 : 0;
      reserved[r][c] = 1;
    }
  };

  // Finder patterns + separators
  const drawFinder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        const on =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setFixed(rr, cc, on ? 1 : 0);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, n - 7);
  drawFinder(n - 7, 0);

  // Alignment patterns
  for (const r of spec.align) {
    for (const c of spec.align) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const on = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setFixed(r + dr, c + dc, on ? 1 : 0);
        }
      }
    }
  }

  // Timing patterns & dark module
  for (let i = 8; i < n - 8; i++) {
    setFixed(6, i, i % 2 === 0 ? 1 : 0);
    setFixed(i, 6, i % 2 === 0 ? 1 : 0);
  }
  setFixed(n - 8, 8, 1);

  // Reserve format info cells
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      reserved[8][i] = 1;
      reserved[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][n - 1 - i] = 1;
    if (i < 7) reserved[n - 1 - i][8] = 1;
  }

  // Place data bits (zig-zag upward/downward)
  let bitIdx = 0;
  let up = true;
  for (let col = n - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!reserved[r][c]) {
          mat[r][c] = bitIdx < finalBits.length ? finalBits[bitIdx++] : 0;
        }
      }
    }
    up = !up;
  }

  // Choose mask 0..7 with lowest penalty
  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  let bestMat = null;
  let bestScore = Infinity;

  for (let m = 0; m < 8; m++) {
    const candidate = mat.map((row) => Int8Array.from(row));
    const fn = maskFns[m];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!reserved[r][c] && fn(r, c)) {
          candidate[r][c] ^= 1;
        }
      }
    }

    const fmt = computeFormatBits(m);
    for (let i = 0; i <= 5; i++) {
      const bit = (fmt >> (14 - i)) & 1;
      candidate[8][i] = bit;
      candidate[n - 1 - i][8] = bit;
    }
    candidate[8][7] = (fmt >> 8) & 1;
    candidate[8][8] = (fmt >> 7) & 1;
    candidate[7][8] = (fmt >> 6) & 1;
    for (let i = 0; i < 8; i++) {
      const bit = (fmt >> i) & 1;
      candidate[8][n - 1 - i] = bit;
      if (i < 6) candidate[i][8] = (fmt >> i) & 1;
    }

    // Simple penalty score
    let score = 0;
    for (let r = 0; r < n; r++) {
      let run = 1;
      for (let c = 1; c < n; c++) {
        if (candidate[r][c] === candidate[r][c - 1]) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let c = 0; c < n; c++) {
      let run = 1;
      for (let r = 1; r < n; r++) {
        if (candidate[r][c] === candidate[r - 1][c]) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    if (score < bestScore) {
      bestScore = score;
      bestMat = candidate;
    }
  }

  return bestMat;
}

export function renderQrSvg(text, sizePx = 196) {
  try {
    const mat = encodeQrMatrix(text);
    const n = mat.length;
    const quiet = 2;
    const total = n + quiet * 2;
    let paths = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (mat[r][c] === 1) {
          paths += `M${c + quiet},${r + quiet}h1v1h-1z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">
      <rect width="${total}" height="${total}" fill="#ffffff"/>
      <path d="${paths}" fill="#090910"/>
    </svg>`;
  } catch {
    return `<div style="padding:16px;color:#111;font-size:12px;">URL ready: ${text}</div>`;
  }
}
