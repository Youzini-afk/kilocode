export type CapabilityRole =
  | "secretary"
  | "orchestrator"
  | "architect"
  | "planner"
  | "explorer"
  | "librarian"
  | "oracle"
  | "designer"
  | "fixer"
  | "observer"
  | "council"
  | "councillor"

export type CapabilityProfile = {
  title: string
  category: "entry" | "strategy" | "discovery" | "execution" | "review"
  description: string
  skills: string[]
  mcps: string[]
  triggers: string[]
  use: string[]
  avoid: string[]
}

export const profiles = {
  secretary: {
    title: "Secretary",
    category: "entry",
    description: "Intake layer that clarifies user intent and hands a clean execution brief to Orchestrator.",
    skills: ["kilo-config"],
    mcps: [],
    triggers: ["vague request", "product intent", "user-facing clarification"],
    use: ["User intent needs compression before execution.", "Secretary mode is selected as the entry agent."],
    avoid: ["Implementation is needed directly.", "A specialist should be called directly."],
  },
  orchestrator: {
    title: "Orchestrator",
    category: "entry",
    description: "Command Kilo Agent Team, doing quick work directly and delegating substantial work to specialists.",
    skills: ["*"],
    mcps: ["*", "!context7"],
    triggers: ["coordination", "routing", "multi-step work", "small direct fixes"],
    use: [
      "A task needs routing, planning, execution, integration, or acceptance.",
      "A small task is faster to do directly.",
    ],
    avoid: ["User only needs Secretary intake.", "Independent council review is the only requested action."],
  },
  architect: {
    title: "Design",
    category: "strategy",
    description:
      "High-level design and architecture advisor. Evaluates system shape, cross-module tradeoffs, data/API/plugin boundaries, migration risk, and minimum viable design before implementation planning.",
    skills: ["kilo-config", "review-work"],
    mcps: ["websearch", "context7"],
    triggers: ["architecture", "API boundary", "data model", "migration", "permission model", "cross-module design"],
    use: ["Direction or long-term tradeoffs matter before concrete tasks.", "The design affects multiple modules."],
    avoid: ["The solution pattern is settled.", "The edit is small and local."],
  },
  planner: {
    title: "Plan",
    category: "strategy",
    description:
      "Concrete implementation planning specialist. Turns settled goals or architecture into scoped tasks, ownership boundaries, dependencies, specialist routing, verification steps, and rollback checkpoints.",
    skills: ["kilo-config", "review-work"],
    mcps: [],
    triggers: ["implementation plan", "task breakdown", "file ownership", "verification strategy"],
    use: ["The goal is settled but execution needs decomposition.", "Multiple specialists or file boundaries matter."],
    avoid: ["Architecture is still undecided.", "A tiny edit is faster than a plan."],
  },
  explorer: {
    title: "Explorer",
    category: "discovery",
    description:
      "Parallel codebase discovery. Finds files, symbols, call sites, architecture seams, and unknown implementation paths quickly.",
    skills: ["kilo-config"],
    mcps: [],
    triggers: ["unknown code path", "symbol search", "call sites", "repo map"],
    use: ["Broad or uncertain local discovery can run in parallel.", "You need paths and summarized findings."],
    avoid: ["You already know the exact file.", "You need to edit the same file immediately."],
  },
  librarian: {
    title: "Librarian",
    category: "discovery",
    description:
      "Current documentation and external source research. Uses official references for library APIs, examples, version-specific behavior, and unfamiliar dependencies.",
    skills: ["kilo-config"],
    mcps: ["websearch", "context7", "grep_app"],
    triggers: ["current docs", "library API", "version behavior", "external reference"],
    use: ["Official docs or current ecosystem behavior matters.", "The dependency is unfamiliar."],
    avoid: ["Stable general knowledge is enough.", "The answer is already in local context."],
  },
  oracle: {
    title: "Oracle",
    category: "review",
    description:
      "Final acceptance and technical review. Validates architecture, implementation quality, risk, maintainability, security, data integrity, and YAGNI tradeoffs.",
    skills: ["review-work", "ai-slop-remover", "kilo-config"],
    mcps: [],
    triggers: ["final review", "acceptance", "security", "maintainability", "YAGNI", "persistent bug"],
    use: [
      "Meaningful specialist implementation needs acceptance.",
      "Risk or repeated failure justifies deeper review.",
    ],
    avoid: ["This is a first routine fix attempt.", "Speed matters more than extra confidence."],
  },
  designer: {
    title: "Designer",
    category: "execution",
    description:
      "UI/UX and frontend engineering specialist. Implements or reviews user-facing layout, interactions, accessibility, responsive behavior, visual hierarchy, and design-system polish.",
    skills: ["frontend-ui-ux", "browser-verification"],
    mcps: ["kilo-playwright"],
    triggers: ["UI", "UX", "frontend", "responsive", "accessibility", "visual polish"],
    use: ["Users see the surface.", "Interaction quality, layout, or design-system fit matters."],
    avoid: ["The change is backend or headless logic.", "A throwaway prototype does not need polish."],
  },
  fixer: {
    title: "Fixer",
    category: "execution",
    description:
      "General implementation specialist for backend, services, CLI, config, tests, fixtures, and bounded non-UI code changes after discovery and decisions are settled.",
    skills: ["kilo-config", "git-master"],
    mcps: [],
    triggers: ["backend", "service", "CLI", "config", "tests", "fixtures", "non-UI implementation"],
    use: ["Implementation scope is clear.", "Non-UI code or tests need bounded edits."],
    avoid: ["Discovery or design decisions are unresolved.", "The edit is tiny enough for Orchestrator."],
  },
  observer: {
    title: "Observer",
    category: "discovery",
    description:
      "Visual analysis specialist. Reads screenshots, images, PDFs, diagrams, and exact visible errors without pulling raw media into the coordinator context.",
    skills: [],
    mcps: [],
    triggers: ["screenshot", "image", "PDF", "diagram", "visible error"],
    use: ["Visual evidence must be interpreted.", "Exact visible UI labels or errors matter."],
    avoid: ["The input is plain text.", "Editable file contents are needed."],
  },
  council: {
    title: "Council",
    category: "review",
    description:
      "Optional technical council. Uses independent councillors for complex, high-risk, ambiguous, or architectural decisions where disagreement improves quality.",
    skills: ["review-work"],
    mcps: [],
    triggers: ["consensus", "high risk", "ambiguous architecture", "disagreement"],
    use: ["Independent disagreement improves a critical decision.", "The user asks for consensus."],
    avoid: ["A single specialist is enough.", "Routine implementation or speed is more important."],
  },
  councillor: {
    title: "Councillor",
    category: "review",
    description: "Internal council advisor. Provides independent read-only analysis for a council session.",
    skills: [],
    mcps: [],
    triggers: ["council session"],
    use: ["Only through council_session."],
    avoid: ["Direct user or Orchestrator routing."],
  },
} satisfies Record<CapabilityRole, CapabilityProfile>

export function profile(role: CapabilityRole) {
  return profiles[role]
}

export function defaults(role: CapabilityRole) {
  const p = profile(role)
  return {
    skills: [...p.skills],
    mcps: [...p.mcps],
  }
}

export function capabilitySummary(roles: CapabilityRole[]) {
  return roles
    .map((role) => {
      const p = profile(role)
      const skills = p.skills.length > 0 ? p.skills.join(", ") : "none"
      const mcps = p.mcps.length > 0 ? p.mcps.join(", ") : "none"
      return `- @${role}: ${p.title}; lane=${p.category}; triggers=${p.triggers.join(", ")}; default skills=${skills}; default MCPs=${mcps}.`
    })
    .join("\n")
}
