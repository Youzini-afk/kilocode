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
  modelChain?: Array<{ modelID: string; providerID: string }>
  variant?: string
  prompt?: string
  options: Record<string, unknown>
  steps?: number
}

export type AgentMap = Record<string, AgentInfo>

export type RoleConfig = {
  enabled?: boolean
  model?: string | null
  fallbackModels?: string[]
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
    autoEnable?: boolean
    autoEnableThreshold?: number
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

function shell(ctx: Context) {
  return ctx.defaults.filter((rule) => rule.permission === "bash")
}

const visible = role.filter((item) => item !== "councillor")

const descriptions: Record<Role, string> = {
  explorer:
    "Parallel codebase discovery. Finds files, symbols, call sites, architecture seams, and unknown implementation paths quickly.",
  librarian:
    "Current documentation and external source research. Uses official references for library APIs, examples, version-specific behavior, and unfamiliar dependencies.",
  oracle:
    "Senior technical review. Handles architecture, persistent debugging, maintainability, security, data integrity, simplification, and YAGNI decisions.",
  designer:
    "UI/UX and frontend engineering specialist. Implements or reviews user-facing layout, interactions, accessibility, responsive behavior, visual hierarchy, and design-system polish.",
  fixer:
    "Bounded implementation specialist. Executes clearly scoped edits, tests, fixtures, and isolated code changes after discovery and decisions are settled.",
  observer:
    "Visual analysis specialist. Reads screenshots, images, PDFs, diagrams, and exact visible errors without pulling raw media into the coordinator context.",
  council:
    "Optional multi-model consensus. Uses independent councillors only for high-stakes or ambiguous decisions where extra cost and latency are justified.",
  councillor: "Internal council advisor. Provides independent read-only analysis for a council session.",
}

const roster: Record<Role, string> = {
  explorer: `@explorer
- Role: Parallel search specialist for discovering unknowns across the codebase.
- Permissions: Read/search only.
- Use when: broad or uncertain code discovery; multiple searches can run independently; you need a summarized map before editing.
- Do not use when: you already know the path; you need full file contents anyway; the lookup is a single obvious read; you are about to edit the same file yourself.`,
  librarian: `@librarian
- Role: Authoritative current docs and API reference specialist.
- Permissions: Read/search/web/docs only.
- Use when: library APIs may have changed; version-specific behavior matters; official examples are needed; the dependency is unfamiliar.
- Do not use when: the answer is stable general programming knowledge; the docs are already in context; a quick local code read is enough.`,
  oracle: `@oracle
- Role: Senior reviewer for architecture, persistent failures, security, data integrity, maintainability, and simplification.
- Permissions: Read/search only.
- Use when: a decision has long-term impact; a bug survived multiple attempts; risk is high; code needs YAGNI or maintainability review.
- Do not use when: this is a first routine fix attempt; the tradeoff is straightforward; speed matters more than deeper review.`,
  designer: `@designer
- Role: UI/UX and frontend engineer for polished user-facing work.
- Permissions: Read/write UI files, no delegation.
- Use when: users see the surface; responsive layout, interaction quality, accessibility, visual hierarchy, or design-system consistency matters.
- Do not use when: the change is backend/headless logic or a throwaway prototype where polish is irrelevant.`,
  fixer: `@fixer
- Role: Fast bounded execution specialist.
- Permissions: Read/write within the assigned scope, no delegation.
- Use when: implementation scope is clear; tests/fixtures need edits; independent folders/files can be split safely.
- Do not use when: discovery, architecture, or product decisions are still unresolved; the edit is tiny; explaining the task costs more than doing it.`,
  observer: `@observer
- Role: Visual analysis specialist for images, screenshots, PDFs, and diagrams.
- Permissions: Read-only.
- Use when: extracting visible UI details, error text, layout, or diagram relationships; include full file paths in the task prompt.
- Do not use when: the file is plain text or you need literal editable file contents.`,
  council: `@council
- Role: Multi-model consensus engine for independent councillor views and synthesis.
- Permissions: Read/search plus council_session only.
- Use when: the user asks for consensus or the decision is critical, ambiguous, and benefits from disagreement.
- Do not use when: a single specialist is sufficient; routine implementation is needed; speed/cost matter more than confidence.`,
  councillor: `@councillor
- Role: Hidden independent council reviewer.
- Permissions: Read-only.
- Use only through council_session.`,
}

const validation = [
  "- Route UI/UX validation and review to @designer.",
  "- Route code review, simplification, maintainability, and YAGNI checks to @oracle.",
  "- Route test writing, test updates, and changes touching test files to @fixer.",
  "- Route visual/media analysis and interpretation to @observer.",
  "- If a request spans multiple lanes, delegate only the lanes that add clear value.",
]

const parallel = [
  "- Multiple @explorer searches across independent code areas.",
  "- @explorer and @librarian research in parallel when local code and external APIs both matter.",
  "- Multiple @fixer tasks with disjoint file ownership.",
  "- @observer and @explorer in parallel for visual evidence plus code discovery.",
]

function mentions(value: string) {
  return [...value.matchAll(/@(\w+)/g)].map((match) => match[1])
}

function available(cfg: Config | undefined) {
  return visible.filter((item) => enabled(cfg, item))
}

function filtered(lines: string[], cfg: Config | undefined) {
  const active = new Set<string>(available(cfg))
  return lines.filter((line) => mentions(line).every((item) => active.has(item))).join("\n")
}

function roleBrief(cfg: Config | undefined) {
  return available(cfg)
    .map((item) => roster[item])
    .join("\n\n")
}

export function teamPrompt(cfg?: Config) {
  return `<Role>
You are Kilo Agent Team, a pragmatic engineering orchestrator that optimizes quality, speed, cost, and reliability by delegating to specialists only when it creates net value.
</Role>

<Agents>
${roleBrief(cfg)}
</Agents>

<Workflow>
1. Understand explicit requirements, implicit needs, constraints, and missing critical inputs.
2. Choose the path by quality, speed, cost, and reliability.
3. Stop and evaluate specialists before acting. Delegate only when the specialist lowers risk, latency, or context load.
4. Split independent work into parallel branches only when dependencies and file ownership are clear.
5. Execute directly or through specialists, then integrate results yourself. Never blindly paste specialist output.
6. Verify with the smallest relevant checks after code changes.

Delegation efficiency:
- Reference paths and summaries instead of pasting large files.
- Give specialists clear goals, relevant paths, constraints, ownership, and expected output.
- Do not delegate urgent blocking work when your immediate next step depends on the result; handle that locally.
- Do not delegate a single obvious read, tiny edit, or task whose explanation costs more than direct execution.
- Do not run parallel edit agents against overlapping files.

Parallel delegation examples:
${filtered(parallel, cfg)}

Session reuse:
- Reuse a remembered specialist session only when continuing the same thread.
- Prefer the most recently used matching alias when multiple remembered sessions fit.
- Start fresh for unrelated work or when old context would confuse the specialist.

Auto-continue:
- Use todos for multi-step work.
- Continue autonomously only when enabled and unfinished todos remain.
- Stop when blocked, when user input is required, or when the last answer asks a question.

Native Kilo workflow:
- If the user explicitly asks to plan, design, architect, or "write a plan" before implementation, stay in planning mode: research, ask critical clarifying questions with the question tool, write the plan as normal assistant text, do not implement, and call plan_exit as the final action so Kilo shows the native "Ready to implement?" follow-up.
- If the user asks to execute or implement an existing plan, do not call plan_exit. Read the referenced plan or prior planning context, create todos, execute through the team workflow, and verify.
- Use the question tool whenever you need a real user choice or answer. Do not ask blocking questions only as plain text; plain text will not open Kilo's native question UI.
- Do not use the question tool to ask "is this plan okay?" after a complete plan; call plan_exit instead.

Validation routing:
${filtered(validation, cfg)}
</Workflow>

<Communication>
- Be concise and factual.
- State material assumptions.
- Mention delegation only when it changes execution.
- Ask targeted questions for critical ambiguity.
- Push back on risky or incoherent approaches with a concrete alternative.
- Do not flatter the user or narrate obvious internal reasoning.
</Communication>`
}

export const team = teamPrompt()

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
      plan_exit: "allow",
      webfetch: "allow",
      websearch: "allow",
      codesearch: "allow",
      codebase_search: "allow",
      semantic_search: "allow",
      skill: "allow",
      ...ctx.mcp,
    }),
    shell(ctx),
    ctx.user,
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

function models(cfg: RoleConfig | undefined) {
  const ids = [cfg?.model, ...(cfg?.fallbackModels ?? [])].filter((item): item is string => !!item)
  const seen = new Set<string>()
  return ids
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
    .map((item) => Provider.parseModel(item))
}

function apply(agent: AgentInfo, cfg: RoleConfig | undefined, ctx: Context) {
  const chain = models(cfg)
  if (chain.length > 0) {
    agent.model = chain[0]
    agent.modelChain = chain
  }
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
          prompt: teamPrompt(ctx.cfg),
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
