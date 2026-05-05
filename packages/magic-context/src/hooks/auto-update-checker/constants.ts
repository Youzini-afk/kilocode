import { join } from "node:path";
import { getKiloCacheDir, getKiloConfigDir } from "../../shared/data-path";

export const PACKAGE_NAME = "kilocode-magic-context";
export const NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const NPM_FETCH_TIMEOUT = 10_000;

/** Root directory Kilo uses for cached npm plugin wrapper installs. */
export const CACHE_DIR = join(getKiloCacheDir(), "packages");

/** Primary Kilo configuration file path (standard JSON). */
export const USER_KILO_CONFIG = join(getKiloConfigDir(), "kilo.json");

/** Alternative Kilo configuration file path (JSON with Comments). */
export const USER_KILO_CONFIG_JSONC = join(getKiloConfigDir(), "kilo.jsonc");
