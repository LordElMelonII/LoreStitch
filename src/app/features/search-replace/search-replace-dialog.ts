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
import { SEARCH_DEBOUNCE_MS } from '../../shared/constants/search';
import { debouncedSignal } from '../../shared/util/debounced-signal';
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

  /**
   * The form values the preview consumes: both text fields debounced by
   * `SEARCH_DEBOUNCE_MS`, so the O(book) scan runs at most once per settle
   * window instead of per keystroke. The match/scope/field toggles below
   * stay immediate (discrete taps), and `apply()` flushes both mirrors
   * before reading rows, so a fast type→Replace never writes against a
   * stale preview.
   */
  protected readonly queryDebounced = debouncedSignal(this.query, SEARCH_DEBOUNCE_MS);
  private readonly replacementDebounced = debouncedSignal(this.replacement, SEARCH_DEBOUNCE_MS);

  protected readonly matchCase = signal(false);
  protected readonly wholeWord = signal(false);
  protected readonly regexMode = signal(false);
  protected readonly scopeActive = signal(false);
  protected readonly inContent = signal(true);
  protected readonly inKeys = signal(true);
  protected readonly inNames = signal(false);
  /** Entry ids excluded from the replace run. */
  protected readonly excluded = signal<Set<number>>(new Set());

  /** The active regex, or null while the settled pattern is invalid/empty. */
  protected readonly pattern = computed<RegExp | null>(() =>
    this.compileForQuery(this.queryDebounced()),
  );

  protected readonly patternError = computed(() => {
    const query = this.query();
    if (!query || !this.regexMode()) {
      return null;
    }
    // Validity is checked against the IMMEDIATE query — a fresh compile of
    // one pattern, no book scan — so a broken regex flags, and a fix clears,
    // without waiting for the debounce. (Wrapping a pattern in \b(?:…)\b
    // cannot change its validity, so this always agrees with the settled
    // `pattern` above.)
    return this.compileForQuery(query) === null ? 'Invalid regular expression' : null;
  });

  /**
   * One construction site for the compile options, shared by the settled
   * scan (`pattern`) and the immediate validity check (`patternError`) so
   * the two can never drift apart.
   */
  private compileForQuery(query: string): RegExp | null {
    return compileSearchPattern({
      query,
      regexMode: this.regexMode(),
      wholeWord: this.wholeWord(),
      matchCase: this.matchCase(),
    });
  }

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
    const replacement = this.replacementDebounced();
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
    // A fast type→Replace must never apply against a stale preview: pull the
    // form's current values through the debounce before reading rows.
    this.queryDebounced.flush();
    this.replacementDebounced.flush();
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
