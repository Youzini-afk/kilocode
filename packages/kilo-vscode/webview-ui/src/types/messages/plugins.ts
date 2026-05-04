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
}
