import { Service } from '@angular/core';
import type { CharacterBook, CharacterBookEntry } from '../models/lorebook.model';
import type { ProjectCommit, ProjectWorkspace } from '../models/project.model';
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  // Only reorder plain objects; class instances, Dates, Maps etc. keep the
  // JSON.stringify semantics of the raw value.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Rebuilds plain objects with lexicographically sorted keys so JSON output
 * never depends on key insertion order; array order is preserved. Unknown
 * vendor values pass through untouched.
 */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (isPlainRecord(value)) {
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      canonical[key] = canonicalJson(value[key]);
    }
    return canonical;
  }
  return value;
}

/**
 * Memo of canonical serializations, keyed by object identity. Correct only
 * under the app-wide immutable-update invariant: model values (books,
 * entries) are never mutated in place — every change produces new object
 * references with structural sharing for untouched parts — so an object's
 * canonical serialization can never change over its lifetime. Dirty tracking
 * (`isDirty`, `dirtyEntryIds`) runs inside `computed()` signal graphs and
 * re-serializes the HEAD snapshot and every unchanged entry on each
 * working-tree change (per keystroke); the memo reduces that to one full
 * serialization per actually-changed object. Observationally pure: same
 * input value → same output string, no I/O.
 */
const canonicalSerializations = new WeakMap<object, string>();

/**
 * Commit engine for lorebooks. Commits are content-addressed: the id is the
 * SHA-256 of the parent id plus the serialized book, so identical states
 * produce identical hashes. Each commit stores a full `CharacterBook`
 * snapshot, making rollback O(1).
 */
@Service()
export class VcsService {
  /**
   * Hashes `parentId + serialized book` with SHA-256. WebCrypto is used when
   * available; on insecure origins (e.g. plain http over the LAN, where
   * `crypto.subtle` does not exist) a pure-JS fallback produces the same
   * digest.
   */
  private async hashBook(book: CharacterBook, parentId: string | null): Promise<string> {
    const payload = `${parentId ?? 'root'}\u0000${JSON.stringify(canonicalJson(book))}`;
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
   * Serializes any model value to a stable string for dirty comparisons. Keys
   * are recursively sorted (array order preserved) so the same logical state
   * always compares equal, regardless of insertion order. Object results are
   * memoized by identity (see `canonicalSerializations`); primitives cannot
   * be WeakMap keys and skip the memo.
   */
  serialize(value: unknown): string {
    if (typeof value !== 'object' || value === null) {
      return JSON.stringify(canonicalJson(value));
    }
    let serialized = canonicalSerializations.get(value);
    if (serialized === undefined) {
      serialized = JSON.stringify(canonicalJson(value));
      canonicalSerializations.set(value, serialized);
    }
    return serialized;
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
    const headEntries = new Map<number, CharacterBookEntry>();
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
