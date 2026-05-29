import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Permission } from "@/permission"
import { KiloTask } from "@/kilocode/tool/task"
import type { Agent } from "@/agent/agent"
import type { Config } from "@/config/config"
import type { Session } from "@/session/session"
import { SessionID } from "@/session/schema"

function agent(name: string, mode: Agent.Info["mode"], permission = Permission.fromConfig({})) {
  return { name, mode, permission, options: {} } as Agent.Info
}

function session(input: { id?: string; parentID?: string; permission?: Permission.Ruleset } = {}) {
  return { id: input.id ?? "ses_root", parentID: input.parentID, permission: input.permission } as Session.Info
}

function sessions(items: Record<string, Session.Info>) {
  return {
    get: (id: SessionID) => Effect.succeed(items[id]),
  } as unknown as Session.Interface
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

  test("preserves legacy one-level safety outside Agent Team", async () => {
    const team = agent("team", "primary")
    const fixer = agent("fixer", "subagent")
    const disabled = { agentTeam: { enabled: false } } as Config.Info
    const root = session({ id: "ses_root" })
    const child = session({ id: "ses_child", parentID: "ses_root", permission: KiloTask.marker() })
    const svc = sessions({ ses_root: root, ses_child: child })

    await expect(
      Effect.runPromise(KiloTask.validateCaller({ cfg: disabled, caller: team, session: root, sessions: svc })),
    ).resolves.toEqual({
      depth: 0,
      childDepth: 1,
      maxDepth: 1,
    })
    await expect(
      Effect.runPromise(KiloTask.validateCaller({ cfg: disabled, caller: fixer, session: child, sessions: svc })),
    ).rejects.toThrow("cannot delegate again")
    await expect(
      Effect.runPromise(KiloTask.validateCaller({ cfg: disabled, caller: team, session: child, sessions: svc })),
    ).resolves.toEqual({
      depth: 1,
      childDepth: 2,
      maxDepth: 2,
    })
  })

  test("enforces Agent Team max-depth by parent chain", async () => {
    const fixer = agent("fixer", "subagent")
    const root = session({ id: "ses_root" })
    const child = session({ id: "ses_child", parentID: "ses_root" })
    const grandchild = session({ id: "ses_grandchild", parentID: "ses_child" })
    const svc = sessions({ ses_root: root, ses_child: child, ses_grandchild: grandchild })
    const low = { agentTeam: { enabled: true, subtask: { maxDepth: 2 } } } as Config.Info

    await expect(Effect.runPromise(KiloTask.depth({ sessions: svc, session: grandchild }))).resolves.toBe(2)
    await expect(
      Effect.runPromise(KiloTask.validateCaller({ cfg: low, caller: fixer, session: grandchild, sessions: svc })),
    ).rejects.toThrow("current depth 2; maxDepth is 2")
  })

  test("keeps nested task available only with definition permission and depth budget", () => {
    const fixer = agent("fixer", "subagent", Permission.fromConfig({ task: "allow" }))
    const explorer = agent("explorer", "subagent")

    expect(Permission.evaluate("task", "fixer", KiloTask.permissions([])).action).toBe("deny")
    expect(Permission.evaluate("task", "fixer", KiloTask.permissions([], { task: true })).action).toBe("ask")
    expect(KiloTask.nestedTask({ cfg, next: fixer, depth: 1, maxDepth: 3 })).toBe(true)
    expect(KiloTask.nestedTask({ cfg, next: fixer, depth: 3, maxDepth: 3 })).toBe(false)
    expect(KiloTask.nestedTask({ cfg, next: explorer, depth: 1, maxDepth: 3 })).toBe(false)
  })

  test("resolves configurable subtask timeout", () => {
    expect(KiloTask.subtaskTimeout(cfg)).toBe(300_000)
    expect(KiloTask.subtaskTimeout({ agentTeam: { enabled: true, subtask: { timeoutMs: 0 } } } as Config.Info)).toBe(0)
    expect(KiloTask.subtaskTimeout({ agentTeam: { enabled: true, subtask: { timeoutMs: 42.8 } } } as Config.Info)).toBe(42)
    expect(KiloTask.subtaskMaxDepth(cfg)).toBe(3)
    expect(KiloTask.subtaskMaxDepth({ agentTeam: { enabled: true, subtask: { maxDepth: 2.8 } } } as Config.Info)).toBe(
      2,
    )
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
