import { ENTER, COMMA } from '@angular/cdk/keycodes';
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
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  ST_LOGIC_OPTIONS,
  entryTriggerState,
} from '../../../core/models/lorebook.model';
import { classifyStKey, parseStRegex, type StKeyClass } from '../../../core/models/st-regex';
import { EntryUpdatesService } from '../entry-updates.service';
import { type KeyEditTarget, type KeyListField } from '../entry-editor.model';
import { RegexTestPanel } from './regex-test-panel';

/** §3.4 verbatim description of an invalid regex key. */
const INVALID_KEY_TOOLTIP =
  'Invalid regular expression — SillyTavern treats this key as plain text';

/**
 * §3.4 verbatim tooltip shape for a valid regex key, `/source/flags` filled
 * from `parseStRegex`. Unreachable fallback keeps the shape well-typed when
 * narrowing cannot see that `'regex'` implies a successful parse.
 */
function regexKeyTooltip(key: string): string {
  const parsed = parseStRegex(key);
  const shape = parsed ? `/${parsed.source}/${parsed.flags}` : key;
  return `Regex key: ${shape} — case and whole-word options don't apply`;
}

/** Presentation state of one key chip: classification plus optional tooltip. */
interface KeyChipState {
  readonly key: string;
  readonly cls: StKeyClass;
  /** §3.4 verbatim tooltip, or null when the chip is a plain text key. */
  readonly tooltip: string | null;
}

/**
 * Keys section of the entry options panel: the Selective (Optional Filter)
 * toggle, the primary / secondary keyword chip grids with add / remove /
 * double-click in-place editing and the secondary keys logic. A section of
 * `EntryOptionsAccordion`; list writes go through `EntryUpdatesService`.
 */
@Component({
  selector: 'app-entry-keys',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    RegexTestPanel,
  ],
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

  /**
   * Chip classification for every primary / secondary key (Task 04 §3.2): a
   * pure presentation view recomputed on add / remove / in-place edit through
   * the `entry` input signal. Writes stay untouched (`addKey` / `setKeys`).
   */
  protected readonly keyStates = computed(() => {
    const entry = this.entry();
    const classify = (key: string): KeyChipState => {
      const cls = classifyStKey(key);
      if (cls === 'regex') {
        return { key, cls, tooltip: regexKeyTooltip(key) };
      }
      if (cls === 'invalid-regex') {
        return { key, cls, tooltip: INVALID_KEY_TOOLTIP };
      }
      return { key, cls, tooltip: null };
    };
    return {
      primary: entry.keys.map(classify),
      secondary: (entry.secondary_keys ?? []).map(classify),
    };
  });

  protected readonly logicOptions = ST_LOGIC_OPTIONS;

  /** Template constant: fallback secondary logic when the entry has none. */
  protected readonly defaultLogic = ST_LOGIC_OPTIONS[0].value;

  protected readonly separatorKeyCodes = [ENTER, COMMA];

  private readonly primaryKeyInput = viewChild<ElementRef<HTMLInputElement>>('primaryKeyInput');
  private readonly secondaryKeyInput = viewChild<ElementRef<HTMLInputElement>>('secondaryKeyInput');
  private readonly keyEditInput = viewChild<ElementRef<HTMLInputElement>>('keyEditInput');

  /** The key currently being edited in place (double-click a chip). */
  protected readonly editingKey = signal<KeyEditTarget | null>(null);
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

  protected isEditing(field: KeyListField, index: number): boolean {
    const editing = this.editingKey();
    return editing?.field === field && editing.index === index;
  }

  protected startEdit(field: KeyListField, index: number, current: string): void {
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
    const current = list[editing.index];
    if (current === undefined) {
      // The list shrank since the edit started; there is no key left to change.
      this.editingKey.set(null);
      return;
    }
    const value = this.editValue().trim();
    if (!value) {
      list.splice(editing.index, 1);
    } else if (current !== value) {
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
