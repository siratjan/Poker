/**
 * WP9 – PWA, Mobile-Polish, Fehlerzustände (Prüfung Gaby, Runde 1).
 *
 * Was hier geprüft wird und warum genau hier:
 *
 *  1. **Icons.** Siri hat den PNG-Encoder selbst geschrieben (`scripts/generate-icons.mjs`).
 *     Ein Dateiname und „size > 0“ (so weit geht `src/app/manifest.test.ts`) sagen nichts
 *     darüber, ob Chrome die Datei dekodieren kann. Dieser Test liest Signatur, IHDR,
 *     jede Chunk-CRC und die Pixel selbst — inklusive Safe-Zone des maskable-Icons.
 *  2. **Kontrast.** Die Ratios werden hier ein zweites Mal gerechnet, mit eigener
 *     Implementierung und zusätzlich aus den *tatsächlichen* Tailwind-v4-Tokens
 *     (oklch → sRGB). Siris Test rechnet gegen die v3-Hexwerte; der Browser rendert
 *     oklch. Beide Wege müssen AA bestehen, sonst ist die Zusage nur auf dem Papier wahr.
 *  3. **Verbindungslogik.** Rangfolge und die Zusage aus WP5 („Verbindung getrennt“ mit
 *     „Neu laden“) dürfen beim Umzug ins Shell-Banner nicht verloren gehen.
 *  4. **Struktur.** Lade-/Fehlerzustand je Route, kein Service Worker, kein Daten-Cache,
 *     kein Float bei Geld, keine neuen Laufzeit-Abhängigkeiten.
 *
 * Kein Produktivcode wird hier verändert (WORKFLOW, Regeln für Gaby).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';
import { isPublicPath, loginPathFor, safeNextPath } from '@/lib/auth/paths';
import { deriveConnection, type RealtimeStatus } from '@/lib/connection/state';
import { amountToneClasses } from '@/lib/ui/amountTone';

const ROOT = join(__dirname, '..', '..');
const read = (relativePath: string): string => readFileSync(join(ROOT, relativePath), 'utf8');

function walk(dir: string, hit: (file: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      found.push(...walk(full, hit));
    } else if (hit(full)) {
      found.push(full);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 1. PNG-Icons: Container und Pixel wirklich lesen
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type PngHeader = {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace: number;
};

type Png = {
  header: PngHeader;
  chunkTypes: string[];
  badCrc: string[];
  /** RGBA, row-major, no filtering (the encoder writes filter type 0 only). */
  pixels: Buffer;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePng(file: string): Png {
  const buffer = readFileSync(file);
  expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE), `${file}: keine PNG-Signatur`).toBe(true);

  let offset = 8;
  const chunkTypes: string[] = [];
  const badCrc: string[] = [];
  const idat: Buffer[] = [];
  let header: PngHeader | null = null;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const stored = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== stored) badCrc.push(type);

    chunkTypes.push(type);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }

  if (header === null) throw new Error(`${file}: kein IHDR`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * 4;
  const pixels = Buffer.alloc(stride * header.height);
  let p = 0;
  for (let y = 0; y < header.height; y += 1) {
    expect(raw[p], `${file}: unerwarteter Filter in Zeile ${y}`).toBe(0);
    p += 1;
    raw.copy(pixels, y * stride, p, p + stride);
    p += stride;
  }

  return { header, chunkTypes, badCrc, pixels };
}

function pixelAt(png: Png, x: number, y: number): [number, number, number, number] {
  const index = (y * png.header.width + x) * 4;
  return [png.pixels[index], png.pixels[index + 1], png.pixels[index + 2], png.pixels[index + 3]];
}

const ICONS = [
  { file: 'public/icons/icon-192.png', size: 192, fullBleed: false },
  { file: 'public/icons/icon-512.png', size: 512, fullBleed: false },
  { file: 'public/icons/icon-maskable-512.png', size: 512, fullBleed: true },
  { file: 'public/icons/apple-touch-icon.png', size: 180, fullBleed: true },
] as const;

describe('WP9 · PWA-Icons sind echte, dekodierbare PNGs', () => {
  it.each(ICONS.map((icon) => [basename(icon.file), icon] as const))(
    '%s: Signatur, IHDR, Chunk-CRCs',
    (_name, icon) => {
      const png = parsePng(join(ROOT, icon.file));

      expect(png.header.width).toBe(icon.size);
      expect(png.header.height).toBe(icon.size);
      expect(png.header.depth).toBe(8);
      expect(png.header.colorType).toBe(6); // RGBA
      expect(png.header.interlace).toBe(0);
      expect(png.badCrc).toEqual([]);
      expect(png.chunkTypes[0]).toBe('IHDR');
      expect(png.chunkTypes.at(-1)).toBe('IEND');
      expect(png.chunkTypes).toContain('IDAT');
    },
  );

  it('maskable: randlos und das Motiv liegt komplett in der 80-%-Safe-Zone', () => {
    const png = parsePng(join(ROOT, 'public/icons/icon-maskable-512.png'));
    const { width, height } = png.header;
    const plate: [number, number, number] = [4, 120, 87]; // emerald-700

    // Alle vier Ecken deckend: Android beschneidet das Icon beliebig.
    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ]) {
      expect(pixelAt(png, x, y)[3], `Ecke ${x}/${y} ist nicht deckend`).toBe(255);
    }

    // Außerhalb des Safe-Zone-Kreises (Radius 40 % der Kante) darf nur die
    // Plattenfarbe stehen — sonst schneidet eine runde Maske Motiv weg.
    let outside = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (Math.hypot(x - width / 2, y - height / 2) <= width * 0.4) continue;
        const [r, g, b, a] = pixelAt(png, x, y);
        if (a !== 255) outside += 1;
        else if (
          Math.abs(r - plate[0]) > 6 ||
          Math.abs(g - plate[1]) > 6 ||
          Math.abs(b - plate[2]) > 6
        ) {
          outside += 1;
        }
      }
    }
    expect(outside, 'Motivpixel außerhalb der Safe-Zone').toBe(0);
  });

  it('apple-touch-icon ist vollflächig deckend (iOS ignoriert Alpha)', () => {
    const png = parsePng(join(ROOT, 'public/icons/apple-touch-icon.png'));
    let transparent = 0;
    for (let y = 0; y < png.header.height; y += 3) {
      for (let x = 0; x < png.header.width; x += 3) {
        if (pixelAt(png, x, y)[3] !== 255) transparent += 1;
      }
    }
    expect(transparent).toBe(0);
  });

  it('die Größenangabe im Manifest stimmt mit den echten Pixeln überein', () => {
    for (const icon of manifest().icons ?? []) {
      const png = parsePng(join(ROOT, 'public', icon.src ?? ''));
      expect(`${png.header.width}x${png.header.height}`).toBe(icon.sizes);
    }
  });

  it('das Icon-Skript ist reproduzierbar und braucht keine Bildbibliothek', () => {
    const script = read('scripts/generate-icons.mjs');
    expect(script).not.toMatch(/from '(sharp|jimp|canvas|pngjs)'/);
    expect(script).toMatch(/node:zlib/);
    const pkg: { dependencies: Record<string, string>; devDependencies: Record<string, string> } =
      JSON.parse(read('package.json'));
    for (const name of ['sharp', 'jimp', 'canvas', 'pngjs', 'workbox-window', 'next-pwa']) {
      expect(pkg.dependencies[name]).toBeUndefined();
      expect(pkg.devDependencies[name]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Manifest
// ---------------------------------------------------------------------------

describe('WP9 · Manifest', () => {
  const value = manifest();

  it('führt die Pflichtfelder einer installierbaren App', () => {
    expect(value.name).toBe('Poker-Kasse');
    expect(value.short_name).toBe('Poker-Kasse');
    expect(value.display).toBe('standalone');
    expect(value.start_url).toBe('/');
    expect(value.scope).toBe('/');
    expect(value.lang).toBe('de');
    expect(value.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(value.background_color).toMatch(/^#[0-9a-f]{6}$/);
    expect((value.icons ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('liefert 192, 512 und ein maskable-Icon, alle als PNG', () => {
    const icons = value.icons ?? [];
    expect(icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(icons.filter((icon) => icon.purpose === 'maskable')).toHaveLength(1);
    expect(icons.filter((icon) => icon.purpose === 'any').length).toBeGreaterThanOrEqual(2);
    for (const icon of icons) expect(icon.type).toBe('image/png');
  });

  it('start_url überlebt den Login-Redirect ohne Schleife', () => {
    const start = value.start_url ?? '';
    // Ohne Session schickt der Proxy `/` auf `/login` — ohne `next`, also ohne
    // die Möglichkeit einer Schleife; nach Google landet man wieder auf `/`.
    expect(loginPathFor(start)).toBe('/login');
    expect(safeNextPath(start)).toBe('/');
    // start_url selbst ist nicht öffentlich (sonst zeigte die App Daten ohne Login).
    expect(isPublicPath(start)).toBe(false);
    // scope deckt start_url ab, sonst öffnet die App im Browser-Tab.
    expect(start.startsWith(value.scope ?? '/')).toBe(true);
  });

  it('Manifest und Icons kommen ohne Session durch den Proxy', () => {
    const matcher = proxyMatcher();
    expect(isPublicPath('/manifest.webmanifest')).toBe(true);
    expect(matcher.test('/manifest.webmanifest')).toBe(false);
    for (const icon of value.icons ?? []) {
      expect(isPublicPath(icon.src ?? ''), `${icon.src} ist nicht öffentlich`).toBe(true);
      expect(matcher.test(icon.src ?? ''), `${icon.src} läuft durch den Proxy`).toBe(false);
    }
    expect(isPublicPath('/icons/apple-touch-icon.png')).toBe(true);
  });

  it('verspricht keinen Service Worker', () => {
    expect(JSON.stringify(value)).not.toMatch(/serviceworker/i);
  });
});

/** Der Matcher steht als String-Literal in src/proxy.ts (Next liest ihn statisch). */
function proxyMatcher(): RegExp {
  const source = read(join('src', 'proxy.ts'));
  const match = source.match(/matcher:\s*\[\s*(?:\/\*[\s\S]*?\*\/\s*)?'([^']+)'/);
  if (match === null) throw new Error('kein Matcher-Literal in src/proxy.ts');
  return new RegExp(`^${match[1].replace(/\\\\/g, '\\')}$`);
}

describe('WP9 · Proxy-Matcher (Gaby WP2-F1)', () => {
  const matcher = proxyMatcher();

  it.each(['/_next/webpack-hmr', '/_next/turbopack-hmr', '/_next/static/chunks/main.js', '/_next/'])(
    '%s läuft nicht mehr durch den Proxy',
    (path) => {
      expect(matcher.test(path)).toBe(false);
    },
  );

  it.each(['/', '/login', '/sessions/abc', '/admin', '/players', '/log'])(
    '%s wird weiterhin geprüft',
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Kontrast – zweite, unabhängige Rechnung
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

const toLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  const [high, low] = first >= second ? [first, second] : [second, first];
  return (high + 0.05) / (low + 0.05);
}

const fromHex = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

/** oklch → sRGB (Björn Ottosson). Tailwind v4 liefert die Palette in oklch. */
function fromOklch(lightness: number, chroma: number, hueDegrees: number): Rgb {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linear: number): number => {
    const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  };
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Alpha-Compositing, wie der Browser `opacity` und getönte Hintergründe rechnet. */
const over = (foreground: Rgb, background: Rgb, alpha: number): Rgb => [
  foreground[0] * alpha + background[0] * (1 - alpha),
  foreground[1] * alpha + background[1] * (1 - alpha),
  foreground[2] * alpha + background[2] * (1 - alpha),
];

const AA = 4.5;
const LIGHT = fromHex('#ffffff');
const DARK = fromHex('#0a0a0a');
const INK = fromHex('#171717');
const PAPER = fromHex('#ededed');

describe('WP9 · Kontrast der Betragsfarben (WCAG 2.1 AA, eigene Rechnung)', () => {
  it('die Formel selbst stimmt', () => {
    expect(contrast(fromHex('#000000'), LIGHT)).toBeCloseTo(21, 5);
    expect(contrast(LIGHT, LIGHT)).toBeCloseTo(1, 5);
    // Referenzwert aus der WCAG-Doku: #767676 auf Weiß ist die AA-Grenze.
    expect(contrast(fromHex('#767676'), LIGHT)).toBeGreaterThanOrEqual(AA);
  });

  it.each([
    ['plus hell (v3-Hex #047857)', fromHex('#047857'), LIGHT],
    ['plus dunkel (v3-Hex #34d399)', fromHex('#34d399'), DARK],
    ['minus hell (v3-Hex #b91c1c)', fromHex('#b91c1c'), LIGHT],
    ['minus dunkel (v3-Hex #f87171)', fromHex('#f87171'), DARK],
    // Was der Browser tatsächlich malt: Tailwind v4 gibt die Palette in oklch aus.
    ['plus hell (v4 oklch emerald-700)', fromOklch(0.508, 0.118, 165.612), LIGHT],
    ['plus dunkel (v4 oklch emerald-400)', fromOklch(0.765, 0.177, 163.223), DARK],
    ['minus hell (v4 oklch red-700)', fromOklch(0.505, 0.213, 27.518), LIGHT],
    ['minus dunkel (v4 oklch red-400)', fromOklch(0.704, 0.191, 22.216), DARK],
  ] as const)('%s erreicht 4,5:1', (_label, colour, background) => {
    expect(contrast(colour, background)).toBeGreaterThanOrEqual(AA);
  });

  it('emerald-600 hell hätte AA verfehlt – in beiden Farbräumen', () => {
    expect(contrast(fromHex('#059669'), LIGHT)).toBeLessThan(AA);
    expect(contrast(fromOklch(0.596, 0.145, 163.225), LIGHT)).toBeLessThan(AA);
  });

  it('die abgeschwächten Texte (opacity) bleiben AA, opacity-50 wäre es nicht', () => {
    expect(contrast(over(INK, LIGHT, 0.5), LIGHT)).toBeLessThan(AA); // der alte Wert
    expect(contrast(over(INK, LIGHT, 0.6), LIGHT)).toBeGreaterThanOrEqual(AA);
    expect(contrast(over(INK, LIGHT, 0.7), LIGHT)).toBeGreaterThanOrEqual(AA);
    expect(contrast(over(PAPER, DARK, 0.6), DARK)).toBeGreaterThanOrEqual(AA);
    expect(contrast(over(PAPER, DARK, 0.7), DARK)).toBeGreaterThanOrEqual(AA);
  });

  it('auch auf der getönten Karte (bg-black/5, bg-white/10) reicht es', () => {
    const cardLight = over(fromHex('#000000'), LIGHT, 0.05);
    const cardDark = over(fromHex('#ffffff'), DARK, 0.1);
    expect(contrast(over(INK, cardLight, 0.7), cardLight)).toBeGreaterThanOrEqual(AA);
    expect(contrast(over(INK, cardLight, 0.8), cardLight)).toBeGreaterThanOrEqual(AA);
    expect(contrast(over(PAPER, cardDark, 0.7), cardDark)).toBeGreaterThanOrEqual(AA);
    expect(contrast(fromOklch(0.505, 0.213, 27.518), cardLight)).toBeGreaterThanOrEqual(AA);
  });

  it('das Verbindungs-Banner ist in beiden Schemata lesbar', () => {
    const red600 = fromOklch(0.577, 0.245, 27.325);
    const red500 = fromOklch(0.637, 0.237, 25.331);
    const amber500 = fromOklch(0.769, 0.188, 70.08);
    const offlineLight = over(red600, LIGHT, 0.12);
    const offlineDark = over(red500, DARK, 0.15);
    const staleLight = over(amber500, LIGHT, 0.15);
    const staleDark = over(amber500, DARK, 0.15);

    expect(contrast(fromOklch(0.444, 0.177, 26.899), offlineLight)).toBeGreaterThanOrEqual(AA);
    expect(contrast(fromOklch(0.885, 0.062, 18.334), offlineDark)).toBeGreaterThanOrEqual(AA);
    expect(contrast(fromOklch(0.414, 0.112, 45.904), staleLight)).toBeGreaterThanOrEqual(AA);
    expect(contrast(fromOklch(0.962, 0.059, 95.617), staleDark)).toBeGreaterThanOrEqual(AA);
  });

  it('keine Komponente wählt die Betragsfarbe noch selbst', () => {
    // Sonst schleicht sich emerald-600 an der geprüften Stelle vorbei zurück.
    for (const file of ['NetAmount.tsx', 'ParticipantCard.tsx']) {
      const source = read(join('src', 'components', file.includes('Net') ? 'players' : 'sessions', file));
      expect(source).toContain('amountToneClasses');
      expect(source).not.toContain('text-emerald-600');
      expect(source).not.toContain('text-red-600');
    }
    expect(amountToneClasses(1)).toBe('text-emerald-700 dark:text-emerald-400');
    expect(amountToneClasses(-1)).toBe('text-red-700 dark:text-red-400');
    expect(amountToneClasses(0)).toBe('opacity-70');
  });
});

// ---------------------------------------------------------------------------
// 4. Verbindungszustand
// ---------------------------------------------------------------------------

const REALTIME: readonly (RealtimeStatus | null)[] = ['connecting', 'live', 'disconnected', null];

describe('WP9 · deriveConnection', () => {
  it('offline schlägt jeden Realtime-Status und blockiert das Schreiben', () => {
    for (const realtime of REALTIME) {
      const state = deriveConnection({ online: false, realtime });
      expect(state.writesBlocked).toBe(true);
      expect(state.banner?.tone).toBe('offline');
      expect(state.banner?.title).toBe('Keine Verbindung');
      // Ein „Neu laden“ ohne Netz führt nur auf die Fehlerseite des Browsers.
      expect(state.banner?.canReload).toBe(false);
    }
  });

  it('hält die WP5-Zusage: toter Kanal → „Verbindung getrennt“ mit „Neu laden“', () => {
    const state = deriveConnection({ online: true, realtime: 'disconnected' });
    expect(state.banner?.title).toBe('Verbindung getrennt');
    expect(state.banner?.canReload).toBe(true);
    // Server Actions gehen über HTTP: Schreiben bleibt möglich.
    expect(state.writesBlocked).toBe(false);
  });

  it('zeigt online ohne Problem gar kein Banner', () => {
    for (const realtime of ['connecting', 'live', null] as const) {
      expect(deriveConnection({ online: true, realtime }).banner).toBeNull();
      expect(deriveConnection({ online: true, realtime }).writesBlocked).toBe(false);
    }
  });

  it('blockiert nie stumm: geblockte Schreibrechte haben immer ein Banner', () => {
    for (const online of [true, false]) {
      for (const realtime of REALTIME) {
        const state = deriveConnection({ online, realtime });
        if (state.writesBlocked) expect(state.banner).not.toBeNull();
      }
    }
  });

  it('die 10-Sekunden-Regel aus WP5 steht weiterhin im Hook', () => {
    const hook = read(join('src', 'components', 'sessions', 'useSessionRealtime.ts'));
    expect(hook).toMatch(/DISCONNECT_HINT_MS\s*=\s*10_000/);
    expect(hook).toMatch(/removeChannel/);
    const client = read(join('src', 'components', 'sessions', 'SessionDetailClient.tsx'));
    expect(client).toContain('useReportRealtimeStatus');
  });

  it('der Realtime-Status wird beim Verlassen der Seite zurückgesetzt (kein Geister-Banner)', () => {
    const provider = read(join('src', 'components', 'app', 'ConnectionProvider.tsx'));
    expect(provider).toMatch(/return\s*\(\)\s*=>\s*setRealtimeStatus\(null\)/);
    expect(provider).toMatch(/removeEventListener\('online'/);
    expect(provider).toMatch(/removeEventListener\('offline'/);
  });
});

// ---------------------------------------------------------------------------
// 5. Offline-Sperren in der UI
// ---------------------------------------------------------------------------

/** Client-Komponenten mit Schreibaktion, die offline gesperrt sein müssen. */
const GUARDED_WRITE_COMPONENTS = [
  'src/components/sessions/EntrySheets.tsx',
  'src/components/sessions/CloseSessionPanel.tsx',
  'src/components/sessions/ClosedSessionSection.tsx',
  'src/components/players/PlayersManager.tsx',
  'src/components/admin/WhitelistManager.tsx',
  'src/components/admin/UserRoleList.tsx',
  'src/components/admin/QuickAmountsEditor.tsx',
];

describe('WP9 · Schreibaktionen offline', () => {
  it.each(GUARDED_WRITE_COMPONENTS)('%s fragt useWritesBlocked ab', (file) => {
    const source = read(file);
    expect(source).toContain('useWritesBlocked');
    // Nicht nur `disabled`: der Guard muss auch in der Submit-Funktion stehen,
    // sonst reicht ein Enter im Formular an der grauen Schaltfläche vorbei.
    expect(source).toMatch(/if \([^)]*offline[^)]*\) return;/);
  });

  it('„Abbrechen“ und das ✕ bleiben offline bedienbar', () => {
    const sheet = read('src/components/ui/Sheet.tsx');
    expect(sheet).not.toContain('useWritesBlocked');
    const entries = read('src/components/sessions/EntrySheets.tsx');
    // Die Abbrechen-Schaltflächen tragen kein `disabled`.
    for (const match of entries.matchAll(/<Button[^>]*variant="secondary"[\s\S]{0,200}?<\/Button>/g)) {
      if (!match[0].includes('Abbrechen')) continue;
      expect(match[0]).not.toContain('disabled');
    }
  });

  it('es gibt keinen Offline-Cache und keinen Service Worker', () => {
    const files = [
      ...walk(join(ROOT, 'src'), (f) => /\.(ts|tsx|css)$/.test(f)),
      ...walk(join(ROOT, 'public'), () => true),
      ...walk(join(ROOT, 'scripts'), (f) => /\.(ts|mjs|js)$/.test(f)),
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const relativePath = relative(ROOT, file).split(sep).join('/');
      // `manifest.ts` erklärt in einem Kommentar, warum es keinen gibt.
      if (relativePath === 'src/app/manifest.ts') continue;
      expect(source, `${relativePath} registriert einen Service Worker`).not.toMatch(
        /navigator\.serviceWorker|serviceWorker\.register|workbox/,
      );
      expect(source, `${relativePath} benutzt die Cache-API`).not.toMatch(
        /\bcaches\.(open|match|keys|delete)\b/,
      );
    }
    expect(existsSync(join(ROOT, 'public', 'sw.js'))).toBe(false);
    expect(existsSync(join(ROOT, 'public', 'service-worker.js'))).toBe(false);
  });
});

/**
 * Finding F1 dieses Berichts, als Test festgehalten: „Session anlegen“ ist die
 * einzige Schreibaktion der App ohne Offline-Sperre. Wird dieser Test rot, ist
 * F1 behoben — dann gehört `NewSessionForm.tsx` in `GUARDED_WRITE_COMPONENTS`
 * und dieser Block wird gelöscht (Runde 2).
 */
describe('WP9 · F1 (offen) – NewSessionForm ohne Offline-Sperre', () => {
  it('dokumentiert den aktuellen Stand', () => {
    const source = read('src/components/sessions/NewSessionForm.tsx');
    expect(source).toContain('createSession');
    expect(source).not.toContain('useWritesBlocked');
    expect(source).not.toContain('OfflineNote');
  });
});

/**
 * Finding F3 dieses Berichts: bricht das Netz *während* einer Schreibaktion ab
 * (`navigator.onLine` merkt das oft erst später), wirft der Server-Action-Aufruf
 * im Browser. Keine der aufrufenden Stellen fängt das ab: `setPending(false)`
 * hinter dem `await` wird nie erreicht, der Knopf bleibt für immer auf
 * „Speichert …“, und der Nutzer sieht keine Meldung. Wird dieser Test rot, ist
 * F3 behoben — dann gehört die Erwartung umgedreht (Runde 2).
 */
describe('WP9 · F3 (offen) – Schreibaktionen fangen keinen Netzwerkfehler', () => {
  it.each([
    'src/components/sessions/SessionDetailClient.tsx',
    'src/components/sessions/NewSessionForm.tsx',
    'src/components/players/PlayersManager.tsx',
    'src/components/admin/WhitelistManager.tsx',
  ])('%s: kein try/catch um den Action-Aufruf', (file) => {
    const source = read(file);
    expect(source).toMatch(/await \w+\(/);
    expect(source).not.toMatch(/\btry\s*\{/);
  });
});

// ---------------------------------------------------------------------------
// 6. Lade- und Fehlerzustände je Route
// ---------------------------------------------------------------------------

function routeSegments(): string[] {
  return walk(join(ROOT, 'src', 'app'), (file) => basename(file) === 'page.tsx').map(dirname);
}

/** Sucht eine Datei im Segment oder in einem übergeordneten Segment. */
function findUpwards(from: string, name: string): string | null {
  const stop = join(ROOT, 'src', 'app');
  let current = from;
  for (;;) {
    const candidate = join(current, name);
    if (existsSync(candidate)) return candidate;
    if (current === stop) return null;
    current = dirname(current);
  }
}

describe('WP9 · Lade- und Fehlerzustände', () => {
  const segments = routeSegments();

  it('findet alle acht Routen', () => {
    expect(segments.length).toBe(8);
  });

  it.each(routeSegments().map((s) => relative(ROOT, s).split(sep).join('/')))(
    '%s hat einen Ladezustand',
    (segment) => {
      expect(existsSync(join(ROOT, segment, 'loading.tsx'))).toBe(true);
    },
  );

  it.each(routeSegments().map((s) => relative(ROOT, s).split(sep).join('/')))(
    '%s liegt unter einer Fehlergrenze',
    (segment) => {
      expect(findUpwards(join(ROOT, segment), 'error.tsx')).not.toBeNull();
    },
  );

  it('jede error.tsx bietet „Erneut versuchen“ und zeigt die Rohmeldung nicht', () => {
    const errorFiles = walk(join(ROOT, 'src', 'app'), (f) => basename(f) === 'error.tsx');
    expect(errorFiles.length).toBeGreaterThanOrEqual(3);
    const state = read('src/components/ui/ErrorState.tsx');
    expect(state).toContain('Erneut versuchen');
    expect(state).toContain('reset');
    // Die Meldung des Servers landet in der Konsole, nicht auf dem Bildschirm.
    expect(state).not.toMatch(/\{\s*error\.message\s*\}/);
    for (const file of errorFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source.startsWith("'use client'")).toBe(true);
      expect(source).toContain('reset');
      expect(source).not.toMatch(/\{\s*error\.message\s*\}/);
    }
  });

  it('global-error steht für sich allein und ist deutsch', () => {
    const source = read('src/app/global-error.tsx');
    expect(source.startsWith("'use client'")).toBe(true);
    expect(source).toContain('lang="de"');
    expect(source).toContain('Erneut versuchen');
    // Es darf nichts importieren, was selbst kaputt sein könnte.
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['react']);
  });

  it('die 404-Seite ist deutsch und führt zurück in die App', () => {
    const source = read('src/app/not-found.tsx');
    expect(source).toContain('Diese Seite gibt es nicht.');
    expect(source).toMatch(/href="\/"/);
  });

  it('die Skeletons sind für Screenreader stumm, der Bereich meldet sich einmal', () => {
    const source = read('src/components/ui/Skeleton.tsx');
    expect(source).toContain('aria-hidden');
    expect(source).toContain('aria-busy');
    expect(source).toContain('sr-only');
    for (const file of walk(join(ROOT, 'src', 'app'), (f) => basename(f) === 'loading.tsx')) {
      // Entweder über `SkeletonScreen` oder – wie login/loading.tsx – direkt:
      // einmal `aria-busy` plus ein Satz für den Screenreader.
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} meldet den Ladezustand nicht`).toMatch(
        /SkeletonScreen|aria-busy="true"/,
      );
      expect(source, `${file} ohne Text für den Screenreader`).toMatch(/SkeletonScreen|sr-only/);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Sheets: Beschriftung und Fokus
// ---------------------------------------------------------------------------

describe('WP9 · Sheets (Screenreader-Basis)', () => {
  const sheet = read('src/components/ui/Sheet.tsx');

  it('ist ein modaler Dialog mit Namen', () => {
    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain('aria-modal="true"');
    // aria-label statt aria-labelledby ist gleichwertig: der Name kommt aus `title`.
    expect(sheet).toMatch(/aria-label=\{title\}/);
    expect(sheet).toMatch(/<h2[^>]*>\{title\}<\/h2>/);
  });

  it('nimmt den Fokus beim Öffnen und schließt mit Escape', () => {
    expect(sheet).toMatch(/panel\.current\?\.focus\(\)/);
    expect(sheet).toMatch(/event\.key === 'Escape'/);
    expect(sheet).toContain('tabIndex={-1}');
    // Aufräumen: Listener und Scroll-Sperre gehen beim Schließen wieder weg.
    expect(sheet).toMatch(/removeEventListener\('keydown'/);
    expect(sheet).toMatch(/document\.body\.style\.overflow = previousOverflow/);
  });

  it('das ✕ ist ein 44-px-Ziel und heißt „Schließen“', () => {
    expect(sheet).toContain('aria-label="Schließen"');
    expect(sheet).toMatch(/size-11/);
  });
});

/**
 * Finding F2 dieses Berichts: das Sheet gibt den Fokus beim Schließen nicht an
 * das auslösende Element zurück und hält ihn nicht fest (kein Focus-Trap),
 * obwohl `aria-modal="true"` das behauptet. Wird dieser Test rot, ist F2
 * behoben — dann gehören die Erwartungen in den Block darüber (Runde 2).
 */
describe('WP9 · F2 (offen) – Sheet ohne Fokus-Rückgabe und ohne Trap', () => {
  it('dokumentiert den aktuellen Stand', () => {
    const sheet = read('src/components/ui/Sheet.tsx');
    // Kein gemerktes Vorher-Element, kein Zurückgeben des Fokus im Cleanup.
    expect(sheet).not.toMatch(/previous(ly)?Focus|restoreFocus|returnFocus/i);
    // Kein Focus-Trap: weder Tab-Behandlung noch `inert` für den Hintergrund.
    expect(sheet).not.toMatch(/key === 'Tab'/);
    expect(sheet).not.toMatch(/\binert(=|\s*\})/);
  });
});

// ---------------------------------------------------------------------------
// 8. Geld, Abhängigkeiten, Lighthouse-Artefakte
// ---------------------------------------------------------------------------

describe('WP9 · Geld und Abhängigkeiten', () => {
  it('das Paket bringt keine neue Laufzeit-Abhängigkeit mit', () => {
    const pkg: { dependencies: Record<string, string>; scripts: Record<string, string> } = JSON.parse(
      read('package.json'),
    );
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@supabase/ssr',
      '@supabase/supabase-js',
      'clsx',
      'next',
      'react',
      'react-dom',
      'zod',
    ]);
    expect(pkg.scripts['icons:generate']).toBe('node scripts/generate-icons.mjs');
  });

  it('in den neuen WP9-Dateien rechnet nichts mit Fließkomma an Geld', () => {
    const newFiles = [
      'src/lib/connection/state.ts',
      'src/lib/ui/amountTone.ts',
      'src/components/app/ConnectionBanner.tsx',
      'src/components/app/ConnectionProvider.tsx',
      'src/components/app/OfflineNote.tsx',
      'src/components/ui/ErrorState.tsx',
      'src/components/ui/Skeleton.tsx',
      'src/app/manifest.ts',
    ];
    for (const file of newFiles) {
      const source = read(file);
      expect(source, `${file}`).not.toMatch(/parseFloat|toFixed\(|\/ 100\b/);
      expect(source, `${file} enthält any`).not.toMatch(/:\s*any\b|\bas any\b/);
    }
  });
});

describe('WP9 · Lighthouse-Artefakte', () => {
  const reports = ['qa/reports/WP9-lighthouse.json', 'qa/reports/WP9-lighthouse-pwa.json'];

  it.each(reports)('%s ist ein echter Lauf gegen die eigene App', (file) => {
    const report: {
      requestedUrl: string;
      finalDisplayedUrl?: string;
      fetchTime: string;
      lighthouseVersion: string;
      configSettings: { formFactor: string };
      categories: Record<string, { score: number | null }>;
    } = JSON.parse(read(file));

    expect(report.requestedUrl).toMatch(/^http:\/\/localhost:\d+\//);
    expect(report.configSettings.formFactor).toBe('mobile');
    expect(Number.isNaN(Date.parse(report.fetchTime))).toBe(false);
    expect(report.lighthouseVersion).toMatch(/^\d+\./);
    for (const [name, category] of Object.entries(report.categories)) {
      expect(category.score, `${name} unter 0,9`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('in den Artefakten steht kein Token und kein Projektschlüssel', () => {
    for (const file of [...reports, 'qa/reports/WP9-lighthouse.html']) {
      const source = read(file);
      expect(source, `${file}`).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT
      expect(source).not.toMatch(/sb_secret|service_role|SUPABASE_SERVICE/i);
    }
  });
});
