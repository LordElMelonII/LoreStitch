import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  VERSION,
  computed,
  inject,
  isDevMode,
  resource,
} from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { APP_BUILD_INFO } from '../../core/models/build-info';
import { GITHUB_REPO_URL } from '../../shared/constants/github';
import { isBreakingSection, parseChangelog } from './changelog';
import { OPEN_SOURCE_GROUPS } from './open-source';

/**
 * In-app "About" pane: version & build metadata, a casual-user changelog
 * parsed from the bundled CHANGELOG.md asset, and open-source credits. The
 * same component renders inside a centered `MatDialog` (tablet/desktop) and a
 * `MatBottomSheet` (phones) — whichever container opened it provides its ref,
 * so both are injected optionally.
 */
@Component({
  selector: 'app-about-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  templateUrl: './about-dialog.html',
  styleUrl: './about-dialog.scss',
})
export class AboutDialog {
  private readonly dialogRef = inject(MatDialogRef, { optional: true });
  private readonly sheetRef = inject(MatBottomSheetRef, { optional: true });

  protected readonly build = inject(APP_BUILD_INFO);
  protected readonly githubUrl = GITHUB_REPO_URL;
  protected readonly issuesUrl = `${GITHUB_REPO_URL}/issues`;
  protected readonly openSourceGroups = OPEN_SOURCE_GROUPS;
  protected readonly isBreaking = isBreakingSection;

  /** Dev/test builds carry no release timestamp (see build-info.ts). */
  protected readonly isDevBuild = computed(() => !this.build.buildTimestamp);

  protected readonly buildDate = computed(() => {
    const timestamp = this.build.buildTimestamp;
    return timestamp ? new Date(timestamp) : null;
  });

  protected readonly shortSha = computed(() => this.build.gitCommitSha?.slice(0, 7) ?? null);

  /** Runtime environment details, for diagnosing version mismatches. */
  protected readonly angularVersion = VERSION.full;
  protected readonly runMode = isDevMode() ? 'Development' : 'Production';

  protected readonly changelogResource = resource({
    loader: ({ abortSignal }) => this.loadChangelog(abortSignal),
  });

  protected readonly releases = computed(() =>
    this.changelogResource.hasValue() ? parseChangelog(this.changelogResource.value()) : [],
  );

  protected readonly changelogFailed = computed(() => this.changelogResource.error() != null);

  /**
   * Fetches the bundled CHANGELOG.md asset. The service worker precaches it,
   * so the changelog reads fine offline; the repo-root file stays the single
   * source of truth (angular.json copies it into the build output).
   */
  private async loadChangelog(abortSignal: AbortSignal): Promise<string> {
    const response = await fetch('CHANGELOG.md', { signal: abortSignal });
    if (!response.ok) {
      throw new Error(`Changelog unavailable (HTTP ${response.status})`);
    }
    return response.text();
  }

  protected close(): void {
    this.dialogRef?.close();
    this.sheetRef?.dismiss();
  }
}
