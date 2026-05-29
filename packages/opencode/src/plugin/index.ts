import type {
  Hooks,
  PluginInput,
  Plugin as PluginInstance,
  PluginModule,
  WorkspaceAdapter as PluginWorkspaceAdapter,
} from "@kilocode/plugin"
import { Config } from "@/config/config"
import { Bus } from "../bus"
import * as Log from "@opencode-ai/core/util/log"
import { createKiloClient } from "@kilocode/sdk"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerAuth } from "@/server/auth"
import { CodexAuthPlugin } from "./codex"
import { Session } from "@/session/session"
import { NamedError } from "@opencode-ai/core/util/error"
import { CopilotAuthPlugin } from "./github-copilot/copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { PoeAuthPlugin } from "opencode-poe-auth"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "./cloudflare"
import { AzureAuthPlugin } from "./azure"
import { XaiAuthPlugin } from "./xai" // kilocode_change
import { Effect, Layer, Context, Stream } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { errorMessage } from "@/util/error"
import { PluginLoader } from "./loader"
import { PluginConflict } from "./conflict"
import { PluginManager } from "./manager"
import { parsePluginSpecifier, readPluginId, readV1Plugin, resolvePluginId } from "./shared"
import { KiloAuthPlugin } from "@kilocode/kilo-gateway" // kilocode_change
import { server as MagicContextPlugin } from "@kilocode/magic-context" // kilocode_change
import { Global } from "@opencode-ai/core/global" // kilocode_change
import { Path as DatabasePath } from "@/storage/db" // kilocode_change
import { registerAdapter } from "@/control-plane/adapters"
import type { WorkspaceAdapter } from "@/control-plane/types"

const log = Log.create({ service: "plugin" })

type State = {
  entries: PluginEntry[]
  hooks: Hooks[]
}

type PluginEntry = {
  id: string
  hooks: Hooks
}

// Hook names that follow the (input, output) => Promise<void> trigger pattern
type TriggerName = {
  [K in keyof Hooks]-?: NonNullable<Hooks[K]> extends (input: any, output: any) => Promise<void> ? K : never
}[keyof Hooks]

export interface Interface {
  readonly trigger: <
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(
    name: Name,
    input: Input,
    output: Output,
  ) => Effect.Effect<Output>
  readonly list: () => Effect.Effect<Hooks[]>
  readonly settingsRpc: (id: string, method: string, params?: unknown) => Effect.Effect<unknown>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}

// Built-in plugins that are directly imported (not installed from npm)
// kilocode_change start
const INTERNAL_PLUGINS: PluginInstance[] = [
  KiloAuthPlugin,
  MagicContextPlugin,
  CodexAuthPlugin,
  CopilotAuthPlugin,
  // kilocode_change - external auth plugins ship against @opencode-ai/plugin; bridge to our @kilocode/plugin types
  GitlabAuthPlugin as unknown as PluginInstance,
  PoeAuthPlugin as unknown as PluginInstance,
  CloudflareWorkersAuthPlugin,
  CloudflareAIGatewayAuthPlugin,
  AzureAuthPlugin,
  XaiAuthPlugin,
]
// kilocode_change end

// kilocode_change start
const OPTIONAL_INTERNAL_PLUGINS = new Map<PluginInstance, () => boolean>([
  [MagicContextPlugin, () => Flag.KILO_DISABLE_MAGIC_CONTEXT],
])

const INTERNAL_PLUGIN_IDS = new Map<PluginInstance, string>([[MagicContextPlugin, "kilocode-magic-context"]])
// kilocode_change end

function isServerPlugin(value: unknown): value is PluginInstance {
  return typeof value === "function"
}

function getServerPlugin(value: unknown) {
  if (isServerPlugin(value)) return value
  if (!value || typeof value !== "object" || !("server" in value)) return
  if (!isServerPlugin(value.server)) return
  return value.server
}

function getLegacyPlugins(mod: Record<string, unknown>) {
  const seen = new Set<unknown>()
  const result: PluginInstance[] = []

  for (const entry of Object.values(mod)) {
    if (seen.has(entry)) continue
    seen.add(entry)
    const plugin = getServerPlugin(entry)
    if (!plugin) throw new TypeError("Plugin export is not a function")
    result.push(plugin)
  }

  return result
}

async function applyPlugin(load: PluginLoader.Loaded, input: PluginInput): Promise<PluginEntry[]> {
  const plugin = readV1Plugin(load.mod, load.spec, "server", "detect")
  if (plugin) {
    const id = await resolvePluginId(load.source, load.spec, load.target, readPluginId(plugin.id, load.spec), load.pkg)
    return [{ id, hooks: await (plugin as PluginModule).server(input, load.options) }]
  }

  const entries: PluginEntry[] = []
  for (const server of getLegacyPlugins(load.mod)) {
    entries.push({ id: load.pkg?.json.name?.toString() || load.spec, hooks: await server(input, load.options) })
  }
  return entries
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Plugin.state")(function* (ctx) {
        const hooks: Hooks[] = []
        const entries: PluginEntry[] = []
        const bridge = yield* EffectBridge.make()

        function publishPluginError(message: string) {
          bridge.fork(bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() }))
        }

        const { Server } = yield* Effect.promise(() => import("../server/server"))

        const client = createKiloClient({
          baseUrl: "http://localhost:4096",
          directory: ctx.directory,
          headers: ServerAuth.headers(),
          fetch: async (...args) => Server.Default().app.fetch(...args),
        })
        const cfg = yield* config.get()
        const input: PluginInput = {
          client,
          project: ctx.project,
          worktree: ctx.worktree,
          directory: ctx.directory,
          // kilocode_change start - expose stable runtime paths to Kilo plugins
          experimental_runtime: {
            app: "kilo",
            paths: {
              config: Global.Path.config,
              data: Global.Path.data,
              cache: Global.Path.cache,
              state: Global.Path.state,
              log: Global.Path.log,
            },
            database: {
              path: DatabasePath,
            },
          },
          // kilocode_change end
          experimental_workspace: {
            register(type: string, adapter: PluginWorkspaceAdapter) {
              registerAdapter(ctx.project.id, type, adapter as WorkspaceAdapter)
            },
          },
          get serverUrl(): URL {
            return Server.url ?? new URL("http://localhost:4096")
          },
          // @ts-expect-error
          $: typeof Bun === "undefined" ? undefined : Bun.$,
        }

        for (const plugin of INTERNAL_PLUGINS) {
          // kilocode_change - optional internal plugin filtering
          // kilocode_change start
          if (OPTIONAL_INTERNAL_PLUGINS.get(plugin)?.()) {
            log.info("skipping disabled internal plugin", { name: plugin.name })
            continue
          }
          // kilocode_change end
          log.info("loading internal plugin", { name: plugin.name })
          const init = yield* Effect.tryPromise({
            try: () => plugin(input),
            catch: (err) => {
              log.error("failed to load internal plugin", { name: plugin.name, error: err })
            },
          }).pipe(Effect.option)
          if (init._tag === "Some") {
            hooks.push(init.value)
            entries.push({ id: INTERNAL_PLUGIN_IDS.get(plugin) ?? plugin.name ?? "internal", hooks: init.value })
          }
        }

        const plugins = Flag.KILO_PURE ? [] : (cfg.plugin_origins ?? [])
        if (Flag.KILO_PURE && cfg.plugin_origins?.length) {
          log.info("skipping external plugins in pure mode", { count: cfg.plugin_origins.length })
        }
        if (plugins.length) yield* config.waitForDependencies()

        const loaded = yield* Effect.promise(() =>
          PluginLoader.loadExternal({
            items: plugins,
            kind: "server",
            async gate(resolved, origin) {
              const manifest = await PluginManager.readKiloManifest(resolved.target).catch((error) => {
                log.warn("failed to inspect plugin conflict manifest", {
                  path: resolved.spec,
                  error: errorMessage(error),
                })
                return undefined
              })
              if (!manifest) return true
              // kilocode_change start - avoid running legacy Magic Context beside native Context Engine
              if (!PluginManager.shouldLoadLegacyMagicContextPlugin(cfg, manifest.id)) {
                log.info("skipping legacy Magic Context plugin for native Context Engine runtime", {
                  id: manifest.id,
                  path: resolved.spec,
                })
                return false
              }
              // kilocode_change end
              const conflict = PluginConflict.report({ config: cfg, spec: origin.spec, manifest })
              if (conflict.status === "blocked" || conflict.status === "pending-resolution") {
                log.warn("skipping plugin with unresolved blocking conflicts", {
                  path: resolved.spec,
                  conflicts: conflict.conflicts.map((item) => item.id),
                })
                return false
              }
              return true
            },
            report: {
              start(candidate) {
                log.info("loading plugin", { path: candidate.plan.spec })
              },
              missing(candidate, _retry, message) {
                log.warn("plugin has no server entrypoint", { path: candidate.plan.spec, message })
              },
              error(candidate, _retry, stage, error, resolved) {
                const spec = candidate.plan.spec
                const cause = error instanceof Error ? (error.cause ?? error) : error
                const message = stage === "load" ? errorMessage(error) : errorMessage(cause)

                if (stage === "install") {
                  const parsed = parsePluginSpecifier(spec)
                  log.error("failed to install plugin", { pkg: parsed.pkg, version: parsed.version, error: message })
                  publishPluginError(`Failed to install plugin ${parsed.pkg}@${parsed.version}: ${message}`)
                  return
                }

                if (stage === "compatibility") {
                  log.warn("plugin incompatible", { path: spec, error: message })
                  publishPluginError(`Plugin ${spec} skipped: ${message}`)
                  return
                }

                if (stage === "entry") {
                  log.error("failed to resolve plugin server entry", { path: spec, error: message })
                  publishPluginError(`Failed to load plugin ${spec}: ${message}`)
                  return
                }

                log.error("failed to load plugin", { path: spec, target: resolved?.entry, error: message })
                publishPluginError(`Failed to load plugin ${spec}: ${message}`)
              },
            },
          }),
        )
        for (const load of loaded) {
          if (!load) continue

          // Keep plugin execution sequential so hook registration and execution
          // order remains deterministic across plugin runs.
          yield* Effect.tryPromise({
            try: async () => {
              const loadedEntries = await applyPlugin(load, input)
              for (const entry of loadedEntries) {
                hooks.push(entry.hooks)
                entries.push(entry)
              }
            },
            catch: (err) => {
              const message = errorMessage(err)
              log.error("failed to load plugin", { path: load.spec, error: message })
              return message
            },
          }).pipe(
            Effect.catch(() => {
              // TODO: make proper events for this
              // bus.publish(Session.Event.Error, {
              //   error: new NamedError.Unknown({
              //     message: `Failed to load plugin ${load.spec}: ${message}`,
              //   }).toObject(),
              // })
              return Effect.void
            }),
          )
        }

        // Notify plugins of current config
        for (const hook of hooks) {
          yield* Effect.tryPromise({
            try: () => Promise.resolve((hook as any).config?.(cfg)),
            catch: (err) => {
              log.error("plugin config hook failed", { error: err })
            },
          }).pipe(Effect.ignore)
        }

        // Subscribe to bus events, fiber interrupted when scope closes
        yield* bus.subscribeAll().pipe(
          Stream.runForEach((input) =>
            Effect.sync(() => {
              for (const hook of hooks) {
                void hook["event"]?.({ event: input as any })
              }
            }),
          ),
          Effect.forkScoped,
        )

        return { hooks, entries }
      }),
    )

    const trigger = Effect.fn("Plugin.trigger")(function* <
      Name extends TriggerName,
      Input = Parameters<Required<Hooks>[Name]>[0],
      Output = Parameters<Required<Hooks>[Name]>[1],
    >(name: Name, input: Input, output: Output) {
      if (!name) return output
      const s = yield* InstanceState.get(state)
      for (const hook of s.hooks) {
        const fn = hook[name] as any
        if (!fn) continue
        yield* Effect.promise(async () => fn(input, output))
      }
      return output
    })

    const list = Effect.fn("Plugin.list")(function* () {
      const s = yield* InstanceState.get(state)
      return s.hooks
    })

    const settingsRpc = Effect.fn("Plugin.settingsRpc")(function* (id: string, method: string, params?: unknown) {
      const s = yield* InstanceState.get(state)
      const entry = s.entries.find((item) => item.id === id)
      if (!entry) throw new Error(`Plugin ${id} is not loaded`)
      const rpc = entry.hooks.settings?.rpc
      if (!rpc) throw new Error(`Plugin ${id} does not expose settings RPC`)
      return yield* Effect.promise(() => rpc({ method, params }))
    })

    const init = Effect.fn("Plugin.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ trigger, list, settingsRpc, init })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Config.defaultLayer))

export * as Plugin from "."
