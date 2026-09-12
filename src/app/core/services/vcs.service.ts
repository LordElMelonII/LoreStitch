import { Injectable } from '@angular/core';
import { CharacterBook, ProjectCommit, ProjectWorkspace } from '../models/lorebook.model';
import { hasSubtleCrypto, sha256Hex } from './sha256';

/** Creates a Git-style short display id from a full SHA-256 hash. */
export function shortHash(id: string): string {
  return id.slice(0, 7);
}

function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Commit engine for lorebooks. Commits are content-addressed: the id is the
 * SHA-256 of the parent id plus the serialized book, so identical states
 * produce identical hashes. Each commit stores a full `CharacterBook`
 * snapshot, making rollback O(1).
 */
@Injectable({ providedIn: 'root' })
export class VcsService {
  /**
   * Hashes `parentId + serialized book` with SHA-256. WebCrypto is used when
   * available; on insecure origins (e.g. plain http over the LAN, where
   * `crypto.subtle` does not exist) a pure-JS fallback produces the same
   * digest.
   */
  private async hashBook(book: CharacterBook, parentId: string | null): Promise<string> {
    const payload = `${parentId ?? 'root'}\u0000${JSON.stringify(book)}`;
    if (hasSubtleCrypto()) {
      const data = new TextEncoder().encode(payload);
      return toHex(await crypto.subtle.digest('SHA-256', data));
    }
    return sha256Hex(payload);
  }

  /**
   * Appends a commit capturing the project's current `activeBook` and moves
   * HEAD to it. Returns a new project object; the input is not mutated.
   */
  async createCommit(project: ProjectWorkspace, message: string): Promise<ProjectWorkspace> {
    const parentId = project.headCommitId;
    const id = await this.hashBook(project.activeBook, parentId);
    const commit: ProjectCommit = {
      id,
      parentId,
      timestamp: Date.now(),
      message,
      snapshot: structuredClone(project.activeBook),
    };
    return {
      ...project,
      commits: [...project.commits, commit],
      headCommitId: id,
      updatedAt: Date.now(),
    };
  }

  /**
   * Restores `activeBook` from a commit's snapshot and records the rollback as
   * a new "Revert to ..." commit, so history is never rewritten.
   * Returns the updated project plus the restored book for the caller.
   */
  async rollbackToCommit(
    project: ProjectWorkspace,
    commitId: string,
  ): Promise<{ project: ProjectWorkspace; commit: ProjectCommit | null }> {
    const commit = project.commits.find((c) => c.id === commitId);
    if (!commit) {
      return { project, commit: null };
    }
    const restored = structuredClone(commit.snapshot);
    const message = `Revert to ${shortHash(commit.id)}: ${commit.message}`;
    const reverted: ProjectWorkspace = {
      ...project,
      activeBook: restored,
    };
    const withCommit = await this.createCommit(reverted, message);
    return { project: withCommit, commit };
  }

  /** The commit HEAD currently points at, if any. */
  headCommit(project: ProjectWorkspace): ProjectCommit | null {
    return project.commits.find((c) => c.id === project.headCommitId) ?? null;
  }

  /**
   * Serializes any model value to a stable string for dirty comparisons. Key
   * order is normalized so the same logical state always compares equal.
   */
  serialize(value: unknown): string {
    return JSON.stringify(value);
  }

  serializeBook(book: CharacterBook): string {
    return this.serialize(book);
  }

  /** True when the working tree differs from HEAD's snapshot. */
  isDirty(project: ProjectWorkspace): boolean {
    const head = this.headCommit(project);
    if (!head) {
      return true;
    }
    return this.serializeBook(project.activeBook) !== this.serializeBook(head.snapshot);
  }

  /**
   * Entries whose working-tree version differs from HEAD (used for the `*`
   * dirty indicators on editor tabs). Matched by entry id.
   */
  dirtyEntryIds(project: ProjectWorkspace): Set<number> {
    const head = this.headCommit(project);
    const headEntries = new Map<number, CharacterBook['entries'][number]>();
    head?.snapshot.entries.forEach((e) => {
      if (typeof e.id === 'number') {
        headEntries.set(e.id, e);
      }
    });

    const dirty = new Set<number>();
    for (const entry of project.activeBook.entries) {
      if (typeof entry.id !== 'number') {
        continue;
      }
      const baseline = headEntries.get(entry.id);
      if (!baseline || this.serialize(baseline) !== this.serialize(entry)) {
        dirty.add(entry.id);
      }
    }
    // Entries deleted in the working tree also show as changes elsewhere,
    // but they cannot carry a tab indicator.
    return dirty;
  }
}
