// kilocode_change - new file
import { Effect } from "effect"
import path from "path"
import { Permission } from "@/permission"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Session } from "../../session/session"
import type { Agent } from "../../agent/agent"
import type { Config } from "../../config/config"
import z from "zod"

// RATIONALE: Mirror narrow state slice Task tool consumes and ignore unrelated TUI fields.
const ModelState = z
  .object({
    model: z.record(z.string(), z.object({ providerID: ProviderID.zod, modelID: ModelID.zod })).optional(),
    variant: z.record(z.string(), z.string().optional()).optional(),
  })
  .passthrough()

export namespace KiloTask {
  const HANDOFF = "agent_team_orchestrator_handoff"

  export function handoff(input: { cfg: Config.Info; caller: Agent.Info; next: Agent.Info; name: string }) {
    if (input.cfg.agentTeam?.enabled !== true) return false
    return input.caller.name === "secretary" && input.next.name === "team" && input.name === "team"
  }

  /** Reject primary agents used as subagents unless this is the Secretary -> Orchestrator handoff. */
  export function validate(info: Agent.Info, name: string, opts?: { handoff?: boolean }) {
    if (info.mode === "primary" && opts?.handoff !== true) {
      throw new Error(`Agent "${name}" is a primary agent and cannot be used as a subagent`)
    }
    if (info.hidden === true) throw new Error(`Agent "${name}" is hidden and cannot be used as a subagent`)
  }

  /** Enforce Agent Team routing beyond generic primary/subagent mode checks. */
  export function validateRoute(input: {
    cfg: Config.Info
    caller: Agent.Info
    next: Agent.Info
    name: string
    handoff?: boolean
  }) {
    if (input.cfg.agentTeam?.enabled === true && input.caller.name === "secretary" && input.handoff !== true) {
      throw new Error(`Secretary can only delegate to Orchestrator (@team), not "${input.name}"`)
    }
    validate(input.next, input.name, { handoff: input.handoff })
  }

  function marked(session: Session.Info) {
    return session.permission?.some((rule) => rule.permission === HANDOFF && rule.action === "allow") === true
  }

  /** Reject nested delegation except Orchestrator sessions created by Secretary handoff. */
  export function validateCaller(input: { caller: Agent.Info; session: Session.Info }) {
    if (!input.session.parentID) return
    if (input.caller.name === "team" && marked(input.session)) return
    throw new Error(`Agent "${input.caller.name}" is already running as a subagent and cannot delegate again`)
  }

  export function marker(): Permission.Ruleset {
    return [{ permission: HANDOFF, pattern: "*", action: "allow" }]
  }

  function unguard(rules: Permission.Ruleset): Permission.Ruleset {
    const skip = new Set<number>()
    for (const permission of ["edit", "bash"]) {
      const index = rules.findLastIndex(
        (rule) => rule.permission === permission && rule.pattern === "*" && rule.action === "deny",
      )
      if (index >= 0) skip.add(index)
    }
    return rules.filter((_, index) => !skip.has(index))
  }

  /** Kilo keeps delegation one level deep to avoid recursive subagent chains. */
  export function nestedTask(): false {
    return false
  }

  /**
   * Build inherited permission rules from the calling agent.
   * Merges the static agent definition with the session's accumulated permissions
   * so restrictions survive multi-hop chains (plan → general → explore).
   *
   * The caller must resolve `caller` (Agent.Info) and `session` (Session.Info)
   * before calling — this function is pure/synchronous.
   */
  export function inherited(input: {
    caller: Agent.Info
    session: Session.Info
    mcp: Config.Info["mcp"]
    handoff?: boolean
  }): Permission.Ruleset {
    const rules = Permission.merge(input.caller.permission ?? [], input.session.permission ?? [])
    const prefixes = Object.keys(input.mcp ?? {}).map((k) => k.replace(/[^a-zA-Z0-9_-]/g, "_") + "_")
    const isMcp = (p: string) => prefixes.some((prefix) => p.startsWith(prefix))
    const filtered = rules.filter(
      (r: Permission.Rule) => r.permission === "edit" || r.permission === "bash" || isMcp(r.permission),
    )
    if (input.handoff && input.caller.name === "secretary") return unguard(filtered)
    return filtered
  }

  /** Extra permission rules appended to subagent sessions */
  export function permissions(rules: Permission.Ruleset, opts?: { task?: boolean }): Permission.Ruleset {
    if (opts?.task) return rules
    return [{ permission: "task", pattern: "*", action: "deny" }, ...rules]
  }

  /** Return saved CLI model for agent, if any. */
  export const resolveModel = Effect.fn("KiloTask.resolveModel")(function* (name: string) {
    if (Flag.KILO_CLIENT !== "cli") return undefined
    const file = path.join(Global.Path.state, "model.json")
    const state = yield* Effect.tryPromise({
      try: () =>
        Bun.file(file)
          .text()
          .then((raw) => ModelState.safeParse(JSON.parse(raw)))
          .then((result) => (result.success ? result.data : undefined))
          .catch(() => undefined),
      catch: () => undefined,
    })
    const model = state?.model?.[name]
    if (!model) return undefined
    return {
      ...model,
      variant: state?.variant?.[`${model.providerID}/${model.modelID}`],
    }
  })
}
