import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry, estimateTokens } from '../../../core/models/lorebook.model';
import { DelimiterDialog } from '../../delimiters/delimiter-dialog';
import { delimiterLabel, detectDelimiter } from '../../../core/models/delimiters';
import { EntryUpdatesService } from '../entry-updates.service';

/**
 * Content editor of the entry: the lore text area with character / token /
 * line stats and the delimiter picker. A section of `EntryFields`.
 */
@Component({
  selector: 'app-entry-content-field',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule],
  templateUrl: './entry-content-field.html',
  styleUrl: './entry-content-field.scss',
})
export class EntryContentField {
  private readonly dialog = inject(MatDialog);
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryFields`). */
  readonly entry = input.required<CharacterBookEntry>();

  /** Badge label for the delimiter recognized in the content, if any. */
  protected readonly delimiterBadge = computed<string | null>(() => {
    const detected = detectDelimiter(this.entry().content ?? '');
    return detected.style === 'none' ? null : delimiterLabel(detected);
  });

  protected readonly delimiterTooltip = computed(() => {
    const detected = detectDelimiter(this.entry().content ?? '');
    if (detected.style === 'none') {
      return 'Wrap content in <tag>, [name=…] or --- delimiters';
    }
    const label = delimiterLabel(detected);
    return `Content is wrapped in ${label} — click to change or remove`;
  });

  protected readonly contentStats = computed(() => {
    const content = this.entry().content ?? '';
    return {
      chars: content.length,
      tokens: estimateTokens(content),
      lines: content ? content.split('\n').length : 0,
    };
  });

  protected openDelimiterDialog(): void {
    this.dialog.open(DelimiterDialog, {
      maxWidth: 'min(96vw, 860px)',
      data: { activeEntryId: this.entry().id },
    });
  }
}
