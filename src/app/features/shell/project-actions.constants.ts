import type { ProjectWorkspace } from '../../core/models/project.model';
import {
  cardJsonExportAvailable,
  cardPngExportAvailable,
  type CardExportFailureReason,
} from '../../core/services/import-export.service';

/** File pickers: what the import / merge inputs accept. */
export const IMPORT_ACCEPT = '.json,.png,.stproj,application/json,image/png';
export const MERGE_ACCEPT = '.json,application/json';

/**
 * Approved card-failure copy (task 15 checkpoint 15-1, used verbatim): keyed
 * by the card boundary's refusal reasons plus the two shell preconditions of
 * the card exports. One table drives every card surface — import failure
 * snackbars, export failure snackbars, and the disabled menu rows' tooltips —
 * so the wording cannot drift between them.
 */
export const CARD_FAILURE_COPY: Record<CardExportFailureReason, string> = {
  'not-a-png': "This file isn't a valid PNG image.",
  'no-card-chunk': 'Not a character card — no embedded lorebook found in the PNG.',
  'no-iend-chunk': 'This PNG is truncated — no IEND chunk found.',
  'bad-chunk-crc': 'This PNG is corrupt (bad chunk checksum).',
  'bad-base64': "The embedded data isn't a valid character card JSON.",
  'card-json-invalid': "The embedded data isn't a valid character card JSON.",
  'not-a-card': "The embedded data isn't a valid character card JSON.",
  'card-without-book': 'This character card has no embedded lorebook to edit.',
  'compressed-card-chunk':
    "This card's data is zlib-compressed (zTXt) — LoreStitch reads standard text chunks.",
  'stale-card-chunk':
    "The card image's stored data no longer matches this project — re-import the card PNG.",
  'no-shell': 'Import a character card first',
  'no-image': 'No card image stored — import a card PNG first',
};

/**
 * One menu row's availability state (plan 15 §3.5): a card export row is
 * ready, or unavailable with the approved tooltip explaining why. Both menus
 * carrying the card section (topbar and mobile bottom bar) derive their rows
 * from this helper so the disabled state and its copy exist exactly once.
 */
export function cardExportRowState(
  project: ProjectWorkspace | null,
  wantsImage: boolean,
): { ready: boolean; tooltip: string } {
  const available = wantsImage ? cardPngExportAvailable(project) : cardJsonExportAvailable(project);
  if (available) {
    return { ready: true, tooltip: '' };
  }
  return {
    ready: false,
    tooltip:
      project?.cardShell === undefined
        ? CARD_FAILURE_COPY['no-shell']
        : CARD_FAILURE_COPY['no-image'],
  };
}
