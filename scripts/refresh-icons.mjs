import fs from 'node:fs';
import path from 'node:path';

// Known dynamic icons that are bound programmatically in templates or models
// rather than appearing as literal string tags like <mat-icon>name</mat-icon>.
const DYNAMIC_ICONS = [
  'expand_more', // entry-options-accordion toggleIcon
  'expand_less', // entry-options-accordion toggleIcon
  'undo', // batch-operations-dialog removal chip
  'help', // confirm-dialog non-danger state
];

function scanDirectory(dir) {
  const icons = new Set();
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      for (const icon of scanDirectory(fullPath)) {
        icons.add(icon);
      }
    } else if (/\.(html|ts)$/.test(file.name) && !file.name.endsWith('.spec.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');

      // Match <mat-icon ...>icon_name</mat-icon>
      const matIconRegex = /<mat-icon\b[^>]*>([\s\S]*?)<\/mat-icon>/g;
      let match;
      while ((match = matIconRegex.exec(content)) !== null) {
        const inner = match[1].trim();
        if (inner && !inner.includes('{{') && !inner.includes('<')) {
          icons.add(inner);
        }
      }

      // Match fontIcon="..."
      const fontIconRegex = /fontIcon=["']([^"']+)["']/g;
      while ((match = fontIconRegex.exec(content)) !== null) {
        icons.add(match[1].trim());
      }
    }
  }

  return icons;
}

async function refreshIcons() {
  const icons = scanDirectory('src');
  for (const dyn of DYNAMIC_ICONS) {
    icons.add(dyn);
  }

  const sortedIcons = Array.from(icons).sort();
  console.log(`Found ${sortedIcons.length} icons to subset:`);
  console.log(sortedIcons.join(', '));

  const iconNamesParam = sortedIcons.join(',');
  const cssUrl = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=${iconNamesParam}&display=block`;

  console.log('\nFetching Google Fonts CSS...');
  const cssResp = await fetch(cssUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
  });

  if (!cssResp.ok) {
    throw new Error(`Failed to fetch CSS: ${cssResp.status} ${cssResp.statusText}`);
  }

  const css = await cssResp.text();
  const fontUrlMatch = css.match(/src:\s*url\((https:\/\/[^)]+)\)/);
  if (!fontUrlMatch) {
    throw new Error('Could not parse woff2 font URL from Google Fonts CSS response');
  }

  const woff2Url = fontUrlMatch[1];
  console.log(`Downloading font from: ${woff2Url}`);

  const fontResp = await fetch(woff2Url);
  if (!fontResp.ok) {
    throw new Error(`Failed to download font: ${fontResp.status} ${fontResp.statusText}`);
  }

  const buffer = Buffer.from(await fontResp.arrayBuffer());
  const targetPath = path.resolve('public/fonts/material-symbols-outlined.woff2');
  fs.writeFileSync(targetPath, buffer);

  console.log(`\nSuccessfully updated ${targetPath} (${buffer.byteLength} bytes)`);
}

refreshIcons().catch((err) => {
  console.error(err);
  process.exit(1);
});
