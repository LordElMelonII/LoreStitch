import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ENTER, COMMA } from '@angular/cdk/keycodes';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  ST_LOGIC,
  ST_ROLE,
  WI_POSITION_OPTIONS,
  WI_POSITION_TO_ST,
  WiPosition,
  WiTriggerState,
  entryTriggerState,
  estimateTokens,
  triggerStatePatch,
} from '../../core/models/lorebook.model';
import { delimiterLabel, detectDelimiter } from '../../core/models/delimiters';
import { WorkspaceService } from '../../core/services/workspace.service';
import { DelimiterDialog } from '../delimiters/delimiter-dialog';

/**
 * The field editors for a single lorebook entry. Rendered inside each editor
 * tab, bound to that tab's entry via the `entry` input; all mutations go
 * through the WorkspaceService.
 */
@Component({
  selector: 'app-entry-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatChipsModule,
    MatDialogModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-fields.html',
  styleUrl: './entry-fields.scss',
})
export class EntryFields {
  protected readonly workspace = inject(WorkspaceService);
  private readonly dialog = inject(MatDialog);

  /** The entry this tab edits. */
  readonly entry = input.required<CharacterBookEntry>();

  protected readonly separatorKeyCodes = [ENTER, COMMA];
  protected readonly positionOptions = WI_POSITION_OPTIONS;
  protected readonly logicOptions = [
    { value: ST_LOGIC.AND_ANY, label: 'AND Any' },
    { value: ST_LOGIC.NOT_ALL, label: 'NOT All' },
    { value: ST_LOGIC.NOT_ANY, label: 'NOT Any' },
    { value: ST_LOGIC.AND_ALL, label: 'AND All' },
  ];
  protected readonly roleOptions = [
    { value: ST_ROLE.system, label: 'System', icon: '⚙️' },
    { value: ST_ROLE.user, label: 'User', icon: '👤' },
    { value: ST_ROLE.assistant, label: 'Assistant', icon: '🤖' },
  ];

  /** Depth & role only make sense when the entry is inserted at a chat depth. */
  protected readonly isAtDepth = computed(() => this.entry().position === 'at_depth');

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));

  /** Outlet entries are pulled into the prompt manually via the outlet macro. */
  protected readonly isOutlet = computed(() => this.entry().position === 'outlet');

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

  // -------------------------------------------------------------------------
  // Field updates
  // -------------------------------------------------------------------------

  protected setText(field: 'comment' | 'name' | 'content', event: Event): void {
    const entry = this.entry();
    if (entry.id !== undefined) {
      this.workspace.updateEntry(entry.id, {
        [field]: (event.target as HTMLTextAreaElement | HTMLInputElement).value,
      });
    }
  }

  protected setNumber(field: 'insertion_order' | 'priority', event: Event): void {
    const entry = this.entry();
    if (entry.id === undefined) {
      return;
    }
    const raw = (event.target as HTMLInputElement).value;
    if (field === 'priority' && raw === '') {
      this.workspace.updateEntry(entry.id, { priority: undefined });
      return;
    }
    const value = Number(raw);
    if (!Number.isNaN(value)) {
      this.workspace.updateEntry(entry.id, { [field]: value });
    }
  }

  /**
   * Changes the insertion position. The ST-native numeric mirror in
   * `extensions.position` is kept in sync so exports round-trip.
   */
  protected setPosition(value: WiPosition): void {
    const entry = this.entry();
    if (entry.id !== undefined) {
      this.workspace.updateEntry(entry.id, {
        position: value,
        extensions: { ...entry.extensions, position: WI_POSITION_TO_ST[value] },
      });
    }
  }

  protected setFlag(
    field: 'enabled' | 'selective' | 'case_sensitive',
    change: MatSlideToggleChange,
  ): void {
    const entry = this.entry();
    if (entry.id !== undefined) {
      this.workspace.updateEntry(entry.id, { [field]: change.checked });
    }
  }

  /** Switches the trigger strategy (normal / constant / vectorized). */
  protected setTriggerState(state: WiTriggerState): void {
    const entry = this.entry();
    if (entry.id !== undefined) {
      this.workspace.updateEntry(entry.id, triggerStatePatch(entry, state));
    }
  }

  protected setExtension(key: string, value: unknown): void {
    const entry = this.entry();
    if (entry.id !== undefined) {
      this.workspace.updateEntry(entry.id, { extensions: { ...entry.extensions, [key]: value } });
    }
  }

  protected setExtensionText(key: string, event: Event): void {
    this.setExtension(key, (event.target as HTMLInputElement).value);
  }

  protected setExtensionNumber(key: string, event: Event, fallback: number | null): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') {
      this.setExtension(key, fallback);
      return;
    }
    const value = Number(raw);
    if (!Number.isNaN(value)) {
      this.setExtension(key, value);
    }
  }

  protected setExtensionFlag(key: string, change: MatSlideToggleChange): void {
    this.setExtension(key, change.checked);
  }

  protected openDelimiterDialog(): void {
    this.dialog.open(DelimiterDialog, {
      maxWidth: 'min(96vw, 860px)',
      data: { activeEntryId: this.entry().id },
    });
  }

  // -------------------------------------------------------------------------
  // Key chips
  // -------------------------------------------------------------------------

  private readonly primaryKeyInput = viewChild<ElementRef<HTMLInputElement>>('primaryKeyInput');
  private readonly secondaryKeyInput = viewChild<ElementRef<HTMLInputElement>>('secondaryKeyInput');
  private readonly keyEditInput = viewChild<ElementRef<HTMLInputElement>>('keyEditInput');

  /** Clicking anywhere in the outlined chip box focuses its input. */
  protected focusPrimaryKeys(): void {
    // Never steal focus while a key is being edited in place.
    if (this.editingKey()) {
      return;
    }
    this.primaryKeyInput()?.nativeElement.focus();
  }

  protected focusSecondaryKeys(): void {
    if (this.editingKey()) {
      return;
    }
    this.secondaryKeyInput()?.nativeElement.focus();
  }

  /** The key currently being edited in place (double-click a chip). */
  protected readonly editingKey = signal<{
    field: 'keys' | 'secondary_keys';
    index: number;
  } | null>(null);
  protected readonly editValue = signal('');

  constructor() {
    // Focus and select the in-place editor whenever it appears.
    afterRenderEffect(() => {
      const input = this.keyEditInput()?.nativeElement;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  protected isEditing(field: 'keys' | 'secondary_keys', index: number): boolean {
    const editing = this.editingKey();
    return editing?.field === field && editing.index === index;
  }

  protected startEdit(field: 'keys' | 'secondary_keys', index: number, current: string): void {
    this.editingKey.set({ field, index });
    this.editValue.set(current);
  }

  protected setEditValue(event: Event): void {
    this.editValue.set((event.target as HTMLInputElement).value);
  }

  /** Applies the edited key (Enter or blur); an empty value removes it. */
  protected commitEdit(): void {
    const editing = this.editingKey();
    if (!editing) {
      return;
    }
    const entry = this.entry();
    if (entry.id !== undefined) {
      const list: string[] = [...(entry[editing.field] ?? [])];
      const value = this.editValue().trim();
      if (!value) {
        list.splice(editing.index, 1);
      } else if (list[editing.index] !== value) {
        // Keep keys unique, mirroring addKey(): if the new value already
        // exists elsewhere the edit collapses into that duplicate.
        if (list.some((k, i) => i !== editing.index && k === value)) {
          list.splice(editing.index, 1);
        } else {
          list[editing.index] = value;
        }
      }
      this.workspace.updateEntry(entry.id, {
        [editing.field]: list,
      } as Partial<CharacterBookEntry>);
    }
    this.editingKey.set(null);
  }

  protected cancelEdit(): void {
    this.editingKey.set(null);
  }

  protected addKey(field: 'keys' | 'secondary_keys', event: MatChipInputEvent): void {
    const entry = this.entry();
    const value = event.value.trim();
    if (entry.id === undefined || !value) {
      return;
    }
    const list = [...(entry[field] ?? [])];
    if (!list.includes(value)) {
      list.push(value);
      this.workspace.updateEntry(entry.id, { [field]: list });
    }
    // Clear the chip input.
    event.input.value = '';
  }

  protected removeKey(field: 'keys' | 'secondary_keys', index: number): void {
    const entry = this.entry();
    if (entry.id === undefined) {
      return;
    }
    const list = [...(entry[field] ?? [])];
    list.splice(index, 1);
    this.workspace.updateEntry(entry.id, { [field]: list });
  }
}
