import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
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

function upstreamDbPath(root: string): string {
    return join(root, "cortexkit", "magic-context", "context.db");
}

function createDb(file: string, marker: string): void {
    mkdirSync(dirname(file), { recursive: true });
    const db = new Database(file);
    db.run("CREATE TABLE source_marker (which TEXT)");
    db.run("INSERT INTO source_marker VALUES (?)", marker);
    closeQuietly(db);
}

function marker(db: Database): string {
    const row = db.prepare("SELECT which FROM source_marker").get() as { which: string };
    return row.which;
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

    test("imports a legacy OpenCode plugin DB on startup", () => {
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
        expect(migratedRows).toEqual([{ name: "migration_canary" }]);

        const rows = db.prepare("SELECT payload FROM migration_canary").all() as Array<{
            payload: string;
        }>;
        expect(rows).toEqual([{ payload: "legacy-data" }]);
    });

    test("imports an upstream shared DB on startup", () => {
        const src = upstreamDbPath(tmpRoot);
        createDb(src, "upstream");

        const db = openDatabase();
        expect(existsSync(kiloDbPath(tmpRoot))).toBe(true);
        expect(existsSync(src)).toBe(true);
        expect(marker(db)).toBe("upstream");
    });

    test("keeps an existing Kilo DB even if a legacy OpenCode DB is present", () => {
        createDb(kiloDbPath(tmpRoot), "kilo");
        createDb(legacyOpenCodeDbPath(tmpRoot), "opencode");

        const db = openDatabase();
        expect(marker(db)).toBe("kilo");
    });

    test("imports upstream shared DB before legacy OpenCode plugin DB", () => {
        createDb(upstreamDbPath(tmpRoot), "upstream");
        createDb(legacyOpenCodeDbPath(tmpRoot), "opencode");

        const db = openDatabase();
        expect(marker(db)).toBe("upstream");
    });

    test("copies wal, shm, and models while leaving source files in place", () => {
        const src = upstreamDbPath(tmpRoot);
        mkdirSync(dirname(src), { recursive: true });
        const source = new Database(src);
        try {
            source.exec("PRAGMA journal_mode=WAL");
            source.run("CREATE TABLE source_marker (which TEXT)");
            source.run("INSERT INTO source_marker VALUES ('upstream')");
            expect(existsSync(`${src}-wal`)).toBe(true);
            expect(existsSync(`${src}-shm`)).toBe(true);
            const models = join(dirname(src), "models");
            mkdirSync(models, { recursive: true });
            writeFileSync(join(models, "model.bin"), "model-data");

            const db = openDatabase();
            expect(marker(db)).toBe("upstream");

            const dst = kiloDbPath(tmpRoot);
            expect(existsSync(`${dst}-wal`)).toBe(true);
            expect(existsSync(`${dst}-shm`)).toBe(true);
            expect(readFileSync(join(dirname(dst), "models", "model.bin"), "utf8")).toBe(
                "model-data",
            );
            expect(existsSync(src)).toBe(true);
            expect(existsSync(`${src}-wal`)).toBe(true);
            expect(existsSync(`${src}-shm`)).toBe(true);
            expect(existsSync(join(models, "model.bin"))).toBe(true);
        } finally {
            closeQuietly(source);
        }
    });

    test("does not overwrite existing target models when importing", () => {
        const src = upstreamDbPath(tmpRoot);
        createDb(src, "upstream");
        const from = join(dirname(src), "models");
        mkdirSync(from, { recursive: true });
        writeFileSync(join(from, "model.bin"), "source-model");

        const to = join(dirname(kiloDbPath(tmpRoot)), "models");
        mkdirSync(to, { recursive: true });
        writeFileSync(join(to, "model.bin"), "target-model");

        const db = openDatabase();
        expect(marker(db)).toBe("upstream");
        expect(readFileSync(join(to, "model.bin"), "utf8")).toBe("target-model");
    });
});
