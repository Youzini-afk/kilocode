import { describe, expect, test } from "bun:test"
import { PluginManager } from "../../../src/plugin/manager"

describe("legacy Magic Context plugin conflict", () => {
  test("detects legacy plugin IDs", () => {
    expect(PluginManager.isLegacyMagicContextPlugin("kilocode-magic-context")).toBe(true)
    expect(PluginManager.isLegacyMagicContextPlugin("magic-context")).toBe(true)
    expect(PluginManager.isLegacyMagicContextPlugin("@kilocode/kilocode-magic-context")).toBe(true)
    expect(PluginManager.isLegacyMagicContextPlugin("local/kilocode-magic-context")).toBe(true)
    expect(PluginManager.isLegacyMagicContextPlugin("@kilocode/kilo-indexing")).toBe(false)
    expect(PluginManager.isLegacyMagicContextPlugin("not-kilocode-magic-context")).toBe(false)
  })

  test("keeps legacy runtime unless native runtime is explicitly selected", () => {
    expect(
      PluginManager.shouldLoadLegacyMagicContextPlugin({ contextEngine: { enabled: true } }, "kilocode-magic-context"),
    ).toBe(true)
    expect(
      PluginManager.shouldLoadLegacyMagicContextPlugin(
        { contextEngine: { enabled: true, runtime: "native" } },
        "kilocode-magic-context",
      ),
    ).toBe(false)
    expect(
      PluginManager.shouldLoadLegacyMagicContextPlugin({ contextEngine: { enabled: false } }, "kilocode-magic-context"),
    ).toBe(true)
    expect(PluginManager.shouldLoadLegacyMagicContextPlugin({ contextEngine: { enabled: true } }, "other")).toBe(true)
  })
})
