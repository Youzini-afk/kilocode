import { describe, expect, test } from "bun:test"
import { Permission } from "@/permission"
import { build, enabled, type Config } from "@/kilocode/agent-team/agents"
import { defaultTeam } from "@/kilocode/agent"

function agents(
  cfg?: Config,
  mcp: Record<string, "allow" | "ask" | "deny"> = {},
  base: Permission.Ruleset = Permission.fromConfig({}),
  user: Permission.Ruleset = Permission.fromConfig({}),
) {
  return build({
    defaults: base,
    user,
    mcp,
    cfg,
  })
}

function app(agentTeam: Parameters<typeof defaultTeam>[0]["agentTeam"]) {
  return { agentTeam } as Parameters<typeof defaultTeam>[0]
}

const shell = Permission.fromConfig({
  bash: {
    "*": "ask",
    "git status *": "allow",
  },
})

describe("Agent Team agents", () => {
  test("registers Orchestrator as the primary team agent and explorer specialist", () => {
    const map = agents({ enabled: true })

    expect(map.team?.mode).toBe("primary")
    expect(map.team?.displayName).toBe("Orchestrator")
    expect(map.team?.description).toContain("delegating substantial work")
    expect(map.explorer?.mode).toBe("subagent")
    expect(map.explorer?.description).toContain("codebase discovery")
    expect(map.team?.prompt).toContain("@explorer")
  })

  test("builds Secretary intake as a selectable primary agent", () => {
    const map = agents({
      enabled: true,
      roles: {
        secretary: {
          model: "openai/gpt-5.4",
          variant: "high",
        },
      },
    })

    expect(map.secretary?.mode).toBe("primary")
    expect(map.secretary?.displayName).toBe("Secretary")
    expect(map.secretary?.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(map.secretary?.variant).toBe("high")
    expect(map.secretary?.prompt).toContain("You are Secretary")
    expect(map.secretary?.prompt).toContain('subagent_type "team"')
    expect(map.secretary?.prompt).toContain("Forbidden task targets")
    expect(map.secretary?.prompt).toContain("@architect")
    expect(map.secretary?.prompt).toContain("@planner")
    expect(Permission.evaluate("task", "team", map.secretary.permission).action).toBe("allow")
    expect(Permission.evaluate("task", "fixer", map.secretary.permission).action).toBe("deny")
    expect(Permission.evaluate("bash", "git status --short", map.secretary.permission).action).toBe("deny")
    expect(Permission.evaluate("edit", "*", map.secretary.permission).action).toBe("deny")
  })

  test("keeps Orchestrator as default while Secretary remains selectable", () => {
    const direct = agents({ enabled: true })

    expect(direct.secretary?.mode).toBe("primary")
    expect(defaultTeam(app({ enabled: true }), direct)).toBe("team")
    expect(defaultTeam(app({ enabled: true, secretary: { enabled: true } }), direct)).toBe("team")
  })

  test("states Orchestrator delegation policy explicitly", () => {
    const map = agents({ enabled: true, council: { enabled: true } })

    expect(map.team?.prompt).toContain("You are Orchestrator")
    expect(map.team?.prompt).toContain("Direct path")
    expect(map.team?.prompt).toContain("Planning path")
    expect(map.team?.prompt).toContain("Design path")
    expect(map.team?.prompt).toContain("Prefer delegation for every non-small task")
    expect(map.team?.prompt).toContain("normally decide whether @planner adds execution value")
    expect(map.team?.prompt).toContain("for example: execution would become confusing without a listed plan")
    expect(map.team?.prompt).toContain("Specialist-first routing")
    expect(map.team?.prompt).toContain("Default to specialist execution for every non-small engineering task")
    expect(map.team?.prompt).toContain("Direct path stays local; Planning, Design, and Specialist paths activate relevant agents by default")
    expect(map.team?.prompt).toContain("dispatch @designer with explicit frontend file ownership")
    expect(map.team?.prompt).toContain("dispatch @fixer with explicit backend/test file ownership")
    expect(map.team?.prompt).toContain("split it into separate @designer and @fixer tasks")
    expect(map.team?.prompt).toContain("dispatch @explorer before implementation")
    expect(map.team?.prompt).toContain("dispatch @librarian before implementation")
    expect(map.team?.prompt).toContain("dispatch @oracle with a review tier")
    expect(map.team?.prompt).toContain("Match @architect to large, architectural")
    expect(map.team?.prompt).toContain("Match @planner to medium-or-larger implementation planning")
    expect(map.team?.prompt).toContain("Match @designer to UI/UX/frontend work")
    expect(map.team?.prompt).toContain("Match @fixer to backend, services, CLI, config, tests")
    expect(map.team?.prompt).toContain("Match @council to complex, high-risk")
  })

  test("keeps default bash available for the primary team agent", () => {
    const map = agents({ enabled: true }, {}, shell)
    const disabled = Permission.disabled(["bash"], map.team.permission)

    expect(disabled.has("bash")).toBe(false)
    expect(Permission.evaluate("bash", "git status --short", map.team.permission).action).toBe("allow")
    expect(Permission.evaluate("bash", "git push origin main", map.team.permission).action).toBe("ask")
  })

  test("routes explicit planning through native Kilo plan follow-up", () => {
    const map = agents({ enabled: true })

    expect(Permission.evaluate("plan_exit", "*", map.team.permission).action).toBe("allow")
    expect(map.team?.prompt).toContain("call plan_exit as the final action")
    expect(map.team?.prompt).toContain('native "Ready to implement?" follow-up')
    expect(map.team?.prompt).toContain("native question UI")
  })

  test("allows auto_continue only for primary agents", () => {
    const map = agents({ enabled: true, council: { enabled: true } })

    expect(Permission.evaluate("auto_continue", "*", map.team.permission).action).toBe("allow")
    expect(Permission.evaluate("auto_continue", "*", map.secretary.permission).action).toBe("allow")
    for (const item of [map.explorer!, map.fixer!, map.observer!, map.council!]) {
      expect(Permission.disabled(["auto_continue"], item.permission).has("auto_continue")).toBe(true)
    }
  })

  test("includes OMO prompt structures for specialist and council roles", () => {
    const map = agents({ enabled: true, council: { enabled: true } })

    expect(map.explorer?.prompt).toContain("Use glob for file discovery")
    expect(map.explorer?.prompt).toContain("grep for regex/text searches")
    expect(map.explorer?.prompt).toContain("ast_grep_search")
    expect(map.explorer?.prompt).toContain("<results>")
    expect(map.explorer?.prompt).toContain("<files>")
    expect(map.fixer?.prompt).toContain("<summary>")
    expect(map.fixer?.prompt).toContain("<changes>")
    expect(map.fixer?.prompt).toContain("<verification>")
    expect(map.fixer?.prompt).toContain("If tests or validation are skipped, state the reason")
    expect(map.observer?.prompt).toContain("Preserve exact visible error text")
    expect(map.observer?.prompt).toContain("do not guess")
    expect(map.council?.prompt).toContain("## Council Response")
    expect(map.council?.prompt).toContain("## Councillor Details")
    expect(map.council?.prompt).toContain("## Council Summary")
    expect(map.council?.prompt).toContain("consensus confidence")
    expect(map.team?.prompt).toContain("Use the auto_continue tool")
    expect(map.team?.prompt).toContain("Todo hygiene")
    expect(map.team?.prompt).toContain("do not leave any todo in_progress")
  })

  test("respects explicit user bash deny for the primary team agent", () => {
    const map = agents({ enabled: true }, {}, shell, Permission.fromConfig({ bash: "deny" }))
    const disabled = Permission.disabled(["bash"], map.team.permission)

    expect(disabled.has("bash")).toBe(true)
  })

  test("applies orchestrator overrides to the team primary agent", () => {
    const map = agents({
      enabled: true,
      roles: {
        orchestrator: {
          model: "openai/gpt-5.4-mini",
          variant: "xhigh",
          temperature: 0.3,
        },
      },
    })

    expect(map.team?.model).toEqual({ providerID: "openai", modelID: "gpt-5.4-mini" })
    expect(map.team?.variant).toBe("xhigh")
    expect(map.team?.temperature).toBe(0.3)
  })

  test("keeps team alias overrides backward compatible", () => {
    const map = agents({
      enabled: true,
      roles: {
        team: {
          variant: "medium",
        },
      },
    })

    expect(map.team?.variant).toBe("medium")
  })

  test("builds de-duplicated role model fallback chains", () => {
    const map = agents({
      enabled: true,
      roles: {
        fixer: {
          model: "openai/gpt-5.4",
          fallbackModels: ["anthropic/claude-sonnet-4.5", "openai/gpt-5.4"],
        },
      },
    })

    expect(map.fixer?.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(map.fixer?.modelChain).toEqual([
      { providerID: "openai", modelID: "gpt-5.4" },
      { providerID: "anthropic", modelID: "claude-sonnet-4.5" },
    ])
  })

  test("allows explorer to be disabled independently", () => {
    const map = agents({
      enabled: true,
      roles: {
        explorer: {
          enabled: false,
        },
      },
    })

    expect(map.explorer).toBeUndefined()
    expect(map.team?.prompt).not.toContain("@explorer")
    expect(enabled({ roles: { explorer: { enabled: false } } }, "explorer")).toBe(false)
  })

  test("describes designer as a UI UX frontend specialist", () => {
    const map = agents({ enabled: true })

    expect(map.designer?.description).toContain("frontend engineering")
    expect(map.designer?.prompt).toContain("user-facing frontend work")
  })

  test("builds Design and Plan as read-only advisory specialists", () => {
    const map = agents({ enabled: true })

    expect(map.architect?.mode).toBe("subagent")
    expect(map.architect?.displayName).toBe("Design")
    expect(map.architect?.description).toContain("High-level design")
    expect(map.architect?.prompt).toContain("Directives for Planner")
    expect(map.planner?.mode).toBe("subagent")
    expect(map.planner?.displayName).toBe("Plan")
    expect(map.planner?.description).toContain("Concrete implementation planning")
    expect(map.planner?.prompt).toContain("File ownership")
    for (const item of [map.architect!, map.planner!]) {
      expect(Permission.evaluate("task", "fixer", item.permission).action).toBe("deny")
      expect(Permission.evaluate("bash", "git status --short", item.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", "*", item.permission).action).toBe("deny")
      expect(Permission.evaluate("question", "*", item.permission).action).toBe("deny")
      expect(Permission.evaluate("read", "*", item.permission).action).toBe("allow")
    }
  })

  test("describes fixer, oracle, and council with team workflow responsibilities", () => {
    const map = agents({ enabled: true, council: { enabled: true } })

    expect(map.fixer?.description).toContain("backend")
    expect(map.fixer?.prompt).toContain("CLI, config, fixtures, tests")
    expect(map.oracle?.description).toContain("Tiered acceptance")
    expect(map.oracle?.prompt).toContain("Tier 1 quick acceptance")
    expect(map.oracle?.prompt).toContain("Tier 3 deep audit")
    expect(map.council?.description).toContain("technical council")
    expect(map.council?.prompt).toContain("rejected options")
  })

  test("requires both council settings and role enablement for council", () => {
    expect(enabled({ council: { enabled: true }, roles: { council: { enabled: false } } }, "council")).toBe(false)
    expect(enabled({ council: { enabled: true } }, "council")).toBe(true)
  })

  test("applies display name and provider options", () => {
    const map = agents({
      enabled: true,
      roles: {
        oracle: {
          displayName: "advisor",
          options: {
            reasoningEffort: "high",
          },
        },
      },
    })

    expect(map.oracle?.displayName).toBe("advisor")
    expect(map.oracle?.options).toEqual({ reasoningEffort: "high" })
  })

  test("applies recommended capability defaults when roles omit skills and MCPs", () => {
    const map = agents(
      { enabled: true },
      {
        "context7_*": "ask",
        "github_*": "ask",
        "kilo-playwright_*": "ask",
      },
    )

    expect(Permission.evaluate("skill", "openai-docs", map.team.permission).action).toBe("allow")
    expect(Permission.evaluate("skill", "review-work", map.oracle.permission).action).toBe("allow")
    expect(Permission.evaluate("skill", "ai-slop-remover", map.oracle.permission).action).toBe("deny")
    expect(Permission.evaluate("skill", "frontend-ui-ux", map.designer.permission).action).toBe("allow")
    expect(Permission.evaluate("skill", "git-master", map.fixer.permission).action).toBe("allow")
    expect(Permission.evaluate("skill", "imagegen", map.oracle.permission).action).toBe("deny")
    expect(Permission.evaluate("context7_query_docs", "*", map.team.permission).action).toBe("deny")
    expect(Permission.evaluate("github_create_issue", "*", map.team.permission).action).toBe("ask")
    expect(Permission.evaluate("context7_query_docs", "*", map.planner.permission).action).toBe("deny")
    expect(Permission.evaluate("kilo-playwright_browser_click", "*", map.designer.permission).action).toBe("ask")
  })

  test("restricts skills with wildcard syntax", () => {
    const map = agents({
      enabled: true,
      roles: {
        oracle: {
          skills: ["browser-use", "openai-docs"],
        },
        librarian: {
          skills: ["*", "!imagegen"],
        },
      },
    })

    expect(Permission.evaluate("skill", "browser-use", map.oracle.permission).action).toBe("allow")
    expect(Permission.evaluate("skill", "imagegen", map.oracle.permission).action).toBe("deny")
    expect(Permission.evaluate("skill", "openai-docs", map.librarian.permission).action).toBe("allow")
    expect(Permission.evaluate("skill", "imagegen", map.librarian.permission).action).toBe("deny")
  })

  test("restricts MCP servers with wildcard syntax", () => {
    const map = agents(
      {
        enabled: true,
        roles: {
          orchestrator: {
            mcps: ["*", "!context7"],
          },
          librarian: {
            mcps: ["github"],
          },
        },
      },
      {
        "context7_*": "ask",
        "github_*": "ask",
      },
    )

    expect(Permission.evaluate("github_create_issue", "*", map.team.permission).action).toBe("ask")
    expect(Permission.evaluate("context7_query_docs", "*", map.team.permission).action).toBe("deny")
    expect(Permission.evaluate("github_create_issue", "*", map.librarian.permission).action).toBe("ask")
    expect(Permission.evaluate("context7_query_docs", "*", map.librarian.permission).action).toBe("deny")
  })
})
