import type { Config } from "@kilocode/sdk/v2/client"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function mergePatch(base: unknown, patch: unknown): unknown {
  if (patch === null || patch === undefined) return undefined
  if (!isRecord(patch)) return patch
  const result: Record<string, unknown> = isRecord(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(patch)) {
    const merged = mergePatch(result[key], value)
    if (merged === undefined) delete result[key]
    else result[key] = merged
  }
  return result
}

export function mergeConfigPatches(base: unknown, ...patches: Array<Partial<Config>>): Config {
  let result: unknown = isRecord(base) ? base : {}
  for (const patch of patches) result = mergePatch(result, patch)
  return (isRecord(result) ? result : {}) as Config
}
