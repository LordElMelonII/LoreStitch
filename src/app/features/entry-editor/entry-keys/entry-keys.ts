import { ENTER, COMMA } from '@angular/cdk/keycodes';
import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  ST_LOGIC,
  entryTriggerState,
} from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';

/**
 * Keys section of the entry options panel: the Selective (Optional Filter)
 * toggle, the primary / secondary keyword chip grids with add / remove /
 * double-click in-place editing and the secondary keys logic. A section of
 * `EntryOptionsAccordion`; list writes go through `EntryUpdatesService`.
 */
@Component({
  selector: 'app-entry-keys',
  imports: [MatChipsModule, MatFormFieldModule, MatIconModule, MatSelectModule, MatTooltipModule],
  templateUrl: './entry-keys.html',
  styleUrl: './entry-keys.scss',
  host: { class: 'entry-panel-section' },
})
export class EntryKeys {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryOptionsAccordion`). */
  readonly entry = input.required<CharacterBookEntry>();

  /** True while the entry always triggers — key-based modifiers don't apply. */
  protected readonly isConstant = computed(() => entryTriggerState(this.entry()) === 'constant');

  protected readonly logicOptions = [
    { value: ST_LOGIC.AND_ANY, label: 'AND Any' },
    { value: ST_LOGIC.NOT_ALL, label: 'NOT All' },
    { value: ST_LOGIC.NOT_ANY, label: 'NOT Any' },
    { value: ST_LOGIC.AND_ALL, label: 'AND All' },
  ];

  /** Template constant: fallback secondary logic when the entry has none. */
  protected readonly defaultLogic = ST_LOGIC.AND_ANY;

  protected readonly separatorKeyCodes = [ENTER, COMMA];

  private readonly primaryKeyInput = viewChild<ElementRef<HTMLInputElement>>('primaryKeyInput');
  private readonly secondaryKeyInput = viewChild<ElementRef<HTMLInputElement>>('secondaryKeyInput');
  private readonly keyEditInput = viewChild<ElementRef<HTMLInputElement>>('keyEditInput');

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
    this.updates.setKeys(entry, editing.field, list);
    this.editingKey.set(null);
  }

  protected cancelEdit(): void {
    this.editingKey.set(null);
  }
}
