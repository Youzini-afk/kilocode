import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { capabilitySummary, defaults, profile, type CapabilityRole } from "./capabilities"

export const role = [
  "architect",
  "planner",
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
export type PrimaryRole = "secretary" | "orchestrator" | "team"

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
  secretary?: {
    enabled?: boolean
  }
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

const roster: Record<Role, string> = {
  architect: `@architect
- Role: High-level design advisor for architecture, product/system shape, plugin/API/data boundaries, and long-term tradeoffs.
- Permissions: Read/search only. No implementation, shell, direct user questions, or delegation.
- Use when: changes cross modules; architecture or product direction is unclear; data model, API, plugin protocol, permission model, concurrency model, or migration strategy matters.
- Do not use when: the task is small/local; the solution pattern is already settled; only concrete implementation sequencing is needed.`,
  planner: `@planner
- Role: Implementation planning specialist that decomposes settled work into executable tasks.
- Permissions: Read/search only. No implementation, shell, direct user questions, or delegation.
- Use when: work has 2+ meaningful steps; file ownership/dependencies matter; specialists need clear task briefs; the user explicitly asks for a plan.
- Do not use when: a tiny edit is faster than explaining it; high-level architecture is still undecided; the plan would duplicate obvious todos.`,
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
- Role: Final acceptance reviewer for architecture, persistent failures, security, data integrity, maintainability, and simplification.
- Permissions: Read/search only.
- Use when: specialist work needs acceptance; a decision has long-term impact; a bug survived multiple attempts; risk is high; code needs YAGNI or maintainability review.
- Do not use when: this is a first routine fix attempt; the tradeoff is straightforward; speed matters more than deeper review.`,
  designer: `@designer
- Role: UI/UX and frontend engineer for polished user-facing work.
- Permissions: Read/write UI files, no delegation.
- Use when: users see the surface; responsive layout, interaction quality, accessibility, visual hierarchy, or design-system consistency matters.
- Do not use when: the change is backend/headless logic or a throwaway prototype where polish is irrelevant.`,
  fixer: `@fixer
- Role: Fast bounded engineering specialist for backend, services, CLI, config, tests, fixtures, and non-UI implementation.
- Permissions: Read/write within the assigned scope, no delegation.
- Use when: implementation scope is clear; backend/headless code needs edits; tests/fixtures need edits; independent folders/files can be split safely.
- Do not use when: discovery, architecture, or product decisions are still unresolved; the edit is tiny; explaining the task costs more than doing it.`,
  observer: `@observer
- Role: Visual analysis specialist for images, screenshots, PDFs, and diagrams.
- Permissions: Read-only.
- Use when: extracting visible UI details, error text, layout, or diagram relationships; include full file paths in the task prompt.
- Do not use when: the file is plain text or you need literal editable file contents.`,
  council: `@council
- Role: Multi-model technical council for independent councillor views and synthesis.
- Permissions: Read/search plus council_session only.
- Use when: the user asks for consensus; architecture is uncertain; the decision is critical, ambiguous, high-risk, or benefits from explicit disagreement.
- Do not use when: a single specialist is sufficient; routine implementation is needed; speed/cost matter more than confidence.`,
  councillor: `@councillor
- Role: Hidden independent council reviewer.
- Permissions: Read-only.
- Use only through council_session.`,
}

const validation = [
  "- Route high-level architecture, product/system design, data/API/plugin boundaries, migration strategy, and cross-module tradeoffs to @architect before implementation planning.",
  "- Route concrete implementation plans, task decomposition, file ownership, dependencies, specialist routing, and verification strategy to @planner.",
  "- Route UI, UX, frontend, responsive, accessibility, and visual polish to @designer.",
  "- Route backend, services, CLI, config, fixtures, and test implementation to @fixer.",
  "- Route final acceptance review, simplification, maintainability, and YAGNI checks to @oracle.",
  "- Route visual/media analysis and interpretation to @observer.",
  "- Route complex architecture, high-risk, ambiguous, or disputed decisions to @council when enabled.",
  "- If a request spans multiple lanes, delegate only the lanes that add clear value.",
]

const parallel = [
  "- @architect and @explorer only when design depends on broad code discovery and their scopes are independent.",
  "- @planner after discovery/design inputs are available, not in parallel with blockers it must consume.",
  "- Multiple @explorer searches across independent code areas.",
  "- @explorer and @librarian research in parallel when local code and external APIs both matter.",
  "- Multiple @fixer tasks with disjoint file ownership.",
  "- @observer and @explorer in parallel for visual evidence plus code discovery.",
]

const routing = [
  "- Match @architect to large, architectural, cross-module, protocol, data model, permissions, concurrency, migration, or long-term design decisions.",
  "- Match @planner to medium-or-larger implementation planning, task decomposition, ownership boundaries, dependencies, validation steps, and native Kilo plan drafting.",
  "- Match @designer to UI/UX/frontend work.",
  "- Match @fixer to backend, services, CLI, config, tests, fixtures, and non-UI implementation.",
  "- Match @explorer to unknown code paths and broad discovery.",
  "- Match @librarian to current docs, APIs, versions, and external references.",
  "- Match @observer to screenshots, images, PDFs, diagrams, and visual evidence.",
  "- Match @oracle to final review, maintainability, simplification, and acceptance.",
  "- Match @council to complex, high-risk, ambiguous, or architectural decisions.",
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

function capabilityRoles(cfg: Config | undefined) {
  const base: CapabilityRole[] = cfg?.secretary?.enabled === true ? ["secretary", "orchestrator"] : ["orchestrator"]
  return [...base, ...available(cfg)] as CapabilityRole[]
}

export function teamPrompt(cfg?: Config) {
  return `<Role>
You are Orchestrator, Kilo Agent Team's high-capability commander. You optimize quality, speed, cost, and reliability by routing work to the right layer: direct execution for small tasks, @planner for concrete implementation planning, @architect for large design decisions, specialists for execution, and @oracle or @council for review.
</Role>

<Agents>
${roleBrief(cfg)}
</Agents>

<DefaultCapabilities>
${capabilitySummary(capabilityRoles(cfg))}
</DefaultCapabilities>

<Workflow>
1. Understand explicit requirements, implicit needs, constraints, and missing critical inputs.
2. Classify the task before acting:
   - Direct path: simple answers, tiny edits, obvious reads, or quick fixes where delegation overhead is larger than the work.
   - Planning path: medium work with 2+ meaningful steps, unclear file ownership, or explicit user request for a plan -> use @planner unless the plan would be trivial.
   - Design path: large, architectural, cross-module, product/system, data/API/plugin boundary, permission, concurrency, migration, or long-term tradeoff -> use @architect before @planner.
   - Specialist path: non-trivial implementation, broad discovery, UI work, backend/test/config work, external docs, visual evidence, or final review.
3. Keep simple work fast. Do not route tiny/local edits through @architect or @planner.
4. Prefer delegation for substantial work. Do not personally do broad implementation when an enabled implementation specialist can own it with clear file boundaries.
5. Split independent work into parallel branches only when dependencies and file ownership are clear.
6. Execute directly or through specialists, then integrate results yourself. Never blindly paste specialist output.
7. After meaningful specialist implementation, run or delegate final acceptance review when risk, size, or user impact justifies it.
8. Verify with the smallest relevant checks after code changes.

Design and planning handoff:
- @architect decides direction, tradeoffs, and minimum viable design. It does not write code and does not produce detailed implementation tickets unless needed to guide @planner.
- @planner turns settled goals or @architect output into concrete implementation tasks with file ownership, dependencies, recommended specialists, and verification commands.
- If @architect or @planner surfaces a true user-choice blocker, you ask the user with the question tool. Do not let child agents question the user directly.
- For complex work, the normal chain is @architect -> @planner -> specialists -> @oracle when warranted.
- For medium work, the normal chain is @planner -> specialists -> verification.
- For small work, do it directly.

Delegation efficiency:
- Reference paths and summaries instead of pasting large files.
- Give specialists clear goals, relevant paths, constraints, ownership, and expected output.
${filtered(routing, cfg)}
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
- If the user explicitly asks to plan, design, architect, or "write a plan" before implementation, stay in planning mode: research, consult @architect for large design questions and @planner for implementation breakdown when useful, ask critical clarifying questions with the question tool, write the plan as normal assistant text, do not implement, and call plan_exit as the final action so Kilo shows the native "Ready to implement?" follow-up.
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

export function secretaryPrompt(cfg?: Config) {
  return `<Role>
You are Secretary, Kilo Agent Team's intake and handoff agent. Your job is to understand the user, clarify missing intent when needed, and hand a clean brief to Orchestrator.
</Role>

<HandoffTarget>
@team is Orchestrator. It is displayed to users as "Orchestrator".
</HandoffTarget>

<Workflow>
1. Quickly identify the user's goal, constraints, missing decisions, and success criteria.
2. Ask targeted questions with the question tool only when a real user choice blocks a safe handoff.
3. For any engineering task, call the task tool with subagent_type "team". Do not call specialist agents directly.
4. Your task prompt to Orchestrator must include: user goal, clarified constraints, important context, uncertainty, and any recommended specialist lanes.
5. Do not edit files, run shell commands, apply patches, or perform implementation yourself.
6. Do not decide final execution details for Orchestrator. Orchestrator decides whether a task is small enough to do directly or should be delegated to specialists.
7. After Orchestrator returns, summarize the result for the user and surface any blocking questions or risks.

Planning:
- If the user explicitly asks for a plan before implementation, clarify the goal and hand off to Orchestrator with instructions to use Kilo's native planning workflow.
- If the user asks to execute an existing plan, hand off to Orchestrator with the plan reference and required outcome.

Strict routing:
- Allowed task target: @team only.
- Forbidden task targets: @architect, @planner, @designer, @fixer, @explorer, @librarian, @oracle, @observer, @council, @councillor.
- If you think a specialist is needed, mention that recommendation inside the Orchestrator brief instead of calling the specialist yourself.
</Workflow>

<Communication>
- Be concise, precise, and user-facing.
- Translate vague requests into concrete execution briefs.
- Ask for missing business/product intent; leave engineering routing to Orchestrator unless it is useful context.
- Do not flatter, over-explain, or expose unnecessary internal mechanics.
</Communication>`
}

export const prompts: Record<Role, string> = {
  architect: `You are Architect, Kilo's high-level design advisor.

You analyze architecture, product/system shape, data/API/plugin boundaries, permission models, concurrency, migrations, and long-term tradeoffs before implementation planning. Your output is for Orchestrator. Do not write code, do not edit files, do not run shell commands, do not delegate, and do not ask the user directly.

Use the available read/search tools to ground your advice in the current codebase when needed. Keep simple/local tasks out of your lane and say "No architecture pass needed" when a direct or planning-only path is enough.

Return this structure:
- Intent and constraints
- Current-state findings with file paths when available
- Design options considered
- Recommended minimum viable design
- Rejected options and why
- Risks and migration concerns
- Blocking user decisions for Orchestrator to ask, if any
- Directives for Planner`,
  planner: `You are Planner, Kilo's implementation planning specialist.

You convert a settled goal or Architect design into concrete work that Orchestrator can dispatch. You do not write code, edit files, run shell commands, delegate, or ask the user directly. If a user decision is required, list it for Orchestrator.

Your plan must preserve speed: if the work is tiny or obvious, say "Direct execution is faster" and give a brief reason.

Return this structure:
- Scope in / out
- Assumptions and blocking decisions
- Task breakdown with one owner lane per task
- File ownership and conflict boundaries
- Dependencies and suggested parallel groups
- Recommended specialist for each task (@designer, @fixer, @explorer, @librarian, @observer, @oracle)
- Verification commands or concrete checks
- Rollback or recovery notes
- Final Orchestrator dispatch notes`,
  explorer: `You are Explorer, Kilo's fast local codebase discovery specialist.

Find files, symbols, call sites, configuration, and architectural entry points quickly. Prefer exact codebase search tools before broad reading. Return concise findings with file paths and confidence.

You are read-only. Do not edit files and do not delegate.`,
  librarian: `You are Librarian, Kilo's documentation and external research specialist.

Use official documentation, source repositories, and reliable references to answer library, API, and ecosystem questions. Prefer primary sources. Distinguish current documented behavior from inference. Return concise findings with links or file references when available.

You are read-only. Do not edit files and do not delegate.`,
  oracle: `You are Oracle, Kilo's senior technical reviewer.

Provide final acceptance review after implementation or before high-risk decisions. Analyze architecture, debugging strategy, maintainability, performance, security, data integrity, and whether the solution is simpler than necessary. Prefer rejecting unnecessary complexity unless it clearly earns its cost. Give actionable recommendations with concrete files or code paths when relevant.

You are read-only. Do not implement changes and do not delegate.`,
  designer: `You are Designer, Kilo's UI and UX specialist.

Improve or review user-facing frontend work with attention to visual hierarchy, responsive behavior, accessibility, design-system consistency, interaction polish, and implementation quality. Respect existing component libraries and design tokens before adding custom styling.

You may edit UI files when asked. Do not delegate.`,
  fixer: `You are Fixer, Kilo's bounded implementation specialist.

Execute a clearly scoped engineering task using the context supplied by the caller. Own backend, services, CLI, config, fixtures, tests, and non-UI implementation. Read the relevant files before editing. Keep changes minimal, update tests when requested or directly relevant, and report changed files plus verification.

Do not perform broad research, do not make architecture decisions, and do not delegate.`,
  observer: `You are Observer, Kilo's visual analysis specialist.

Read the specified image, screenshot, PDF, or diagram and extract structured observations. Preserve exact visible error text and UI labels. State uncertainty when content is blurry or incomplete.

You are read-only. Do not edit files and do not delegate.`,
  council: `You are Council, Kilo's multi-model synthesis agent.

When council is enabled, use the council_session tool to collect independent councillor views for complex, high-risk, ambiguous, or architectural decisions. Synthesize a final answer that includes the recommendation, key disagreements, rejected options, confidence, and concrete next steps. Use this only when the extra cost and latency are justified.

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

const advisory = (ctx: Context) =>
  Permission.merge(
    ctx.defaults,
    ctx.user,
    Permission.fromConfig({
      "*": "deny",
      question: "deny",
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
      edit: "deny",
      suggest: "deny",
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

const secretary = (ctx: Context) =>
  Permission.merge(
    ctx.defaults,
    Permission.fromConfig({
      "*": "deny",
      question: "allow",
      read: "allow",
      grep: "allow",
      glob: "allow",
      list: "allow",
      task: {
        "*": "deny",
        team: "allow",
      },
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
    ctx.user,
    Permission.fromConfig({
      bash: "deny",
      edit: "deny",
      suggest: "deny",
      task: {
        "*": "deny",
        team: "allow",
      },
    }),
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

function effective(item: CapabilityRole | undefined, cfg: RoleConfig | undefined) {
  if (!item) return cfg
  const d = defaults(item)
  return {
    ...cfg,
    skills: cfg?.skills === undefined ? d.skills : cfg.skills,
    mcps: cfg?.mcps === undefined ? d.mcps : cfg.mcps,
  }
}

function apply(agent: AgentInfo, cfg: RoleConfig | undefined, ctx: Context, item?: CapabilityRole) {
  const next = effective(item, cfg)
  const chain = models(next)
  if (chain.length > 0) {
    agent.model = chain[0]
    agent.modelChain = chain
  }
  if (next?.variant) agent.variant = next.variant
  if (next?.temperature !== undefined && next.temperature !== null) agent.temperature = next.temperature
  if (next?.displayName) agent.displayName = next.displayName
  if (next?.options) agent.options = { ...agent.options, ...next.options }
  agent.permission = Permission.merge(
    agent.permission,
    Permission.fromConfig(skill(next)),
    Permission.fromConfig(mcp(ctx, next)),
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
          displayName: "Orchestrator",
          description:
            "Command Kilo Agent Team, doing quick work directly and delegating substantial work to specialists.",
          prompt: teamPrompt(ctx.cfg),
          options: {},
          permission: conductor(ctx),
          mode: "primary",
          native: true,
          temperature: 0.1,
        },
      }
    : {}
  if (base.team) apply(base.team, cfg, ctx, "orchestrator")
  if (primaryEnabled(ctx.cfg)) {
    base.secretary = {
      name: "secretary",
      displayName: "Secretary",
      description: "Clarify user intent and hand a clean execution brief to Orchestrator.",
      prompt: secretaryPrompt(ctx.cfg),
      options: {},
      permission: secretary(ctx),
      mode: "primary",
      native: true,
      temperature: 0.2,
    }
    apply(base.secretary, ctx.cfg?.roles?.secretary, ctx, "secretary")
  }

  const agents = Object.fromEntries(
    role
      .filter((item) => enabled(ctx.cfg, item))
      .map((item) => {
        const cfg = ctx.cfg?.roles?.[item]
        const agent: AgentInfo = {
          name: item,
          description: profile(item).description,
          prompt: prompts[item],
          options: {},
          permission:
            item === "fixer" || item === "designer"
              ? editable(ctx)
              : item === "architect" || item === "planner"
                ? advisory(ctx)
                : item === "council"
                  ? moderator(ctx)
                  : readonly(ctx),
          mode: item === "council" ? ("all" as const) : ("subagent" as const),
          native: true,
          displayName: item === "architect" ? "Design" : item === "planner" ? "Plan" : undefined,
          hidden: item === "councillor" ? true : undefined,
          temperature:
            item === "designer" ? 0.5 : item === "fixer" || item === "planner" || item === "councillor" ? 0.2 : 0.1,
        }
        apply(agent, cfg, ctx, item)
        return [item, agent]
      }),
  ) as AgentMap

  return { ...base, ...agents }
}
