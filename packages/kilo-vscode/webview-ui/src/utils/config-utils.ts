import type { Config } from "../types/messages"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** Deep merge two objects, with source values overriding target values. */
export function deepMerge(target: Config, source: Partial<Config>): Config {
  const result: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key] as Config, value as Partial<Config>)
    } else {
      result[key] = value
    }
  }
  return result as Config
}

/** Recursively remove keys whose value is null (null = "deleted"). */
export function stripNulls(obj: Config): Config {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (isRecord(value)) {
      result[key] = stripNulls(value as Config)
    } else {
      result[key] = value
    }
  }
  return result as Config
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => valuesEqual(item, b[index]))
  }
  if (isRecord(a) || isRecord(b)) {
    if (!isRecord(a) || !isRecord(b)) return false
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && valuesEqual(a[key], b[key]))
  }
  return false
}

/**
 * Remove only the draft values that were part of a confirmed save.
 *
 * Edits made while saveConfig() is in-flight must remain dirty after the
 * backend acknowledges the older save; otherwise the UI appears to ignore
 * changes made immediately after the first save started.
 */
export function removeMatchingDraft(current: Partial<Config>, confirmed: Partial<Config>): Partial<Config> {
  const result: Record<string, unknown> = {}
  const confirmedRecord = confirmed as Record<string, unknown>

  for (const [key, currentValue] of Object.entries(current)) {
    if (!Object.prototype.hasOwnProperty.call(confirmedRecord, key)) {
      result[key] = currentValue
      continue
    }

    const confirmedValue = confirmedRecord[key]
    if (isRecord(currentValue) && isRecord(confirmedValue)) {
      const child = removeMatchingDraft(currentValue as Partial<Config>, confirmedValue as Partial<Config>)
      if (Object.keys(child).length > 0) result[key] = child
      continue
    }

    if (!valuesEqual(currentValue, confirmedValue)) result[key] = currentValue
  }

  return result as Partial<Config>
}

/**
 * Resolve the visible config when a configLoaded/configUpdated message arrives.
 * If the user has pending draft changes, re-apply the draft on top of the
 * incoming server config so pending toggles don't snap back.
 */
export function resolveConfig(server: Config, draft: Partial<Config>, dirty: boolean): Config {
  if (dirty) return stripNulls(deepMerge(server, draft))
  return server
}

/**
 * Plain-object config state machine — mirrors the SolidJS ConfigProvider
 * logic without signals so the message-handling behavior is unit-testable.
 */
export class ConfigState {
  config: Config = {}
  saved: Config = {}
  draft: Partial<Config> = {}
  savingDraft: Partial<Config> = {}
  dirty = false
  saving = false
  loading = true

  /** Accumulate a partial change (same as the toggle click path). */
  updateConfig(partial: Partial<Config>) {
    this.config = stripNulls(deepMerge(this.config, partial))
    this.draft = deepMerge(this.draft as Config, partial)
    this.dirty = true
  }

  /** Handle an incoming configLoaded push from the extension. */
  handleConfigLoaded(server: Config) {
    if (this.saving) return
    this.config = resolveConfig(server, this.draft, this.dirty)
    this.saved = server
    this.loading = false
  }

  /** Handle an incoming configUpdated push from the extension. */
  handleConfigUpdated(server: Config) {
    if (this.saving) {
      const remaining = removeMatchingDraft(this.draft, this.savingDraft)
      this.saving = false
      this.savingDraft = {}
      this.draft = remaining
      this.dirty = Object.keys(remaining).length > 0
      this.config = resolveConfig(server, remaining, this.dirty)
    } else {
      this.config = resolveConfig(server, this.draft, this.dirty)
    }
    this.saved = server
  }

  /** Handle a confirmed save when merged config refresh is still pending. */
  handleConfigSaved() {
    if (!this.saving) return
    const remaining = removeMatchingDraft(this.draft, this.savingDraft)
    this.saving = false
    this.savingDraft = {}
    this.draft = remaining
    this.dirty = Object.keys(remaining).length > 0
    this.saved = this.config
  }

  /** Handle an explicit save failure from the extension. */
  handleConfigSaveFailed(server: Config) {
    if (!this.saving) return
    this.saving = false
    this.savingDraft = {}
    this.saved = server
    this.config = resolveConfig(server, this.draft, this.dirty)
  }

  /** Send the draft to the backend. */
  saveConfig() {
    if (this.saving || Object.keys(this.draft).length === 0) return
    this.savingDraft = this.draft
    this.saving = true
  }

  /** Discard pending changes. */
  discardConfig() {
    this.config = this.saved
    this.draft = {}
    this.dirty = false
  }
}
