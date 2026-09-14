import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry, entryTitle } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import {
  compileSearchPattern,
  type FieldHits,
  type MatchRow,
  type SearchReplaceDialogData,
} from './search-replace.model';
import { DiffViewer } from '../../shared/components/diff-viewer/diff-viewer';

/** Form model of the search & replace dialog's text fields. */
interface SearchReplaceFormModel {
  query: string;
  replacement: string;
}

/** Global search & replace across entries with a safe batch preview. */
@Component({
  selector: 'app-search-replace-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    DiffViewer,
  ],
  templateUrl: './search-replace-dialog.html',
  styleUrl: './search-replace-dialog.scss',
})
export class SearchReplaceDialog {
  private readonly dialogRef = inject(MatDialogRef<SearchReplaceDialog, boolean>);
  protected readonly data = inject<SearchReplaceDialogData>(MAT_DIALOG_DATA);
  protected readonly workspace = inject(WorkspaceService);
  private readonly snackBar = inject(MatSnackBar);

  private readonly model = signal<SearchReplaceFormModel>({ query: '', replacement: '' });

  protected readonly replaceForm = form(this.model);

  protected readonly query = computed(() => this.model().query);
  protected readonly replacement = computed(() => this.model().replacement);

  protected readonly matchCase = signal(false);
  protected readonly wholeWord = signal(false);
  protected readonly regexMode = signal(false);
  protected readonly scopeActive = signal(false);
  protected readonly inContent = signal(true);
  protected readonly inKeys = signal(true);
  protected readonly inNames = signal(false);
  /** Entry ids excluded from the replace run. */
  protected readonly excluded = signal<Set<number>>(new Set());

  /** The active regex, or null while the pattern is invalid/empty. */
  protected readonly pattern = computed<RegExp | null>(() =>
    compileSearchPattern({
      query: this.query(),
      regexMode: this.regexMode(),
      wholeWord: this.wholeWord(),
      matchCase: this.matchCase(),
    }),
  );

  protected readonly patternError = computed(() => {
    if (!this.query()) {
      return null;
    }
    if (this.regexMode() && this.pattern() === null) {
      return 'Invalid regular expression';
    }
    return null;
  });

  protected readonly rows = computed<MatchRow[]>(() => {
    const regex = this.pattern();
    const scope = this.scopeActive();
    const activeId = this.data.activeEntryId;
    if (!regex) {
      return [];
    }
    return this.workspace
      .entries()
      .filter((entry) => !scope || entry.id === activeId)
      .flatMap((entry) => this.matchEntry(entry, regex));
  });

  protected readonly totalHits = computed(() =>
    this.rows().reduce((sum, row) => sum + row.total, 0),
  );

  protected readonly selectedRows = computed(
    () => this.rows().filter((row) => !this.excluded().has(row.entryId) && row.changed).length,
  );

  /** Preview row of an entry, or empty. */
  private matchEntry(entry: CharacterBookEntry, regex: RegExp): MatchRow[] {
    const replacement = this.replacement();
    // In literal (non-regex) mode the replacement must not be interpreted:
    // passing it as a function keeps `$&`, `$1` etc. verbatim.
    const apply = (text: string): string =>
      this.regexMode()
        ? text.replace(regex, replacement)
        : text.replace(regex, () => replacement);
    const hits: FieldHits = { content: 0, keys: 0, names: 0 };

    const contentHits = entry.content.match(regex)?.length ?? 0;
    const keyList = entry.keys ?? [];
    const secondary = entry.secondary_keys ?? [];
    const keyHits = keyList
      .concat(secondary)
      .reduce((n, k) => n + (k.match(regex)?.length ?? 0), 0);
    const nameHits = (entry.comment ?? '').match(regex)?.length ?? 0;

    if (this.inContent()) {
      hits.content = contentHits;
    }
    if (this.inKeys()) {
      hits.keys = keyHits;
    }
    if (this.inNames()) {
      hits.names = nameHits;
    }

    const total = hits.content + hits.keys + hits.names;
    if (!total) {
      return [];
    }

    const nextContent = hits.content ? apply(entry.content) : null;
    const nextKeys = hits.keys ? keyList.map(apply) : null;
    const nextSecondaryKeys = hits.keys ? secondary.map(apply) : null;
    const nextName = hits.names ? apply(entry.comment ?? '') : null;

    return [
      {
        entryId: entry.id ?? -1,
        title: entryTitle(entry),
        hits,
        total,
        nextContent,
        nextKeys,
        nextSecondaryKeys,
        nextName,
        changed: true,
      },
    ];
  }

  protected toggleExcluded(entryId: number, checked: boolean): void {
    this.excluded.update((set) => {
      const next = new Set(set);
      if (checked) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  protected isExcluded(entryId: number): boolean {
    return this.excluded().has(entryId);
  }

  protected async apply(): Promise<void> {
    const excluded = this.excluded();
    const targets = this.rows().filter((row) => row.changed && !excluded.has(row.entryId));
    let occurrences = 0;
    for (const row of targets) {
      const entry = this.workspace.entries().find((e) => e.id === row.entryId);
      if (!entry) {
        continue;
      }
      const patch: Partial<CharacterBookEntry> = {};
      if (row.nextContent !== null) {
        patch.content = row.nextContent;
        occurrences += row.hits.content;
      }
      if (row.nextKeys !== null) {
        patch.keys = row.nextKeys;
        patch.secondary_keys = row.nextSecondaryKeys ?? undefined;
        occurrences += row.hits.keys;
      }
      if (row.nextName !== null) {
        patch.comment = row.nextName;
        occurrences += row.hits.names;
      }
      this.workspace.updateEntry(row.entryId, patch);
    }

    this.snackBar.open(
      `Replaced ${occurrences} occurrence${occurrences === 1 ? '' : 's'} across ${targets.length} entr${targets.length === 1 ? 'y' : 'ies'}`,
      'OK',
      { duration: 4000 },
    );
    this.dialogRef.close(targets.length > 0);
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
