import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, disabled, form } from '@angular/forms/signals';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
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
  delimiterNameMatches,
  detectDelimiter,
  detectMalformedWrapper,
  entryDelimiterName,
  entryDelimiterNameFromKey,
  rewrapContent,
  sanitizeDelimiterName,
  stripMalformedWrapper,
  type DetectedDelimiter,
  type MarkdownHeadingLevel,
  type MarkdownWrapOptions,
  type MalformedWrapper,
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
  /** ATX heading level of the markdown style (Task 12 §5.3, default 2). */
  markdownLevel: MarkdownHeadingLevel;
  /** Whether the markdown style appends its trailing `---` toggle marker. */
  markdownSeparator: boolean;
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
 * entry, the whole book, or the checked selection — with a live diff preview
 * before applying. The controls share one Signal Form model; the
 * Material select / checkbox write into it from their change events (they are
 * CVA components, so only the name input binds `[formField]` directly).
 *
 * The pane is dual-container, exactly like the batch editor
 * (`BatchOperationsDialog`): a centered `MatDialog` (tablet/desktop) and a
 * `MatBottomSheet` (phones, `.app-delimiters-sheet`) share this template, so
 * both refs and both data tokens are injected optionally and `close()` routes
 * to whichever container is present. Opened through
 * `ResponsiveOverlayService` by the entry editor (one entry / whole book) and
 * the entry-list batch toolbar (the checked selection, scope locked — D2).
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
  /** Ref of the opening container — exactly one of the two is present. */
  private readonly dialogRef = inject(MatDialogRef<DelimiterDialog, boolean>, {
    optional: true,
  });
  private readonly sheetRef = inject(MatBottomSheetRef<DelimiterDialog, boolean>, {
    optional: true,
  });

  /** Payload from whichever container opened the pane (canonical at the caller). */
  protected readonly data: DelimiterDialogData =
    (inject(MAT_DIALOG_DATA, { optional: true }) as DelimiterDialogData | null) ??
    (inject(MAT_BOTTOM_SHEET_DATA, { optional: true }) as DelimiterDialogData | null) ?? {
      entryIds: [],
    };

  protected readonly workspace = inject(WorkspaceService);
  private readonly snackBar = inject(MatSnackBar);

  /**
   * Selection mode (Task 12 §5.2, D2): opened from the batch toolbar with a
   * non-empty `entryIds` — the Apply-to select is hidden and the targets are
   * locked to the checked entries. The internal scope runs at `all` so the
   * per-entry naming machinery (each checked entry wrapped with its own name
   * by default) applies unchanged; the hidden select can never change it.
   */
  protected readonly selectionMode = (this.data.entryIds?.length ?? 0) > 0;

  protected readonly styleOptions = DELIMITER_STYLE_OPTIONS;

  private readonly model = signal<DelimiterFormModel>({
    name: entryDelimiterName(
      this.workspace.entries().find((e) => e.id === this.data.activeEntryId) ?? { keys: [] },
    ),
    style: 'tag',
    scope: this.selectionMode ? 'all' : 'entry',
    useEachName: true,
    usePrimaryKey: false,
    markdownLevel: 2,
    markdownSeparator: false,
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

  protected setMarkdownLevel(level: MarkdownHeadingLevel): void {
    this.model.update((m) => ({ ...m, markdownLevel: level }));
  }

  protected setMarkdownSeparator(separator: boolean): void {
    this.model.update((m) => ({ ...m, markdownSeparator: separator }));
  }

  protected readonly needsName = computed(
    () =>
      this.style() === 'tag' || this.style() === 'bracket' || this.style() === 'markdown',
  );

  /** Whether the markdown option row renders (§5.3: level + trailing `---`). */
  protected readonly isMarkdown = computed(() => this.style() === 'markdown');

  /** Heading levels offered by the markdown level picker (§5.3, D6). */
  protected readonly markdownLevels: readonly MarkdownHeadingLevel[] = [1, 2, 3, 4, 5, 6];

  protected readonly markdownLevel = computed(() => this.model().markdownLevel);

  protected readonly markdownSeparator = computed(() => this.model().markdownSeparator);

  /** Compact trigger/option label for a heading level (`## — H2`). */
  protected headingLevelLabel(level: MarkdownHeadingLevel): string {
    return `${'#'.repeat(level)} — H${level}`;
  }

  /**
   * The markdown options every wrap/rewrap composes with — preview and apply
   * read this ONE accessor, so what is previewed is exactly what is written
   * (D5/D6: level normalization and the trailing `---` toggle ride along).
   * Every other style ignores the options entirely.
   */
  private markdownOptions(): MarkdownWrapOptions | undefined {
    return this.style() === 'markdown'
      ? { level: this.model().markdownLevel, trailingSeparator: this.model().markdownSeparator }
      : undefined;
  }

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
    if (this.selectionMode) {
      // Locked to the checked entries (D2): the selection the toolbar sent,
      // order-preserving against the book's own list.
      const ids = new Set(this.data.entryIds ?? []);
      return entries.filter((e) => e.id !== undefined && ids.has(e.id));
    }
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

  /**
   * The rewrap source for one entry: a classified malformed shell is stripped
   * first so the same rewrap replaces the broken pair instead of nesting
   * around it. Only classified rows strip — `stripMalformedWrapper` is
   * structural and hint-free, so the classification gate here is what keeps
   * an orphan shape whose name matches no entry name as payload. Previews and
   * `apply()` compose through this one helper: what is previewed is exactly
   * what is written.
   */
  private stripClassifiedShell(entry: CharacterBookEntry): string {
    const current = entry.content ?? '';
    const malformed = detectMalformedWrapper(current, this.resolveExpectedNames(entry));
    return malformed !== null ? stripMalformedWrapper(current) : current;
  }

  protected readonly previews = computed<EntryPreview[]>(() => {
    const style = this.style();
    return this.targets().map((entry) => {
      const current = entry.content ?? '';
      const expectedNames = this.resolveExpectedNames(entry);
      // Orphan detection is hint-gated (§3.2.4): the dialog reuses its
      // accepted-name chain — resolved target name plus entry-derived
      // fallbacks — so an orphaned tag classifies only when the entry itself
      // points at that name; mismatched pairs need no hints.
      const malformed = detectMalformedWrapper(current, expectedNames);
      // Same composition the write path uses (see `stripClassifiedShell`):
      // the previewed bytes are the written bytes by construction — markdown
      // options included.
      const next = rewrapContent(
        this.stripClassifiedShell(entry),
        style,
        this.resolveName(entry),
        expectedNames,
        this.markdownOptions(),
      );
      const detected = detectDelimiter(current);
      // A detected whole-content tag/bracket wrapper is always stripped (its
      // own name is in the accepted set); a markdown wrapper only when its
      // header matches the accepted chain (D7 — foreign headers stay
      // payload); a trailing `---` only by the `none` target.
      const stripped =
        isNamedWrapper(detected) ||
        (detected.style === 'markdown' && delimiterNameMatches(detected.name, expectedNames)) ||
        (detected.style === 'separator' && style === 'none');
      return {
        entryId: entry.id ?? -1,
        title: entryTitle(entry),
        current,
        next,
        changed: next !== current,
        blank: current.trim() === '',
        tokenDelta: estimateTokens(next) - estimateTokens(current),
        replacedDelimiter: next !== current && stripped ? delimiterLabel(detected) : null,
        malformed,
      };
    });
  });

  protected readonly changedCount = computed(() => this.previews().filter((p) => p.changed).length);

  protected readonly blankCount = computed(() => this.previews().filter((p) => p.blank).length);

  /** Rows whose current content carries a classified malformed shell. */
  protected readonly malformedCount = computed(
    () => this.previews().filter((p) => p.malformed !== null).length,
  );

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
  protected readonly selectedPreviewId = signal<number | null>(this.data.activeEntryId ?? null);

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

  /**
   * The malformed counterpart of the `replacedDelimiter` hint: names the
   * broken shell exactly as written and says whether the picked style
   * replaces it or removes it.
   */
  protected malformedHint(malformed: MalformedWrapper): string {
    const verb = this.style() === 'none' ? 'remove' : 'replace';
    switch (malformed.kind) {
      case 'mismatched':
        return (
          `Will ${verb} the mismatched <${malformed.openingName}> ` +
          `and </${malformed.closingName}> delimiters`
        );
      case 'orphan-open':
        return `Will ${verb} the unclosed <${malformed.name}> delimiter`;
      case 'orphan-close':
        return `Will ${verb} the unclosed </${malformed.name}> delimiter`;
      case 'empty-header':
        return `Will ${verb} the empty ${'#'.repeat(malformed.level)} heading (no header text)`;
      case 'no-space-header':
        return `Will ${verb} the unspaced #${malformed.name} heading`;
    }
  }

  /**
   * Row-chip label for a classified malformed shell: mismatched pairs read
   * `mismatched`, both orphan kinds read `unclosed`, an empty ATX header
   * reads `empty header`, and a glue-typed header reads `missing space`
   * (Task 12 §5.3 chip copy). Exhaustive over `MalformedWrapper` (no
   * default) so a future kind is a compile error here, not a silently
   * mislabeled chip.
   */
  protected malformedChipLabel(malformed: MalformedWrapper): string {
    switch (malformed.kind) {
      case 'mismatched':
        return 'mismatched';
      case 'orphan-open':
      case 'orphan-close':
        return 'unclosed';
      case 'empty-header':
        return 'empty header';
      case 'no-space-header':
        return 'missing space';
    }
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
      case 'markdown': {
        // The live emitted shape (D5/D6): `#{level} name`, one structural
        // blank line, the payload — plus the toggle marker when asked.
        const lines = [`${'#'.repeat(this.markdownLevel())} ${name}`, '', 'Entry content…'];
        return this.markdownSeparator() ? [...lines, '', '---'] : lines;
      }
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
      this.close(false);
      return;
    }
    const changedIds = this.previews()
      .filter((p) => p.changed)
      .map((p) => p.entryId);
    if (!changedIds.length) {
      this.close(false);
      return;
    }
    const style = this.style();
    this.workspace.updateManyEntries(changedIds, (entry) => ({
      content: rewrapContent(
        // Same composition as the preview rows (see `stripClassifiedShell`):
        // what is previewed is exactly what is written.
        this.stripClassifiedShell(entry),
        style,
        this.resolveName(entry),
        this.resolveExpectedNames(entry),
        this.markdownOptions(),
      ),
    }));
    this.snackBar.open(
      `Delimiters updated on ${changedIds.length} entr${changedIds.length === 1 ? 'y' : 'ies'}.`,
      'OK',
      { duration: 3500 },
    );
    this.close(true);
  }

  /**
   * Closes whichever container opened the pane (exactly one ref is present;
   * both optional chains, the `BatchOperationsDialog` pattern). Selection
   * mode callers read the result off `paneResult` and clear the selection
   * when it is truthy.
   */
  protected close(result = false): void {
    this.dialogRef?.close(result);
    this.sheetRef?.dismiss(result);
  }
}
