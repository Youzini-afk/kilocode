import { describe, expect, test } from "bun:test"
import type { Config } from "@/config/config"
import { AgentTeamSessionReuse } from "@/kilocode/agent-team/session-reuse"

const cfg = (maxSessionsPerAgent = 2, secretary = false) =>
  ({
    agentTeam: {
      enabled: true,
      secretary: secretary ? { enabled: true } : undefined,
      sessionReuse: {
        enabled: true,
        maxSessionsPerAgent,
      },
    },
  }) as Config.Info

describe("AgentTeamSessionReuse", () => {
  test("remembers sessions and resolves short aliases", () => {
    const parent = "parent-alias"
    const entry = AgentTeamSessionReuse.remember({
      cfg: cfg(),
      caller: "team",
      parent,
      agent: "fixer",
      taskID: "task-1",
      description: "fix cache key",
      prompt: "fix the cache key",
    })

    expect(entry?.alias).toBe("fix-1")
    expect(
      AgentTeamSessionReuse.resolve({ cfg: cfg(), caller: "team", parent, agent: "fixer", taskID: "fix-1" }),
    ).toMatchObject({ taskID: "task-1" })
    expect(AgentTeamSessionReuse.format({ cfg: cfg(), caller: "team", parent })).toContain("fix-1 fix cache key")
    expect(AgentTeamSessionReuse.format({ cfg: cfg(), caller: "team", parent })).toContain("[task-1]")
  })

  test("keeps only the configured number of sessions per agent", () => {
    const parent = "parent-trim"
    for (const taskID of ["task-1", "task-2", "task-3"]) {
      AgentTeamSessionReuse.remember({
        cfg: cfg(2),
        caller: "team",
        parent,
        agent: "oracle",
        taskID,
        description: taskID,
      })
    }

    const text = AgentTeamSessionReuse.format({ cfg: cfg(2), caller: "team", parent }) ?? ""
    expect(text).not.toContain("ora-1")
    expect(text).toContain("ora-2")
    expect(text).toContain("ora-3")
  })

  test("stays inactive outside team sessions", () => {
    const parent = "parent-disabled"
    const entry = AgentTeamSessionReuse.remember({
      cfg: cfg(),
      caller: "code",
      parent,
      agent: "fixer",
      taskID: "task-1",
    })

    expect(entry).toBeUndefined()
    expect(AgentTeamSessionReuse.format({ cfg: cfg(), caller: "team", parent })).toBeUndefined()
  })

  test("supports Secretary sessions", () => {
    const parent = "parent-secretary"
    const entry = AgentTeamSessionReuse.remember({
      cfg: cfg(),
      caller: "secretary",
      parent,
      agent: "designer",
      taskID: "task-1",
      description: "polish layout",
    })

    expect(entry?.alias).toBeUndefined()

    const remembered = AgentTeamSessionReuse.remember({
      cfg: cfg(2, true),
      caller: "secretary",
      parent,
      agent: "designer",
      taskID: "task-2",
      description: "polish layout",
    })

    expect(remembered?.alias).toBe("des-1")
    expect(AgentTeamSessionReuse.format({ cfg: cfg(2, true), caller: "secretary", parent })).toContain(
      "des-1 polish layout",
    )
  })

  test("clears parent and child session references", () => {
    const parent = "parent-clear"
    AgentTeamSessionReuse.remember({
      cfg: cfg(),
      caller: "team",
      parent,
      agent: "designer",
      taskID: "child-clear",
      description: "review settings",
    })

    AgentTeamSessionReuse.clear("child-clear")
    expect(AgentTeamSessionReuse.format({ cfg: cfg(), caller: "team", parent })).toBeUndefined()

    AgentTeamSessionReuse.remember({
      cfg: cfg(),
      caller: "team",
      parent,
      agent: "designer",
      taskID: "child-again",
      description: "review settings again",
    })
    AgentTeamSessionReuse.clear(parent)

    expect(AgentTeamSessionReuse.resolve({ cfg: cfg(), caller: "team", parent, agent: "designer", taskID: "des-2" }))
      .toMatchObject({ taskID: "des-2" })
    expect(AgentTeamSessionReuse.format({ cfg: cfg(), caller: "team", parent })).toBeUndefined()
  })
})
