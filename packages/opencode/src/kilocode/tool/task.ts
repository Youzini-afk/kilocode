// kilocode_change - new file
import { Effect } from "effect"
import path from "path"
import { Permission } from "@/permission"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Session } from "../../session/session"
import type { Agent } from "../../agent/agent"
import type { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import z from "zod"

const log = Log.create({ service: "kilocode-task-model" })
const DEFAULT_SUBTASK_TIMEOUT_MS = 300_000
const DEFAULT_SUBTASK_MAX_DEPTH = 3

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

  export type Budget = {
    depth: number
    childDepth: number
    maxDepth: number
  }

  export const depth: (input: {
    sessions: Session.Interface
    session: Session.Info
    seen?: Set<string>
  }) => Effect.Effect<number, Error> = Effect.fn("KiloTask.depth")(function* (input) {
    const seen = new Set(input.seen ?? [])
    if (seen.has(input.session.id)) return yield* Effect.fail(new Error(`Session parent cycle detected: ${input.session.id}`))
    if (!input.session.parentID) return 0
    seen.add(input.session.id)
    const parent = yield* input.sessions.get(input.session.parentID)
    return 1 + (yield* depth({ sessions: input.sessions, session: parent, seen }))
  })

  /** Enforce bounded nested delegation for Agent Team while preserving legacy one-level safety elsewhere. */
  export const validateCaller: (input: {
    cfg: Config.Info
    caller: Agent.Info
    session: Session.Info
    sessions: Session.Interface
  }) => Effect.Effect<Budget, Error> = Effect.fn("KiloTask.validateCaller")(function* (input) {
    const current = yield* depth({ sessions: input.sessions, session: input.session })
    if (input.cfg.agentTeam?.enabled !== true) {
      if (current === 0) return { depth: current, childDepth: current + 1, maxDepth: 1 }
      if (
        input.caller.name === "team" &&
        input.session.permission?.some((rule) => rule.permission === HANDOFF && rule.action === "allow")
      ) {
        return { depth: current, childDepth: current + 1, maxDepth: current + 1 }
      }
      return yield* Effect.fail(
        new Error(`Agent "${input.caller.name}" is already running as a subagent and cannot delegate again`),
      )
    }

    const max = subtaskMaxDepth(input.cfg)
    const child = current + 1
    if (child <= max) return { depth: current, childDepth: child, maxDepth: max }
    return yield* Effect.fail(
      new Error(`Agent "${input.caller.name}" cannot delegate from current depth ${current}; maxDepth is ${max}`),
    )
  })

  export function validateDepth(input: { cfg: Config.Info; depth: number; maxDepth: number }) {
    if (input.cfg.agentTeam?.enabled !== true) return
    if (input.depth <= input.maxDepth) return
    throw new Error(`Cannot resume task session at delegation depth ${input.depth}; maxDepth is ${input.maxDepth}`)
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

  function taskPermission(info: Agent.Info) {
    return info.permission.some((rule) => rule.permission === "task" && rule.action !== "deny")
  }

  /** Kilo allows Agent Team nested delegation only within the configured depth budget. */
  export function nestedTask(input: {
    cfg: Config.Info
    next: Agent.Info
    depth: number
    maxDepth: number
    handoff?: boolean
  }) {
    if (!taskPermission(input.next)) return false
    if (input.handoff) return true
    if (input.cfg.agentTeam?.enabled !== true) return false
    return input.depth < input.maxDepth
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

  export function subtaskTimeout(cfg: Pick<Config.Info, "agentTeam">) {
    const value = cfg.agentTeam?.subtask?.timeoutMs
    if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SUBTASK_TIMEOUT_MS
    return Math.max(0, Math.floor(value))
  }

  export function subtaskMaxDepth(cfg: Pick<Config.Info, "agentTeam">) {
    const value = cfg.agentTeam?.subtask?.maxDepth
    if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SUBTASK_MAX_DEPTH
    return Math.max(1, Math.floor(value))
  }

  export function timeoutError(name: string, timeout: number) {
    return new Error(`Task subagent "${name}" timed out after ${timeout}ms`)
  }

  type Model = { providerID: ProviderID; modelID: ModelID }
  type Saved = Model & { variant?: string }
  type Choice = { model: Model; variant?: string; sticky?: boolean; direct?: boolean }

  function parse(value: string | null | undefined): Model | undefined {
    if (!value) return undefined
    const [providerID, ...parts] = value.split("/")
    return {
      providerID: ProviderID.make(providerID),
      modelID: ModelID.make(parts.join("/")),
    }
  }

  const saved = Effect.fn("KiloTask.savedModel")(function* (name: string) {
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

  /** Resolve the task subagent model while discarding stale unavailable overrides. */
  export const resolveModel = Effect.fn("KiloTask.resolveModel")(function* (input: {
    name: string
    agent: Pick<Agent.Info, "model" | "variant">
    config: Pick<Config.Info, "subagent_model" | "subagent_variant">
    parent: Model
  }) {
    const state = yield* saved(input.name)
    const cfg = parse(input.config.subagent_model)
    const choices: Array<Choice | undefined> = [
      state
        ? {
            model: { providerID: state.providerID, modelID: state.modelID },
            variant: state.variant,
            sticky: true,
          }
        : undefined,
      input.agent.model ? { model: input.agent.model, variant: input.agent.variant, direct: true } : undefined,
      cfg ? { model: cfg, variant: input.config.subagent_variant ?? undefined } : undefined,
    ]

    for (const choice of choices) {
      if (!choice) continue
      if (choice.direct) return { model: choice.model, variant: choice.variant }
      const full = yield* Effect.tryPromise(() =>
        Provider.getModel(choice.model.providerID, choice.model.modelID),
      ).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.debug("skipping unavailable task subagent model", {
              providerID: choice.model.providerID,
              modelID: choice.model.modelID,
              err,
            })
            return undefined
          }),
        ),
      )
      if (!full) continue
      const variant = choice.variant && full.variants?.[choice.variant] ? choice.variant : undefined
      return {
        model: choice.sticky && variant ? { ...choice.model, variant } : choice.model,
        variant,
      }
    }

    return { model: input.parent, variant: undefined }
  })
}
