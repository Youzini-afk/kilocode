import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { applyEdits, modify, parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser"
import type { Config } from "@/config/config"
import { ConfigPlugin } from "@/config/plugin"
import { isRecord } from "@/util/record"

export type PluginCapability = {
  id: string
  label?: string
  mode?: "exclusive"
}

export type NativeFeatureID = "native.compaction.auto" | "native.compaction.prune"
export type NativeFeatureGroupID = "native.compaction"
export type PluginConflictStatus = "ok" | "warning" | "blocked" | "pending-resolution"

export type PluginResolutionAction =
  | { type: "setNativeFeature"; feature: NativeFeatureID; enabled: boolean }
  | { type: "createPluginConfig" }
  | { type: "setPluginEnabled"; enabled: boolean }

export type PluginConflictResolution = {
  id: string
  label: string
  recommended?: boolean
  actions: PluginResolutionAction[]
}

export type PluginConflictDeclaration = {
  id: string
  type: "nativeFeature"
  feature: NativeFeatureID | NativeFeatureGroupID
  severity: "blocking" | "warning"
  reason: string
  resolutions: PluginConflictResolution[]
}

export type ManagedNativeFeatureChange = {
  type: "nativeFeature"
  feature: NativeFeatureID
  previous: { exists: boolean; value?: unknown }
  applied: { exists: boolean; value?: unknown }
}

export type PluginManagedChangeSet = {
  id: string
  conflictId: string
  resolutionId: string
  appliedAt: string
  changes: ManagedNativeFeatureChange[]
}

export type PluginConflictItem = PluginConflictDeclaration & {
  active: boolean
}

export type PluginConflictReport = {
  status: PluginConflictStatus
  conflicts: PluginConflictItem[]
  managedChanges: PluginManagedChangeSet[]
}

export type PluginConflictManifest = {
  capabilities: PluginCapability[]
  conflicts: PluginConflictDeclaration[]
}

type FeatureSpec = {
  path: string[]
  read(config: Config.Info): boolean
  value(enabled: boolean): unknown
}

const NATIVE_FEATURES: Record<NativeFeatureID, FeatureSpec> = {
  "native.compaction.auto": {
    path: ["compaction", "auto"],
    read(config) {
      return config.compaction?.auto !== false
    },
    value(enabled) {
      return enabled
    },
  },
  "native.compaction.prune": {
    path: ["compaction", "prune"],
    read(config) {
      return config.compaction?.prune === true
    },
    value(enabled) {
      return enabled
    },
  },
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const text = value.trim()
  return text || undefined
}

function cleanBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function parseAction(value: unknown): PluginResolutionAction | undefined {
  if (!isRecord(value)) return
  if (value.type === "setNativeFeature") {
    const feature = cleanString(value.feature)
    if (!feature || !(feature in NATIVE_FEATURES)) return
    const enabled = cleanBool(value.enabled)
    if (enabled === undefined) return
    return { type: "setNativeFeature", feature: feature as NativeFeatureID, enabled }
  }
  if (value.type === "createPluginConfig") return { type: "createPluginConfig" }
  if (value.type === "setPluginEnabled") {
    const enabled = cleanBool(value.enabled)
    if (enabled === undefined) return
    return { type: "setPluginEnabled", enabled }
  }
}

function parseResolution(value: unknown): PluginConflictResolution | undefined {
  if (!isRecord(value)) return
  const id = cleanString(value.id)
  const label = cleanString(value.label)
  if (!id || !label || !Array.isArray(value.actions)) return
  const actions = value.actions.map(parseAction).filter((item): item is PluginResolutionAction => Boolean(item))
  if (!actions.length) return
  return {
    id,
    label,
    recommended: cleanBool(value.recommended),
    actions,
  }
}

export function parseCapabilities(value: unknown): PluginCapability[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = cleanString(item.id)
    if (!id) return []
    const mode = item.mode === "exclusive" ? "exclusive" : undefined
    return [
      {
        id,
        label: cleanString(item.label),
        ...(mode ? { mode } : {}),
      },
    ]
  })
}

export function parseConflicts(value: unknown): PluginConflictDeclaration[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = cleanString(item.id)
    const feature = cleanString(item.feature)
    const reason = cleanString(item.reason)
    if (!id || item.type !== "nativeFeature" || !feature || !reason) return []
    if (feature !== "native.compaction" && !(feature in NATIVE_FEATURES)) return []
    const severity = item.severity === "warning" ? "warning" : "blocking"
    const resolutions = Array.isArray(item.resolutions)
      ? item.resolutions.map(parseResolution).filter((next): next is PluginConflictResolution => Boolean(next))
      : []
    return [
      {
        id,
        type: "nativeFeature",
        feature: feature as NativeFeatureID | NativeFeatureGroupID,
        severity,
        reason,
        resolutions,
      },
    ]
  })
}

export function nativeFeatureEnabled(config: Config.Info, feature: NativeFeatureID | NativeFeatureGroupID): boolean {
  if (feature === "native.compaction") {
    return nativeFeatureEnabled(config, "native.compaction.auto") || nativeFeatureEnabled(config, "native.compaction.prune")
  }
  return NATIVE_FEATURES[feature].read(config)
}

function parseSnapshot(value: unknown): { exists: boolean; value?: unknown } | undefined {
  if (!isRecord(value) || typeof value.exists !== "boolean") return
  return value.exists ? { exists: true, value: value.value } : { exists: false }
}

function parseManagedChanges(value: unknown): PluginManagedChangeSet[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((set) => {
    if (!isRecord(set)) return []
    const id = cleanString(set.id)
    const conflictId = cleanString(set.conflictId)
    const resolutionId = cleanString(set.resolutionId)
    const appliedAt = cleanString(set.appliedAt)
    if (!id || !conflictId || !resolutionId || !appliedAt || !Array.isArray(set.changes)) return []
    const changes = set.changes.flatMap((change): ManagedNativeFeatureChange[] => {
      if (!isRecord(change) || change.type !== "nativeFeature") return []
      const feature = cleanString(change.feature)
      if (!feature || !(feature in NATIVE_FEATURES)) return []
      const previous = parseSnapshot(change.previous)
      const applied = parseSnapshot(change.applied)
      if (!previous || !applied) return []
      return [
        {
          type: "nativeFeature",
          feature: feature as NativeFeatureID,
          previous,
          applied,
        },
      ]
    })
    if (!changes.length) return []
    return [
      {
        id,
        conflictId,
        resolutionId,
        appliedAt,
        changes,
      },
    ]
  })
}

export function report(input: {
  config: Config.Info
  spec: ConfigPlugin.Spec
  manifest: PluginConflictManifest
  ignoreResolved?: boolean
}): PluginConflictReport {
  const kilo = ConfigPlugin.pluginKiloMetadata(ConfigPlugin.pluginOptions(input.spec))
  const resolvedConflicts = Array.isArray(kilo?.resolvedConflicts) ? kilo.resolvedConflicts : []
  const disabledResolutions = new Set(
    input.ignoreResolved || ConfigPlugin.pluginEnabled(input.spec)
      ? []
      : resolvedConflicts.flatMap((resolved) => {
          const conflict = input.manifest.conflicts.find((item) => item.id === resolved.conflictId)
          const resolution = conflict?.resolutions.find((item) => item.id === resolved.resolutionId)
          const keepsPluginDisabled = resolution?.actions.some(
            (action) => action.type === "setPluginEnabled" && action.enabled === false,
          )
          return keepsPluginDisabled ? [resolved.conflictId] : []
        }),
  )
  const active = input.manifest.conflicts
    .filter((conflict) => nativeFeatureEnabled(input.config, conflict.feature))
    .filter((conflict) => !disabledResolutions.has(conflict.id))
    .map((conflict) => ({ ...conflict, active: true }))
  const blocking = active.some((conflict) => conflict.severity === "blocking")
  const enabled = ConfigPlugin.pluginEnabled(input.spec)
  const status: PluginConflictStatus = blocking
    ? enabled
      ? "blocked"
      : "pending-resolution"
    : active.length
      ? "warning"
      : "ok"
  return {
    status,
    conflicts: active,
    managedChanges: parseManagedChanges(kilo?.managedChanges),
  }
}

function parseConfigText(text: string, file: string) {
  const errors: ParseError[] = []
  const data = parseJsonc(text.trim() ? text : "{}", errors, { allowTrailingComma: true })
  if (errors.length) {
    const err = errors[0]!
    const lines = text.substring(0, err.offset).split("\n")
    throw new Error(
      `Invalid JSONC in ${file}: ${printParseErrorCode(err.error)} at line ${lines.length}, column ${
        lines[lines.length - 1]!.length + 1
      }`,
    )
  }
  return data
}

async function readConfigFile(file: string) {
  return fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "{}"
    throw err
  })
}

function atPath(data: unknown, keys: string[]) {
  let cursor = data
  for (const key of keys) {
    if (!isRecord(cursor) || !(key in cursor)) return { exists: false as const }
    cursor = cursor[key]
  }
  return { exists: true as const, value: cursor }
}

function patch(text: string, keys: string[], value: unknown) {
  return applyEdits(
    text.trim() ? text : "{}",
    modify(text.trim() ? text : "{}", keys, value, {
      formattingOptions: {
        tabSize: 2,
        insertSpaces: true,
      },
    }),
  )
}

export async function setNativeFeature(input: {
  file: string
  feature: NativeFeatureID
  enabled: boolean
}): Promise<ManagedNativeFeatureChange> {
  const spec = NATIVE_FEATURES[input.feature]
  const text = await readConfigFile(input.file)
  const data = parseConfigText(text, input.file)
  const previous = atPath(data, spec.path)
  const value = spec.value(input.enabled)
  await fs.mkdir(path.dirname(input.file), { recursive: true })
  await fs.writeFile(input.file, patch(text, spec.path, value))
  return {
    type: "nativeFeature",
    feature: input.feature,
    previous,
    applied: { exists: true, value },
  }
}

function sameSnapshot(current: { exists: boolean; value?: unknown }, snapshot: { exists: boolean; value?: unknown }) {
  if (current.exists !== snapshot.exists) return false
  return JSON.stringify(current.value) === JSON.stringify(snapshot.value)
}

export async function restoreNativeFeature(input: {
  file: string
  change: ManagedNativeFeatureChange
}): Promise<{ restored: boolean; reason?: string }> {
  const spec = NATIVE_FEATURES[input.change.feature]
  const text = await readConfigFile(input.file)
  const data = parseConfigText(text, input.file)
  const current = atPath(data, spec.path)
  if (!sameSnapshot(current, input.change.applied)) {
    return { restored: false, reason: `${input.change.feature} was changed after Kilo applied it` }
  }
  await fs.mkdir(path.dirname(input.file), { recursive: true })
  await fs.writeFile(input.file, patch(text, spec.path, input.change.previous.exists ? input.change.previous.value : undefined))
  return { restored: true }
}

export function schemaReference(input: { packageDir?: string; schema?: string }) {
  const schema = cleanString(input.schema)
  if (!schema) return
  if (/^https?:\/\//i.test(schema) || schema.startsWith("file://")) return schema
  if (path.isAbsolute(schema)) return pathToFileURL(schema).href
  if (input.packageDir) return pathToFileURL(path.resolve(input.packageDir, schema)).href
  return schema
}

export * as PluginConflict from "./conflict"
