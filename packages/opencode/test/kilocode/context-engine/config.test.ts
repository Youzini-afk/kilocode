import { describe, expect, test } from "bun:test"
import { ContextEngineConfig } from "../../../src/kilocode/context-engine/config"

describe("ContextEngineConfig", () => {
  test("normalizes missing config to safe defaults", () => {
    const config = ContextEngineConfig.normalize(undefined)
    expect(config.enabled).toBe(false)
    expect(config.mode).toBe("recommended")
    expect(config.historian.enabled).toBe(true)
    expect(config.historian.model).toBe("")
    expect(config.historian.fallbackModels).toEqual([])
    expect(config.dreamer.enabled).toBe(false)
    expect(config.sidekick.enabled).toBe(false)
    expect(config.memory.enabled).toBe(false)
  })

  test("normalizes partial user config without mutating input", () => {
    const input = {
      enabled: true,
      historian: {
        model: "github-copilot/claude-sonnet-4-5",
        fallbackModels: ["openai/gpt-5.1", ""],
      },
      memory: { enabled: true },
    }
    const config = ContextEngineConfig.normalize(input)
    expect(input.historian.fallbackModels).toEqual(["openai/gpt-5.1", ""])
    expect(config.enabled).toBe(true)
    expect(config.historian.model).toBe("github-copilot/claude-sonnet-4-5")
    expect(config.historian.fallbackModels).toEqual(["openai/gpt-5.1"])
    expect(config.memory.enabled).toBe(true)
    expect(config.memory.embedding.provider).toBe("local")
  })

  test("accepts legacy snake case keys", () => {
    const config = ContextEngineConfig.normalize({
      historian: { fallback_models: [" openai/gpt-5.1 "], thinking_level: "high", two_pass: false },
      memory: {
        injection_budget_tokens: 8000,
        auto_promote: false,
        retrieval_count_promotion_threshold: 5,
        embedding: { api_key: "secret" },
      },
    })
    expect(config.historian.fallbackModels).toEqual(["openai/gpt-5.1"])
    expect(config.historian.thinkingLevel).toBe("high")
    expect(config.historian.twoPass).toBe(false)
    expect(config.memory.injectionBudgetTokens).toBe(8000)
    expect(config.memory.autoPromote).toBe(false)
    expect(config.memory.retrievalCountPromotionThreshold).toBe(5)
    expect(config.memory.embedding.apiKey).toBe("secret")
  })
})
