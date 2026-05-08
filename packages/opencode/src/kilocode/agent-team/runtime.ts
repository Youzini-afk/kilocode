import type { Config } from "@/config/config"
import type { ModelID, ProviderID } from "@/provider/schema"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionID } from "@/session/schema"
import { enabled, role, type Config as TeamConfig, type Role } from "./agents"

const START = "<agent_team_runtime>"
const END = "</agent_team_runtime>"

type TaskMeta = {
  sessionId: SessionID
  model?: {
    modelID: ModelID
    providerID: ProviderID
  }
  variant?: string
  failed?: boolean
  subagent_type?: string
}

type TaskResult = {
  title: string
  metadata: TaskMeta
  output: string
}

function primary(caller: string) {
  return caller === "team" || caller === "secretary"
}

function active(cfg: Config.Info | undefined, caller = "team") {
  if (!primary(caller)) return false
  return cfg?.agentTeam?.enabled === true
}

function text(msg: MessageV2.WithParts) {
  return msg.parts.find((part): part is MessageV2.TextPart => part.type === "text")
}

function media(msg: MessageV2.WithParts) {
  return msg.parts.some(
    (part) =>
      part.type === "file" &&
      (part.mime.startsWith("image/") || part.mime === "application/pdf" || part.mime.startsWith("video/")),
  )
}

function visible(cfg: TeamConfig | undefined) {
  return role.filter((item) => item !== "councillor" && enabled(cfg, item))
}

function names(cfg: Config.Info) {
  return visible(cfg.agentTeam).map((item) => `@${item}`)
}

function guidance(input: { cfg: Config.Info; msg: MessageV2.WithParts }) {
  const lines = [
    "Agent Team runtime reminders:",
    "- Re-check whether specialist delegation has net value before doing broad discovery, UI review, docs research, or bounded implementation yourself.",
    "- Use @architect only for large design/architecture choices; use @planner for concrete multi-step implementation plans; keep tiny work direct.",
    "- If you delegate, pass concise scope, paths, constraints, ownership, and expected output.",
    "- Keep independent branches parallel only when their file ownership does not overlap.",
    "- After edits, run the smallest relevant verification or explain why it cannot run.",
  ]

  if (media(input.msg) && enabled(input.cfg.agentTeam, "observer")) {
    lines.push("- Visual attachment detected: delegate exact screenshot/image/PDF interpretation to @observer with full file paths before acting on visual details.")
  }

  return lines.join("\n")
}

function agents(cfg: Config.Info) {
  const list = names(cfg)
  if (list.length === 0) return "No Agent Team specialists are currently enabled."
  return `Enabled Agent Team specialists: ${list.join(", ")}.`
}

function retry(input: {
  cfg: Config.Info
  params: { subagent_type: string; task_id?: string }
  cause: string
}) {
  return [
    "[ERROR] Agent Team delegation failed.",
    "",
    input.cause,
    "",
    "<agent_team_delegation_retry>",
    agents(input.cfg),
    "Retry guidance:",
    `- Requested subagent: @${input.params.subagent_type}. Use the exact name of an enabled specialist.`,
    "- Primary agents are normally not subagents. The only exception is Secretary handing off to @team.",
    input.params.task_id
      ? "- If this was a resume attempt, omit task_id or use a current resumable-session alias from the prompt."
      : "- If this is unrelated to an existing child session, do not set task_id.",
    "- If the failure came from missing context, retry with narrower scope and explicit file paths.",
    "</agent_team_delegation_retry>",
  ]
    .filter((item) => item !== undefined)
    .join("\n")
}

export namespace AgentTeamRuntime {
  export function inject(input: { cfg: Config.Info; messages: MessageV2.WithParts[] }) {
    const msg = input.messages.findLast((item) => item.info.role === "user" && primary(item.info.agent))
    if (!msg) return
    if (!active(input.cfg, msg.info.agent)) return
    const part = text(msg)
    if (!part) return
    if (part.text.includes(START)) return
    part.text = [part.text, "", START, guidance({ cfg: input.cfg, msg }), END].join("\n")
  }

  export function taskFailure(input: {
    cfg: Config.Info
    caller: string
    sessionID: SessionID
    params: { description: string; subagent_type: string; task_id?: string }
    cause: string
  }): TaskResult | undefined {
    if (!active(input.cfg, input.caller)) return undefined
    return {
      title: input.params.description,
      metadata: {
        sessionId: input.sessionID,
        failed: true,
        subagent_type: input.params.subagent_type,
      },
      output: retry({ cfg: input.cfg, params: input.params, cause: input.cause }),
    }
  }
}
