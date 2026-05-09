// kilocode_change - new file
// Built-in skills that ship inside the CLI binary.
// Content is inlined at compile time via Bun's static import of .md files.
// Registered before all discovery phases so user skills with the same name override.

import KILO_CONFIG from "./kilo-config.md"
import FRONTEND_UI_UX from "./frontend-ui-ux.md"
import REVIEW_WORK from "./review-work.md"
import GIT_MASTER from "./git-master.md"
import AI_SLOP_REMOVER from "./ai-slop-remover.md"
import BROWSER_VERIFICATION from "./browser-verification.md"

export interface BuiltinSkill {
  name: string
  description: string
  content: string
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "kilo-config",
    description:
      "Guide for Kilo configuration: config paths, kilo.json fields, commands, agents, skills, permissions, MCPs, providers, TUI settings, plus Agent Manager worktree setup/run scripts, workflows, and state. Use for Kilo config questions, locating loaded config, changing settings, or Agent Manager questions about run/setup scripts, worktree setup/workflows, apply/merge/PR/conflicts, missing sessions/worktrees, and agent-manager.json recovery.",
    content: KILO_CONFIG,
  },
  {
    name: "frontend-ui-ux",
    description:
      "Frontend UI/UX engineering guidance for visible product surfaces, layout, accessibility, responsive behavior, interaction polish, and design-system consistency.",
    content: FRONTEND_UI_UX,
  },
  {
    name: "review-work",
    description:
      "Final acceptance and technical review guidance for correctness, scope, maintainability, security, verification, and risk.",
    content: REVIEW_WORK,
  },
  {
    name: "git-master",
    description:
      "Git workflow guidance for atomic commits, pushes, rebases, conflict resolution, blame, bisect, and history search.",
    content: GIT_MASTER,
  },
  {
    name: "ai-slop-remover",
    description:
      "Pragmatic cleanup guidance for removing over-engineered, generic, brittle, or cosmetic AI-generated code.",
    content: AI_SLOP_REMOVER,
  },
  {
    name: "browser-verification",
    description:
      "Browser and webview verification guidance for frontend changes, including interaction, state, layout, theme, and error checks.",
    content: BROWSER_VERIFICATION,
  },
]
