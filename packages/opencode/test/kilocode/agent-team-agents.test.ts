import { describe, expect, test } from "bun:test"
import { Permission } from "@/permission"
import { build, enabled, type Config } from "@/kilocode/agent-team/agents"

function agents(cfg?: Config, mcp: Record<string, "allow" | "ask" | "deny"> = {}) {
  return build({
    defaults: Permission.fromConfig({}),
    user: Permission.fromConfig({}),
    mcp,
    cfg,
  })
}

describe("Agent Team agents", () => {
  test("registers the primary team and explorer specialist", () => {
    const map = agents({ enabled: true })

    expect(map.team?.mode).toBe("primary")
    expect(map.explorer?.mode).toBe("subagent")
    expect(map.explorer?.description).toContain("codebase discovery")
    expect(map.team?.prompt).toContain("@explorer")
  })

  test("applies orchestrator overrides to the team primary agent", () => {
    const map = agents({
      enabled: true,
      roles: {
        orchestrator: {
          model: "openai/gpt-5.4-mini",
          variant: "xhigh",
          temperature: 0.3,
        },
      },
    })

    expect(map.team?.model).toEqual({ providerID: "openai", modelID: "gpt-5.4-mini" })
    expect(map.team?.variant).toBe("xhigh")
    expect(map.team?.temperature).toBe(0.3)
  })

  test("keeps team alias overrides backward compatible", () => {
    const map = agents({
      enabled: true,
      roles: {
        team: {
          variant: "medium",
        },
      },
    })

    expect(map.team?.variant).toBe("medium")
  })

  test("allows explorer to be disabled independently", () => {
    const map = agents({
      enabled: true,
      roles: {
        explorer: {
          enabled: false,
        },
      },
    })

    expect(map.explorer).toBeUndefined()
    expect(enabled({ roles: { explorer: { enabled: false } } }, "explorer")).toBe(false)
  })

  test("requires both council settings and role enablement for council", () => {
    expect(enabled({ council: { enabled: true }, roles: { council: { enabled: false } } }, "council")).toBe(false)
    expect(enabled({ council: { enabled: true } }, "council")).toBe(true)
  })
})
