import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ENTER, COMMA } from '@angular/cdk/keycodes';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry, estimateTokens, ST_LOGIC } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';

interface TabItem {
  id: number;
  title: string;
  dirty: boolean;
}

/** Central tabbed editor for multiple entries with full field editing. */
@Component({
  selector: 'app-entry-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DragDropModule,
    MatButtonModule,
    MatChipsModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-editor.html',
  styleUrl: './entry-editor.scss',
})
export class EntryEditor {
  protected readonly workspace = inject(WorkspaceService);

  protected readonly separatorKeyCodes = [ENTER, COMMA];
  protected readonly logicOptions = [
    { value: ST_LOGIC.AND_ANY, label: 'AND Any' },
    { value: ST_LOGIC.NOT_ALL, label: 'NOT All' },
    { value: ST_LOGIC.NOT_ANY, label: 'NOT Any' },
    { value: ST_LOGIC.AND_ALL, label: 'AND All' },
  ];

  protected readonly tabs = computed<TabItem[]>(() => {
    const dirty = this.workspace.dirtyEntryIds();
    const byId = new Map(this.workspace.entries().map((e) => [e.id, e]));
    return this.workspace.openTabEntryIds().flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [{ id, title: this.tabTitle(entry), dirty: dirty.has(id) }] : [];
    });
  });

  protected readonly entry = computed(() => this.workspace.activeEntry());

  protected readonly contentStats = computed(() => {
    const content = this.entry()?.content ?? '';
    return {
      chars: content.length,
      tokens: estimateTokens(content),
      lines: content ? content.split('\n').length : 0,
    };
  });

  protected tabTitle(entry: CharacterBookEntry): string {
    const title = entry.comment?.trim() || entry.name?.trim();
    return title || (entry.keys.length ? entry.keys.join(', ') : `Entry ${entry.id}`);
  }

  // -------------------------------------------------------------------------
  // Field updates
  // -------------------------------------------------------------------------

  protected setText(field: 'comment' | 'name' | 'content', event: Event): void {
    const entry = this.entry();
    if (entry?.id !== undefined) {
      this.workspace.updateEntry(entry.id, {
        [field]: (event.target as HTMLTextAreaElement | HTMLInputElement).value,
      });
    }
  }

  protected setNumber(field: 'insertion_order' | 'priority', event: Event): void {
    const entry = this.entry();
    if (entry?.id === undefined) {
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

  protected setPosition(value: 'before_char' | 'after_char'): void {
    const entry = this.entry();
    if (entry?.id !== undefined) {
      this.workspace.updateEntry(entry.id, { position: value });
    }
  }

  protected setFlag(
    field: 'enabled' | 'constant' | 'selective' | 'case_sensitive',
    change: MatSlideToggleChange,
  ): void {
    const entry = this.entry();
    if (entry?.id !== undefined) {
      this.workspace.updateEntry(entry.id, { [field]: change.checked });
    }
  }

  protected setExtension(key: string, value: unknown): void {
    const entry = this.entry();
    if (entry?.id !== undefined) {
      this.workspace.updateEntry(entry.id, { extensions: { ...entry.extensions, [key]: value } });
    }
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

  // -------------------------------------------------------------------------
  // Key chips
  // -------------------------------------------------------------------------

  protected addKey(field: 'keys' | 'secondary_keys', event: MatChipInputEvent): void {
    const entry = this.entry();
    const value = event.value.trim();
    if (!entry || entry.id === undefined || !value) {
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
    if (entry?.id === undefined) {
      return;
    }
    const list = [...(entry[field] ?? [])];
    list.splice(index, 1);
    this.workspace.updateEntry(entry.id, { [field]: list });
  }
}
