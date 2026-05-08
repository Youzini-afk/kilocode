import type { Config, KiloClient } from "@kilocode/sdk/v2/client"
import { configFeatures } from "../features"
import { retry } from "../services/cli-backend/retry"

export type ConfigMessageContext = {
  client: () => KiloClient | null
  state: () => "connecting" | "connected" | "disconnected" | "error"
  pending: () => number
  cached: () => unknown
  setCached: (msg: unknown) => void
  workspace: () => string
  post: (msg: unknown) => void
  global?: () => Promise<Config | null | undefined>
  setGlobalCached?: (config: Config | null) => void
}

async function getGlobal(ctx: Pick<ConfigMessageContext, "global" | "setGlobalCached">) {
  if (!ctx.global) return undefined
  const config = (await ctx.global()) ?? null
  ctx.setGlobalCached?.(config)
  return config ?? undefined
}

export async function fetchConfig(ctx: ConfigMessageContext) {
  const client = ctx.client()
  if (!client || ctx.state() !== "connected") {
    const cached = ctx.cached()
    if (cached) ctx.post(cached)
    return
  }
  if (ctx.pending() > 0) return

  try {
    const dir = ctx.workspace()
    const { data: config } = await retry(() => client.config.get({ directory: dir }, { throwOnError: true }))
    const globalConfig = await getGlobal(ctx)
    const msg = {
      type: "configLoaded" as const,
      config,
      ...(ctx.global ? { globalConfig } : {}),
      features: configFeatures(config),
    }
    ctx.setCached(msg)
    ctx.post(msg)
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch config:", error)
  }
}

export async function fetchGlobalConfig(
  ctx: Pick<ConfigMessageContext, "client" | "state" | "post" | "setGlobalCached">,
) {
  const client = ctx.client()
  if (!client || ctx.state() !== "connected") return
  try {
    const { data: config } = await client.global.config.get({ throwOnError: true })
    ctx.setGlobalCached?.(config ?? null)
    ctx.post({ type: "globalConfigLoaded", config: config ?? {} })
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch global config:", error)
  }
}

export async function fetchConfigUpdated(ctx: Omit<ConfigMessageContext, "pending" | "cached">) {
  const client = ctx.client()
  if (!client || ctx.state() !== "connected") return
  try {
    const dir = ctx.workspace()
    const { data: config } = await retry(() => client.config.get({ directory: dir }, { throwOnError: true }))
    const globalConfig = await getGlobal(ctx)
    ctx.setCached({
      type: "configLoaded",
      config,
      ...(ctx.global ? { globalConfig } : {}),
      features: configFeatures(config),
    })
    ctx.post({
      type: "configUpdated",
      config,
      ...(ctx.global ? { globalConfig } : {}),
      features: configFeatures(config),
    })
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch config after update:", error)
  }
}
