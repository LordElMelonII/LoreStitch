import { InjectionToken } from '@angular/core';
import { type BuildInfo } from './build-info.types';

export type { BuildInfo } from './build-info.types';

/**
 * Development/test defaults — keep `version` in sync with package.json (the
 * "development build" chip softens any drift, and release builds replace this
 * module wholesale). Release builds swap this file for the generated
 * `build-info.prod.ts` sibling via `fileReplacements` (see angular.json and
 * `scripts/generate-build-info.mjs`), so the shipped app reports its real
 * version, build timestamp and commit.
 */
export const APP_BUILD_INFO = new InjectionToken<BuildInfo>('APP_BUILD_INFO', {
  factory: (): BuildInfo => ({ version: '1.0.0', buildTimestamp: null, gitCommitSha: null }),
});
