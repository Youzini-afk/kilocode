import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import {
    getCacheDir,
    getDataDir,
    getLegacyOpenCodeMagicContextStorageDir,
    getLegacyOpenCodeStoragePluginDir,
    getKiloCacheDir,
    getKiloStorageDir,
    getMagicContextStorageDir,
} from "./data-path";

const savedEnv = {
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    APPDATA: process.env.APPDATA,
    KILO_CONFIG_DIR: process.env.KILO_CONFIG_DIR,
    KILO_TEST_HOME: process.env.KILO_TEST_HOME,
};

describe("data-path", () => {
    beforeEach(() => {
        process.env.XDG_CACHE_HOME = undefined;
        process.env.XDG_DATA_HOME = undefined;
        process.env.LOCALAPPDATA = undefined;
        process.env.APPDATA = undefined;
        process.env.KILO_CONFIG_DIR = undefined;
        process.env.KILO_TEST_HOME = undefined;
        // Bun's env handling: explicit delete for unset
        delete process.env.XDG_CACHE_HOME;
        delete process.env.XDG_DATA_HOME;
        delete process.env.LOCALAPPDATA;
        delete process.env.APPDATA;
        delete process.env.KILO_CONFIG_DIR;
        delete process.env.KILO_TEST_HOME;
    });

    afterEach(() => {
        if (savedEnv.XDG_CACHE_HOME !== undefined)
            process.env.XDG_CACHE_HOME = savedEnv.XDG_CACHE_HOME;
        if (savedEnv.XDG_DATA_HOME !== undefined)
            process.env.XDG_DATA_HOME = savedEnv.XDG_DATA_HOME;
        if (savedEnv.LOCALAPPDATA !== undefined) process.env.LOCALAPPDATA = savedEnv.LOCALAPPDATA;
        if (savedEnv.APPDATA !== undefined) process.env.APPDATA = savedEnv.APPDATA;
        if (savedEnv.KILO_CONFIG_DIR !== undefined)
            process.env.KILO_CONFIG_DIR = savedEnv.KILO_CONFIG_DIR;
        if (savedEnv.KILO_TEST_HOME !== undefined)
            process.env.KILO_TEST_HOME = savedEnv.KILO_TEST_HOME;
    });

    test("getCacheDir falls back to <homedir>/.cache when XDG_CACHE_HOME is unset (all platforms)", () => {
        // Matches Kilo's xdg-basedir-style fallback when no platform override
        // is present.
        // Windows. A previous bug mapped Windows to %LOCALAPPDATA% and caused
        // doctor --force to target a non-existent cache directory.
        expect(getCacheDir()).toBe(path.join(os.homedir(), ".cache"));
    });

    test("getCacheDir honors XDG_CACHE_HOME when set", () => {
        process.env.XDG_CACHE_HOME = "/tmp/custom-cache";
        expect(getCacheDir()).toBe("/tmp/custom-cache");
    });

    test("getCacheDir honors LOCALAPPDATA when XDG_CACHE_HOME is unset", () => {
        process.env.LOCALAPPDATA = "C:\\Users\\Test\\AppData\\Local";
        expect(getCacheDir()).toBe("C:\\Users\\Test\\AppData\\Local");
    });

    test("getKiloCacheDir appends 'kilo' to the cache base", () => {
        expect(getKiloCacheDir()).toBe(path.join(os.homedir(), ".cache", "kilo"));
    });

    test("getKiloCacheDir with XDG_CACHE_HOME set", () => {
        process.env.XDG_CACHE_HOME = "/tmp/custom-cache";
        expect(getKiloCacheDir()).toBe(path.join("/tmp/custom-cache", "kilo"));
    });

    test("getDataDir falls back to <homedir>/.local/share when XDG_DATA_HOME is unset", () => {
        expect(getDataDir()).toBe(path.join(os.homedir(), ".local", "share"));
    });

    test("getKiloStorageDir composes correctly", () => {
        expect(getKiloStorageDir()).toBe(path.join(os.homedir(), ".local", "share", "kilo", "storage"));
    });

    test("getMagicContextStorageDir uses Kilo plugin layout", () => {
        expect(getMagicContextStorageDir()).toBe(
            path.join(
                os.homedir(),
                ".local",
                "share",
                "kilo",
                "storage",
                "plugin",
                "kilocode-magic-context",
            ),
        );
    });

    test("getMagicContextStorageDir honors XDG_DATA_HOME", () => {
        process.env.XDG_DATA_HOME = "/tmp/custom-data";
        expect(getMagicContextStorageDir()).toBe(
            path.join("/tmp/custom-data", "kilo", "storage", "plugin", "kilocode-magic-context"),
        );
    });

    test("legacy helpers point at old OpenCode locations for explicit import", () => {
        expect(getLegacyOpenCodeMagicContextStorageDir()).toBe(
            path.join(os.homedir(), ".local", "share", "cortexkit", "magic-context"),
        );
        expect(getLegacyOpenCodeStoragePluginDir()).toBe(
            path.join(os.homedir(), ".local", "share", "opencode", "storage", "plugin", "magic-context"),
        );
    });

    test("legacy storage dir distinct from new shared dir even with same XDG override", () => {
        // Sanity check: even when XDG_DATA_HOME points the same place, the two
        // resolvers must return different paths so the migration copy doesn't
        // self-overwrite.
        process.env.XDG_DATA_HOME = "/tmp/test-xdg";
        const legacy = getLegacyOpenCodeMagicContextStorageDir();
        const kilo = getMagicContextStorageDir();
        expect(legacy).not.toBe(kilo);
        expect(legacy).toContain("cortexkit");
        expect(kilo).toContain("kilo");
    });
});
