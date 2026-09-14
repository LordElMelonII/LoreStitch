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
  entryDelimiterName,
  rewrapContent,
} from '../../core/models/delimiters';
import { entryTitle } from '../../core/models/lorebook.model';
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
  });

  protected readonly delimiterForm = form(this.model, (s) => {
    // Batch mode with per-entry names never reads the fixed name.
    disabled(s.name, {
      when: ({ valueOf }) => valueOf(s.scope) === 'all' && valueOf(s.useEachName),
    });
  });

  protected readonly scope = computed(() => this.model().scope);
  protected readonly style = computed(() => this.model().style);
  protected readonly name = computed(() => this.model().name);
  protected readonly useEachName = computed(() => this.model().useEachName);

  protected setScope(scope: DelimiterScope): void {
    this.model.update((m) => ({ ...m, scope }));
  }

  protected setStyle(style: DelimiterStyle): void {
    this.model.update((m) => ({ ...m, style }));
  }

  protected setUseEachName(useEachName: boolean): void {
    this.model.update((m) => ({ ...m, useEachName }));
  }

  protected readonly needsName = computed(
    () => this.style() === 'tag' || this.style() === 'bracket',
  );

  /** The fixed typed name is skipped when every entry supplies its own. */
  protected readonly nameResolvedFromEntries = computed(
    () => this.scope() === 'all' && this.useEachName(),
  );

  protected readonly nameMissing = computed(
    () => this.needsName() && !this.nameResolvedFromEntries() && !this.name().trim(),
  );

  protected readonly targets = computed(() => {
    const entries = this.workspace.entries();
    return this.scope() === 'entry'
      ? entries.filter((e) => e.id === this.data.activeEntryId)
      : entries;
  });

  protected readonly previews = computed<EntryPreview[]>(() => {
    const style = this.style();
    const ownNames = this.nameResolvedFromEntries();
    const fixedName = this.name().trim();
    return this.targets().map((entry) => {
      const resolvedName = ownNames ? entryDelimiterName(entry) : fixedName;
      const next = rewrapContent(entry.content ?? '', style, resolvedName);
      return {
        entryId: entry.id ?? -1,
        title: entryTitle(entry),
        current: entry.content ?? '',
        next,
        changed: next !== entry.content,
      };
    });
  });

  protected readonly changedCount = computed(() => this.previews().filter((p) => p.changed).length);

  /** The diff shown in the preview pane: the active entry, else the first. */
  protected readonly previewEntry = computed<EntryPreview | null>(() => {
    const previews = this.previews();
    return (
      previews.find((p) => p.entryId === this.data.activeEntryId) ??
      previews.find((p) => p.changed) ??
      previews[0] ??
      null
    );
  });

  /** Formats the chosen style with the resolved name, as a reference card. */
  protected readonly example = computed<string[]>(() => {
    const ownNames = this.nameResolvedFromEntries();
    const name = ownNames ? '<entry name>' : this.name().trim() || '<entry name>';
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
    const changedIds = this.previews()
      .filter((p) => p.changed)
      .map((p) => p.entryId);
    if (!changedIds.length) {
      this.dialogRef.close(false);
      return;
    }
    const style = this.style();
    const ownNames = this.nameResolvedFromEntries();
    const fixedName = this.name().trim();
    this.workspace.updateManyEntries(changedIds, (entry) => ({
      content: rewrapContent(
        entry.content ?? '',
        style,
        ownNames ? entryDelimiterName(entry) : fixedName,
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
