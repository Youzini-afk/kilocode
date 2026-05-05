import { join } from "node:path";
import { readJsoncFile } from "./jsonc-parser";
import { log } from "./logger";
import { getOpenCodeConfigPaths } from "./opencode-config-dir";

interface KiloConfig {
    compaction?: {
        auto?: boolean;
        prune?: boolean;
    };
}

function hasCompactionConflict(
    compaction: KiloConfig["compaction"] | undefined,
): boolean | undefined {
    if (!compaction) return undefined;
    const hasExplicitSetting = compaction.auto !== undefined || compaction.prune !== undefined;
    if (!hasExplicitSetting) return undefined;
    return compaction.auto === true || compaction.prune === true;
}

export function isOpenCodeAutoCompactionEnabled(directory: string): boolean {
    if (process.env.KILO_DISABLE_AUTOCOMPACT) {
        log(
            "[compaction-detector] KILO_DISABLE_AUTOCOMPACT env flag set — auto compaction disabled",
        );
        return false;
    }

    const projectCompaction = readProjectCompactionConfig(directory);
    if (projectCompaction !== undefined) {
        log("[compaction-detector] project config compaction conflict =", projectCompaction);
        return projectCompaction;
    }

    const userCompaction = readUserCompactionConfig(directory);
    if (userCompaction !== undefined) {
        log("[compaction-detector] user config compaction conflict =", userCompaction);
        return userCompaction;
    }

    log("[compaction-detector] no compaction config found — default is enabled");
    return true;
}

function readProjectCompactionConfig(directory: string): boolean | undefined {
    // .kilo/.kilocode dir config has higher precedence than root-level config in Kilo's loading order.
    const dotOpenCodeJsonc = join(directory, ".kilo", "kilo.jsonc");
    const dotOpenCodeJson = join(directory, ".kilo", "kilo.json");
    const dotOpenCodeConfig =
        readJsoncFile<KiloConfig>(dotOpenCodeJsonc) ??
        readJsoncFile<KiloConfig>(dotOpenCodeJson) ??
        readJsoncFile<KiloConfig>(join(directory, ".kilocode", "kilo.jsonc")) ??
        readJsoncFile<KiloConfig>(join(directory, ".kilocode", "kilo.json"));

    const dotOpenCodeCompactionConflict = hasCompactionConflict(dotOpenCodeConfig?.compaction);
    if (dotOpenCodeCompactionConflict !== undefined) {
        return dotOpenCodeCompactionConflict;
    }

    // Root-level project config (lower precedence than .opencode/)
    const rootJsonc = join(directory, "kilo.jsonc");
    const rootJson = join(directory, "kilo.json");
    const rootConfig =
        readJsoncFile<KiloConfig>(rootJsonc) ?? readJsoncFile<KiloConfig>(rootJson);

    return hasCompactionConflict(rootConfig?.compaction);
}

function readUserCompactionConfig(_directory: string): boolean | undefined {
    try {
        const paths = getOpenCodeConfigPaths({ binary: "opencode" });
        const config =
            readJsoncFile<KiloConfig>(paths.configJsonc) ??
            readJsoncFile<KiloConfig>(paths.configJson);

        return hasCompactionConflict(config?.compaction);
    } catch {
        // Intentional: config read is best-effort; missing/unreadable config is not an error
        return undefined;
    }
}
