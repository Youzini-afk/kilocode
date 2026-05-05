import { describe, expect, test } from "bun:test"
import { ContextEngineMigration } from "../../../src/kilocode/context-engine/migration"
import { tmpdir } from "../../fixture/fixture"

describe("ContextEngineMigration", () => {
  test("converts legacy Magic Context config", () => {
    const config = ContextEngineMigration.fromLegacyConfig({
      enabled: true,
      historian: {
        model: "openai/gpt-5.1",
        fallback_models: ["github-copilot/claude-sonnet-4-5"],
        two_pass: false,
      },
      memory: { enabled: true, injection_budget_tokens: 8000 },
      embedding: { provider: "openai-compatible", model: "text-embedding-3-large" },
    })

    expect(config.enabled).toBe(true)
    expect(config.historian.model).toBe("openai/gpt-5.1")
    expect(config.historian.fallbackModels).toEqual(["github-copilot/claude-sonnet-4-5"])
    expect(config.historian.twoPass).toBe(false)
    expect(config.memory.enabled).toBe(true)
    expect(config.memory.injectionBudgetTokens).toBe(8000)
    expect(config.memory.embedding.provider).toBe("openai-compatible")
    expect(config.memory.embedding.model).toBe("text-embedding-3-large")
  })

  test("normalizes invalid legacy config", () => {
    const config = ContextEngineMigration.fromLegacyConfig(undefined)

    expect(config.enabled).toBe(false)
    expect(config.memory.embedding.provider).toBe("local")
  })

  test("loads legacy JSONC file", async () => {
    await using tmp = await tmpdir()
    const file = `${tmp.path}/kilo-magic-context.jsonc`
    await Bun.write(
      file,
      `{
        "enabled": true,
        "historian": { "model": "openai/gpt-5.1" },
      }`,
    )

    const config = await ContextEngineMigration.fromLegacyFile(file)

    expect(config?.enabled).toBe(true)
    expect(config?.historian.model).toBe("openai/gpt-5.1")
  })
})
