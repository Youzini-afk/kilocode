import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import { dirname, join } from "node:path";
import { Database } from "../../shared/sqlite";
import { closeQuietly } from "../../shared/sqlite-helpers";
import { closeDatabase, openDatabase } from "./storage-db";

function kiloDbPath(root: string): string {
    return join(root, "kilo", "storage", "plugin", "kilocode-magic-context", "context.db");
}

function legacyOpenCodeDbPath(root: string): string {
    return join(root, "opencode", "storage", "plugin", "magic-context", "context.db");
}

describe("storage-db Kilo isolation", () => {
    let tmpRoot: string;
    let savedXdg: string | undefined;

    beforeEach(() => {
        tmpRoot = mkdtempSync(join(os.tmpdir(), "magic-context-kilo-storage-test-"));
        savedXdg = process.env.XDG_DATA_HOME;
        process.env.XDG_DATA_HOME = tmpRoot;
        closeDatabase();
    });

    afterEach(() => {
        closeDatabase();
        if (savedXdg !== undefined) {
            process.env.XDG_DATA_HOME = savedXdg;
        } else {
            delete process.env.XDG_DATA_HOME;
        }
        rmSync(tmpRoot, { recursive: true, force: true });
    });

    test("opens fresh DB at the Kilo-native plugin storage path", () => {
        const db = openDatabase();
        expect(db).toBeDefined();
        expect(existsSync(kiloDbPath(tmpRoot))).toBe(true);

        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all() as Array<{ name: string }>;
        const tableNames = new Set(tables.map((t) => t.name));
        expect(tableNames.has("tags")).toBe(true);
        expect(tableNames.has("memories")).toBe(true);
        expect(tableNames.has("compartments")).toBe(true);
    });

    test("does not automatically import an OpenCode plugin DB on startup", () => {
        const legacyDbPath = legacyOpenCodeDbPath(tmpRoot);
        mkdirSync(dirname(legacyDbPath), { recursive: true });
        const legacy = new Database(legacyDbPath);
        legacy.run("CREATE TABLE migration_canary (id INTEGER PRIMARY KEY, payload TEXT)");
        legacy.run("INSERT INTO migration_canary (payload) VALUES ('legacy-data')");
        closeQuietly(legacy);

        const db = openDatabase();
        expect(existsSync(kiloDbPath(tmpRoot))).toBe(true);
        expect(existsSync(legacyDbPath)).toBe(true);

        const migratedRows = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migration_canary'")
            .all();
        expect(migratedRows).toEqual([]);
    });

    test("keeps an existing Kilo DB even if a legacy OpenCode DB is present", () => {
        const activeDbPath = kiloDbPath(tmpRoot);
        mkdirSync(dirname(activeDbPath), { recursive: true });
        const active = new Database(activeDbPath);
        active.run("CREATE TABLE source_marker (which TEXT)");
        active.run("INSERT INTO source_marker VALUES ('kilo')");
        closeQuietly(active);

        const legacyDbPath = legacyOpenCodeDbPath(tmpRoot);
        mkdirSync(dirname(legacyDbPath), { recursive: true });
        const legacy = new Database(legacyDbPath);
        legacy.run("CREATE TABLE source_marker (which TEXT)");
        legacy.run("INSERT INTO source_marker VALUES ('opencode')");
        closeQuietly(legacy);

        const db = openDatabase();
        const rows = db.prepare("SELECT which FROM source_marker").all() as Array<{
            which: string;
        }>;
        expect(rows).toEqual([{ which: "kilo" }]);
    });
});
