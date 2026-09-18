import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, disabled, form } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  DELIMITER_STYLE_OPTIONS,
  DelimiterStyle,
  delimiterLabel,
  detectDelimiter,
  entryDelimiterName,
  entryDelimiterNameFromKey,
  rewrapContent,
  sanitizeDelimiterName,
  type DetectedDelimiter,
} from '../../core/models/delimiters';
import { CharacterBookEntry, entryTitle } from '../../core/models/lorebook.model';
import { estimateTokens, formatTokenCount } from '../../core/services/token-estimator';
import { WorkspaceService } from '../../core/services/workspace.service';
import {
  type DelimiterDialogData,
  type DelimiterScope,
  type EntryPreview,
} from './delimiter-dialog.model';
import { DiffViewer } from '../../shared/components/diff-viewer/diff-viewer';

/** Form model of the delimiter dialog. */
interface DelimiterFormModel {
  /** Fixed wrapper name (skipped when every entry supplies its own). */
  name: string;
  style: DelimiterStyle;
  scope: DelimiterScope;
  useEachName: boolean;
  /** Wrap with the entry's first primary key instead of its name. */
  usePrimaryKey: boolean;
}

/** Direction class used to color a token delta (`up` = more tokens). */
type TokenDeltaDirection = 'up' | 'down' | 'neutral';

/** `+N` / `−N` (U+2212, M3 typographic minus) / `=` label for a token delta. */
function tokenDeltaLabel(delta: number): string {
  if (delta === 0) {
    return '=';
  }
  return delta > 0 ? `+${formatTokenCount(delta)}` : `−${formatTokenCount(-delta)}`;
}

/** Maps a token delta to its direction class. */
function tokenDeltaDirection(delta: number): TokenDeltaDirection {
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
}

/**
 * True when a detection is a named tag/bracket wrapper whose name survives
 * sanitizing — a name like `<=>` collapses to nothing and can never be
 * matched, so it stays payload.
 */
function isNamedWrapper(detected: DetectedDelimiter): boolean {
  return (
    (detected.style === 'tag' || detected.style === 'bracket') &&
    sanitizeDelimiterName(detected.name) !== ''
  );
}

/**
 * Recognizes, adds, changes, and removes content delimiters — for the active
 * entry or the whole book — with a live diff preview before applying. The
 * four controls share one Signal Form model; the Material select / checkbox
 * write into it from their change events (they are CVA components, so only
 * the name input binds `[formField]` directly).
 */
@Component({
  selector: 'app-delimiter-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    DiffViewer,
  ],
  templateUrl: './delimiter-dialog.html',
  styleUrl: './delimiter-dialog.scss',
})
export class DelimiterDialog {
  private readonly dialogRef = inject(MatDialogRef<DelimiterDialog, boolean>);
  protected readonly data = inject<DelimiterDialogData>(MAT_DIALOG_DATA);
  protected readonly workspace = inject(WorkspaceService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly styleOptions = DELIMITER_STYLE_OPTIONS;

  private readonly model = signal<DelimiterFormModel>({
    name: entryDelimiterName(
      this.workspace.entries().find((e) => e.id === this.data.activeEntryId) ?? { keys: [] },
    ),
    style: 'tag',
    scope: 'entry',
    useEachName: true,
    usePrimaryKey: false,
  });

  protected readonly delimiterForm = form(this.model, (s) => {
    // Batch mode with per-entry names — and key-derived names everywhere —
    // never reads the fixed name.
    disabled(s.name, {
      when: ({ valueOf }) =>
        valueOf(s.usePrimaryKey) || (valueOf(s.scope) === 'all' && valueOf(s.useEachName)),
    });
  });

  protected readonly scope = computed(() => this.model().scope);
  protected readonly style = computed(() => this.model().style);
  protected readonly name = computed(() => this.model().name);
  protected readonly useEachName = computed(() => this.model().useEachName);
  protected readonly usePrimaryKey = computed(() => this.model().usePrimaryKey);

  protected setScope(scope: DelimiterScope): void {
    this.model.update((m) => ({ ...m, scope }));
  }

  protected setStyle(style: DelimiterStyle): void {
    this.model.update((m) => ({ ...m, style }));
  }

  protected setUseEachName(useEachName: boolean): void {
    this.model.update((m) => ({ ...m, useEachName }));
  }

  protected setUsePrimaryKey(usePrimaryKey: boolean): void {
    this.model.update((m) => ({ ...m, usePrimaryKey }));
  }

  protected readonly needsName = computed(
    () => this.style() === 'tag' || this.style() === 'bracket',
  );

  /** The fixed typed name is skipped when every entry supplies its own. */
  protected readonly nameResolvedFromEntries = computed(
    () => this.scope() === 'all' && this.useEachName(),
  );

  /** The fixed typed name is skipped entirely (per-entry name resolution). */
  protected readonly nameSkipped = computed(
    () => this.usePrimaryKey() || this.nameResolvedFromEntries(),
  );

  protected readonly nameMissing = computed(
    () => this.needsName() && !this.nameSkipped() && !this.name().trim(),
  );

  /** The typed fixed name as it will be applied (empty while skipped). */
  protected readonly resolvedFixedName = computed(() =>
    this.nameSkipped() ? '' : sanitizeDelimiterName(this.name()),
  );

  /**
   * True when the typed name contains characters the wrapper syntax cannot
   * carry (`<`, `=`, `[`, `]`, newlines): the field is never rewritten, but
   * the sanitized name is previewed — and applied — instead.
   */
  protected readonly fixedNameRewritten = computed(
    () =>
      this.needsName() &&
      !this.nameSkipped() &&
      this.name().trim() !== '' &&
      this.resolvedFixedName() !== this.name().trim(),
  );

  protected readonly targets = computed(() => {
    const entries = this.workspace.entries();
    return this.scope() === 'entry'
      ? entries.filter((e) => e.id === this.data.activeEntryId)
      : entries;
  });

  /**
   * The wrapper name for one entry: its first primary key when key mode is
   * on, else its own name in batch mode, else the sanitized fixed typed name.
   */
  private resolveName(entry: CharacterBookEntry): string {
    if (this.usePrimaryKey()) {
      return entryDelimiterNameFromKey(entry);
    }
    return this.nameResolvedFromEntries() ? entryDelimiterName(entry) : this.resolvedFixedName();
  }

  /**
   * Every name that counts as "already wrapped" for one entry: the resolved
   * target name, the entry-derived fallbacks, and — decisively — the name
   * actually detected in the content. Accepting the detected wrapper is what
   * lets the dialog replace a shell it did not choose (`<TEAFsa>`, an old
   * key-style name) instead of nesting a second one around it, and lets
   * `none` strip it; the preview diff and the row hint show that
   * replacement before anything is written. Separator stripping stays
   * conservative: a trailing `---` is only removed by the `separator`/`none`
   * targets, so a scene break survives a re-wrap.
   */
  private resolveExpectedNames(entry: CharacterBookEntry): string[] {
    const detected = detectDelimiter(entry.content ?? '');
    const names = [
      this.resolveName(entry),
      entryDelimiterName(entry),
      entryDelimiterNameFromKey(entry),
      isNamedWrapper(detected) ? detected.name : '',
    ];
    return [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))];
  }

  protected readonly previews = computed<EntryPreview[]>(() => {
    const style = this.style();
    return this.targets().map((entry) => {
      const current = entry.content ?? '';
      const expectedNames = this.resolveExpectedNames(entry);
      const next = rewrapContent(current, style, this.resolveName(entry), expectedNames);
      const detected = detectDelimiter(current);
      // A detected whole-content wrapper is always stripped (its own name is
      // in the accepted set); a trailing `---` only by the `none` target.
      const stripped =
        isNamedWrapper(detected) || (detected.style === 'separator' && style === 'none');
      return {
        entryId: entry.id ?? -1,
        title: entryTitle(entry),
        current,
        next,
        changed: next !== current,
        blank: current.trim() === '',
        tokenDelta: estimateTokens(next) - estimateTokens(current),
        replacedDelimiter: next !== current && stripped ? delimiterLabel(detected) : null,
      };
    });
  });

  protected readonly changedCount = computed(() => this.previews().filter((p) => p.changed).length);

  protected readonly blankCount = computed(() => this.previews().filter((p) => p.blank).length);

  /** True when every target is blank — applying is then a guaranteed no-op. */
  protected readonly allBlank = computed(
    () => this.previews().length > 0 && this.previews().every((p) => p.blank),
  );

  /** Sum of the per-row estimates; only changed rows contribute non-zero. */
  protected readonly tokenDeltaTotal = computed(() =>
    this.previews().reduce((sum, p) => sum + p.tokenDelta, 0),
  );

  protected readonly tokenDeltaLabel = computed(() => tokenDeltaLabel(this.tokenDeltaTotal()));

  protected readonly tokenDeltaDirection = computed(() =>
    tokenDeltaDirection(this.tokenDeltaTotal()),
  );

  /** Diff target chosen by clicking a summary row; defaults to the active entry. */
  protected readonly selectedPreviewId = signal<number | null>(this.data.activeEntryId);

  protected selectPreview(entryId: number): void {
    this.selectedPreviewId.set(entryId);
  }

  /** Per-row formatting helpers for the summary list. */
  protected formatDelta(delta: number): string {
    return tokenDeltaLabel(delta);
  }

  protected deltaDirection(delta: number): TokenDeltaDirection {
    return tokenDeltaDirection(delta);
  }

  /** The diff shown in the preview pane: the selected row, else the active entry. */
  protected readonly previewEntry = computed<EntryPreview | null>(() => {
    const previews = this.previews();
    const selectedId = this.selectedPreviewId();
    return (
      previews.find((p) => p.entryId === selectedId) ??
      previews.find((p) => p.entryId === this.data.activeEntryId) ??
      previews.find((p) => p.changed) ??
      previews[0] ??
      null
    );
  });

  /** Formats the chosen style with the resolved name, as a reference card. */
  protected readonly example = computed<string[]>(() => {
    const name = this.nameSkipped()
      ? this.usePrimaryKey()
        ? '<first key>'
        : '<entry name>'
      : this.resolvedFixedName() || '<entry name>';
    switch (this.style()) {
      case 'tag':
        return [`<${name}>`, 'Entry content…', `</${name}>`];
      case 'bracket':
        return [`[${name}=`, 'Entry content…', ']'];
      case 'separator':
        return ['Entry content…', '', '---'];
      default:
        return ['Entry content…'];
    }
  });

  protected apply(): void {
    // Blank targets are a no-op by construction: never write a phantom
    // wrapper, even if a stray preview ever reported a change.
    if (this.allBlank()) {
      this.dialogRef.close(false);
      return;
    }
    const changedIds = this.previews()
      .filter((p) => p.changed)
      .map((p) => p.entryId);
    if (!changedIds.length) {
      this.dialogRef.close(false);
      return;
    }
    const style = this.style();
    this.workspace.updateManyEntries(changedIds, (entry) => ({
      content: rewrapContent(
        entry.content ?? '',
        style,
        this.resolveName(entry),
        this.resolveExpectedNames(entry),
      ),
    }));
    this.snackBar.open(
      `Delimiters updated on ${changedIds.length} entr${changedIds.length === 1 ? 'y' : 'ies'}.`,
      'OK',
      { duration: 3500 },
    );
    this.dialogRef.close(true);
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
