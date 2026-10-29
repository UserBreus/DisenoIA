// TIFF CMYK 8 bits, 300 ppp, compresión PackBits. Conversión RGB→CMYK básica (sin perfil ICC).

function packBitsRow(src: Uint8Array, start: number, len: number, out: Uint8Array, pos: number): number {
  let i = start;
  const end = start + len;
  while (i < end) {
    let run = 1;
    while (i + run < end && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 3) {
      out[pos++] = 257 - run; // -(run-1) como byte
      out[pos++] = src[i];
      i += run;
      continue;
    }
    let lit = 0;
    const litStart = i;
    while (i < end && lit < 128) {
      if (i + 2 < end && src[i] === src[i + 1] && src[i] === src[i + 2]) break;
      i++;
      lit++;
    }
    out[pos++] = lit - 1;
    out.set(src.subarray(litStart, litStart + lit), pos);
    pos += lit;
  }
  return pos;
}

export function rgbaToCmyk(d: ImageData): Uint8Array {
  const p = d.data;
  const out = new Uint8Array(d.width * d.height * 4);
  for (let i = 0; i < p.length; i += 4) {
    // Compone sobre blanco (el sustrato).
    const a = p[i + 3] / 255;
    const r = (p[i] * a + 255 * (1 - a)) / 255;
    const g = (p[i + 1] * a + 255 * (1 - a)) / 255;
    const b = (p[i + 2] * a + 255 * (1 - a)) / 255;
    const k = 1 - Math.max(r, g, b);
    const inv = k < 1 ? 1 / (1 - k) : 0;
    out[i] = Math.round((1 - r - k) * inv * 255);
    out[i + 1] = Math.round((1 - g - k) * inv * 255);
    out[i + 2] = Math.round((1 - b - k) * inv * 255);
    out[i + 3] = Math.round(k * 255);
  }
  return out;
}

export function encodeCmykTiff(d: ImageData, dpi = 300): Blob {
  const { width: w, height: h } = d;
  const cmyk = rgbaToCmyk(d);
  const rowBytes = w * 4;
  const rowsPerStrip = Math.max(1, Math.floor(65536 / rowBytes)) || 1;
  const strips = Math.ceil(h / rowsPerStrip);
  const worst = rowBytes + Math.ceil(rowBytes / 128) + 1;

  const stripData: Uint8Array[] = [];
  for (let s = 0; s < strips; s++) {
    const rows = Math.min(rowsPerStrip, h - s * rowsPerStrip);
    const buf = new Uint8Array(worst * rows);
    let pos = 0;
    for (let r = 0; r < rows; r++) pos = packBitsRow(cmyk, (s * rowsPerStrip + r) * rowBytes, rowBytes, buf, pos);
    stripData.push(buf.subarray(0, pos));
  }

  const dataLen = stripData.reduce((a, b) => a + b.length, 0);
  let off = 8 + dataLen;
  off += off & 1;
  const xresOff = off;
  const yresOff = xresOff + 8;
  const bpsOff = yresOff + 8;
  const stripOffOff = bpsOff + 8;
  const stripCntOff = stripOffOff + strips * 4;
  const ifdOff = stripCntOff + strips * 4;
  const tags = 14;
  const total = ifdOff + 2 + tags * 12 + 4;

  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  v.setUint16(0, 0x4949, true); // "II"
  v.setUint16(2, 42, true);
  v.setUint32(4, ifdOff, true);

  let pos = 8;
  const offsets: number[] = [];
  for (const s of stripData) {
    offsets.push(pos);
    u8.set(s, pos);
    pos += s.length;
  }
  v.setUint32(xresOff, dpi, true);
  v.setUint32(xresOff + 4, 1, true);
  v.setUint32(yresOff, dpi, true);
  v.setUint32(yresOff + 4, 1, true);
  for (let i = 0; i < 4; i++) v.setUint16(bpsOff + i * 2, 8, true);
  offsets.forEach((o, i) => v.setUint32(stripOffOff + i * 4, o, true));
  stripData.forEach((s, i) => v.setUint32(stripCntOff + i * 4, s.length, true));

  let e = ifdOff;
  v.setUint16(e, tags, true);
  e += 2;
  const entry = (tag: number, type: 3 | 4 | 5, count: number, value: number) => {
    v.setUint16(e, tag, true);
    v.setUint16(e + 2, type, true);
    v.setUint32(e + 4, count, true);
    if (type === 3 && count === 1) v.setUint16(e + 8, value, true);
    else v.setUint32(e + 8, value, true);
    e += 12;
  };
  entry(256, 4, 1, w); // ImageWidth
  entry(257, 4, 1, h); // ImageLength
  entry(258, 3, 4, bpsOff); // BitsPerSample
  entry(259, 3, 1, 32773); // Compression PackBits
  entry(262, 3, 1, 5); // Photometric: Separated (CMYK)
  entry(273, 4, strips, strips === 1 ? offsets[0] : stripOffOff); // StripOffsets
  entry(277, 3, 1, 4); // SamplesPerPixel
  entry(278, 4, 1, rowsPerStrip); // RowsPerStrip
  entry(279, 4, strips, strips === 1 ? stripData[0].length : stripCntOff); // StripByteCounts
  entry(282, 5, 1, xresOff); // XResolution
  entry(283, 5, 1, yresOff); // YResolution
  entry(284, 3, 1, 1); // PlanarConfiguration
  entry(296, 3, 1, 2); // ResolutionUnit: pulgadas
  entry(332, 3, 1, 1); // InkSet: CMYK
  v.setUint32(e, 0, true);

  return new Blob([buf], { type: "image/tiff" });
}
