import { describe, expect, test } from "bun:test"
import { ContextEngineModelOptions } from "../../../src/kilocode/context-engine/model-options"

describe("ContextEngineModelOptions", () => {
  test("builds sorted provider and model options", () => {
    const options = ContextEngineModelOptions.fromProviders({
      openai: {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5.1": { id: "gpt-5.1", name: "GPT 5.1" },
        },
      },
      "github-copilot": {
        id: "github-copilot",
        name: "GitHub Copilot",
        models: {
          "claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        },
      },
    })
    expect(options).toEqual([
      {
        value: "github-copilot/claude-sonnet-4-5",
        label: "GitHub Copilot · Claude Sonnet 4.5",
        provider: "github-copilot",
        model: "claude-sonnet-4-5",
      },
      { value: "openai/gpt-5.1", label: "OpenAI · GPT 5.1", provider: "openai", model: "gpt-5.1" },
    ])
  })
})
