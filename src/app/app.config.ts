import {
  ApplicationConfig,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  inject,
  isDevMode,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideServiceWorker } from '@angular/service-worker';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_TOOLTIP_DEFAULT_OPTIONS } from '@angular/material/tooltip';
import { MatIconRegistry } from '@angular/material/icon';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // M3: one consistent outlined text-field style across the whole app.
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'fill' as const },
    },
    // Tooltips are a desktop-hover affordance: on touch platforms the default
    // `auto` mode stamps `touch-action: none` on every tooltip host, which
    // kills native panning for touches that start on those elements (the
    // entry list became unscrollable from any row). 'off' keeps the scroll.
    // Non-interactive additionally makes the floating panel itself
    // `pointer-events: none`, so gliding the cursor over a tooltip (e.g.
    // moving down from an icon button onto the entry beneath it) passes
    // straight through instead of getting stuck on the bubble.
    {
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      useValue: { touchGestures: 'off' as const, disableTooltipInteractivity: true },
    },
    // M3 iconography: Material Symbols Outlined replaces the legacy
    // Material Icons font as the default ligature set for <mat-icon>.
    provideAppInitializer(() => {
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
    }),
  ],
};
