/**
 * Cross-runtime helpers that smooth over the small bun:sqlite ↔ better-sqlite3
 * API differences without leaking either library into call sites.
 */

import type { Database } from "./sqlite";

export function finalizeQuietly(statement: unknown): void {
    try {
        (statement as { finalize?: () => void } | null | undefined)?.finalize?.();
    } catch {
        // intentional: caller wants quiet finalize
    }
}

function settleBunSqliteClose(): void {
    const bun = (globalThis as { Bun?: { gc?: (force?: boolean) => void } }).Bun;
    if (!bun?.gc) return;
    bun.gc(true);
    if (process.platform === "win32") {
        // Bun releases some SQLite transaction handles on the next tick; on
        // Windows an immediate recursive rm can otherwise see EBUSY.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        bun.gc(true);
    }
}

/**
 * Close a database, ignoring errors.
 *
 * bun:sqlite supports `db.close(throwOnError = false)`. better-sqlite3 has
 * only `db.close()` and throws on already-closed databases. This helper
 * mirrors the bun "swallow errors" semantics for both runtimes — useful in
 * test teardown and `finally` blocks where the caller doesn't care whether
 * the close succeeded.
 */
export function closeQuietly(db: Database | null | undefined): void {
    if (!db) return;
    // Just attempt close and swallow errors. bun:sqlite can leave handles open
    // when statements are still live unless throwOnError=false is passed.
    // better-sqlite3 throws TypeError on already-closed databases — both are
    // handled by the bare try/catch.
    try {
        try {
            db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        } catch {
            // Not every DB is writable or even open; close is still attempted.
        }
        if (typeof process.versions?.bun === "string") {
            (db as unknown as { close: (throwOnError?: boolean) => void }).close(false);
            settleBunSqliteClose();
        } else {
            db.close();
        }
    } catch {
        // intentional: caller wants quiet close
    }
}
