import { describe, expect, test } from "bun:test"
import type { Config } from "@/config/config"
import { AgentTeamRuntime } from "@/kilocode/agent-team/runtime"
import { MessageV2 } from "@/session/message-v2"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, PartID, SessionID } from "@/session/schema"

const sessionID = SessionID.make("ses_agent_team_runtime")

function cfg(agentTeam: Config.Info["agentTeam"] = { enabled: true }) {
  return { agentTeam } as Config.Info
}

function info(id: string, agent = "team") {
  return {
    id: MessageID.make(id),
    sessionID,
    role: "user",
    time: { created: 0 },
    agent,
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    tools: {},
    mode: "",
  } as unknown as MessageV2.User
}

function text(id: string, value: string): MessageV2.TextPart {
  return {
    id: PartID.make("part_text_" + id),
    sessionID,
    messageID: MessageID.make(id),
    type: "text",
    text: value,
  }
}

function file(id: string, mime: string): MessageV2.FilePart {
  return {
    id: PartID.make("part_file_" + id),
    sessionID,
    messageID: MessageID.make(id),
    type: "file",
    mime,
    filename: "screen.png",
    url: "data:" + mime + ";base64,AAAA",
  }
}

function msg(id: string, parts: MessageV2.Part[], agent = "team"): MessageV2.WithParts {
  return { info: info(id, agent), parts }
}

describe("AgentTeamRuntime", () => {
  test("injects workflow and observer reminders into Team turns", () => {
    const messages = [msg("msg_runtime", [text("msg_runtime", "review this"), file("msg_runtime", "image/png")])]

    AgentTeamRuntime.inject({ cfg: cfg(), messages })

    expect((messages[0].parts[0] as MessageV2.TextPart).text).toContain("<agent_team_runtime>")
    expect((messages[0].parts[0] as MessageV2.TextPart).text).toContain("@observer")
  })

  test("injects workflow reminders into Secretary turns", () => {
    const messages = [msg("msg_secretary", [text("msg_secretary", "review this")], "secretary")]

    AgentTeamRuntime.inject({ cfg: cfg({ enabled: true, secretary: { enabled: true } }), messages })

    expect((messages[0].parts[0] as MessageV2.TextPart).text).toContain("<agent_team_runtime>")
  })

  test("skips disabled Agent Team and non-Team turns", () => {
    const disabled = [msg("msg_disabled", [text("msg_disabled", "review this")])]
    const code = [msg("msg_code", [text("msg_code", "review this")], "code")]
    const secretary = [msg("msg_secretary_disabled", [text("msg_secretary_disabled", "review this")], "secretary")]

    AgentTeamRuntime.inject({ cfg: cfg({ enabled: false }), messages: disabled })
    AgentTeamRuntime.inject({ cfg: cfg(), messages: code })
    AgentTeamRuntime.inject({ cfg: cfg({ enabled: true, secretary: { enabled: false } }), messages: secretary })

    expect((disabled[0].parts[0] as MessageV2.TextPart).text).not.toContain("<agent_team_runtime>")
    expect((code[0].parts[0] as MessageV2.TextPart).text).not.toContain("<agent_team_runtime>")
    expect((secretary[0].parts[0] as MessageV2.TextPart).text).not.toContain("<agent_team_runtime>")
  })

  test("formats Agent Team delegation retry guidance", () => {
    const result = AgentTeamRuntime.taskFailure({
      cfg: cfg(),
      caller: "team",
      sessionID,
      params: { description: "bad delegate", subagent_type: "unknown", task_id: "fix-9" },
      cause: "Unknown agent type",
    })

    expect(result?.output).toContain("<agent_team_delegation_retry>")
    expect(result?.output).toContain("omit task_id")
    expect(result?.output).toContain("secretary")
    expect(result?.metadata.failed).toBe(true)

    expect(
      AgentTeamRuntime.taskFailure({
        cfg: cfg({ enabled: true, secretary: { enabled: true } }),
        caller: "secretary",
        sessionID,
        params: { description: "bad delegate", subagent_type: "unknown" },
        cause: "Unknown agent type",
      })?.output,
    ).toContain("<agent_team_delegation_retry>")

    expect(
      AgentTeamRuntime.taskFailure({
        cfg: cfg(),
        caller: "code",
        sessionID,
        params: { description: "bad delegate", subagent_type: "unknown" },
        cause: "Unknown agent type",
      }),
    ).toBeUndefined()
  })
})
