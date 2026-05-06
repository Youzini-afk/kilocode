import { describe, expect, test } from "bun:test"
import { AgentTeamAutoContinue } from "@/kilocode/agent-team/auto-continue"

describe("AgentTeamAutoContinue", () => {
  test("recognizes internal auto-continue prompts", () => {
    expect(
      AgentTeamAutoContinue.isAutoPrompt([
        { type: "text", text: "<agent_team_auto_continue>\ncontinue\n<agent_team_auto_continue>" },
      ]),
    ).toBe(true)
    expect(AgentTeamAutoContinue.isAutoPrompt([{ type: "text", text: "normal user prompt" }])).toBe(false)
  })
})
