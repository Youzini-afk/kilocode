import * as os from "node:os";
import * as path from "node:path";

export interface KiloRuntimeInfo {
    app?: string;
    paths?: {
        config?: string;
        data?: string;
        cache?: string;
        state?: string;
        log?: string;
    };
    database?: {
        path?: string;
    };
}

let runtimeInfo: KiloRuntimeInfo | undefined;

export function setKiloRuntimeInfo(input: unknown): void {
    if (!input || typeof input !== "object") return;
    const candidate = input as { experimental_runtime?: KiloRuntimeInfo };
    runtimeInfo = candidate.experimental_runtime;
}

function cleanPath(value: string | undefined): string | undefined {
    return value?.replace(/[\r\n]+/g, "");
}

function homeDir(): string {
    return cleanPath(process.env.KILO_TEST_HOME) ?? os.homedir();
}

export function getDataDir(): string {
    return (
        cleanPath(process.env.XDG_DATA_HOME) ??
        cleanPath(process.env.LOCALAPPDATA) ??
        path.join(homeDir(), ".local", "share")
    );
}

export function getConfigDir(): string {
    return (
        cleanPath(process.env.XDG_CONFIG_HOME) ??
        cleanPath(process.env.APPDATA) ??
        path.join(homeDir(), ".config")
    );
}

export function getCacheDir(): string {
    return (
        cleanPath(process.env.XDG_CACHE_HOME) ??
        cleanPath(process.env.LOCALAPPDATA) ??
        path.join(homeDir(), ".cache")
    );
}

export function getStateDir(): string {
    return cleanPath(process.env.XDG_STATE_HOME) ?? path.join(homeDir(), ".local", "state");
}

export function getKiloDataDir(): string {
    return runtimeInfo?.paths?.data ?? path.join(getDataDir(), "kilo");
}

export function getKiloConfigDir(): string {
    return cleanPath(process.env.KILO_CONFIG_DIR) ?? runtimeInfo?.paths?.config ?? path.join(getConfigDir(), "kilo");
}

export function getKiloCacheDir(): string {
    return runtimeInfo?.paths?.cache ?? path.join(getCacheDir(), "kilo");
}

export function getKiloStateDir(): string {
    return runtimeInfo?.paths?.state ?? path.join(getStateDir(), "kilo");
}

export function getKiloLogDir(): string {
    return runtimeInfo?.paths?.log ?? path.join(getKiloDataDir(), "log");
}

export function getKiloDbPath(): string {
    const explicit = process.env.KILO_DB?.trim();
    if (explicit) {
        if (explicit === ":memory:" || path.isAbsolute(explicit)) return explicit;
        return path.join(getKiloDataDir(), explicit);
    }
    return runtimeInfo?.database?.path ?? path.join(getKiloDataDir(), "kilo.db");
}

export function getKiloStorageDir(): string {
    return path.join(getKiloDataDir(), "storage");
}

/**
 * Resolve Kilo Magic Context's storage directory.
 *
 * Kilo data intentionally does not share the original OpenCode/Pi
 * cortexkit/magic-context database. Users can run the explicit migration CLI
 * when they want to import an older OpenCode database.
 *
 * Layout: <Kilo data>/storage/plugin/kilocode-magic-context/
 */
export function getMagicContextStorageDir(): string {
    return path.join(getKiloStorageDir(), "plugin", "kilocode-magic-context");
}

/**
 * Legacy magic-context storage directory used by the OpenCode plugin before the
 * shared cortexkit path. Used only for one-time migration of existing data into
 * the new shared location. The legacy directory is left in place after copy so
 * users can roll back if needed; manual cleanup is safe after one stable
 * release.
 */
export function getLegacyOpenCodeMagicContextStorageDir(): string {
    return path.join(getDataDir(), "cortexkit", "magic-context");
}

export function getLegacyOpenCodeStoragePluginDir(): string {
    return path.join(getDataDir(), "opencode", "storage", "plugin", "magic-context");
}
