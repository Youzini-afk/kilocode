import { join, resolve } from "node:path";

import type { OpenCodeConfigDirOptions, OpenCodeConfigPaths } from "./opencode-config-dir-types";
import { getKiloConfigDir } from "./data-path";

export type {
    OpenCodeBinaryType,
    OpenCodeConfigDirOptions,
    OpenCodeConfigPaths,
} from "./opencode-config-dir-types";

function getCliConfigDir(): string {
    const envConfigDir = process.env.KILO_CONFIG_DIR?.trim();
    if (envConfigDir) {
        return resolve(envConfigDir);
    }

    return getKiloConfigDir();
}

export function getOpenCodeConfigDir(_options: OpenCodeConfigDirOptions): string {
    return getCliConfigDir();
}

export function getOpenCodeConfigPaths(options: OpenCodeConfigDirOptions): OpenCodeConfigPaths {
    const configDir = getOpenCodeConfigDir(options);
    return {
        configDir,
        configJson: join(configDir, "kilo.json"),
        configJsonc: join(configDir, "kilo.jsonc"),
        packageJson: join(configDir, "package.json"),
        omoConfig: join(configDir, "kilo-magic-context.jsonc"),
    };
}
