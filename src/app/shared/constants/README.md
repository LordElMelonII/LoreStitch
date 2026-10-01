# shared/constants/

App-wide constants: `breakpoints.ts` (handset/tablet breakpoints), `github.ts` (repo links + icon), `brand-mark.ts` (the LoreStitch mark as an inline SVG literal registered with MatIconRegistry — same strategy as the GitHub icon), `search.ts` (200ms search debounce shared by the sidebar filter and the Search & Replace dialog). The touch-target policy (44px floor, 48px on phones) lives as CSS custom properties on `:root` in `src/styles.scss`.
