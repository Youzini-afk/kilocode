---
title: "Agent Team"
description: "Native Kilo architecture for coordinated specialist-agent workflows"
---

# Agent Team

Agent Team is the native Kilo architecture for coordinated specialist-agent workflows. It internalizes the useful orchestration patterns from `oh-my-opencode-slim` without preserving its plugin packaging, installer, terminal multiplexer integration, or user-facing JSON configuration model.

## Goals

- Provide a first-class Kilo team mode that can become the default agent when enabled.
- Keep `code`, `plan`, `debug`, and `ask` available for explicit manual selection.
- Let users choose role models from configured Kilo providers instead of typing raw provider/model strings.
- Keep the implementation in Kilo-owned source directories where possible.
- Make advanced behaviors incremental and reversible: session reuse, council consensus, and auto-continue must each have explicit settings.

## Non-Goals

- Do not embed `oh-my-opencode-slim` as an external plugin.
- Do not expose a raw JSON settings editor for normal setup.
- Do not add tmux, zellij, Divoom, plugin auto-update, or installer flows to Kilo.
- Do not remove existing native agents.
- Do not enable high-cost multi-model council behavior by default.

## Native Modules

| Module | Responsibility |
|---|---|
| `packages/opencode/src/kilocode/agent-team/agents.ts` | Defines Secretary, Orchestrator, and specialist agent prompts, descriptions, defaults, and permissions. |
| `packages/opencode/src/kilocode/agent-team/capabilities.ts` | Defines role capability profiles: routing metadata, recommended skills, and recommended MCP access. |
| `packages/opencode/src/kilocode/agent-team/config.ts` | Normalizes `agentTeam` config and resolves role model overrides. |
| `packages/opencode/src/kilocode/agent-team/session-reuse.ts` | Tracks reusable child sessions and injects resumable-session hints into Orchestrator or Secretary requests. |
| `packages/opencode/src/kilocode/agent-team/council.ts` | Runs optional multi-model council sessions and formats synthesis input. |
| `packages/opencode/src/kilocode/agent-team/auto-continue.ts` | Conservatively resumes Team sessions with incomplete todos when enabled. |
| `packages/opencode/src/kilocode/skills/` | Ships Kilo-native built-in skills used by Agent Team roles. |
| `packages/kilo-vscode/webview-ui/src/components/settings/AgentTeamTab.tsx` | Presents polished settings sections backed by Kilo provider/model pickers. |

Shared upstream files should only receive thin integration calls. Kilo-specific logic belongs under paths containing `kilocode`.

## Capability Parity Baseline

Agent Team is being aligned to `oh-my-opencode-slim` by capability, not by copying its plugin package shape.

| Capability | OMO Slim source | Kilo status | Native target |
|---|---|---|---|
| Specialist roster | `src/agents/` | Implemented, but prompts are compressed | Keep native roles and expand prompts/routing rules. |
| Orchestrator routing | `src/agents/orchestrator.ts` | Partial | Match delegation, validation routing, parallelism, design/plan splitting, session reuse, and communication rules. |
| Secretary intake | OMO-style front-door workflow | Implemented natively | Selectable entry agent that clarifies user intent and hands a clean brief to Orchestrator. |
| Task session aliases | `src/hooks/task-session-manager/` | Partial | Keep native `task_id` aliasing and add stale-entry cleanup plus stronger prompt guidance. |
| Delegation retry hints | `src/hooks/delegate-task-retry/` | Missing | Append recovery guidance after failed `task` calls. |
| Phase reminders | `src/hooks/phase-reminder/` | Missing | Inject concise workflow reminders into Team turns. |
| File-tool nudges | `src/hooks/post-file-tool-nudge/` | Missing | Nudge verification after edits and file reads when useful. |
| JSON error recovery | `src/hooks/json-error-recovery/` | Missing | Add structured recovery guidance for malformed tool/JSON output failures. |
| Skill filtering | `src/hooks/filter-available-skills/` | Partial via permissions | Filter unavailable skills from Team prompts and role permissions. |
| Image routing | `src/hooks/image-hook.ts` | Prompt-only | Encourage Observer delegation for visual attachments without moving raw media into Team context. |
| Foreground fallback | `src/hooks/foreground-fallback/` | Missing | Add per-role fallback chains and retry selected provider/model failures. |
| Auto-continue | `src/hooks/todo-continuation/` | Partial | Keep conservative native continuation and align defaults/guidance. |
| Council | `src/tools/council/` | Partial | Keep native council tool and add clearer presets/fallback behavior. |
| AST grep tools | `src/tools/ast-grep/` | Not native | Prefer Kilo search tools first; add AST grep only if native search cannot cover the workflow. |
| Web fetch/search MCPs | `src/mcp/` and `src/tools/smartfetch` | Partially covered | Map to Kilo web/MCP tools rather than shipping plugin MCP defaults. |
| Multiplexer/display extras | `src/multiplexer/`, Divoom | Not implemented | Out of scope for Kilo native integration. |
| Installer/autoupdate | `src/cli/`, update hooks | Not implemented | Out of scope because Agent Team is built in. |

The main implementation gap is runtime orchestration behavior. UI polish alone cannot close this gap.

## Configuration Shape

The user-facing config key is `agentTeam`:

```jsonc
{
  "agentTeam": {
    "enabled": true,
    "takeoverDefault": true,
    "secretary": {
      "enabled": false
    },
    "roles": {
      "secretary": {
        "model": "kilo/auto",
        "variant": "medium"
      },
      "orchestrator": {
        "enabled": true,
        "model": "kilo/auto",
        "variant": "high",
        "temperature": 0.1,
        "mcps": ["*", "!context7"]
      },
      "architect": {
        "enabled": true,
        "variant": "xhigh"
      },
      "planner": {
        "enabled": true,
        "variant": "high"
      },
      "explorer": {
        "enabled": true,
        "model": "kilo/auto",
        "fallbackModels": ["openrouter/anthropic/claude-sonnet-4.5"]
      },
      "librarian": {
        "enabled": true,
        "skills": ["openai-docs"],
        "mcps": ["websearch", "context7", "grep_app"]
      },
      "oracle": { "enabled": true, "variant": "xhigh" },
      "fixer": { "enabled": true, "temperature": 0.2 }
    },
    "sessionReuse": {
      "enabled": true,
      "maxSessionsPerAgent": 2
    },
    "council": {
      "enabled": false
    },
    "autoContinue": {
      "enabled": false,
      "autoEnable": false,
      "autoEnableThreshold": 4,
      "maxContinuations": 5,
      "cooldownMs": 3000
    }
  }
}
```

The VS Code settings UI owns normal editing. JSON remains a power-user escape hatch only.

Role entries support:

- `enabled` — include or disable the role.
- `model` — provider/model picked from configured Kilo providers.
- `fallbackModels` — ordered provider/model fallback chain for delegated specialist retries.
- `variant` — thinking/reasoning effort, such as `low`, `medium`, `high`, or `xhigh`.
- `temperature` — optional sampling temperature override from `0` to `2`.
- `skills` — skill allow-list with `*` and `!name` syntax.
- `mcps` — MCP server allow-list with `*` and `!name` syntax.
- `displayName` — optional user-facing alias.
- `options` — provider-specific model options for power users.

If `skills` or `mcps` is omitted for a role, Kilo applies the recommended Agent Team capability profile. If the field is present, including an empty array, the user override is authoritative.

## Capability Profiles

Agent Team roles are capability-driven. Profiles define what each role is good at, when Orchestrator should route to it, and which built-in skills or MCP servers are recommended by default.

| Role | Recommended skills | Recommended MCPs |
|---|---|---|
| `secretary` | `kilo-config` | none |
| `team` / Orchestrator | `*` | `*`, `!context7` |
| `architect` | `kilo-config`, `review-work` | `websearch`, `context7` |
| `planner` | `kilo-config`, `review-work` | none |
| `explorer` | `kilo-config` | none |
| `librarian` | `kilo-config` | `websearch`, `context7`, `grep_app` |
| `oracle` | `review-work`, `ai-slop-remover`, `kilo-config` | none |
| `designer` | `frontend-ui-ux`, `browser-verification` | `kilo-playwright` |
| `fixer` | `kilo-config`, `git-master` | none |
| `observer` | none | none |
| `council` | `review-work` | none |

The VS Code settings UI renders these as selectable options rather than raw comma-separated JSON fields. The same `*` and `!name` semantics remain available through the UI and JSON config.

## Agents

| Agent | Mode | Default access | Purpose |
|---|---|---|---|
| `secretary` | primary | `task` only to `team`, todo, read/search, web, no shell/edit | Selectable intake layer that clarifies intent and hands a clean execution brief to Orchestrator. |
| `team` | primary | Delegation, todo, read/search, web, shell from defaults | Orchestrator. Commands the workflow, handles quick work directly, and delegates substantial work to specialists. |
| `architect` | subagent | Read/search/web/docs, no question/edit/shell/delegation | Design advisor. Evaluates architecture, product/system shape, data/API/plugin boundaries, migration risk, and long-term tradeoffs before implementation planning. |
| `planner` | subagent | Read/search/web/docs, no question/edit/shell/delegation | Implementation planner. Converts settled goals or architecture into task breakdowns, ownership boundaries, dependencies, specialist lanes, and verification steps. |
| `explorer` | subagent | Read/search/code discovery | Finds files, symbols, call sites, and architectural entry points quickly. |
| `librarian` | subagent | Read/search/web/docs | Looks up current external documentation and source examples. |
| `oracle` | subagent | Read/search | Reviews architecture, debugging strategy, maintainability, and high-risk decisions. |
| `designer` | subagent | Edit allowed, no delegation | Implements or reviews user-facing UI and UX. |
| `fixer` | subagent | Edit allowed, no delegation | Executes bounded backend, service, CLI, config, fixture, test, and non-UI implementation changes. |
| `observer` | subagent | Read only | Analyzes images, screenshots, PDFs, and diagrams. |
| `council` | all or subagent | Council tool only plus read | Synthesizes optional multi-model opinions. |
| `councillor` | hidden subagent | Read only | Internal independent advisor spawned by council sessions. |

The upstream `explore` agent remains available for manual use. Agent Team uses its own `explorer` specialist so the built-in coordinator can route discovery work without referencing a missing alias.

## Default-Agent Takeover

When `agentTeam.enabled` and `agentTeam.takeoverDefault` are true:

1. If the user explicitly sets `default_agent`, honor it.
2. If no explicit default exists, choose `team` as Orchestrator.
3. If Orchestrator is disabled, hidden, or unavailable, fall back to `code`.

This setting only controls the default entry. When Agent Team is enabled, users can switch between `secretary` and `team` from the agent picker for each conversation.

## Delegation Rules

- `secretary` can only delegate to `team` and cannot directly call specialist agents.
- `team` can delegate to enabled specialists.
- The only allowed nested delegation chain is `secretary -> team -> specialist`.
- `architect` and `planner` are advisory specialists. They must not directly question users, edit files, run shell commands, or delegate further.
- `team` should keep simple tasks direct, route medium multi-step work to `planner`, and route large/cross-module design decisions to `architect` before `planner`.
- `fixer` and `designer` are leaf implementation agents and must not delegate.
- Read-only roles must not receive edit or shell permissions.
- Primary agents must not be used as subagents except the controlled `secretary -> team` handoff.
- Child sessions inherit edit, shell, and MCP restrictions from the caller.
- `task_id` session reuse should be automatic only for Agent Team primary sessions.

## Session Reuse

Kilo already returns `task_id` from delegated tasks. Agent Team adds memory around it:

1. Record `parent session -> role -> recent child sessions`.
2. Append resumable-session hints to the latest Orchestrator or Secretary user message.
3. Resolve short aliases to real `task_id` values before Task execution.
4. Drop stale entries when child sessions are deleted or fail as missing.

This avoids repeatedly recreating specialist context while keeping behavior local to Team mode.

## Council

Council is an advanced feature:

- Disabled by default.
- Uses configured Kilo provider models.
- Runs independent councillor sessions in parallel or serial mode.
- Requires a final synthesis response with council response, councillor details, disagreements, and confidence.
- Must surface cost/latency implications in settings.

## Auto-Continue

Auto-continue is intentionally conservative:

- Disabled by default.
- Only applies to Orchestrator and Secretary sessions.
- Requires incomplete todos.
- Can auto-enable only when unfinished todos meet the configured threshold.
- Must not continue when the last assistant message asks a question.
- Must stop after a configured number of continuations.
- Must suppress continuation after user abort.

## UI Requirements

The VS Code settings UI should use clear sections:

- Agent Team overview and master enable switch.
- Default takeover switch.
- Agent routing grid grouped into entry, design/planning, discovery, execution, and review layers.
- Per-role enable switch, model picker, thinking strength, and temperature.
- Collapsed per-role policy controls for display name, skills, and MCPs.
- Collaboration settings for session reuse and parallelism.
- Council settings in a collapsed advanced section.
- Auto-continue settings in a collapsed advanced section.

All user-facing labels and descriptions require i18n strings. Model fields must use the existing model selector rather than text fields.

## Rollout

1. Add architecture documentation.
2. Add native agent definitions and prompts.
3. Add config schema and default-agent takeover.
4. Add VS Code settings UI.
5. Tighten Task delegation constraints and descriptions.
6. Add Team-only session reuse.
7. Add optional council.
8. Add optional auto-continue.
9. Run targeted package checks and add tests around Kilo-specific logic.
