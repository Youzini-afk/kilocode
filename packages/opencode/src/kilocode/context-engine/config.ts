import { isRecord } from "@/util/record"

export namespace ContextEngineConfig {
  export type Mode = "recommended" | "light" | "advanced"
  export type EmbeddingProvider = "local" | "openai-compatible" | "off"

  export type Agent = {
    enabled: boolean
    model: string
    fallbackModels: string[]
    variant: string
    thinkingLevel: string
  }

  export type Info = {
    enabled: boolean
    mode: Mode
    historian: Agent & { twoPass: boolean }
    dreamer: Agent
    sidekick: Agent
    memory: {
      enabled: boolean
      injectionBudgetTokens: number
      autoPromote: boolean
      retrievalCountPromotionThreshold: number
      embedding: {
        provider: EmbeddingProvider
        model: string
        endpoint: string
        apiKey: string
      }
    }
  }

  const agent: Agent = {
    enabled: false,
    model: "",
    fallbackModels: [],
    variant: "",
    thinkingLevel: "medium",
  }

  export const defaults: Info = {
    enabled: false,
    mode: "recommended",
    historian: { ...agent, enabled: true, twoPass: true },
    dreamer: { ...agent },
    sidekick: { ...agent },
    memory: {
      enabled: false,
      injectionBudgetTokens: 4000,
      autoPromote: true,
      retrievalCountPromotionThreshold: 3,
      embedding: {
        provider: "local",
        model: "Xenova/all-MiniLM-L6-v2",
        endpoint: "",
        apiKey: "",
      },
    },
  }

  function text(value: unknown, fallback: string) {
    if (typeof value !== "string") return fallback
    return value.trim()
  }

  function bool(value: unknown, fallback: boolean) {
    if (typeof value !== "boolean") return fallback
    return value
  }

  function num(value: unknown, fallback: number) {
    if (typeof value !== "number") return fallback
    if (!Number.isFinite(value)) return fallback
    return value
  }

  function list(value: unknown, fallback: string[]) {
    if (!Array.isArray(value)) return [...fallback]
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function mode(value: unknown): Mode {
    if (value === "recommended" || value === "light" || value === "advanced") return value
    return defaults.mode
  }

  function embedding(value: unknown): EmbeddingProvider {
    if (value === "local" || value === "openai-compatible" || value === "off") return value
    return defaults.memory.embedding.provider
  }

  function object(value: unknown) {
    if (isRecord(value)) return value
    return {}
  }

  function normalizeAgent(value: unknown, fallback: Agent): Agent {
    const input = object(value)
    return {
      enabled: bool(input.enabled, fallback.enabled),
      model: text(input.model, fallback.model),
      fallbackModels: list(input.fallbackModels ?? input.fallback_models, fallback.fallbackModels),
      variant: text(input.variant, fallback.variant),
      thinkingLevel: text(input.thinkingLevel ?? input.thinking_level, fallback.thinkingLevel),
    }
  }

  export function normalize(value: unknown): Info {
    const input = object(value)
    const historian = object(input.historian)
    const memory = object(input.memory)
    const embed = object(memory.embedding)
    return {
      enabled: bool(input.enabled, defaults.enabled),
      mode: mode(input.mode),
      historian: {
        ...normalizeAgent(historian, defaults.historian),
        twoPass: bool(historian.twoPass ?? historian.two_pass, defaults.historian.twoPass),
      },
      dreamer: normalizeAgent(input.dreamer, defaults.dreamer),
      sidekick: normalizeAgent(input.sidekick, defaults.sidekick),
      memory: {
        enabled: bool(memory.enabled, defaults.memory.enabled),
        injectionBudgetTokens: num(
          memory.injectionBudgetTokens ?? memory.injection_budget_tokens,
          defaults.memory.injectionBudgetTokens,
        ),
        autoPromote: bool(memory.autoPromote ?? memory.auto_promote, defaults.memory.autoPromote),
        retrievalCountPromotionThreshold: num(
          memory.retrievalCountPromotionThreshold ?? memory.retrieval_count_promotion_threshold,
          defaults.memory.retrievalCountPromotionThreshold,
        ),
        embedding: {
          provider: embedding(embed.provider),
          model: text(embed.model, defaults.memory.embedding.model),
          endpoint: text(embed.endpoint, defaults.memory.embedding.endpoint),
          apiKey: text(embed.apiKey ?? embed.api_key, defaults.memory.embedding.apiKey),
        },
      },
    }
  }

  export function savePatch(value: unknown) {
    const config = normalize(value)
    return {
      contextEngine: config,
      ...(config.enabled ? { compaction: { auto: false } } : {}),
    }
  }
}
