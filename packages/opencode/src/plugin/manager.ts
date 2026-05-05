import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import { existsSync } from "fs"
import { fileURLToPath, pathToFileURL } from "url"
import { applyEdits, modify, parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser"
import { Global } from "@opencode-ai/core/global"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigPaths } from "@/config/paths"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { isRecord } from "@/util/record"
import { parsePluginSpecifier, readPluginPackage, resolvePluginTarget } from "./shared"
import { readPluginManifest } from "./install"
import type { Config } from "@/config/config"
import {
  PluginConflict,
  type PluginCapability,
  type PluginConflictItem,
  type PluginConflictStatus,
  type PluginManagedChangeSet,
} from "./conflict"

export type PluginKind = "server" | "tui"
export type PluginScope = "global" | "local" | "builtin"

export type PluginSettingsManifest = {
  title?: string
  icon?: string
  entry?: string
}

export type PluginConfigManifest = {
  file?: string
  schema?: string
}

export type ManagedInstall =
  | {
      type: "git"
      url: string
      ref?: string
      path?: string
      directory?: string
      managedDir?: string
    }
  | {
      type: "npm" | "path"
      value?: string
    }

export type PluginListItem = {
  id: string
  spec: string
  displayName: string
  description?: string
  version?: string
  kinds: PluginKind[]
  scope: PluginScope
  source: "git" | "npm" | "file" | "builtin"
  configSource: string
  enabled: boolean
  managed: boolean
  target?: string
  packageDir?: string
  error?: string
  install?: ManagedInstall
  config?: PluginConfigManifest
  settings?: PluginSettingsManifest & { available: boolean }
  capabilities?: PluginCapability[]
  conflictStatus?: PluginConflictStatus
  conflicts?: PluginConflictItem[]
  managedChanges?: PluginManagedChangeSet[]
}

export type InstallInput = {
  url: string
  ref?: string
  path?: string
  scope?: "global" | "local"
  force?: boolean
  directory: string
  config?: Config.Info
}

export type ToggleInput = {
  id: string
  enabled: boolean
  directory: string
  restoreManagedChanges?: boolean
}

export type RemoveInput = {
  id: string
  directory: string
  deleteManaged?: boolean
  restoreManagedChanges?: boolean
}

export type UpdateInput = {
  id: string
  directory: string
  config?: Config.Info
}

export type ResolveConflictInput = {
  id: string
  conflictId: string
  resolutionId: string
  directory: string
}

type PatchTarget = {
  file: string
  spec: string
}

const KILO_PLUGIN_FIELD = "kilo-plugin"
const GIT_ROOT = () => path.join(Global.Path.data, "storage", "plugin", "git")

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const text = value.trim()
  return text || undefined
}

function cleanRel(value: string | undefined) {
  if (!value) return
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "")
  if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..")) {
    throw new Error(`Invalid plugin subpath: ${value}`)
  }
  return normalized
}

function slug(url: string) {
  const base = url
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.git$/i, "")
  const name = (base || "plugin").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return name || "plugin"
}

function installHash(input: Pick<InstallInput, "url" | "ref" | "path">) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ url: input.url, ref: input.ref ?? "", path: input.path ?? "" }))
    .digest("hex")
    .slice(0, 12)
}

async function readJson(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>
}

function hasExport(pkg: Record<string, unknown>, key: "./server" | "./tui") {
  const exports = pkg.exports
  return isRecord(exports) && exports[key] !== undefined
}

function ocKinds(pkg: Record<string, unknown>): PluginKind[] {
  const raw = pkg["oc-plugin"]
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is PluginKind => item === "server" || item === "tui")
}

function kiloKinds(pkg: Record<string, unknown>): PluginKind[] {
  const raw = pkg[KILO_PLUGIN_FIELD]
  if (!isRecord(raw)) return []
  const kinds = raw.kinds
  if (!Array.isArray(kinds)) return []
  return kinds.filter((item): item is PluginKind => item === "server" || item === "tui")
}

function packageLooksLikePlugin(pkg: Record<string, unknown>) {
  return (
    isRecord(pkg[KILO_PLUGIN_FIELD]) ||
    ocKinds(pkg).length > 0 ||
    hasExport(pkg, "./server") ||
    hasExport(pkg, "./tui") ||
    typeof pkg.main === "string"
  )
}

async function isPluginPackageDir(dir: string) {
  try {
    return packageLooksLikePlugin(await readJson(path.join(dir, "package.json")))
  } catch {
    return false
  }
}

async function findWorkspacePluginPackage(repo: string, explicitPath?: string) {
  if (explicitPath) {
    const dir = path.resolve(repo, cleanRel(explicitPath)!)
    if (!(await isPluginPackageDir(dir))) throw new Error(`No Kilo plugin package found at ${explicitPath}`)
    return dir
  }

  const rootPkg = path.join(repo, "package.json")
  if (await isPluginPackageDir(repo)) return repo

  const conventional = path.join(repo, "packages", "plugin")
  if (await isPluginPackageDir(conventional)) return conventional

  const packagesDir = path.join(repo, "packages")
  try {
    const entries = await fs.readdir(packagesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(packagesDir, entry.name)
      if (await isPluginPackageDir(candidate)) return candidate
    }
  } catch {
    // no workspace packages
  }

  throw new Error(
    (await Filesystem.exists(rootPkg))
      ? "Repository package.json does not expose a Kilo plugin"
      : "Repository does not contain a package.json plugin package",
  )
}

async function run(cmd: string[], cwd: string) {
  await Process.run(cmd, { cwd })
}

async function preparePackage(repo: string, pluginDir: string) {
  await run(["bun", "install"], repo)
  const pkg = await readJson(path.join(pluginDir, "package.json"))
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : {}
  if (typeof scripts.build === "string") await run(["bun", "run", "build"], pluginDir)
}

function globalConfigFile() {
  const candidates = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"].map((file) =>
    path.join(Global.Path.config, file),
  )
  return candidates.find((file) => existsSync(file)) ?? candidates[0]!
}

function configFileForScope(scope: "global" | "local", directory: string) {
  if (scope === "global") return globalConfigFile()
  const dir = path.join(directory, ".kilo")
  const files = ConfigPaths.fileInDirectory(dir, "kilo")
  return files.find((file) => existsSync(file)) ?? path.join(dir, "kilo.jsonc")
}

function configFilesInDirectory(dir: string) {
  return ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"].map((file) =>
    path.join(dir, file),
  )
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

async function isDirectory(file: string) {
  return fs.stat(file).then(
    (stat) => stat.isDirectory(),
    () => false,
  )
}

function patch(text: string, path: Array<string | number>, value: unknown, insert = false) {
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: {
        tabSize: 2,
        insertSpaces: true,
      },
      isArrayInsertion: insert,
    }),
  )
}

function entrySpec(item: unknown) {
  if (typeof item === "string") return item
  if (Array.isArray(item) && typeof item[0] === "string") return item[0]
}

function entryOptions(item: unknown): Record<string, unknown> {
  if (Array.isArray(item) && isRecord(item[1])) return item[1]
  return {}
}

function identity(spec: string) {
  if (spec.startsWith("file://")) return spec
  return parsePluginSpecifier(spec).pkg
}

function matchesSpec(a: string, b: string) {
  return identity(a) === identity(b)
}

function pluginList(data: unknown) {
  if (!isRecord(data) || !Array.isArray(data.plugin)) return undefined
  return data.plugin as unknown[]
}

async function updatePluginEntry(
  target: PatchTarget,
  update: (entry: unknown) => unknown | undefined,
  missing?: () => unknown,
) {
  const text = await readConfigFile(target.file)
  const data = parseConfigText(text, target.file)
  const list = pluginList(data)
  const rows = (list ?? []).map((item, index) => ({ item, index, spec: entrySpec(item) }))
  const hit = rows.find((row) => row.spec && matchesSpec(row.spec, target.spec))

  let next = text.trim() ? text : "{}"
  if (hit) {
    const replacement = update(hit.item)
    next = patch(next, ["plugin", hit.index], replacement)
  } else if (missing) {
    const replacement = missing()
    if (!list) next = patch(next, ["plugin"], [replacement])
    else next = patch(next, ["plugin", list.length], replacement, true)
  } else {
    return false
  }

  await fs.mkdir(path.dirname(target.file), { recursive: true })
  await fs.writeFile(target.file, next)
  return true
}

async function removePluginEntry(target: PatchTarget) {
  const text = await readConfigFile(target.file)
  const data = parseConfigText(text, target.file)
  const list = pluginList(data)
  if (!list) return false
  const index = list.findIndex((item) => {
    const spec = entrySpec(item)
    return spec ? matchesSpec(spec, target.spec) : false
  })
  if (index < 0) return false
  await fs.writeFile(target.file, patch(text.trim() ? text : "{}", ["plugin", index], undefined))
  return true
}

async function fileContainsPluginSpec(file: string, spec: string) {
  const text = await readConfigFile(file)
  const data = parseConfigText(text, file)
  const list = pluginList(data)
  return Boolean(
    list?.some((item) => {
      const next = entrySpec(item)
      return next ? matchesSpec(next, spec) : false
    }),
  )
}

async function patchFileForSource(source: string, spec: string) {
  if (!(await isDirectory(source))) return source

  const candidates = configFilesInDirectory(source)
  for (const file of candidates) {
    if (!existsSync(file)) continue
    if (await fileContainsPluginSpec(file, spec)) return file
  }
  return candidates.find((file) => existsSync(file)) ?? path.join(source, "kilo.jsonc")
}

function mergeKiloOptions(options: Record<string, unknown>, kilo: ConfigPlugin.KiloMetadata) {
  const current = isRecord(options[ConfigPlugin.KILO_META_KEY]) ? options[ConfigPlugin.KILO_META_KEY] : {}
  return {
    ...options,
    [ConfigPlugin.KILO_META_KEY]: {
      ...current,
      ...kilo,
      install: kilo.install ?? (current as ConfigPlugin.KiloMetadata).install,
    },
  }
}

function enabledEntry(spec: string, options: Record<string, unknown>, enabled: boolean) {
  const next = mergeKiloOptions(options, { enabled })
  return Object.keys(next).length ? [spec, next] : spec
}

function withKiloMetadata(
  options: Record<string, unknown>,
  update: (current: ConfigPlugin.KiloMetadata) => ConfigPlugin.KiloMetadata,
) {
  const current = ConfigPlugin.pluginKiloMetadata(options) ?? {}
  const nextKilo = update(current)
  return {
    ...options,
    [ConfigPlugin.KILO_META_KEY]: nextKilo,
  }
}

function metadataEntry(
  spec: string,
  options: Record<string, unknown>,
  update: (current: ConfigPlugin.KiloMetadata) => ConfigPlugin.KiloMetadata,
) {
  return [spec, withKiloMetadata(options, update)] as const
}

function resolvedConflicts(current: ConfigPlugin.KiloMetadata) {
  return Array.isArray(current.resolvedConflicts) ? current.resolvedConflicts : []
}

async function addOrReplacePlugin(file: string, spec: string, options: Record<string, unknown>, force: boolean) {
  await updatePluginEntry(
    { file, spec },
    (entry) => {
      if (!force) return entry
      return [spec, { ...entryOptions(entry), ...options }]
    },
    () => [spec, options],
  )
}

async function createPluginConfigFile(input: { targetFile: string; item: PluginListItem }) {
  const configFile = input.item.config?.file
  if (!configFile) return
  const file = path.isAbsolute(configFile) ? configFile : path.join(path.dirname(input.targetFile), configFile)
  if (existsSync(file)) return
  const schema = PluginConflict.schemaReference({
    packageDir: input.item.packageDir,
    schema: input.item.config?.schema,
  })
  const body = schema ? JSON.stringify({ $schema: schema }, null, 2) : "{}"
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${body}\n`)
}

async function restoreManagedChanges(target: PatchTarget, item: PluginListItem) {
  const skipped: string[] = []
  for (const set of item.managedChanges ?? []) {
    for (const change of set.changes) {
      const result = await PluginConflict.restoreNativeFeature({ file: target.file, change })
      if (!result.restored && result.reason) skipped.push(result.reason)
    }
  }
  await updatePluginEntry(target, (entry) => {
    const spec = entrySpec(entry) ?? target.spec
    return metadataEntry(spec, entryOptions(entry), (current) => {
      const { managedChanges: _managedChanges, ...rest } = current
      return rest
    })
  })
  return skipped
}

function safeManifestObject(value: unknown) {
  return isRecord(value) ? value : {}
}

function settingsManifest(value: unknown): PluginSettingsManifest | undefined {
  if (!isRecord(value)) return
  const entry = cleanString(value.entry)
  if (!entry) return
  return {
    entry,
    title: cleanString(value.title),
    icon: cleanString(value.icon),
  }
}

function configManifest(value: unknown): PluginConfigManifest | undefined {
  if (!isRecord(value)) return
  return {
    file: cleanString(value.file),
    schema: cleanString(value.schema),
  }
}

export async function readKiloManifest(target: string) {
  const pkg = await readPluginPackage(target)
  const kilo = safeManifestObject(pkg.json[KILO_PLUGIN_FIELD])
  const manifestKinds = Array.from(new Set([...kiloKinds(pkg.json), ...ocKinds(pkg.json)]))
  const detected = await readPluginManifest(target)
    .then((item) => (item.ok ? item.targets.map((target) => target.kind) : []))
    .catch(() => [] as PluginKind[])
  const kinds = Array.from(new Set<PluginKind>([...manifestKinds, ...detected]))
  const id = cleanString(kilo.id) ?? cleanString(pkg.json.name) ?? path.basename(pkg.dir)
  return {
    packageDir: pkg.dir,
    id,
    displayName: cleanString(kilo.displayName) ?? cleanString(pkg.json.name) ?? id,
    description: cleanString(kilo.description) ?? cleanString(pkg.json.description),
    version: cleanString(pkg.json.version),
    kinds,
    config: configManifest(kilo.config),
    settings: settingsManifest(kilo.settings),
    capabilities: PluginConflict.parseCapabilities(kilo.capabilities),
    conflicts: PluginConflict.parseConflicts(kilo.conflicts),
  }
}

function sourceFromSpec(spec: string, install: ManagedInstall | undefined, source: string): PluginListItem["source"] {
  if (source === "builtin") return "builtin"
  if (install?.type === "git") return "git"
  if (spec.startsWith("file://") || path.isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith(".")) {
    return "file"
  }
  return "npm"
}

export async function list(config: Config.Info): Promise<PluginListItem[]> {
  const origins = config.plugin_origins ?? []
  const result: PluginListItem[] = []
  for (const origin of origins) {
    const spec = ConfigPlugin.pluginSpecifier(origin.spec)
    const options = ConfigPlugin.pluginOptions(origin.spec)
    const kilo = ConfigPlugin.pluginKiloMetadata(options)
    const install = kilo?.install as ManagedInstall | undefined
    const item: PluginListItem = {
      id: identity(spec),
      spec,
      displayName: identity(spec),
      kinds: [],
      scope: origin.source === "builtin" ? "builtin" : origin.scope,
      source: sourceFromSpec(spec, install, origin.source),
      configSource: origin.source,
      enabled: ConfigPlugin.pluginEnabled(origin.spec),
      managed: install?.type === "git" && Boolean(install.managedDir ?? install.directory),
      install,
    }

    if (origin.source === "builtin") {
      result.push(item)
      continue
    }

    try {
      const target = await resolvePluginTarget(spec)
      item.target = target
      const manifest = await readKiloManifest(target)
      item.id = manifest.id
      item.displayName = manifest.displayName
      item.description = manifest.description
      item.version = manifest.version
      item.kinds = manifest.kinds
      item.packageDir = manifest.packageDir
      item.config = manifest.config
      item.settings = manifest.settings ? { ...manifest.settings, available: true } : undefined
      item.capabilities = manifest.capabilities
      const conflictReport = PluginConflict.report({
        config,
        spec: origin.spec,
        manifest,
      })
      item.conflictStatus = conflictReport.status
      item.conflicts = conflictReport.conflicts
      item.managedChanges = conflictReport.managedChanges
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error)
    }
    result.push(item)
  }
  return result
}

export async function installFromGit(input: InstallInput) {
  const url = input.url.trim()
  if (!url) throw new Error("Git URL is required")

  const subpath = cleanRel(input.path)
  const managedDir = path.join(GIT_ROOT(), `${slug(url)}-${installHash(input)}`)
  const repo = path.join(managedDir, "repo")
  await fs.mkdir(GIT_ROOT(), { recursive: true })

  if (await Filesystem.exists(repo)) {
    if (!input.force) {
      await run(["git", "-C", repo, "fetch", "--all", "--tags"], repo)
      if (input.ref) await run(["git", "-C", repo, "checkout", input.ref], repo)
      await run(["git", "-C", repo, "pull", "--ff-only"], repo).catch(() => undefined)
    } else {
      if (!Filesystem.contains(GIT_ROOT(), managedDir)) throw new Error("Refusing to delete unmanaged plugin directory")
      await fs.rm(managedDir, { recursive: true, force: true })
    }
  }

  if (!(await Filesystem.exists(repo))) {
    const args = ["git", "clone"]
    if (input.ref) args.push("--branch", input.ref)
    args.push("--depth", "1", url, repo)
    await run(args, GIT_ROOT())
  }

  const pluginDir = await findWorkspacePluginPackage(repo, subpath)
  await preparePackage(repo, pluginDir)

  const detectedPath = path.relative(repo, pluginDir).replaceAll("\\", "/") || undefined
  const spec = pathToFileURL(pluginDir).href
  const manifest = await readKiloManifest(spec)
  const file = configFileForScope(input.scope ?? "global", input.directory)
  const kiloMetadata: ConfigPlugin.KiloMetadata = {
    enabled: true,
    install: {
      type: "git",
      url,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(detectedPath ? { path: detectedPath } : {}),
      directory: repo,
      managedDir,
    },
  }
  const options = {
    [ConfigPlugin.KILO_META_KEY]: kiloMetadata,
  }
  const conflictReport = PluginConflict.report({
    config: input.config ?? {},
    spec: [spec, options],
    manifest,
  })
  const hasBlockingConflict = conflictReport.conflicts.some((conflict) => conflict.severity === "blocking")
  if (hasBlockingConflict) kiloMetadata.enabled = false

  await addOrReplacePlugin(file, spec, options, input.force ?? true)
  return {
    item: {
      id: manifest.id,
      spec,
      displayName: manifest.displayName,
      version: manifest.version,
      kinds: manifest.kinds,
      configSource: file,
      conflictStatus: hasBlockingConflict ? "pending-resolution" : conflictReport.status,
    },
  }
}

function editableSource(source: string) {
  if (source === "builtin" || source.startsWith("http://") || source.startsWith("https://")) return false
  if (source === "KILO_CONFIG_CONTENT") return false
  return true
}

async function findPatchTarget(config: Config.Info, id: string): Promise<{ target: PatchTarget; item: PluginListItem }> {
  const items = await list(config)
  const item = items.find((candidate) => candidate.id === id || candidate.spec === id || identity(candidate.spec) === id)
  if (!item) throw new Error(`Plugin not found: ${id}`)
  if (item.configSource === "builtin") {
    const file = globalConfigFile()
    return {
      item,
      target: {
        file,
        spec: item.spec,
      },
    }
  }
  if (!editableSource(item.configSource)) throw new Error(`Plugin ${item.displayName} is not editable from this source`)
  const file = await patchFileForSource(item.configSource, item.spec)
  return {
    item,
    target: {
      file,
      spec: item.spec,
    },
  }
}

async function hasActiveBlockingConflict(config: Config.Info, item: PluginListItem) {
  if (!item.target) return false
  const manifest = await readKiloManifest(item.target).catch(() => undefined)
  if (!manifest) return false
  const conflict = PluginConflict.report({
    config,
    spec: item.spec,
    manifest,
    ignoreResolved: true,
  })
  return conflict.conflicts.some((candidate) => candidate.severity === "blocking")
}

async function disabledConflictResolutions(item: PluginListItem, resolvedAt: string) {
  if (!item.target) return []
  const manifest = await readKiloManifest(item.target).catch(() => undefined)
  if (!manifest) return []
  return manifest.conflicts.flatMap((conflict) => {
    const resolution = conflict.resolutions.find((candidate) =>
      candidate.actions.some((action) => action.type === "setPluginEnabled" && action.enabled === false),
    )
    return resolution
      ? [
          {
            conflictId: conflict.id,
            resolutionId: resolution.id,
            resolvedAt,
          },
        ]
      : []
  })
}

export async function setEnabled(config: Config.Info, input: ToggleInput) {
  const { target, item } = await findPatchTarget(config, input.id)
  if (input.enabled && (await hasActiveBlockingConflict(config, item))) {
    throw new Error(`Plugin ${item.displayName} has unresolved blocking conflicts`)
  }
  if (!input.enabled && input.restoreManagedChanges) {
    await restoreManagedChanges(target, item)
  }
  const disabledResolutions = input.enabled ? [] : await disabledConflictResolutions(item, new Date().toISOString())
  await updatePluginEntry(target, (entry) => {
    const spec = entrySpec(entry) ?? target.spec
    return metadataEntry(spec, entryOptions(entry), (current) => ({
      ...current,
      enabled: input.enabled,
      resolvedConflicts: disabledResolutions.length
        ? [
            ...resolvedConflicts(current).filter(
              (existing) => !disabledResolutions.some((resolution) => resolution.conflictId === existing.conflictId),
            ),
            ...disabledResolutions,
          ]
        : current.resolvedConflicts,
    }))
  }, () => metadataEntry(target.spec, {}, () => ({ enabled: input.enabled })))
}

export async function remove(config: Config.Info, input: RemoveInput) {
  const { target, item } = await findPatchTarget(config, input.id)
  if (input.restoreManagedChanges) {
    await restoreManagedChanges(target, item)
  }
  await removePluginEntry(target)
  if (input.deleteManaged !== false && item.install?.type === "git") {
    const managedDir = item.install.managedDir ?? (item.install.directory ? path.dirname(item.install.directory) : undefined)
    if (managedDir && Filesystem.contains(GIT_ROOT(), managedDir)) {
      await fs.rm(managedDir, { recursive: true, force: true })
    }
  }
}

export async function update(config: Config.Info, input: UpdateInput) {
  const { item } = await findPatchTarget(config, input.id)
  if (item.install?.type !== "git") throw new Error(`Plugin ${item.displayName} is not a managed Git plugin`)
  return installFromGit({
    url: item.install.url,
    ref: item.install.ref,
    path: item.install.path,
    directory: input.directory,
    scope: item.scope === "local" ? "local" : "global",
    force: false,
    config: input.config ?? config,
  })
}

export async function resolveConflict(config: Config.Info, input: ResolveConflictInput) {
  const { target, item } = await findPatchTarget(config, input.id)
  const conflict = item.conflicts?.find((candidate) => candidate.id === input.conflictId)
  if (!conflict) throw new Error(`Conflict not found: ${input.conflictId}`)
  const resolution = conflict.resolutions.find((candidate) => candidate.id === input.resolutionId)
  if (!resolution) throw new Error(`Resolution not found: ${input.resolutionId}`)

  const changes: PluginManagedChangeSet["changes"] = []
  try {
    for (const action of resolution.actions) {
      if (action.type === "setNativeFeature") {
        changes.push(
          await PluginConflict.setNativeFeature({
            file: target.file,
            feature: action.feature,
            enabled: action.enabled,
          }),
        )
        continue
      }
      if (action.type === "createPluginConfig") {
        await createPluginConfigFile({ targetFile: target.file, item })
        continue
      }
      if (action.type === "setPluginEnabled") {
        await updatePluginEntry(target, (entry) => {
          const spec = entrySpec(entry) ?? target.spec
          return enabledEntry(spec, entryOptions(entry), action.enabled)
        })
      }
    }
  } catch (error) {
    for (const change of changes.toReversed()) {
      await PluginConflict.restoreNativeFeature({ file: target.file, change }).catch(() => undefined)
    }
    throw error
  }

  const resolvedAt = new Date().toISOString()
  const changeSet: PluginManagedChangeSet | undefined = changes.length
    ? {
        id: `${conflict.id}/${resolution.id}`,
        conflictId: conflict.id,
        resolutionId: resolution.id,
        appliedAt: resolvedAt,
        changes,
      }
    : undefined
  await updatePluginEntry(target, (entry) => {
    const spec = entrySpec(entry) ?? target.spec
    return metadataEntry(spec, entryOptions(entry), (current) => ({
      ...current,
      managedChanges: changeSet
        ? [...(current.managedChanges ?? []).filter((existing) => existing.id !== changeSet.id), changeSet]
        : current.managedChanges,
      resolvedConflicts: [
        ...resolvedConflicts(current).filter((existing) => existing.conflictId !== conflict.id),
        {
          conflictId: conflict.id,
          resolutionId: resolution.id,
          resolvedAt,
        },
      ],
    }))
  })

  return { ok: true as const }
}

export async function resolveSettingsAsset(config: Config.Info, id: string, assetPath: string | undefined) {
  const items = await list(config)
  const item = items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Plugin not found: ${id}`)
  if (!item.settings?.entry || !item.packageDir) throw new Error(`Plugin ${item.displayName} has no settings UI`)

  const entry = cleanRel(item.settings.entry)
  const entryFile = path.resolve(item.packageDir, entry!)
  if (!Filesystem.contains(item.packageDir, entryFile)) throw new Error("Invalid settings entry")
  const base = path.dirname(entryFile)
  const rel = cleanRel(assetPath) ?? path.basename(entryFile)
  const file = assetPath ? path.resolve(base, rel) : entryFile
  if (!Filesystem.contains(base, file)) throw new Error("Invalid settings asset path")
  return file
}

export function filePathFromTarget(target: string) {
  return target.startsWith("file://") ? fileURLToPath(target) : target
}

export * as PluginManager from "./manager"
