import { describe, expect, it } from "bun:test"
import { splitConfigByScope } from "../../webview-ui/src/utils/config-scope"

describe("splitConfigByScope", () => {
  it("writes indexing enablement to project config only", () => {
    const split = splitConfigByScope({
      indexing: {
        enabled: true,
        provider: "ollama",
      },
    })

    expect(split.global).toEqual({ indexing: { provider: "ollama" } })
    expect(split.project).toEqual({ indexing: { enabled: true } })
  })

  it("writes context engine settings to project config", () => {
    const split = splitConfigByScope({
      contextEngine: {
        enabled: true,
        mode: "recommended",
      },
    })

    expect(split.global).toEqual({})
    expect(split.project).toEqual({
      contextEngine: {
        enabled: true,
        mode: "recommended",
      },
    })
  })

  it("writes Agent Team settings to project config", () => {
    const split = splitConfigByScope({
      agentTeam: {
        enabled: true,
        roles: {
          orchestrator: {
            model: "kilo/gpt-5.5",
            variant: "high",
          },
        },
      },
    })

    expect(split.global).toEqual({})
    expect(split.project).toEqual({
      agentTeam: {
        enabled: true,
        roles: {
          orchestrator: {
            model: "kilo/gpt-5.5",
            variant: "high",
          },
        },
      },
    })
  })
})
