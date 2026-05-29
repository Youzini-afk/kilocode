import { Config } from "@/config/config"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"

const Action = Schema.Literals(["enable", "disable", "status", "toggle"]).annotate({
  description: "Operation to perform for Agent Team auto-continue",
})
type Action = Schema.Schema.Type<typeof Action>

export const Params = Schema.Struct({
  action: Action,
})
export type Params = Schema.Schema.Type<typeof Params>

type State = {
  agentTeamEnabled: boolean
  enabled: boolean
  autoEnable: boolean
  autoEnableThreshold: number
  maxContinuations: number
  cooldownMs: number
}

type Meta = State & {
  action: Action
  truncated: boolean
}

function state(cfg: Config.Info): State {
  const auto = cfg.agentTeam?.autoContinue
  return {
    agentTeamEnabled: cfg.agentTeam?.enabled === true,
    enabled: auto?.enabled === true,
    autoEnable: auto?.autoEnable === true,
    autoEnableThreshold: auto?.autoEnableThreshold ?? 4,
    maxContinuations: auto?.maxContinuations ?? 5,
    cooldownMs: auto?.cooldownMs ?? 3000,
  }
}

function output(info: State) {
  return [
    `agentTeamEnabled: ${info.agentTeamEnabled}`,
    `enabled: ${info.enabled}`,
    `autoEnable: ${info.autoEnable}`,
    `autoEnableThreshold: ${info.autoEnableThreshold}`,
    `maxContinuations: ${info.maxContinuations}`,
    `cooldownMs: ${info.cooldownMs}`,
  ].join("\n")
}

function primary(agent: string) {
  return agent === "team" || agent === "secretary"
}

export const AutoContinueTool = Tool.define<typeof Params, Meta, Config.Service, "auto_continue">(
  "auto_continue",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Enable, disable, toggle, or inspect Kilo Agent Team auto-continue for the current project configuration.",
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          if (!primary(ctx.agent)) {
            return yield* Effect.fail(new Error("auto_continue can only be used by primary team or secretary agents"))
          }

          const cfg = yield* config.get()
          const current = state(cfg)
          const enabled =
            params.action === "enable"
              ? true
              : params.action === "disable"
                ? false
                : params.action === "toggle"
                  ? !current.enabled
                  : undefined

          if (enabled !== undefined) {
            if (!current.agentTeamEnabled) {
              return {
                title: "Auto-continue unavailable",
                output: [
                  "Agent Team is not enabled for this project.",
                  "Enable Agent Team first, then use auto_continue to manage auto-continuation.",
                  "",
                  output(current),
                ].join("\n"),
                metadata: { ...current, action: params.action, truncated: false },
              }
            }
            yield* ctx.ask({
              permission: "auto_continue",
              patterns: ["*"],
              always: ["*"],
              metadata: { action: params.action, enabled },
            })
            yield* config.update({ agentTeam: { autoContinue: { enabled } } } as Config.Info)
          }

          const latest = enabled === undefined ? current : state(yield* config.get())
          return {
            title: params.action === "status" ? "Auto-continue status" : "Auto-continue updated",
            output: output(latest),
            metadata: { ...latest, action: params.action, truncated: false },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
