/**
 * Dev utility: converts the bundled Fate/Stay Night Fuyuki lorebook into a
 * `.stproj`-shaped workspace JSON so the app can be seeded quickly (drop the
 * output into IndexedDB or import it via the UI's "open archive" flow).
 *
 * Run: node --experimental-strip-types scripts/make-fuyuki-stproj.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stNativeToCharacterBook,
  type ProjectWorkspace,
} from '../src/app/core/models/lorebook.model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cardPath = resolve(here, '../example_card/Fate Stay Night - Fuyuki Lorebook(1).json');
const outPath = resolve(here, '../.tmp-fuyuki-workspace.json');

const card = JSON.parse(readFileSync(cardPath, 'utf8'));
const book = stNativeToCharacterBook(card, 'Fuyuki');
const now = Date.now();
const workspace: ProjectWorkspace = {
  id: 'fuyuki-fixture',
  title: 'Fuyuki Lorebook (fixture)',
  createdAt: now,
  updatedAt: now,
  targetType: 'standalone_lorebook',
  activeBook: book,
  headCommitId: null,
  commits: [],
};

writeFileSync(outPath, JSON.stringify(workspace));
console.log(`wrote ${outPath} with ${book.entries.length} entries`);
