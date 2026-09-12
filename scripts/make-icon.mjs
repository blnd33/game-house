// Builds the Windows icon from the supplied logo. The logo file itself is never
// modified: this only scales it into the sizes Windows needs and wraps them in an
// .ico. Re-run after replacing the logo: node scripts/make-icon.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../apps/desktop/public/brand/gaming-house-logo.png', import.meta.url));
const output = fileURLToPath(new URL('../apps/desktop/public/brand/gaming-house.ico', import.meta.url));
const SIZES = [256, 64, 48, 32, 16];

/** Decodes an 8-bit RGB/RGBA non-interlaced PNG into {width, height, rgba}. */
function decodePng(buffer) {
  let position = 8;
  let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const data = [];
  while (position < buffer.length) {
    const length = buffer.readUInt32BE(position);
    const type = buffer.toString('ascii', position + 4, position + 8);
    const chunk = buffer.subarray(position + 8, position + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      bitDepth = chunk[8]; colorType = chunk[9]; interlace = chunk[12];
    }
    if (type === 'IDAT') data.push(chunk);
    position += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) throw new Error('unsupported PNG: use an 8-bit RGB or RGBA logo');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const to = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[to + x - channels] : 0;
      const b = y ? pixels[to - stride + x] : 0;
      const c = x >= channels && y ? pixels[to - stride + x - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[to + x] = (raw[from + x] + predictor) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * channels];
    rgba[i * 4 + 1] = pixels[i * channels + 1];
    rgba[i * 4 + 2] = pixels[i * channels + 2];
    rgba[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255;
  }
  return { width, height, rgba };
}

/** Box-filter downscale: averages the source pixels covered by each target pixel. */
function resize(image, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = image.width / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scale), x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      const y0 = Math.floor(y * scale), y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let sy = y0; sy < Math.min(y1, image.height); sy++) {
        for (let sx = x0; sx < Math.min(x1, image.width); sx++) {
          const i = (sy * image.width + sx) * 4;
          r += image.rgba[i]; g += image.rgba[i + 1]; b += image.rgba[i + 2]; a += image.rgba[i + 3];
          count++;
        }
      }
      const i = (y * size + x) * 4;
      out[i] = Math.round(r / count); out[i + 1] = Math.round(g / count);
      out[i + 2] = Math.round(b / count); out[i + 3] = Math.round(a / count);
    }
  }
  return { width: size, height: size, rgba: out };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
  return Buffer.concat([header, body, crc]);
}

function encodePng(image) {
  const stride = image.width * 4;
  const raw = Buffer.alloc(image.height * (stride + 1));
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0; // no per-row filtering
    image.rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; header[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const logo = decodePng(await readFile(source));
const images = SIZES.map(size => ({ size, png: encodePng(resize(logo, size)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + images.length * 16;
const entries = images.map(({ size, png }) => {
  const entry = Buffer.alloc(16);
  entry[0] = size === 256 ? 0 : size; // 0 means 256
  entry[1] = size === 256 ? 0 : size;
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
await writeFile(output, Buffer.concat([header, ...entries, ...images.map(i => i.png)]));
console.log(`Wrote ${output} (${SIZES.join(', ')} px) from the supplied logo.`);
