/**
 * Public API for the post-lifecycle module.
 *
 * Consumers should import from here, not from individual files:
 *   import { createDraftPost, transition, Reconciler } from '@/lib/post-lifecycle';
 */

export {
  PostId,
  ImageBlobId,
  InvalidTransitionError,
  AtomicityViolationError,
} from './types';

export type {
  PostId as PostIdType,
  ImageBlobId as ImageBlobIdType,
  PostRecord,
  PostState,
  PostFailureReason,
  Platform,
  ImageBlob,
  StateTransition,
} from './types';

export {
  canTransition,
  transition,
  isRetryable,
  isExhausted,
  nextRetryDelay,
  createDraftPost,
} from './state-machine';

export type { TransitionOptions } from './state-machine';

export type { PostLifecycleStorage } from './persistence';
export { InMemoryStorage } from './persistence';

export { Reconciler } from './reconciler';
export type { ReconcileResult } from './reconciler';

// ── Storage backends ─────────────────────────────────────────────────────
//
// Two production backends and one test backend are exported here. The
// IndexedDB backend is for the web surface (Next.js / PWA). The SQLite
// backend is for the Tauri desktop surface. The in-memory backend in
// `persistence.ts` is for unit tests of the state machine itself —
// storage-level tests use the IndexedDB or SQLite backends via their
// own in-memory mock drivers (fake-indexeddb, better-sqlite3).

export { IdbPostLifecycleStorage } from './storage/idb';
export type { IdbDriver, IdbWriteTx } from './storage/idb';

export { TauriSqliteStorage } from './storage/tauri-sqlite';
export type { SqliteDriver, SqliteTxDriver } from './storage/tauri-sqlite';

export { TauriSqliteDriver } from './storage/tauri-driver';
export { BetterSqlite3Driver } from './storage/better-sqlite3-driver';
