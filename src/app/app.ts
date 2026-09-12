import { Component, computed, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';

export interface TechFeature {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly tag: string;
}

@Component({
  imports: [
    RouterOutlet,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatChipsModule,
    MatBadgeModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatDividerModule,
  ],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('LoreStitch');
  protected readonly counter = signal(0);
  protected readonly doubleCount = computed(() => this.counter() * 2);
  protected readonly isFeatureEnabled = signal(true);

  protected readonly techStack = signal<readonly TechFeature[]>([
    {
      title: 'Angular v22',
      description: 'Zoneless-ready, standalone-first architecture with native control flow.',
      icon: 'bolt',
      tag: 'Framework',
    },
    {
      title: 'Angular Material M3',
      description: 'Material Design 3 system variables, dynamic palettes, and accessible components.',
      icon: 'palette',
      tag: 'UI Library',
    },
    {
      title: 'Signal State',
      description: 'Fine-grained reactive state management with signals and computed values.',
      icon: 'sync_alt',
      tag: 'Reactivity',
    },
    {
      title: 'SCSS Styling',
      description: 'Clean scoped styling paired with Material 3 design tokens.',
      icon: 'brush',
      tag: 'Styling',
    },
  ]);

  protected increment(): void {
    this.counter.update((count) => count + 1);
  }

  protected decrement(): void {
    this.counter.update((count) => Math.max(0, count - 1));
  }

  protected reset(): void {
    this.counter.set(0);
  }

  protected toggleFeature(): void {
    this.isFeatureEnabled.update((enabled) => !enabled);
  }
}

