/** Static metadata about the deployed application build, shown in the About dialog. */
export interface BuildInfo {
  /** Semantic version, read from package.json at build time. */
  readonly version: string;
  /** ISO-8601 UTC timestamp of the release build; null outside release builds. */
  readonly buildTimestamp: string | null;
  /** Git commit SHA the build was produced from; null when unavailable. */
  readonly gitCommitSha: string | null;
}
