import { describe, expect, test } from "bun:test"
import { Permission } from "@/permission"
import { KiloTask } from "@/kilocode/tool/task"
import type { Agent } from "@/agent/agent"
import type { Config } from "@/config/config"
import type { Session } from "@/session/session"

function agent(name: string, mode: Agent.Info["mode"], permission = Permission.fromConfig({})) {
  return { name, mode, permission, options: {} } as Agent.Info
}

function session(input: { parentID?: string; permission?: Permission.Ruleset } = {}) {
  return input as Session.Info
}

const cfg = { agentTeam: { enabled: true } } as Config.Info

describe("KiloTask Agent Team handoff rules", () => {
  test("allows only Secretary to hand off to Orchestrator primary", () => {
    const secretary = agent("secretary", "primary")
    const team = agent("team", "primary")
    const code = agent("code", "primary")
    const fixer = agent("fixer", "subagent")

    const handoff = KiloTask.handoff({ cfg, caller: secretary, next: team, name: "team" })

    expect(handoff).toBe(true)
    expect(() => KiloTask.validateRoute({ cfg, caller: secretary, next: team, name: "team", handoff })).not.toThrow()
    expect(() => KiloTask.validateRoute({ cfg, caller: secretary, next: fixer, name: "fixer" })).toThrow(
      "Secretary can only delegate to Orchestrator",
    )
    expect(() => KiloTask.validateRoute({ cfg, caller: team, next: code, name: "code" })).toThrow("primary agent")
    expect(() => KiloTask.validateRoute({ cfg, caller: team, next: fixer, name: "fixer" })).not.toThrow()
    expect(KiloTask.handoff({ cfg, caller: team, next: code, name: "code" })).toBe(false)
  })

  test("allows nested delegation only from marked Orchestrator handoff sessions", () => {
    const team = agent("team", "primary")
    const fixer = agent("fixer", "subagent")

    expect(() =>
      KiloTask.validateCaller({ caller: team, session: session({ parentID: "parent", permission: KiloTask.marker() }) }),
    ).not.toThrow()
    expect(() => KiloTask.validateCaller({ caller: team, session: session({ parentID: "parent" }) })).toThrow(
      "cannot delegate again",
    )
    expect(() =>
      KiloTask.validateCaller({ caller: fixer, session: session({ parentID: "parent", permission: KiloTask.marker() }) }),
    ).toThrow("cannot delegate again")
  })

  test("keeps task available only for Orchestrator handoff sessions", () => {
    expect(Permission.evaluate("task", "fixer", KiloTask.permissions([])).action).toBe("deny")
    expect(Permission.evaluate("task", "fixer", KiloTask.permissions([], { task: true })).action).toBe("ask")
  })

  test("removes Secretary self-guards from Orchestrator handoff while preserving user denies", () => {
    const base = Permission.fromConfig({ bash: "allow", edit: "allow" })
    const user = Permission.fromConfig({ bash: "deny" })
    const guard = Permission.fromConfig({ bash: "deny", edit: "deny" })
    const secretary = agent("secretary", "primary", Permission.merge(base, user, guard))

    const rules = KiloTask.inherited({
      caller: secretary,
      session: session(),
      mcp: {},
      handoff: true,
    })

    expect(Permission.evaluate("bash", "*", rules).action).toBe("deny")
    expect(Permission.evaluate("edit", "*", rules).action).toBe("allow")
  })
})
