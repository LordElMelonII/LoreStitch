import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry } from '../../../core/models/lorebook.model';
import { estimateTokens } from '../../../core/services/token-estimator';
import {
  delimiterLabel,
  detectDelimiter,
  detectMalformedWrapper,
  entryDelimiterName,
  entryDelimiterNameFromKey,
  malformedWrapperLabel,
  type MalformedWrapper,
} from '../../../core/models/delimiters';
import { entrySliceSignal } from '../entry-edit-form';

/** Form model of the content editor. */
interface EntryContentModel {
  content: string;
}

/**
 * Content editor of the entry: the lore text area with character / token /
 * line stats and the delimiter picker. The text area is a Signal Form over
 * the workspace entry (see `entrySliceSignal`). A section of `EntryFields`.
 */
@Component({
  selector: 'app-entry-content-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-content-field.html',
  styleUrl: './entry-content-field.scss',
})
export class EntryContentField {
  private readonly dialog = inject(MatDialog);

  /** The entry being edited (owned by the enclosing `EntryFields`). */
  readonly entry = input.required<CharacterBookEntry>();

  private readonly model = entrySliceSignal<EntryContentModel>({
    source: this.entry,
    fallback: { content: '' },
    pick: (entry) => ({ content: entry.content ?? '' }),
    toPatch: (_entry, model) => ({ content: model.content }),
  });

  protected readonly contentForm = form(this.model);

  /** Badge label for the delimiter recognized in the content, if any. */
  protected readonly delimiterBadge = computed<string | null>(() => {
    const detected = detectDelimiter(this.entry().content ?? '');
    return detected.style === 'none' ? null : delimiterLabel(detected);
  });

  /**
   * The classified malformed whole-content wrapper, or null. Orphan
   * openers/closers are hint-gated by the entry's own names (comment, then
   * first key), so a lone `<div>` in prose stays unclassified; mismatched
   * pairs need no hints.
   */
  protected readonly malformedWrapper = computed<MalformedWrapper | null>(() => {
    const content = this.entry().content ?? '';
    // Well-formed wrappers belong to the recognized badge above.
    if (detectDelimiter(content).style !== 'none') {
      return null;
    }
    const entry = this.entry();
    return detectMalformedWrapper(content, [
      entryDelimiterName(entry),
      entryDelimiterNameFromKey(entry),
    ]);
  });

  /** Badge label for a classified malformed shell (`<test> ? </universe>`). */
  protected readonly malformedBadge = computed<string | null>(() => {
    const malformed = this.malformedWrapper();
    return malformed === null ? null : malformedWrapperLabel(malformed);
  });

  protected readonly delimiterTooltip = computed(() => {
    if (this.malformedWrapper() !== null) {
      return 'Content has mismatched or unclosed delimiters — click to fix';
    }
    const detected = detectDelimiter(this.entry().content ?? '');
    if (detected.style === 'none') {
      return 'Wrap content in <tag>, [name=…] or --- delimiters';
    }
    const label = delimiterLabel(detected);
    return `Content is wrapped in ${label} — click to change or remove`;
  });

  protected readonly contentStats = computed(() => {
    const content = this.contentForm.content().value() ?? '';
    return {
      chars: content.length,
      tokens: estimateTokens(content),
      lines: content ? content.split('\n').length : 0,
    };
  });

  protected async openDelimiterDialog(): Promise<void> {
    // Lazy-loaded: keeps the delimiter picker out of the initial bundle.
    const { DelimiterDialog } = await import('../../delimiters/delimiter-dialog');
    this.dialog.open(DelimiterDialog, {
      maxWidth: 'min(96vw, 860px)',
      // MD3 adaptive behavior: the dialog goes full-screen on compact screens
      // (see the global .app-compact-fullscreen-dialog rules).
      panelClass: 'app-compact-fullscreen-dialog',
      data: { activeEntryId: this.entry().id },
    });
  }
}
