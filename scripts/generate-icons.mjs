/**
 * Generates the PWA icons of Poker-Kasse from the chip motif in
 * `public/icons/icon.svg` — without any image library and without a hand-made
 * binary file in the repository (WP9, step 1).
 *
 * Run: `npm run icons:generate`
 *
 * Why a rasteriser of our own instead of `sharp`: the motif is three circles
 * and eight notches. Rendering it from a distance function costs ~80 lines and
 * saves a 30 MB native dependency that would have to build on every machine and
 * on Vercel. The PNG container is written by hand as well: signature, IHDR,
 * IDAT (zlib from node:zlib), IEND — all of it is in the standard library.
 *
 * Output (regenerate after every change of the motif, the files are committed):
 *   public/icons/icon-192.png            192x192, purpose "any", round plate
 *   public/icons/icon-512.png            512x512, purpose "any", round plate
 *   public/icons/icon-maskable-512.png   512x512, full-bleed square, motif in the 80 % safe zone
 *   public/icons/apple-touch-icon.png    180x180, full-bleed square (iOS ignores alpha)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'icons');

/** Brand colours, identical to the ones the manifest reports. */
const GREEN = [4, 120, 87]; // emerald-700 #047857, the plate of the chip
const CREAM = [255, 255, 255]; // the ring, the notches and the inner disc
const INK = [4, 78, 56]; // #044e38, the pip inside the disc

/**
 * The motif as fractions of the edge length, so every size looks the same.
 * `scale` shrinks the whole chip for the maskable variant (80 % safe zone).
 */
function chip(scale) {
  return {
    plateRadius: 0.5, // full bleed: the plate is the background
    ringOuter: 0.38 * scale,
    ringInner: 0.3 * scale,
    discRadius: 0.19 * scale,
    pipRadius: 0.085 * scale,
    notchCount: 8,
    /** Half width of a notch, in radians. */
    notchHalfAngle: 0.2,
  };
}

/**
 * Colour of one point of the motif, or `null` for transparent.
 * `x`/`y` are relative to the centre, in fractions of the edge length.
 */
function sample(x, y, geometry) {
  const distance = Math.hypot(x, y);
  const { ringOuter, ringInner, discRadius, pipRadius, notchCount, notchHalfAngle } = geometry;

  if (distance > geometry.plateRadius) return null;
  if (distance <= pipRadius) return INK;
  if (distance <= discRadius) return CREAM;

  if (distance >= ringInner && distance <= ringOuter) {
    // The ring is cream except in the eight notches, where the plate shows
    // through — that is what makes it read as a poker chip and not as a target.
    const angle = Math.atan2(y, x);
    const step = (2 * Math.PI) / notchCount;
    const offset = Math.abs(((angle % step) + step + step / 2) % step) - step / 2;
    return Math.abs(offset) <= notchHalfAngle ? GREEN : CREAM;
  }

  return GREEN;
}

/**
 * Renders the motif into an RGBA buffer. Antialiasing by 4x4 supersampling:
 * every pixel averages sixteen samples, which is enough for circles at 192 px
 * and costs nothing at build time.
 */
function render(size, { scale = 1, square = false } = {}) {
  const geometry = chip(scale);
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size - 0.5;
          const y = (py + (sy + 0.5) / samples) / size - 0.5;
          const colour = sample(x, y, geometry);
          if (colour === null) {
            // Outside the round plate: transparent for the "any" icons, the
            // plate colour for the square ones (maskable / iOS).
            if (square) {
              r += GREEN[0];
              g += GREEN[1];
              b += GREEN[2];
              a += 255;
            }
            continue;
          }
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }

      const total = samples * samples;
      const alpha = a / total;
      const index = (py * size + px) * 4;
      // Straight (non-premultiplied) alpha: average the colour over the
      // covering samples only, otherwise the edge fades towards black.
      const covered = alpha === 0 ? 1 : a / 255;
      pixels[index] = Math.round(r / covered);
      pixels[index + 1] = Math.round(g / covered);
      pixels[index + 2] = Math.round(b / covered);
      pixels[index + 3] = Math.round(alpha);
    }
  }

  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** RGBA8 PNG, one IDAT, filter type 0 on every scanline. */
function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The same motif as SVG, kept next to the PNGs as the readable source. */
function svgSource() {
  const g = chip(1);
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const notches = Array.from({ length: g.notchCount }, (_, i) => {
    const angle = (360 / g.notchCount) * i;
    const width = ((g.notchHalfAngle * 2 * 180) / Math.PI / 360) * 2 * Math.PI * g.ringOuter * 512;
    return `    <rect x="${(256 - width / 2).toFixed(1)}" y="${((0.5 - g.ringOuter) * 512).toFixed(1)}" width="${width.toFixed(1)}" height="${((g.ringOuter - g.ringInner) * 512).toFixed(1)}" fill="${rgb(GREEN)}" transform="rotate(${angle} 256 256)" />`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Poker-Kasse</title>
  <rect width="512" height="512" fill="${rgb(GREEN)}" />
  <circle cx="256" cy="256" r="${(g.ringOuter * 512).toFixed(1)}" fill="${rgb(CREAM)}" />
  <circle cx="256" cy="256" r="${(g.ringInner * 512).toFixed(1)}" fill="${rgb(GREEN)}" />
${notches}
  <circle cx="256" cy="256" r="${(g.discRadius * 512).toFixed(1)}" fill="${rgb(CREAM)}" />
  <circle cx="256" cy="256" r="${(g.pipRadius * 512).toFixed(1)}" fill="${rgb(INK)}" />
</svg>
`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, options: {} },
  { file: 'icon-512.png', size: 512, options: {} },
  { file: 'icon-maskable-512.png', size: 512, options: { scale: 0.8, square: true } },
  { file: 'apple-touch-icon.png', size: 180, options: { scale: 0.9, square: true } },
];

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'icon.svg'), svgSource());

for (const { file, size, options } of TARGETS) {
  const png = encodePng(size, render(size, options));
  writeFileSync(join(OUT_DIR, file), png);
  const digest = createHash('sha256').update(png).digest('hex').slice(0, 12);
  console.log(`${file.padEnd(24)} ${String(png.length).padStart(7)} bytes  sha256:${digest}`);
}
