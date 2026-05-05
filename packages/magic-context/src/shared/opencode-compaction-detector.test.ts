import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isOpenCodeAutoCompactionEnabled } from "./opencode-compaction-detector";
import * as configDir from "./opencode-config-dir";

describe("opencode-compaction-detector", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = join("/tmp", `compaction-detector-test-${Date.now()}`);
        mkdirSync(join(tmpDir, ".kilo"), { recursive: true });
        delete process.env.KILO_DISABLE_AUTOCOMPACT;
        spyOn(configDir, "getOpenCodeConfigPaths").mockReturnValue({
            configJson: join(tmpDir, "user-config", "kilo.json"),
            configJsonc: join(tmpDir, "user-config", "kilo.jsonc"),
        } as ReturnType<typeof configDir.getOpenCodeConfigPaths>);
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.KILO_DISABLE_AUTOCOMPACT;
    });

    describe("#given no config exists", () => {
        it("#then returns true (default: compaction enabled)", () => {
            const emptyDir = join("/tmp", `compaction-empty-${Date.now()}`);
            mkdirSync(emptyDir, { recursive: true });

            const result = isOpenCodeAutoCompactionEnabled(emptyDir);

            expect(result).toBe(true);
            rmSync(emptyDir, { recursive: true, force: true });
        });
    });

    describe("#given KILO_DISABLE_AUTOCOMPACT env flag is set", () => {
        it("#then returns false", () => {
            process.env.KILO_DISABLE_AUTOCOMPACT = "1";

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });
    });

    describe("#given project config has compaction.auto = false", () => {
        it("#when kilo.json #then returns false", () => {
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ compaction: { auto: false } }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });

        it("#when kilo.jsonc #then returns false", () => {
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.jsonc"),
                `{
          // compaction disabled
          "compaction": { "auto": false }
        }`,
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });
    });

    describe("#given project config has compaction.auto = true", () => {
        it("#then returns true", () => {
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ compaction: { auto: true } }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(true);
        });
    });

    describe("#given project config has compaction.prune = true", () => {
        it("#then returns true (conflict enabled)", () => {
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ compaction: { auto: false, prune: true } }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(true);
        });
    });

    describe("#given project config has auto/prune both false", () => {
        it("#then returns false", () => {
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ compaction: { auto: false, prune: false } }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });
    });

    describe("#given project config has only compaction.prune = false", () => {
        it("#then returns false", () => {
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ compaction: { prune: false } }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });
    });

    describe("#given jsonc and json both exist", () => {
        it("#then jsonc takes precedence", () => {
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ compaction: { auto: true } }),
            );
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.jsonc"),
                `{ "compaction": { "auto": false } }`,
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });
    });

    describe("#given config exists but no compaction field", () => {
        it("#then returns true (default)", () => {
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ model: "claude-opus-4-6" }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(true);
        });
    });

    describe("#given env flag overrides config", () => {
        it("#then env flag wins even when config has auto: true", () => {
            process.env.KILO_DISABLE_AUTOCOMPACT = "true";
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ compaction: { auto: true } }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });
    });

    describe("#given root-level project config", () => {
        it("#when root kilo.json has compaction.auto = false #then returns false", () => {
            writeFileSync(
                join(tmpDir, "kilo.json"),
                JSON.stringify({ compaction: { auto: false } }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });

        it("#when root kilo.jsonc has compaction.auto = false #then returns false", () => {
            writeFileSync(join(tmpDir, "kilo.jsonc"), `{ "compaction": { "auto": false } }`);

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });
    });

    describe("#given .kilo/ overrides root-level config", () => {
        it("#when root says false but .kilo says true #then .kilo wins", () => {
            writeFileSync(
                join(tmpDir, "kilo.json"),
                JSON.stringify({ compaction: { auto: false } }),
            );
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ compaction: { auto: true } }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(true);
        });

        it("#when root says true but .kilo says false #then .kilo wins", () => {
            writeFileSync(
                join(tmpDir, "kilo.json"),
                JSON.stringify({ compaction: { auto: true } }),
            );
            writeFileSync(
                join(tmpDir, ".kilo", "kilo.json"),
                JSON.stringify({ compaction: { auto: false } }),
            );

            const result = isOpenCodeAutoCompactionEnabled(tmpDir);

            expect(result).toBe(false);
        });
    });
});
