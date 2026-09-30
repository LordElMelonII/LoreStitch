// Regenerates every shipped LoreStitch icon from the single source mark at
// public/icons/icon.svg (`npm run icons:generate`). Outputs, all committed
// together with any source change:
//
//   public/favicon.ico                    16/32/48 ICO layers (tab icon)
//   public/icons/icon-<n>x<n>.png         any-purpose PWA set (manifest
//                                         `purpose: any`), mark full-bleed
//   public/icons/icon-maskable-<n>.png    maskable set: mark at 60% on an
//                                         opaque white tile — launchers crop
//                                         to the central 80% circle and the
//                                         mark's frame corners sit outside it
//                                         at any larger scale
//   public/icons/apple-touch-icon.png     180x180, same padded treatment
//                                         (iOS rounds corners itself and
//                                         composites transparent PNGs on
//                                         black, so the tile stays opaque)
//
// Filenames are stable across regenerations — the ARD catalog's logoUrl
// points at icon-512x512.png (see public/.well-known/ard.json) and the
// manifest URLs never move; the bytes change under them.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const SRC = path.resolve('public/icons/icon.svg');
const OUT_DIR = path.resolve('public/icons');
const FAVICON = path.resolve('public/favicon.ico');

// Backdrop for the padded sets. Opaque white, not the brand amber: a colored
// tile fights arbitrary launcher themes and the thin-stroked mark needs the
// quietest possible ground at 48px.
const TILE_BG = '#ffffff';
// Largest scale whose full-frame corners stay inside the maskable safe zone
// (central circle, diameter 80% of the canvas): the mark's extreme corner
// sits at radius ~0.66 of the half-diagonal, so s * 338 <= 204.8 at 512.
const PADDED_SCALE = 0.6;

const ANY_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const MASKABLE_SIZES = [192, 512];
const APPLE_TOUCH_SIZE = 180;
const ICO_SIZES = [16, 32, 48];

/** Rasterize the vector mark at an exact edge length. */
async function renderMark(size) {
  // Density scaling (72dpi is the SVG's intrinsic 512px) rasterizes the
  // vectors straight at the target size — downsampling a big render would
  // blur the thin strokes on the 16px favicon layer.
  const density = (72 * size) / 512;
  return sharp(SRC, { density }).resize(size, size).png().toBuffer();
}

/** The mark centered at `scale` on an opaque tile of `size`. */
async function renderPadded(size, scale) {
  const inner = Math.round(size * scale);
  const mark = await sharp(SRC, { density: (72 * inner) / 512 })
    .resize(inner, inner)
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: TILE_BG },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function write(file, buffer) {
  await writeFile(file, buffer);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

for (const size of ANY_SIZES) {
  await write(path.join(OUT_DIR, `icon-${size}x${size}.png`), await renderMark(size));
}

for (const size of MASKABLE_SIZES) {
  await write(path.join(OUT_DIR, `icon-maskable-${size}x${size}.png`), await renderPadded(size, PADDED_SCALE));
}

await write(path.join(OUT_DIR, 'apple-touch-icon.png'), await renderPadded(APPLE_TOUCH_SIZE, PADDED_SCALE));

await write(FAVICON, await pngToIco(await Promise.all(ICO_SIZES.map(renderMark))));
