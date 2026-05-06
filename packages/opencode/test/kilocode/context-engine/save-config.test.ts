import { describe, expect, test } from "bun:test"
import { ContextEngineConfig } from "../../../src/kilocode/context-engine/config"

describe("context engine save", () => {
  test("normalizes saved draft", () => {
    const saved = ContextEngineConfig.normalize({
      enabled: true,
      historian: { model: "openai/gpt-5.1" },
      memory: { enabled: true },
    })
    expect(saved.enabled).toBe(true)
    expect(saved.historian.model).toBe("openai/gpt-5.1")
    expect(saved.memory.enabled).toBe(true)
    expect(saved.memory.embedding.provider).toBe("local")
  })

  test("disables native automatic compaction when engine is enabled", () => {
    const patch = ContextEngineConfig.savePatch({ enabled: true })
    expect(patch.contextEngine.enabled).toBe(true)
    expect(patch.compaction).toEqual({ auto: false })
  })

  test("does not change native automatic compaction when engine is disabled", () => {
    const patch = ContextEngineConfig.savePatch({ enabled: false })
    expect(patch.contextEngine.enabled).toBe(false)
    expect("compaction" in patch).toBe(false)
  })
})
