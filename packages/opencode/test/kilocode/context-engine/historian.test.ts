import { describe, expect, test } from "bun:test"
import { ContextEngineHistorian } from "../../../src/kilocode/context-engine/historian"

describe("ContextEngineHistorian", () => {
  test("does not run when engine is disabled", () => {
    expect(ContextEngineHistorian.shouldRun({ engineEnabled: false, historianEnabled: true, messageCount: 200 })).toBe(
      false,
    )
  })

  test("does not run when historian is disabled", () => {
    expect(ContextEngineHistorian.shouldRun({ engineEnabled: true, historianEnabled: false, messageCount: 200 })).toBe(
      false,
    )
  })

  test("waits for enough messages", () => {
    expect(ContextEngineHistorian.shouldRun({ engineEnabled: true, historianEnabled: true, messageCount: 99 })).toBe(
      false,
    )
  })

  test("runs when enabled and history is large enough", () => {
    expect(ContextEngineHistorian.shouldRun({ engineEnabled: true, historianEnabled: true, messageCount: 100 })).toBe(
      true,
    )
  })
})
