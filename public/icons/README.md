# public/icons/

PWA/home-screen icon assets referenced by `manifest.webmanifest`.

Everything here regenerates from the single source mark `icon.svg` via
`npm run icons:generate` (sharp + png-to-ico; see `scripts/generate-icons.mjs`):

- `icon-<n>x<n>.png` (72–512) — any-purpose set, mark full-bleed
  (`purpose: any` in the manifest)
- `icon-maskable-<n>x<n>.png` (192/512) — mark at 60% on an opaque white
  tile (`purpose: maskable`); launchers crop to the central 80% circle and
  the mark's frame corners fall outside it at any larger scale
- `apple-touch-icon.png` (180) — same padded treatment for the iOS home
  screen (linked from `src/index.html`; iOS composites transparent icons on
  black, so the tile stays opaque)

Filenames are stable across regenerations on purpose — the ARD catalog's
`logoUrl` points at `icon-512x512.png` (see `public/.well-known/ard.json`)
and the manifest URLs never move; the bytes change under the same URLs.
Caveat: Cloudflare Pages serves `/icons/*` cache-immutable for a year (see
`public/_headers`), so returning visitors may keep the previous set until
their cache expires.
