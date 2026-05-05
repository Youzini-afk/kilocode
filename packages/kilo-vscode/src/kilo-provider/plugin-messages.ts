import * as path from "path"
import { Buffer } from "buffer"
import { openConfig } from "./open-config"

export type PluginListItem = {
  id: string
  spec: string
  displayName: string
  description?: string
  version?: string
  kinds: Array<"server" | "tui">
  scope: "global" | "local" | "builtin"
  source: "git" | "npm" | "file" | "builtin"
  configSource: string
  enabled: boolean
  managed: boolean
  target?: string
  packageDir?: string
  error?: string
  install?:
    | { type: "git"; url: string; ref?: string; path?: string; directory?: string; managedDir?: string }
    | { type: "npm" | "path"; value?: string }
  config?: { file?: string; schema?: string }
  settings?: { title?: string; icon?: string; entry?: string; available: boolean }
}

export type PluginRouteContext = {
  state: "connecting" | "connected" | "disconnected" | "error"
  cached: () => unknown
  setCached: (msg: unknown) => void
  server: () => { baseUrl: string; password: string } | null
  workspace: () => string
  project: () => string | undefined
  post: (msg: unknown) => void
  refresh: () => Promise<void>
  config: () => Promise<void>
  openFile: (file: string) => void
  error: (error: unknown) => string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}

function bool(value: unknown) {
  return typeof value === "boolean" ? value : undefined
}

function scope(value: unknown): "global" | "local" {
  return value === "local" ? "local" : "global"
}

function plugins(value: unknown) {
  if (!record(value) || !Array.isArray(value.plugins)) return []
  return value.plugins as PluginListItem[]
}

function result(ctx: PluginRouteContext, requestId: string, action: string, success: boolean, error?: string) {
  ctx.post({ type: "pluginActionResult", requestId, action, success, error })
}

function auth(ctx: PluginRouteContext) {
  const cfg = ctx.server()
  if (!cfg) return null
  return {
    baseUrl: cfg.baseUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`kilo:${cfg.password}`).toString("base64")}`,
      "Content-Type": "application/json",
      "x-kilo-directory": ctx.workspace(),
    },
  }
}

async function request<T>(ctx: PluginRouteContext, url: string, init?: RequestInit): Promise<T> {
  const cfg = auth(ctx)
  if (!cfg) throw new Error("Not connected to CLI backend")
  const headers = {
    ...cfg.headers,
    ...(init?.headers as Record<string, string> | undefined),
  }
  const res = await fetch(`${cfg.baseUrl}${url}`, { ...init, headers }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Plugin request failed: ${message}. The CLI backend may still be starting or may have stopped.`)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(body || `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export async function fetchPlugins(ctx: PluginRouteContext) {
  if (ctx.state !== "connected") {
    const cached = ctx.cached()
    if (cached) ctx.post(cached)
    return
  }
  try {
    const list = await request<PluginListItem[]>(ctx, "/plugin")
    const msg = { type: "pluginsLoaded" as const, plugins: list }
    ctx.setCached(msg)
    ctx.post(msg)
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch plugins:", error)
    ctx.post({ type: "error", message: ctx.error(error) || "Failed to fetch plugins" })
  }
}

async function loadContext(ctx: PluginRouteContext) {
  try {
    const data = await request<{
      config: unknown
      models: Array<{ value: string; label: string; provider: string; model: string }>
    }>(ctx, "/config/context-engine")
    ctx.post({ type: "contextEngineSettingsLoaded", config: data.config, models: data.models })
  } catch (error) {
    ctx.post({ type: "error", message: ctx.error(error) || "Failed to load Context Engine settings" })
  }
}

async function saveContext(ctx: PluginRouteContext, config: unknown) {
  try {
    const data = await request<{ config: unknown }>(ctx, "/config/context-engine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    })
    ctx.post({ type: "contextEngineSettingsSaved", config: data.config })
    await ctx.config()
  } catch (error) {
    ctx.post({ type: "error", message: ctx.error(error) || "Failed to save Context Engine settings" })
  }
}

async function install(ctx: PluginRouteContext, msg: Record<string, unknown>) {
  const requestId = text(msg.requestId)
  if (msg.trusted !== true) {
    result(ctx, requestId, "install", false, "Install cancelled: trust confirmation is required.")
    return
  }
  try {
    await request(ctx, "/plugin/install", {
      method: "POST",
      body: JSON.stringify({
        type: "git",
        url: text(msg.url),
        ref: text(msg.ref) || undefined,
        path: text(msg.path) || undefined,
        scope: scope(msg.scope),
        force: bool(msg.force),
      }),
    })
    await ctx.refresh()
    result(ctx, requestId, "install", true)
  } catch (error) {
    result(ctx, requestId, "install", false, ctx.error(error))
  }
}

async function enabled(ctx: PluginRouteContext, msg: Record<string, unknown>) {
  const requestId = text(msg.requestId)
  try {
    await request(ctx, "/plugin/enabled", {
      method: "POST",
      body: JSON.stringify({
        id: text(msg.id),
        enabled: msg.enabled === true,
        restoreManagedChanges: bool(msg.restoreManagedChanges),
      }),
    })
    await ctx.refresh()
    result(ctx, requestId, "enable", true)
  } catch (error) {
    result(ctx, requestId, "enable", false, ctx.error(error))
  }
}

async function remove(ctx: PluginRouteContext, msg: Record<string, unknown>) {
  const requestId = text(msg.requestId)
  try {
    await request(ctx, "/plugin/remove", {
      method: "POST",
      body: JSON.stringify({
        id: text(msg.id),
        deleteManaged: bool(msg.deleteManaged),
        restoreManagedChanges: bool(msg.restoreManagedChanges),
      }),
    })
    await ctx.refresh()
    result(ctx, requestId, "remove", true)
  } catch (error) {
    result(ctx, requestId, "remove", false, ctx.error(error))
  }
}

async function update(ctx: PluginRouteContext, msg: Record<string, unknown>) {
  const requestId = text(msg.requestId)
  try {
    await request(ctx, "/plugin/update", {
      method: "POST",
      body: JSON.stringify({ id: text(msg.id) }),
    })
    await ctx.refresh()
    result(ctx, requestId, "update", true)
  } catch (error) {
    result(ctx, requestId, "update", false, ctx.error(error))
  }
}

async function resolve(ctx: PluginRouteContext, msg: Record<string, unknown>) {
  const requestId = text(msg.requestId)
  try {
    await request(ctx, "/plugin/resolve-conflict", {
      method: "POST",
      body: JSON.stringify({
        id: text(msg.id),
        conflictId: text(msg.conflictId),
        resolutionId: text(msg.resolutionId),
      }),
    })
    await ctx.refresh()
    result(ctx, requestId, "resolve", true)
  } catch (error) {
    result(ctx, requestId, "resolve", false, ctx.error(error))
  }
}

async function config(ctx: PluginRouteContext, id: string, preferred?: unknown) {
  const plugin = plugins(ctx.cached()).find((item) => item.id === id)
  const file = plugin?.config?.file
  if (file) {
    const target = path.isAbsolute(file)
      ? file
      : plugin?.scope === "local"
        ? path.join(ctx.workspace(), ".kilo", file)
        : file
    ctx.openFile(target)
    return
  }
  await openConfig(
    preferred === "global" || preferred === "local" ? preferred : plugin?.scope === "local" ? "local" : "global",
    {
      scope: plugin?.scope === "local" ? "Local" : "Global",
      statusLoaded: "loaded",
      statusLoadedLegacy: "loaded legacy config",
      statusNotLoaded: "not loaded",
      statusCreate: "not found - create this file",
      title: "Open Kilo config file",
      placeholder: "Config files are merged in order.",
      noWorkspace: "Open a workspace folder to edit the local Kilo config file.",
      openFailed: "Failed to open Kilo config file: {{message}}",
      sourceXdg: "XDG global config",
      sourceHomeKilo: "Home .kilo config",
      sourceHomeKilocode: "Home .kilocode config",
      sourceHomeOpencode: "Home .opencode config",
      sourceEnvFile: "KILO_CONFIG environment file",
      sourceEnvDir: "KILO_CONFIG_DIR",
      sourceEnvContent: "Inline environment config",
      sourceProjectKilo: "Project .kilo config",
      sourceProjectRoot: "Project root config",
      sourceProjectKilocode: "Legacy .kilocode config",
      sourceProjectOpencode: "Legacy .opencode config",
    },
    ctx.project(),
  )
}

function settings(ctx: PluginRouteContext, id: string) {
  const cfg = auth(ctx)
  if (!cfg) {
    ctx.post({ type: "error", message: "Not connected to CLI backend" })
    return
  }
  const plugin = plugins(ctx.cached()).find((item) => item.id === id)
  if (!plugin?.settings?.available) {
    ctx.post({ type: "error", message: `Plugin ${id} has no settings UI` })
    return
  }
  const token = cfg.headers.Authorization.replace(/^Basic\s+/i, "")
  const url = `${cfg.baseUrl}/plugin/settings/${encodeURIComponent(id)}?auth_token=${encodeURIComponent(token)}&directory=${encodeURIComponent(ctx.workspace())}`
  ctx.post({ type: "openPluginSettingsPanel", pluginId: id, url, title: plugin.settings.title ?? plugin.displayName })
}

async function rpc(ctx: PluginRouteContext, msg: Record<string, unknown>) {
  const pluginId = text(msg.pluginId)
  const requestId = text(msg.requestId)
  try {
    const data = await request<{ result?: unknown }>(ctx, "/plugin/settings/rpc", {
      method: "POST",
      body: JSON.stringify({
        id: pluginId,
        requestId,
        method: text(msg.method),
        params: msg.params,
      }),
    })
    ctx.post({ type: "pluginSettingsRpcResult", pluginId, requestId, result: data.result })
  } catch (error) {
    ctx.post({ type: "pluginSettingsRpcResult", pluginId, requestId, error: ctx.error(error) })
  }
}

export async function routePluginWebviewMessage(message: unknown, ctx: PluginRouteContext) {
  if (!record(message) || typeof message.type !== "string") return false
  switch (message.type) {
    case "loadContextEngineSettings":
      await loadContext(ctx)
      return true
    case "saveContextEngineSettings":
      await saveContext(ctx, message.config)
      return true
    case "requestPlugins":
      await fetchPlugins(ctx)
      return true
    case "installPlugin":
      await install(ctx, message)
      return true
    case "setPluginEnabled":
      await enabled(ctx, message)
      return true
    case "removePlugin":
      await remove(ctx, message)
      return true
    case "updatePlugin":
      await update(ctx, message)
      return true
    case "resolvePluginConflict":
      await resolve(ctx, message)
      return true
    case "openPluginConfig":
      await config(ctx, text(message.id), message.scope)
      return true
    case "openPluginSettings":
      settings(ctx, text(message.pluginId))
      return true
    case "pluginSettingsRpc":
      await rpc(ctx, message)
      return true
  }
  return false
}
