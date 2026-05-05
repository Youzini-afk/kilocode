export type PluginKind = "server" | "tui"
export type PluginScope = "global" | "local" | "builtin"
export type PluginSource = "git" | "npm" | "file" | "builtin"

export interface PluginSettingsManifest {
  title?: string
  icon?: string
  entry?: string
  available: boolean
}

export interface PluginConfigManifest {
  file?: string
  schema?: string
}

export interface PluginCapability {
  id: string
  label?: string
  mode?: "exclusive"
}

export type PluginConflictStatus = "ok" | "warning" | "blocked" | "pending-resolution"

export type PluginResolutionAction =
  | { type: "setNativeFeature"; feature: "native.compaction.auto" | "native.compaction.prune"; enabled: boolean }
  | { type: "createPluginConfig" }
  | { type: "setPluginEnabled"; enabled: boolean }

export interface PluginConflictResolution {
  id: string
  label: string
  recommended?: boolean
  actions: PluginResolutionAction[]
}

export interface PluginConflictItem {
  id: string
  type: "nativeFeature"
  feature: "native.compaction" | "native.compaction.auto" | "native.compaction.prune"
  severity: "blocking" | "warning"
  reason: string
  resolutions: PluginConflictResolution[]
  active: boolean
}

export interface PluginManagedChangeSet {
  id: string
  conflictId: string
  resolutionId: string
  appliedAt: string
  changes: Array<{
    type: "nativeFeature"
    feature: "native.compaction.auto" | "native.compaction.prune"
    previous: { exists: boolean; value?: unknown }
    applied: { exists: boolean; value?: unknown }
  }>
}

export interface ManagedGitInstall {
  type: "git"
  url: string
  ref?: string
  path?: string
  directory?: string
  managedDir?: string
}

export interface ManagedNpmOrPathInstall {
  type: "npm" | "path"
  value?: string
}

export type ManagedInstall = ManagedGitInstall | ManagedNpmOrPathInstall

export interface PluginListItem {
  id: string
  spec: string
  displayName: string
  description?: string
  version?: string
  kinds: PluginKind[]
  scope: PluginScope
  source: PluginSource
  configSource: string
  enabled: boolean
  managed: boolean
  target?: string
  packageDir?: string
  error?: string
  install?: ManagedInstall
  config?: PluginConfigManifest
  settings?: PluginSettingsManifest
  capabilities?: PluginCapability[]
  conflictStatus?: PluginConflictStatus
  conflicts?: PluginConflictItem[]
  managedChanges?: PluginManagedChangeSet[]
}
