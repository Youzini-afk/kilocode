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
| `packages/opencode/src/kilocode/agent-team/agents.ts` | Defines Team and specialist agent prompts, descriptions, defaults, and permissions. |
| `packages/opencode/src/kilocode/agent-team/config.ts` | Normalizes `agentTeam` config and resolves role model overrides. |
| `packages/opencode/src/kilocode/agent-team/session-reuse.ts` | Tracks reusable child sessions and injects resumable-session hints into Team requests. |
| `packages/opencode/src/kilocode/agent-team/council.ts` | Runs optional multi-model council sessions and formats synthesis input. |
| `packages/opencode/src/kilocode/agent-team/auto-continue.ts` | Conservatively resumes Team sessions with incomplete todos when enabled. |
| `packages/kilo-vscode/webview-ui/src/components/settings/AgentTeamTab.tsx` | Presents polished settings sections backed by Kilo provider/model pickers. |

Shared upstream files should only receive thin integration calls. Kilo-specific logic belongs under paths containing `kilocode`.

## Configuration Shape

The user-facing config key is `agentTeam`:

```jsonc
{
  "agentTeam": {
    "enabled": true,
    "takeoverDefault": true,
    "roles": {
      "orchestrator": {
        "enabled": true,
        "model": "kilo/auto",
        "variant": "high",
        "temperature": 0.1,
        "mcps": ["*", "!context7"]
      },
      "explorer": { "enabled": true, "model": "kilo/auto" },
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
      "enabled": false
    }
  }
}
```

The VS Code settings UI owns normal editing. JSON remains a power-user escape hatch only.

Role entries support:

- `enabled` — include or disable the role.
- `model` — provider/model picked from configured Kilo providers.
- `variant` — thinking/reasoning effort, such as `low`, `medium`, `high`, or `xhigh`.
- `temperature` — optional sampling temperature override from `0` to `2`.
- `skills` — skill allow-list with `*` and `!name` syntax.
- `mcps` — MCP server allow-list with `*` and `!name` syntax.
- `displayName` — optional user-facing alias.
- `options` — provider-specific model options for power users.

## Agents

| Agent | Mode | Default access | Purpose |
|---|---|---|---|
| `team` | primary | Delegation, todo, read/search, web, no shell | Coordinates work and chooses when specialist delegation is worth the overhead. |
| `explorer` | subagent | Read/search/code discovery | Finds files, symbols, call sites, and architectural entry points quickly. |
| `librarian` | subagent | Read/search/web/docs | Looks up current external documentation and source examples. |
| `oracle` | subagent | Read/search | Reviews architecture, debugging strategy, maintainability, and high-risk decisions. |
| `designer` | subagent | Edit allowed, no delegation | Implements or reviews user-facing UI and UX. |
| `fixer` | subagent | Edit allowed, no delegation | Executes bounded implementation and test changes. |
| `observer` | subagent | Read only | Analyzes images, screenshots, PDFs, and diagrams. |
| `council` | all or subagent | Council tool only plus read | Synthesizes optional multi-model opinions. |
| `councillor` | hidden subagent | Read only | Internal independent advisor spawned by council sessions. |

The upstream `explore` agent remains available for manual use. Agent Team uses its own `explorer` specialist so the built-in coordinator can route discovery work without referencing a missing alias.

## Default-Agent Takeover

When `agentTeam.enabled` and `agentTeam.takeoverDefault` are true:

1. If the user explicitly sets `default_agent`, honor it.
2. If no explicit default exists, choose `team`.
3. If `team` is disabled, hidden, or unavailable, fall back to `code`.

This preserves user intent and makes disabling Agent Team a clean rollback.

## Delegation Rules

- `team` can delegate to enabled subagents.
- `fixer` and `designer` are leaf implementation agents and must not delegate.
- Read-only roles must not receive edit or shell permissions.
- Primary agents must not be used as subagents.
- Child sessions inherit edit, shell, and MCP restrictions from the caller.
- `task_id` session reuse should be automatic only for Team-managed sessions.

## Session Reuse

Kilo already returns `task_id` from delegated tasks. Agent Team adds memory around it:

1. Record `parent session -> role -> recent child sessions`.
2. Append resumable-session hints to the latest Team user message.
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
- Only applies to Team sessions.
- Requires incomplete todos.
- Must not continue when the last assistant message asks a question.
- Must stop after a configured number of continuations.
- Must suppress continuation after user abort.

## UI Requirements

The VS Code settings UI should use clear sections:

- Agent Team overview and master enable switch.
- Default takeover switch.
- Agent routing grid with coordinator and specialists in one place.
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
