/**
 * Curated credits for the About dialog's "Open Source" tab. This is a
 * hand-maintained summary of the meaningful runtime and build dependencies
 * (see package.json for the machine-readable source of truth), not an
 * exhaustive auto-generated inventory.
 */

/** A single credited open-source dependency. */
export interface OpenSourceDependency {
  readonly name: string;
  /** SPDX license identifier. */
  readonly license: string;
  readonly author: string;
  readonly url: string;
  /** What LoreStitch uses it for, in one casual line. */
  readonly role: string;
}

/** Dependencies grouped the way the About dialog renders them. */
export interface OpenSourceGroup {
  readonly title: string;
  readonly dependencies: readonly OpenSourceDependency[];
}

export const OPEN_SOURCE_GROUPS: readonly OpenSourceGroup[] = [
  {
    title: 'Runtime',
    dependencies: [
      {
        name: 'Angular',
        license: 'MIT',
        author: 'Google',
        url: 'https://angular.dev',
        role: 'Application framework — signals, standalone components, router, service worker',
      },
      {
        name: 'Angular CDK',
        license: 'MIT',
        author: 'Google',
        url: 'https://material.angular.dev',
        role: 'Component dev kit — overlays, virtual scrolling, breakpoints',
      },
      {
        name: 'Angular Material',
        license: 'MIT',
        author: 'Google',
        url: 'https://material.angular.dev',
        role: 'Material Design 3 component library',
      },
      {
        name: 'diff (jsdiff)',
        license: 'BSD-3-Clause',
        author: 'Kevin Decker and jsdiff contributors',
        url: 'https://github.com/kpdecker/jsdiff',
        role: 'Text differencing behind the commit and merge diff viewers',
      },
      {
        name: 'idb',
        license: 'ISC',
        author: 'Jake Archibald',
        url: 'https://github.com/jakearchibald/idb',
        role: 'Promise wrapper over the IndexedDB project storage',
      },
      {
        name: 'RxJS',
        license: 'Apache-2.0',
        author: 'RxJS contributors',
        url: 'https://rxjs.dev',
        role: 'Reactive streams for responsive breakpoint observation',
      },
      {
        name: 'tslib',
        license: '0BSD',
        author: 'Microsoft',
        url: 'https://github.com/microsoft/tslib',
        role: 'TypeScript runtime helpers',
      },
    ],
  },
  {
    title: 'Build & testing',
    dependencies: [
      {
        name: 'TypeScript',
        license: 'Apache-2.0',
        author: 'Microsoft',
        url: 'https://www.typescriptlang.org',
        role: 'Type-checked JavaScript',
      },
      {
        name: 'Angular CLI',
        license: 'MIT',
        author: 'Google',
        url: 'https://angular.dev/tools/cli',
        role: 'Build, serve and test toolchain',
      },
      {
        name: 'ESLint',
        license: 'MIT',
        author: 'OpenJS Foundation and ESLint contributors',
        url: 'https://eslint.org',
        role: 'Code linting',
      },
      {
        name: 'angular-eslint',
        license: 'MIT',
        author: 'James Henry and contributors',
        url: 'https://github.com/angular-eslint/angular-eslint',
        role: 'Angular-specific ESLint rules',
      },
      {
        name: 'typescript-eslint',
        license: 'MIT',
        author: 'James Henry, Brad Zacher and contributors',
        url: 'https://typescript-eslint.io',
        role: 'TypeScript-aware ESLint parsing and rules',
      },
      {
        name: 'Prettier',
        license: 'MIT',
        author: 'Prettier contributors',
        url: 'https://prettier.io',
        role: 'Code formatting',
      },
      {
        name: 'Vitest',
        license: 'MIT',
        author: 'Vitest contributors',
        url: 'https://vitest.dev',
        role: 'Unit test runner',
      },
      {
        name: 'Playwright',
        license: 'Apache-2.0',
        author: 'Microsoft',
        url: 'https://playwright.dev',
        role: 'End-to-end browser tests',
      },
      {
        name: 'jsdom',
        license: 'MIT',
        author: 'jsdom contributors',
        url: 'https://github.com/jsdom/jsdom',
        role: 'DOM environment for unit tests',
      },
    ],
  },
];
