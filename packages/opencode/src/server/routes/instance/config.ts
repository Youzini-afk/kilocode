import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"
import { Provider } from "@/provider/provider"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest, runRequest } from "./trace"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
// kilocode_change start
import { fetchDefaultModel } from "@kilocode/kilo-gateway"
import { Auth } from "@/auth"
import { ModelID, ProviderID } from "@/provider/schema"
import { ContextEngineConfig, ContextEngineModelOptions } from "@/kilocode/context-engine"
import { z } from "zod"
// kilocode_change end

// kilocode_change start
const ContextEngineSaveInput = z.object({ config: z.unknown() })
const ContextEngineAgentOutput = z.object({
  enabled: z.boolean(),
  model: z.string(),
  fallbackModels: z.array(z.string()),
  variant: z.string(),
  thinkingLevel: z.string(),
})
const ContextEngineConfigOutput = z.object({
  enabled: z.boolean(),
  mode: z.enum(["recommended", "light", "advanced"]),
  historian: ContextEngineAgentOutput.extend({ twoPass: z.boolean() }),
  dreamer: ContextEngineAgentOutput,
  sidekick: ContextEngineAgentOutput,
  memory: z.object({
    enabled: z.boolean(),
    injectionBudgetTokens: z.number(),
    autoPromote: z.boolean(),
    retrievalCountPromotionThreshold: z.number(),
    embedding: z.object({
      provider: z.enum(["local", "openai-compatible", "off"]),
      model: z.string(),
      endpoint: z.string(),
      apiKey: z.string(),
    }),
  }),
})
const ContextEngineModelOutput = z.object({
  value: z.string(),
  label: z.string(),
  provider: z.string(),
  model: z.string(),
})
const ContextEngineSettingsOutput = z.object({
  config: ContextEngineConfigOutput,
  models: z.array(ContextEngineModelOutput),
})
const ContextEngineSaveOutput = z.object({ config: ContextEngineConfigOutput })
// kilocode_change end

const log = Log.create({ service: "server.config" })

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current OpenCode configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.get", c, function* () {
          const cfg = yield* Config.Service
          return yield* cfg.get()
        }),
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update OpenCode configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info.zod),
      async (c) => {
        const result = await runRequest(
          "ConfigRoutes.update",
          c,
          Effect.gen(function* () {
            const config = c.req.valid("json")
            const cfg = yield* Config.Service
            yield* cfg.update(config)
            return { config, ctx: yield* InstanceState.context }
          }),
        )
        const response = c.json(result.config)
        void runRequest(
          "ConfigRoutes.update.dispose",
          c,
          InstanceStore.Service.use((store) => store.dispose(result.ctx)).pipe(
            Effect.uninterruptible,
            Effect.catchCause((cause) => Effect.sync(() => log.warn("instance disposal failed", { cause }))),
          ),
        )
        return response
      },
    )
    // kilocode_change start
    .get(
      "/context-engine",
      describeRoute({
        summary: "Get Context Engine settings",
        description: "Get normalized native Context Engine configuration and configured Kilo provider models.",
        operationId: "config.contextEngine.get",
        responses: {
          200: {
            description: "Context Engine settings",
            content: {
              "application/json": {
                schema: resolver(ContextEngineSettingsOutput),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.contextEngine.get", c, function* () {
          const cfg = yield* Config.Service
          const svc = yield* Provider.Service
          const current = yield* cfg.get()
          const providers = yield* svc.list()
          return {
            config: ContextEngineConfig.normalize(current.contextEngine),
            models: ContextEngineModelOptions.fromProviders(providers),
          }
        }),
    )
    .post(
      "/context-engine",
      describeRoute({
        summary: "Save Context Engine settings",
        description: "Save native Context Engine configuration.",
        operationId: "config.contextEngine.save",
        responses: {
          200: {
            description: "Context Engine settings saved",
            content: {
              "application/json": {
                schema: resolver(ContextEngineSaveOutput),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ContextEngineSaveInput),
      async (c) =>
        jsonRequest("ConfigRoutes.contextEngine.save", c, function* () {
          const input = c.req.valid("json")
          const cfg = yield* Config.Service
          const patch = ContextEngineConfig.savePatch(input.config)
          const config = patch.contextEngine
          yield* cfg.update(patch, { dispose: false })
          return { config }
        }),
    )
    .get(
      "/warnings",
      describeRoute({
        summary: "Get config warnings",
        description: "Get warnings generated during config loading (e.g., invalid JSON, schema errors).",
        operationId: "config.warnings",
        responses: {
          200: {
            description: "Config warnings",
            content: {
              "application/json": {
                schema: resolver(Config.Warning.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.warnings", c, function* () {
          const cfg = yield* Config.Service
          return yield* cfg.warnings()
        }),
    )
    // kilocode_change end
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ConfigProvidersResult.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.providers", c, function* () {
          const svc = yield* Provider.Service
          const providers = yield* svc.list()
          const defaults = Provider.defaultModelIDs(providers)

          // kilocode_change start - Fetch default model from Kilo API when the kilo provider is available.
          // Only call the Kilo API when the kilo provider is actually available.
          // This prevents unnecessary network calls for teams using only their
          // own providers (e.g. LiteLLM) via enabled_providers config.
          if (providers[ProviderID.kilo]) {
            const auth = yield* Auth.Service
            const kiloAuth = yield* auth.get("kilo")
            const token = kiloAuth?.type === "oauth" ? kiloAuth.access : kiloAuth?.key
            const organizationId = kiloAuth?.type === "oauth" ? kiloAuth.accountId : undefined
            const kiloApiDefault = yield* Effect.promise(() => fetchDefaultModel(token, organizationId))
            if (kiloApiDefault && providers[ProviderID.kilo]?.models[kiloApiDefault]) {
              defaults[ProviderID.kilo] = ModelID.make(kiloApiDefault)
            }
          }
          // kilocode_change end

          return {
            providers: Object.values(providers),
            default: defaults, // kilocode_change
          }
        }),
    ),
)
