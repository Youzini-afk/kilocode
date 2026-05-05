import { describe, expect, test } from "bun:test"
import { ContextEngineConfig, ContextEngineModelOptions } from "../../../src/kilocode/context-engine"

describe("context engine settings route data", () => {
  test("combines normalized config and model options", () => {
    const config = ContextEngineConfig.normalize({ enabled: true, historian: { model: "openai/gpt-5.1" } })
    const models = ContextEngineModelOptions.fromProviders({
      openai: { id: "openai", name: "OpenAI", models: { "gpt-5.1": { id: "gpt-5.1", name: "GPT 5.1" } } },
    })
    expect(config.enabled).toBe(true)
    expect(config.historian.model).toBe("openai/gpt-5.1")
    expect(models[0]?.value).toBe("openai/gpt-5.1")
  })
})
