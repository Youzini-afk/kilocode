import fs from "fs/promises"
import path from "path"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Effect } from "effect"
import z from "zod"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { PluginManager } from "@/plugin/manager"
import { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"
import { InstanceStore } from "@/project/instance-store" // kilocode_change
import { errors } from "../../error"
import { jsonRequest, runRequest } from "./trace"

const PluginKind = z.enum(["server", "tui"])
const PluginCapability = z.object({
  id: z.string(),
  label: z.string().optional(),
  mode: z.literal("exclusive").optional(),
})
const PluginResolutionAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setNativeFeature"),
    feature: z.enum(["native.compaction.auto", "native.compaction.prune"]),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal("createPluginConfig") }),
  z.object({ type: z.literal("setPluginEnabled"), enabled: z.boolean() }),
])
const PluginConflictResolution = z.object({
  id: z.string(),
  label: z.string(),
  recommended: z.boolean().optional(),
  actions: z.array(PluginResolutionAction),
})
const PluginConflictItem = z.object({
  id: z.string(),
  type: z.literal("nativeFeature"),
  feature: z.enum(["native.compaction", "native.compaction.auto", "native.compaction.prune"]),
  severity: z.enum(["blocking", "warning"]),
  reason: z.string(),
  resolutions: z.array(PluginConflictResolution),
  active: z.boolean(),
})
const PluginManagedChangeSet = z.object({
  id: z.string(),
  conflictId: z.string(),
  resolutionId: z.string(),
  appliedAt: z.string(),
  changes: z.array(
    z.object({
      type: z.literal("nativeFeature"),
      feature: z.enum(["native.compaction.auto", "native.compaction.prune"]),
      previous: z.object({ exists: z.boolean(), value: z.unknown().optional() }),
      applied: z.object({ exists: z.boolean(), value: z.unknown().optional() }),
    }),
  ),
})
const ManagedInstall = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("git"),
    url: z.string(),
    ref: z.string().optional(),
    path: z.string().optional(),
    directory: z.string().optional(),
    managedDir: z.string().optional(),
  }),
  z.object({
    type: z.enum(["npm", "path"]),
    value: z.string().optional(),
  }),
])

const PluginListItem = z.object({
  id: z.string(),
  spec: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  kinds: z.array(PluginKind),
  scope: z.enum(["global", "local", "builtin"]),
  source: z.enum(["git", "npm", "file", "builtin"]),
  configSource: z.string(),
  enabled: z.boolean(),
  managed: z.boolean(),
  target: z.string().optional(),
  packageDir: z.string().optional(),
  error: z.string().optional(),
  install: ManagedInstall.optional(),
  config: z
    .object({
      file: z.string().optional(),
      schema: z.string().optional(),
    })
    .optional(),
  settings: z
    .object({
      title: z.string().optional(),
      icon: z.string().optional(),
      entry: z.string().optional(),
      available: z.boolean(),
    })
    .optional(),
  capabilities: z.array(PluginCapability).optional(),
  conflictStatus: z.enum(["ok", "warning", "blocked", "pending-resolution"]).optional(),
  conflicts: z.array(PluginConflictItem).optional(),
  managedChanges: z.array(PluginManagedChangeSet).optional(),
})

const InstallInput = z.object({
  type: z.literal("git").default("git"),
  url: z.string().min(1),
  ref: z.string().optional(),
  path: z.string().optional(),
  scope: z.enum(["global", "local"]).default("global"),
  force: z.boolean().optional(),
})

const ToggleInput = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  restoreManagedChanges: z.boolean().optional(),
})

const RemoveInput = z.object({
  id: z.string().min(1),
  deleteManaged: z.boolean().optional(),
  restoreManagedChanges: z.boolean().optional(),
})

const UpdateInput = z.object({
  id: z.string().min(1),
})

const ResolveConflictInput = z.object({
  id: z.string().min(1),
  conflictId: z.string().min(1),
  resolutionId: z.string().min(1),
})

const SettingsRpcInput = z.object({
  id: z.string().min(1),
  requestId: z.string().optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
})

// kilocode_change start - plugin mutations require reloading active instances after config invalidation.
const reload = Effect.fn("PluginRoutes.reload")(function* (cfg: Config.Interface) {
  yield* cfg.invalidate()
  const store = yield* InstanceStore.Service
  yield* store.disposeAll()
})
// kilocode_change end

function settingsModelOptions(providers: Record<string, Provider.Info>) {
  const options = []
  for (const provider of Object.values(providers)) {
    for (const [modelID, model] of Object.entries(provider.models)) {
      const id = model.id || modelID
      options.push({
        value: `${provider.id}/${id}`,
        label: `${provider.name} · ${model.name || id}`,
        provider: provider.id,
        model: id,
      })
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label))
}

function contentType(file: string) {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".html") return "text/html; charset=utf-8"
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8"
  if (ext === ".css") return "text/css; charset=utf-8"
  if (ext === ".json") return "application/json; charset=utf-8"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  return "application/octet-stream"
}

export const PluginRoutes = () =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List plugins",
        description: "List configured Kilo plugins and their management metadata.",
        operationId: "plugin.list",
        responses: {
          200: {
            description: "Configured plugins",
            content: {
              "application/json": {
                schema: resolver(z.array(PluginListItem)),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("PluginRoutes.list", c, function* () {
          const cfg = yield* Config.Service
          const current = yield* cfg.get()
          return yield* Effect.promise(() => PluginManager.list(current))
        }),
    )
    .post(
      "/install",
      describeRoute({
        summary: "Install plugin",
        description: "Install a plugin from a trusted Git repository and add it to Kilo config.",
        operationId: "plugin.install",
        responses: {
          200: {
            description: "Installed plugin",
            content: {
              "application/json": {
                schema: resolver(z.object({ item: z.unknown() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", InstallInput),
      async (c) =>
        jsonRequest("PluginRoutes.install", c, function* () {
          const input = c.req.valid("json")
          const cfg = yield* Config.Service
          const current = yield* cfg.get()
          const out = yield* Effect.promise(() =>
            PluginManager.installFromGit({
              ...input,
              directory: Instance.directory,
              config: current,
            }),
          )
          yield* reload(cfg)
          return out
        }),
    )
    .post(
      "/enabled",
      describeRoute({
        summary: "Enable or disable plugin",
        operationId: "plugin.setEnabled",
        responses: {
          200: {
            description: "Plugin enabled state updated",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.literal(true) })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ToggleInput),
      async (c) =>
        jsonRequest("PluginRoutes.setEnabled", c, function* () {
          const input = c.req.valid("json")
          const cfg = yield* Config.Service
          const current = yield* cfg.get()
          yield* Effect.promise(() => PluginManager.setEnabled(current, { ...input, directory: Instance.directory }))
          yield* reload(cfg)
          return { ok: true as const }
        }),
    )
    .post(
      "/remove",
      describeRoute({
        summary: "Remove plugin",
        operationId: "plugin.remove",
        responses: {
          200: {
            description: "Plugin removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.literal(true) })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", RemoveInput),
      async (c) =>
        jsonRequest("PluginRoutes.remove", c, function* () {
          const input = c.req.valid("json")
          const cfg = yield* Config.Service
          const current = yield* cfg.get()
          yield* Effect.promise(() => PluginManager.remove(current, { ...input, directory: Instance.directory }))
          yield* reload(cfg)
          return { ok: true as const }
        }),
    )
    .post(
      "/update",
      describeRoute({
        summary: "Update plugin",
        operationId: "plugin.update",
        responses: {
          200: {
            description: "Plugin updated",
            content: {
              "application/json": {
                schema: resolver(z.object({ item: z.unknown() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", UpdateInput),
      async (c) =>
        jsonRequest("PluginRoutes.update", c, function* () {
          const input = c.req.valid("json")
          const cfg = yield* Config.Service
          const current = yield* cfg.get()
          const out = yield* Effect.promise(() =>
            PluginManager.update(current, { ...input, directory: Instance.directory, config: current }),
          )
          yield* reload(cfg)
          return out
        }),
    )
    .post(
      "/resolve-conflict",
      describeRoute({
        summary: "Resolve plugin conflict",
        operationId: "plugin.resolveConflict",
        responses: {
          200: {
            description: "Plugin conflict resolved",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.literal(true) })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ResolveConflictInput),
      async (c) =>
        jsonRequest("PluginRoutes.resolveConflict", c, function* () {
          const input = c.req.valid("json")
          const cfg = yield* Config.Service
          const current = yield* cfg.get()
          const out = yield* Effect.promise(() =>
            PluginManager.resolveConflict(current, { ...input, directory: Instance.directory }),
          )
          yield* reload(cfg)
          return out
        }),
    )
    .post(
      "/settings/rpc",
      describeRoute({
        summary: "Call plugin settings RPC",
        operationId: "plugin.settingsRpc",
        responses: {
          200: {
            description: "Plugin settings RPC result",
            content: {
              "application/json": {
                schema: resolver(z.object({ requestId: z.string().optional(), result: z.unknown().optional() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", SettingsRpcInput),
      async (c) =>
        jsonRequest("PluginRoutes.settingsRpc", c, function* () {
          const input = c.req.valid("json")
          if (input.method === "kilo.models") {
            const provider = yield* Provider.Service
            const providers = yield* provider.list()
            return {
              requestId: input.requestId,
              result: { models: settingsModelOptions(providers) },
            }
          }
          const plugin = yield* Plugin.Service
          const result = yield* plugin.settingsRpc(input.id, input.method, input.params)
          return {
            requestId: input.requestId,
            result,
          }
        }),
    )
    .get("/settings/:id", async (c) => {
      return runRequest(
        "PluginRoutes.settingsAsset",
        c,
        Effect.gen(function* () {
        const cfg = yield* Config.Service
        const current = yield* cfg.get()
        const file = yield* Effect.promise(() => PluginManager.resolveSettingsAsset(current, c.req.param("id"), undefined))
        const body = yield* Effect.promise(() => fs.readFile(file))
        return new Response(new Uint8Array(body), {
          headers: {
            "Content-Type": contentType(file),
            "X-Content-Type-Options": "nosniff",
          },
        })
        }),
      )
    })
    .get("/settings/:id/*", async (c) => {
      return runRequest(
        "PluginRoutes.settingsAsset",
        c,
        Effect.gen(function* () {
        const cfg = yield* Config.Service
        const current = yield* cfg.get()
        const file = yield* Effect.promise(() =>
          PluginManager.resolveSettingsAsset(current, c.req.param("id"), c.req.param("*")),
        )
        const body = yield* Effect.promise(() => fs.readFile(file))
        return new Response(new Uint8Array(body), {
          headers: {
            "Content-Type": contentType(file),
            "X-Content-Type-Options": "nosniff",
          },
        })
        }),
      )
    })
