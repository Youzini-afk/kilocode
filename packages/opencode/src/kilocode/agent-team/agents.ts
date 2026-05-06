import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"

export const role = [
  "explorer",
  "librarian",
  "oracle",
  "designer",
  "fixer",
  "observer",
  "council",
  "councillor",
] as const

export type Role = (typeof role)[number]
export type PrimaryRole = "orchestrator" | "team"

export type AgentInfo = {
  name: string
  displayName?: string
  description?: string
  deprecated?: boolean
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission: Permission.Ruleset
  model?: { modelID: string; providerID: string }
  variant?: string
  prompt?: string
  options: Record<string, unknown>
  steps?: number
}

export type AgentMap = Record<string, AgentInfo>

export type RoleConfig = {
  enabled?: boolean
  model?: string | null
  variant?: string | null
  temperature?: number | null
  skills?: string[]
  mcps?: string[]
  options?: Record<string, unknown>
  displayName?: string | null
}

export type Config = {
  enabled?: boolean
  takeoverDefault?: boolean
  roles?: Partial<Record<Role | PrimaryRole, RoleConfig>>
  sessionReuse?: {
    enabled?: boolean
    maxSessionsPerAgent?: number
  }
  council?: {
    enabled?: boolean
    defaultPreset?: string
    timeoutMs?: number
  }
  autoContinue?: {
    enabled?: boolean
    maxContinuations?: number
    cooldownMs?: number
  }
}

type Context = {
  defaults: Permission.Ruleset
  user: Permission.Ruleset
  mcp: Record<string, "allow" | "ask" | "deny">
  cfg?: Config
}

type PermissionConfig = Parameters<typeof Permission.fromConfig>[0]

const visible = role.filter((item) => item !== "councillor")

const descriptions: Record<Role, string> = {
  explorer:
    "Fast local codebase discovery. Use for finding files, symbols, call sites, and architectural entry points.",
  librarian:
    "Current documentation and external source research. Use for library APIs, official examples, version-specific behavior, and unfamiliar dependencies.",
  oracle:
    "Senior technical review. Use for architecture, high-risk debugging, maintainability, security, data integrity, and simplification decisions.",
  designer:
    "UI/UX implementation and review. Use for user-facing layout, interaction, accessibility, visual hierarchy, and design-system polish.",
  fixer:
    "Bounded implementation. Use for clearly specified edits, tests, fixtures, and isolated code changes after scope is known.",
  observer:
    "Visual analysis. Use for screenshots, images, PDFs, diagrams, and exact extraction of visible errors or UI details.",
  council:
    "Optional multi-model consensus. Use only for high-stakes or ambiguous decisions where independent perspectives justify extra cost and latency.",
  councillor: "Internal council advisor. Provides independent read-only analysis for a council session.",
}

const roleBrief = () =>
  visible
    .map((item) => [item, descriptions[item]] as const)
    .map(([name, description]) => `- @${name}: ${description}`)
    .join("\n")

export const team = `You are Kilo Agent Team, a pragmatic engineering orchestrator.

Your job is to optimize for correctness, speed, cost, and reviewability. You can work directly, but you should delegate when a specialist clearly lowers risk or latency.

Available specialists:
${roleBrief()}

Workflow:
1. Understand the request and identify missing critical inputs.
2. Decide whether specialist delegation has net value. Skip delegation when the overhead is higher than doing the work directly.
3. Split independent work into parallel waves only when file ownership and dependencies are clear.
4. Provide subagents with concise goals, relevant paths, constraints, and expected output.
5. Integrate results yourself. Do not blindly paste specialist output.
6. Verify with the smallest relevant checks when code changes are made.

Delegation rules:
- Use @explorer for broad local code discovery.
- Use @librarian for current external docs and APIs.
- Use @oracle for reviews, architecture, persistent failures, and high-risk decisions.
- Use @designer for user-facing UI/UX work.
- Use @fixer for bounded implementation after scope is clear.
- Use @observer for image, screenshot, PDF, and diagram analysis.
- Use @council only when multiple model opinions justify added cost.
- Do not delegate a single obvious read or tiny edit.
- Do not run conflicting edit subagents in parallel against the same files.

Communication:
- Be concise and factual.
- State material assumptions.
- Mention delegation only when it changes how the work proceeds.
- Push back on risky or unclear requests with a concrete alternative.`

export const prompts: Record<Role, string> = {
  explorer: `You are Explorer, Kilo's fast local codebase discovery specialist.

Find files, symbols, call sites, configuration, and architectural entry points quickly. Prefer exact codebase search tools before broad reading. Return concise findings with file paths and confidence.

You are read-only. Do not edit files and do not delegate.`,
  librarian: `You are Librarian, Kilo's documentation and external research specialist.

Use official documentation, source repositories, and reliable references to answer library, API, and ecosystem questions. Prefer primary sources. Distinguish current documented behavior from inference. Return concise findings with links or file references when available.

You are read-only. Do not edit files and do not delegate.`,
  oracle: `You are Oracle, Kilo's senior technical reviewer.

Analyze architecture, debugging strategy, maintainability, performance, security, and data integrity. Prefer simpler designs unless complexity clearly earns its cost. Give actionable recommendations with concrete files or code paths when relevant.

You are read-only. Do not implement changes and do not delegate.`,
  designer: `You are Designer, Kilo's UI and UX specialist.

Improve or review user-facing interfaces with attention to visual hierarchy, responsive behavior, accessibility, design-system consistency, and interaction polish. Respect existing component libraries and design tokens before adding custom styling.

You may edit UI files when asked. Do not delegate.`,
  fixer: `You are Fixer, Kilo's bounded implementation specialist.

Execute a clearly scoped task using the context supplied by the caller. Read the relevant files before editing. Keep changes minimal, update tests when requested or directly relevant, and report changed files plus verification.

Do not perform broad research, do not make architecture decisions, and do not delegate.`,
  observer: `You are Observer, Kilo's visual analysis specialist.

Read the specified image, screenshot, PDF, or diagram and extract structured observations. Preserve exact visible error text and UI labels. State uncertainty when content is blurry or incomplete.

You are read-only. Do not edit files and do not delegate.`,
  council: `You are Council, Kilo's multi-model synthesis agent.

When council is enabled, use the council_session tool to collect independent councillor views, then synthesize a final answer. Include the final recommendation, councillor details, disagreements, and confidence. Use this only when the extra cost and latency are justified.

Do not edit files directly.`,
  councillor: `You are an independent councillor in a Kilo council session.

Inspect the available code or context before answering. Provide your own best analysis without trying to predict other councillors. Be concise, cite relevant files, state assumptions, and identify uncertainty.

You are read-only. Do not edit files, run shell commands, or delegate.`,
}

const readonly = (ctx: Context) =>
  Permission.merge(
    ctx.defaults,
    ctx.user,
    Permission.fromConfig({
      "*": "deny",
      question: "allow",
      read: "allow",
      grep: "allow",
      glob: "allow",
      list: "allow",
      webfetch: "allow",
      websearch: "allow",
      codesearch: "allow",
      codebase_search: "allow",
      semantic_search: "allow",
      skill: "allow",
      task: "deny",
      bash: "deny",
      ...ctx.mcp,
    }),
    ctx.user.filter((rule) => rule.action === "deny"),
  )

const editable = (ctx: Context) =>
  Permission.merge(
    ctx.defaults,
    Permission.fromConfig({
      question: "allow",
      suggest: "allow",
      task: "deny",
      semantic_search: "allow",
    }),
    ctx.user,
    Permission.fromConfig({ task: "deny" }),
  )

const conductor = (ctx: Context) =>
  Permission.merge(
    ctx.defaults,
    Permission.fromConfig({
      "*": "deny",
      question: "allow",
      suggest: "allow",
      read: "allow",
      grep: "allow",
      glob: "allow",
      list: "allow",
      task: "allow",
      todoread: "allow",
      todowrite: "allow",
      webfetch: "allow",
      websearch: "allow",
      codesearch: "allow",
      codebase_search: "allow",
      semantic_search: "allow",
      skill: "allow",
      bash: "deny",
      ...ctx.mcp,
    }),
    ctx.user,
    Permission.fromConfig({ bash: "deny" }),
  )

const moderator = (ctx: Context) =>
  Permission.merge(
    ctx.defaults,
    ctx.user,
    Permission.fromConfig({
      "*": "deny",
      question: "allow",
      suggest: "allow",
      read: "allow",
      grep: "allow",
      glob: "allow",
      list: "allow",
      todoread: "allow",
      webfetch: "allow",
      websearch: "allow",
      codesearch: "allow",
      codebase_search: "allow",
      semantic_search: "allow",
      skill: "allow",
      council_session: "allow",
      task: "deny",
      bash: "deny",
      ...ctx.mcp,
    }),
    ctx.user.filter((rule) => rule.action === "deny"),
  )

function select(items: string[], all: string[]) {
  const allow = items.filter((item) => !item.startsWith("!"))
  const deny = items.filter((item) => item.startsWith("!")).map((item) => item.slice(1))
  if (deny.includes("*")) return []
  if (allow.includes("*")) return all.filter((item) => !deny.includes(item))
  return allow.filter((item) => all.includes(item) && !deny.includes(item))
}

function skill(cfg: RoleConfig | undefined): PermissionConfig {
  if (!cfg?.skills) return {}
  const rules: Record<string, "allow" | "deny"> = cfg.skills.some((item) => !item.startsWith("!") && item !== "*")
    ? { "*": "deny" }
    : { "*": cfg.skills.includes("*") ? "allow" : "deny" }

  for (const item of cfg.skills) {
    if (item === "*") continue
    if (item.startsWith("!")) {
      rules[item.slice(1)] = "deny"
      continue
    }
    rules[item] = "allow"
  }
  return { skill: rules }
}

function server(name: string) {
  return name.endsWith("_*") ? name.slice(0, -2) : name
}

function mcp(ctx: Context, cfg: RoleConfig | undefined): PermissionConfig {
  if (!cfg?.mcps) return {}
  const keys = Object.keys(ctx.mcp)
  const all = keys.map(server)
  const picked = new Set(select(cfg.mcps.map(server), all))
  const rules = Object.fromEntries(keys.map((key) => [key, picked.has(server(key)) ? ctx.mcp[key] : "deny"]))
  return rules
}

function apply(agent: AgentInfo, cfg: RoleConfig | undefined, ctx: Context) {
  if (cfg?.model) agent.model = Provider.parseModel(cfg.model)
  if (cfg?.variant) agent.variant = cfg.variant
  if (cfg?.temperature !== undefined && cfg.temperature !== null) agent.temperature = cfg.temperature
  if (cfg?.displayName) agent.displayName = cfg.displayName
  if (cfg?.options) agent.options = { ...agent.options, ...cfg.options }
  agent.permission = Permission.merge(
    agent.permission,
    Permission.fromConfig(skill(cfg)),
    Permission.fromConfig(mcp(ctx, cfg)),
  )
}

export function enabled(cfg: Config | undefined, item: Role) {
  if (item === "council") return cfg?.council?.enabled === true && cfg?.roles?.council?.enabled !== false
  if (item === "councillor") return cfg?.council?.enabled === true
  return cfg?.roles?.[item]?.enabled !== false
}

function primary(cfg: Config | undefined) {
  return cfg?.roles?.orchestrator ?? cfg?.roles?.team
}

function primaryEnabled(cfg: Config | undefined) {
  return primary(cfg)?.enabled !== false
}

export function build(ctx: Context): AgentMap {
  const cfg = primary(ctx.cfg)
  const base: AgentMap = primaryEnabled(ctx.cfg)
    ? {
        team: {
          name: "team",
          displayName: "Agent Team",
          description: "Coordinate complex work by delegating to Kilo specialist agents when useful.",
          prompt: team,
          options: {},
          permission: conductor(ctx),
          mode: "primary",
          native: true,
          temperature: 0.1,
        },
      }
    : {}
  if (base.team) apply(base.team, cfg, ctx)

  const agents = Object.fromEntries(
    role
      .filter((item) => enabled(ctx.cfg, item))
      .map((item) => {
        const cfg = ctx.cfg?.roles?.[item]
        const agent: AgentInfo = {
          name: item,
          description: descriptions[item],
          prompt: prompts[item],
          options: {},
          permission:
            item === "fixer" || item === "designer"
              ? editable(ctx)
              : item === "council"
                ? moderator(ctx)
                : readonly(ctx),
          mode: item === "council" ? ("all" as const) : ("subagent" as const),
          native: true,
          hidden: item === "councillor" ? true : undefined,
          temperature: item === "designer" ? 0.5 : item === "fixer" || item === "councillor" ? 0.2 : 0.1,
        }
        apply(agent, cfg, ctx)
        return [item, agent]
      }),
  ) as AgentMap

  return { ...base, ...agents }
}
