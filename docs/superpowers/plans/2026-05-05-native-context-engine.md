# Native Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Magic Context directly into Kilo as a native Context Engine so it no longer depends on plugin install/update, iframe settings RPC, or separate plugin packaging.

**Architecture:** Add a native `contextEngine` domain under `packages/opencode/src/kilocode/context-engine/` for config, lifecycle, model resolution, migration, tools, memory, and session hooks. Add first-class server routes and VS Code webview state so settings read/write Kilo config directly and model selection uses Kilo configured providers without plugin RPC.

**Tech Stack:** Bun, TypeScript, Effect services, Kilo config system, Kilo provider service, Hono routes, Solid webview UI, kilo-ui, Bun tests.

---

## Scope And Direction

This is an internal high-customization migration. Magic Context becomes a built-in Kilo feature. The old plugin remains only as a migration source and should not be required for normal operation.

Non-goals for the first native milestone:
- No plugin marketplace support for Magic Context.
- No iframe settings UI.
- No raw JSON settings UI.
- No attempt to upstream this as a clean PR.
- No full Dreamer/Sidekick parity before the native config + model picker + service lifecycle are stable.

## Target User Experience

- Kilo Settings has a native `Context Engine` page.
- The page has one clean header: left title, right actions: refresh, diagnose, reset, save.
- Tabs/sections use `API`, not `代理`.
- Model fields are dropdowns populated from Kilo configured providers/models.
- If no provider is configured, show a clear `Configure API Provider` action.
- No iframe, no nested card chrome, no duplicated `Magic Context` title, no bottom config path footer.
- Existing `kilo-magic-context.jsonc` can be migrated once into Kilo config.

## File Structure

### Backend files

- Create: `packages/opencode/src/kilocode/context-engine/config.ts`
  - Native config types, defaults, normalization, camel/snake legacy compatibility.
- Create: `packages/opencode/src/kilocode/context-engine/model-options.ts`
  - Converts Kilo providers into UI model options.
- Create: `packages/opencode/src/kilocode/context-engine/migration.ts`
  - Converts old `kilo-magic-context.jsonc` shape to `contextEngine`.
- Create: `packages/opencode/src/kilocode/context-engine/service.ts`
  - Starts/stops native Context Engine and exposes status.
- Create: `packages/opencode/src/kilocode/context-engine/historian.ts`
  - First native Historian decision/runner boundary.
- Create: `packages/opencode/src/kilocode/context-engine/index.ts`
  - Barrel exports.
- Modify: `packages/opencode/src/server/routes/instance/config.ts`
  - Add `GET /config/context-engine` and `POST /config/context-engine`.
- Modify: `packages/opencode/src/config/config.ts`
  - Add `contextEngine` config shape if the schema requires it.
- Modify: `packages/opencode/src/plugin/manager.ts`
  - Detect legacy Magic Context plugin IDs and expose helper.

### Backend tests

- Create: `packages/opencode/test/kilocode/context-engine/config.test.ts`
- Create: `packages/opencode/test/kilocode/context-engine/model-options.test.ts`
- Create: `packages/opencode/test/kilocode/context-engine/migration.test.ts`
- Create: `packages/opencode/test/kilocode/context-engine/service.test.ts`
- Create: `packages/opencode/test/kilocode/context-engine/historian.test.ts`
- Create: `packages/opencode/test/kilocode/context-engine/plugin-conflict.test.ts`

### VS Code/webview files

- Modify: `packages/kilo-vscode/src/KiloProvider.ts`
  - Add load/save handlers for Context Engine settings.
- Modify: `packages/kilo-vscode/webview-ui/src/types/messages/webview-messages.ts`
  - Add Context Engine message types.
- Create: `packages/kilo-vscode/webview-ui/src/context/context-engine.tsx`
  - Webview state provider.
- Create: `packages/kilo-vscode/webview-ui/src/components/settings/ContextEngineTab.tsx`
  - Native settings page.
- Create: `packages/kilo-vscode/webview-ui/src/components/settings/ContextEngineModelSelect.tsx`
  - Shared model dropdown.
- Modify: `packages/kilo-vscode/webview-ui/src/components/settings/Settings.tsx`
  - Add native Context Engine settings entry.
- Modify: `packages/kilo-vscode/webview-ui/src/i18n/en.ts`
- Modify: `packages/kilo-vscode/webview-ui/src/i18n/zh.ts`
- Modify: `packages/kilo-vscode/webview-ui/src/i18n/zht.ts`

---
### Task 1: Native Config Defaults

**Files:**
- Create: `packages/opencode/src/kilocode/context-engine/config.ts`
- Create: `packages/opencode/src/kilocode/context-engine/index.ts`
- Create: `packages/opencode/test/kilocode/context-engine/config.test.ts`

- [ ] **Step 1: Write the failing config test**

Create `packages/opencode/test/kilocode/context-engine/config.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ContextEngineConfig } from "../../../src/kilocode/context-engine/config"

describe("ContextEngineConfig", () => {
  test("normalizes missing config to safe defaults", () => {
    const config = ContextEngineConfig.normalize(undefined)
    expect(config.enabled).toBe(false)
    expect(config.mode).toBe("recommended")
    expect(config.historian.enabled).toBe(true)
    expect(config.historian.model).toBe("")
    expect(config.historian.fallbackModels).toEqual([])
    expect(config.dreamer.enabled).toBe(false)
    expect(config.sidekick.enabled).toBe(false)
    expect(config.memory.enabled).toBe(false)
  })

  test("normalizes partial user config without mutating input", () => {
    const input = {
      enabled: true,
      historian: {
        model: "github-copilot/claude-sonnet-4-5",
        fallbackModels: ["openai/gpt-5.1", ""],
      },
      memory: { enabled: true },
    }
    const config = ContextEngineConfig.normalize(input)
    expect(input.historian.fallbackModels).toEqual(["openai/gpt-5.1", ""])
    expect(config.enabled).toBe(true)
    expect(config.historian.model).toBe("github-copilot/claude-sonnet-4-5")
    expect(config.historian.fallbackModels).toEqual(["openai/gpt-5.1"])
    expect(config.memory.enabled).toBe(true)
    expect(config.memory.embedding.provider).toBe("local")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/opencode`:

```bash
bun test test/kilocode/context-engine/config.test.ts --timeout 20000
```

Expected: FAIL with module not found for `context-engine/config`.

- [ ] **Step 3: Implement native config module**

Create `packages/opencode/src/kilocode/context-engine/config.ts`:

```ts
import { isRecord } from "@/util/record"

export type ContextEngineMode = "recommended" | "light" | "advanced"
export type ContextEngineEmbeddingProvider = "local" | "openai-compatible" | "off"

export type ContextEngineAgentConfig = {
  enabled: boolean
  model: string
  fallbackModels: string[]
  variant: string
  thinkingLevel: string
}

export type ContextEngineConfig = {
  enabled: boolean
  mode: ContextEngineMode
  historian: ContextEngineAgentConfig & { twoPass: boolean }
  dreamer: ContextEngineAgentConfig
  sidekick: ContextEngineAgentConfig
  memory: {
    enabled: boolean
    injectionBudgetTokens: number
    autoPromote: boolean
    retrievalCountPromotionThreshold: number
    embedding: {
      provider: ContextEngineEmbeddingProvider
      model: string
      endpoint: string
      apiKey: string
    }
  }
}

const agentDefaults: ContextEngineAgentConfig = {
  enabled: false,
  model: "",
  fallbackModels: [],
  variant: "",
  thinkingLevel: "medium",
}

export const defaultConfig: ContextEngineConfig = {
  enabled: false,
  mode: "recommended",
  historian: { ...agentDefaults, enabled: true, twoPass: true },
  dreamer: { ...agentDefaults },
  sidekick: { ...agentDefaults },
  memory: {
    enabled: false,
    injectionBudgetTokens: 4000,
    autoPromote: true,
    retrievalCountPromotionThreshold: 3,
    embedding: {
      provider: "local",
      model: "Xenova/all-MiniLM-L6-v2",
      endpoint: "",
      apiKey: "",
    },
  },
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function num(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function list(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
}

function mode(value: unknown): ContextEngineMode {
  return value === "recommended" || value === "light" || value === "advanced" ? value : "recommended"
}

function embeddingProvider(value: unknown): ContextEngineEmbeddingProvider {
  return value === "local" || value === "openai-compatible" || value === "off" ? value : "local"
}

function normalizeAgent(value: unknown, defaults: ContextEngineAgentConfig): ContextEngineAgentConfig {
  const input = isRecord(value) ? value : {}
  return {
    enabled: bool(input.enabled, defaults.enabled),
    model: text(input.model, defaults.model),
    fallbackModels: list(input.fallbackModels ?? input.fallback_models),
    variant: text(input.variant, defaults.variant),
    thinkingLevel: text(input.thinkingLevel ?? input.thinking_level, defaults.thinkingLevel),
  }
}

export function normalize(value: unknown): ContextEngineConfig {
  const input = isRecord(value) ? value : {}
  const historian = isRecord(input.historian) ? input.historian : {}
  const memory = isRecord(input.memory) ? input.memory : {}
  const embedding = isRecord(memory.embedding) ? memory.embedding : {}
  return {
    enabled: bool(input.enabled, defaultConfig.enabled),
    mode: mode(input.mode),
    historian: {
      ...normalizeAgent(historian, defaultConfig.historian),
      twoPass: bool(historian.twoPass ?? historian.two_pass, defaultConfig.historian.twoPass),
    },
    dreamer: normalizeAgent(input.dreamer, defaultConfig.dreamer),
    sidekick: normalizeAgent(input.sidekick, defaultConfig.sidekick),
    memory: {
      enabled: bool(memory.enabled, defaultConfig.memory.enabled),
      injectionBudgetTokens: num(memory.injectionBudgetTokens ?? memory.injection_budget_tokens, defaultConfig.memory.injectionBudgetTokens),
      autoPromote: bool(memory.autoPromote ?? memory.auto_promote, defaultConfig.memory.autoPromote),
      retrievalCountPromotionThreshold: num(
        memory.retrievalCountPromotionThreshold ?? memory.retrieval_count_promotion_threshold,
        defaultConfig.memory.retrievalCountPromotionThreshold,
      ),
      embedding: {
        provider: embeddingProvider(embedding.provider),
        model: text(embedding.model, defaultConfig.memory.embedding.model),
        endpoint: text(embedding.endpoint, defaultConfig.memory.embedding.endpoint),
        apiKey: text(embedding.apiKey ?? embedding.api_key, defaultConfig.memory.embedding.apiKey),
      },
    },
  }
}

export const ContextEngineConfig = { default: defaultConfig, normalize }
```

Create `packages/opencode/src/kilocode/context-engine/index.ts`:

```ts
export * from "./config"
```

- [ ] **Step 4: Run config test**

Run:

```bash
bun test test/kilocode/context-engine/config.test.ts --timeout 20000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/kilocode/context-engine/config.ts packages/opencode/src/kilocode/context-engine/index.ts packages/opencode/test/kilocode/context-engine/config.test.ts
git commit -m "feat: add native context engine config"
```

---

### Task 2: Provider Model Options

**Files:**
- Create: `packages/opencode/src/kilocode/context-engine/model-options.ts`
- Modify: `packages/opencode/src/kilocode/context-engine/index.ts`
- Create: `packages/opencode/test/kilocode/context-engine/model-options.test.ts`

- [ ] **Step 1: Write failing model option test**

Create `packages/opencode/test/kilocode/context-engine/model-options.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ContextEngineModelOptions } from "../../../src/kilocode/context-engine/model-options"

describe("ContextEngineModelOptions", () => {
  test("builds sorted provider/model options", () => {
    const options = ContextEngineModelOptions.fromProviders({
      openai: {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5.1": { id: "gpt-5.1", name: "GPT 5.1" },
        },
      },
      "github-copilot": {
        id: "github-copilot",
        name: "GitHub Copilot",
        models: {
          "claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        },
      },
    })
    expect(options).toEqual([
      { value: "github-copilot/claude-sonnet-4-5", label: "GitHub Copilot · Claude Sonnet 4.5", provider: "github-copilot", model: "claude-sonnet-4-5" },
      { value: "openai/gpt-5.1", label: "OpenAI · GPT 5.1", provider: "openai", model: "gpt-5.1" },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test test/kilocode/context-engine/model-options.test.ts --timeout 20000
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement model options**

Create `packages/opencode/src/kilocode/context-engine/model-options.ts`:

```ts
export type ContextEngineProviderModel = { id?: string; name?: string }
export type ContextEngineProviderInfo = { id: string; name: string; models: Record<string, ContextEngineProviderModel> }
export type ContextEngineModelOption = { value: string; label: string; provider: string; model: string }

export function fromProviders(providers: Record<string, ContextEngineProviderInfo>): ContextEngineModelOption[] {
  const options: ContextEngineModelOption[] = []
  for (const provider of Object.values(providers)) {
    for (const [modelID, model] of Object.entries(provider.models)) {
      const id = model.id || modelID
      options.push({ value: `${provider.id}/${id}`, label: `${provider.name} · ${model.name || id}`, provider: provider.id, model: id })
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label))
}

export const ContextEngineModelOptions = { fromProviders }
```

Modify `packages/opencode/src/kilocode/context-engine/index.ts`:

```ts
export * from "./config"
export * from "./model-options"
```

- [ ] **Step 4: Run test**

```bash
bun test test/kilocode/context-engine/model-options.test.ts --timeout 20000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/kilocode/context-engine/model-options.ts packages/opencode/src/kilocode/context-engine/index.ts packages/opencode/test/kilocode/context-engine/model-options.test.ts
git commit -m "feat: add context engine model options"
```

---

### Task 3: Backend Settings GET Route

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/config.ts`
- Create: `packages/opencode/test/kilocode/context-engine/routes.test.ts`

- [ ] **Step 1: Write helper coverage test**

Create `packages/opencode/test/kilocode/context-engine/routes.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ContextEngineConfig, ContextEngineModelOptions } from "../../../src/kilocode/context-engine"

describe("context engine settings route data", () => {
  test("combines normalized config and model options", () => {
    const config = ContextEngineConfig.normalize({ enabled: true, historian: { model: "openai/gpt-5.1" } })
    const models = ContextEngineModelOptions.fromProviders({
      openai: { id: "openai", name: "OpenAI", models: { "gpt-5.1": { id: "gpt-5.1", name: "GPT 5.1" } } },
    })
    expect(config.enabled).toBe(true)
    expect(config.historian.model).toBe("openai/gpt-5.1")
    expect(models[0]?.value).toBe("openai/gpt-5.1")
  })
})
```

- [ ] **Step 2: Run test**

```bash
bun test test/kilocode/context-engine/routes.test.ts --timeout 20000
```

Expected: PASS after Tasks 1 and 2.

- [ ] **Step 3: Add GET route**

Modify `packages/opencode/src/server/routes/instance/config.ts`.

Add imports:

```ts
import { ContextEngineConfig, ContextEngineModelOptions } from "@/kilocode/context-engine"
import { Provider } from "@/provider/provider"
```

Add route near existing config routes:

```ts
.get(
  "/context-engine",
  describeRoute({
    summary: "Get Context Engine settings",
    description: "Get normalized native Context Engine configuration and configured Kilo provider models.",
    operationId: "config.contextEngine.get",
    responses: { 200: { description: "Context Engine settings" } },
  }),
  async (c) =>
    jsonRequest("ConfigRoutes.contextEngine.get", c, function* () {
      const cfg = yield* Config.Service
      const provider = yield* Provider.Service
      const current = yield* cfg.get()
      const providers = yield* provider.list()
      return {
        config: ContextEngineConfig.normalize((current as { contextEngine?: unknown }).contextEngine),
        models: ContextEngineModelOptions.fromProviders(providers),
      }
    }),
)
```

- [ ] **Step 4: Run backend typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/server/routes/instance/config.ts packages/opencode/test/kilocode/context-engine/routes.test.ts
git commit -m "feat: expose context engine settings route"
```

---

### Task 4: Webview Message Plumbing

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/types/messages/webview-messages.ts`
- Modify: `packages/kilo-vscode/src/KiloProvider.ts`
- Create: `packages/kilo-vscode/webview-ui/src/context/context-engine.tsx`

- [ ] **Step 1: Add webview message types**

Add these interfaces to `packages/kilo-vscode/webview-ui/src/types/messages/webview-messages.ts`:

```ts
export interface LoadContextEngineSettingsMessage { type: "loadContextEngineSettings" }
export interface SaveContextEngineSettingsMessage { type: "saveContextEngineSettings"; config: unknown }
export interface ContextEngineSettingsLoadedMessage {
  type: "contextEngineSettingsLoaded"
  config: unknown
  models: Array<{ value: string; label: string; provider: string; model: string }>
}
export interface ContextEngineSettingsSavedMessage { type: "contextEngineSettingsSaved"; config: unknown }
```

Add load/save messages to the webview-to-extension union. Add loaded/saved messages to the extension-to-webview union.

- [ ] **Step 2: Add KiloProvider load handler**

In `packages/kilo-vscode/src/KiloProvider.ts`, add:

```ts
private async handleLoadContextEngineSettings(): Promise<void> {
  try {
    const data = await this.pluginFetch<{ config: unknown; models: Array<{ value: string; label: string; provider: string; model: string }> }>("/config/context-engine")
    this.postMessage({ type: "contextEngineSettingsLoaded", config: data.config, models: data.models })
  } catch (error) {
    this.postMessage({ type: "error", message: getErrorMessage(error) || "Failed to load Context Engine settings" })
  }
}
```

Wire message switch:

```ts
case "loadContextEngineSettings":
  await this.handleLoadContextEngineSettings()
  break
```

- [ ] **Step 3: Create webview context provider**

Create `packages/kilo-vscode/webview-ui/src/context/context-engine.tsx`:

```tsx
import { Accessor, ParentComponent, createContext, createSignal, onCleanup, useContext } from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"

export type ContextEngineModelOption = { value: string; label: string; provider: string; model: string }

type State = {
  config: Accessor<unknown>
  models: Accessor<ContextEngineModelOption[]>
  loading: Accessor<boolean>
  load: () => void
}

const ContextEngineContext = createContext<State>()

export const ContextEngineProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [config, setConfig] = createSignal<unknown>({})
  const [models, setModels] = createSignal<ContextEngineModelOption[]>([])
  const [loading, setLoading] = createSignal(false)

  const load = () => {
    setLoading(true)
    vscode.postMessage({ type: "loadContextEngineSettings" })
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "contextEngineSettingsLoaded") return
    setConfig(message.config)
    setModels(message.models)
    setLoading(false)
  })

  onCleanup(unsubscribe)
  load()

  return <ContextEngineContext.Provider value={{ config, models, loading, load }}>{props.children}</ContextEngineContext.Provider>
}

export function useContextEngine() {
  const context = useContext(ContextEngineContext)
  if (!context) throw new Error("useContextEngine must be used inside ContextEngineProvider")
  return context
}
```

- [ ] **Step 4: Run VS Code typecheck**

```bash
bun run --cwd packages/kilo-vscode typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kilo-vscode/src/KiloProvider.ts packages/kilo-vscode/webview-ui/src/types/messages/webview-messages.ts packages/kilo-vscode/webview-ui/src/context/context-engine.tsx
git commit -m "feat: add context engine settings plumbing"
```

---
### Task 5: Native Settings UI

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/components/settings/ContextEngineModelSelect.tsx`
- Create: `packages/kilo-vscode/webview-ui/src/components/settings/ContextEngineTab.tsx`
- Modify: `packages/kilo-vscode/webview-ui/src/components/settings/Settings.tsx`
- Modify: `packages/kilo-vscode/webview-ui/src/i18n/en.ts`
- Modify: `packages/kilo-vscode/webview-ui/src/i18n/zh.ts`
- Modify: `packages/kilo-vscode/webview-ui/src/i18n/zht.ts`

- [ ] **Step 1: Create model select component**

Create `packages/kilo-vscode/webview-ui/src/components/settings/ContextEngineModelSelect.tsx`:

```tsx
import { Component, Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import type { ContextEngineModelOption } from "../../context/context-engine"

type Props = {
  label: string
  value: string
  models: ContextEngineModelOption[]
  onChange: (value: string) => void
  onOpenProviders: () => void
}

export const ContextEngineModelSelect: Component<Props> = (props) => {
  const options = () => [{ value: "", label: "Use Kilo default" }, ...props.models]
  return (
    <div style={{ display: "grid", gap: "6px" }}>
      <label style={{ "font-weight": 600 }}>{props.label}</label>
      <Show
        when={props.models.length > 0}
        fallback={
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <span>No configured API models found.</span>
            <button type="button" onClick={props.onOpenProviders}>Configure API Provider</button>
          </div>
        }
      >
        <Select
          options={options()}
          value={options().find((item) => item.value === props.value) ?? options()[0]}
          onChange={(item) => props.onChange(item.value)}
        />
      </Show>
    </div>
  )
}
```

- [ ] **Step 2: Create Context Engine tab**

Create `packages/kilo-vscode/webview-ui/src/components/settings/ContextEngineTab.tsx`:

```tsx
import { Component, createEffect, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useContextEngine } from "../../context/context-engine"
import { useLanguage } from "../../context/language"
import { ContextEngineModelSelect } from "./ContextEngineModelSelect"

type Draft = {
  enabled?: boolean
  historian?: { model?: string }
  dreamer?: { model?: string }
  sidekick?: { model?: string }
  memory?: { enabled?: boolean }
}

function clone(value: unknown): Draft {
  if (!value || typeof value !== "object") return {}
  return JSON.parse(JSON.stringify(value)) as Draft
}

export const ContextEngineTab: Component = () => {
  const language = useLanguage()
  const engine = useContextEngine()
  const [draft, setDraft] = createSignal<Draft>({})
  const [dirty, setDirty] = createSignal(false)

  createEffect(() => {
    if (dirty()) return
    setDraft(clone(engine.config()))
  })

  const patch = (fn: (current: Draft) => Draft) => {
    setDraft((current) => fn(clone(current)))
    setDirty(true)
  }

  const setAgentModel = (agent: "historian" | "dreamer" | "sidekick", model: string) => {
    patch((current) => ({ ...current, [agent]: { ...(current[agent] ?? {}), model } }))
  }

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
        <h2 style={{ margin: 0 }}>{language.t("settings.contextEngine.title")}</h2>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="secondary" onClick={engine.load}>{language.t("settings.contextEngine.refresh")}</Button>
          <Button variant="secondary" disabled={!dirty()} onClick={() => { setDraft(clone(engine.config())); setDirty(false) }}>{language.t("settings.contextEngine.reset")}</Button>
          <Button disabled={!dirty()} onClick={() => { engine.save(draft()); setDirty(false) }}>{language.t("settings.contextEngine.save")}</Button>
        </div>
      </div>
      <Card>
        <div style={{ display: "grid", gap: "12px" }}>
          <Switch checked={draft().enabled === true} onChange={(enabled) => patch((current) => ({ ...current, enabled }))}>
            {language.t("settings.contextEngine.enabled")}
          </Switch>
          <ContextEngineModelSelect label={language.t("settings.contextEngine.historianModel")} value={draft().historian?.model ?? ""} models={engine.models()} onChange={(value) => setAgentModel("historian", value)} onOpenProviders={() => window.dispatchEvent(new CustomEvent("kilo-open-provider-settings"))} />
          <ContextEngineModelSelect label={language.t("settings.contextEngine.dreamerModel")} value={draft().dreamer?.model ?? ""} models={engine.models()} onChange={(value) => setAgentModel("dreamer", value)} onOpenProviders={() => window.dispatchEvent(new CustomEvent("kilo-open-provider-settings"))} />
          <ContextEngineModelSelect label={language.t("settings.contextEngine.sidekickModel")} value={draft().sidekick?.model ?? ""} models={engine.models()} onChange={(value) => setAgentModel("sidekick", value)} onOpenProviders={() => window.dispatchEvent(new CustomEvent("kilo-open-provider-settings"))} />
          <Switch checked={draft().memory?.enabled === true} onChange={(enabled) => patch((current) => ({ ...current, memory: { ...(current.memory ?? {}), enabled } }))}>
            {language.t("settings.contextEngine.memoryEnabled")}
          </Switch>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Add i18n keys**

Add to `packages/kilo-vscode/webview-ui/src/i18n/en.ts`:

```ts
"settings.contextEngine.title": "Context Engine",
"settings.contextEngine.refresh": "Refresh",
"settings.contextEngine.reset": "Reset",
"settings.contextEngine.save": "Save",
"settings.contextEngine.enabled": "Enable Context Engine",
"settings.contextEngine.historianModel": "Historian model",
"settings.contextEngine.dreamerModel": "Dreamer model",
"settings.contextEngine.sidekickModel": "Sidekick model",
"settings.contextEngine.memoryEnabled": "Enable memory",
```

Add to `packages/kilo-vscode/webview-ui/src/i18n/zh.ts`:

```ts
"settings.contextEngine.title": "Context Engine",
"settings.contextEngine.refresh": "刷新",
"settings.contextEngine.reset": "重置",
"settings.contextEngine.save": "保存",
"settings.contextEngine.enabled": "启用 Context Engine",
"settings.contextEngine.historianModel": "Historian 模型",
"settings.contextEngine.dreamerModel": "Dreamer 模型",
"settings.contextEngine.sidekickModel": "Sidekick 模型",
"settings.contextEngine.memoryEnabled": "启用记忆",
```

Add equivalent keys to `packages/kilo-vscode/webview-ui/src/i18n/zht.ts`. Use `API` literally anywhere API appears. Do not translate API as `代理`.

- [ ] **Step 4: Wire tab into Settings**

Modify `packages/kilo-vscode/webview-ui/src/components/settings/Settings.tsx` using the existing tab pattern. Add a `Context Engine` tab or section that renders:

```tsx
<ContextEngineProvider>
  <ContextEngineTab />
</ContextEngineProvider>
```

- [ ] **Step 5: Typecheck webview**

```bash
bun run --cwd packages/kilo-vscode typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/components/settings/ContextEngineModelSelect.tsx packages/kilo-vscode/webview-ui/src/components/settings/ContextEngineTab.tsx packages/kilo-vscode/webview-ui/src/components/settings/Settings.tsx packages/kilo-vscode/webview-ui/src/i18n/en.ts packages/kilo-vscode/webview-ui/src/i18n/zh.ts packages/kilo-vscode/webview-ui/src/i18n/zht.ts
git commit -m "feat: add native context engine settings UI"
```

---

### Task 6: Save Context Engine Config

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/config.ts`
- Create: `packages/opencode/test/kilocode/context-engine/save-config.test.ts`
- Modify: `packages/kilo-vscode/src/KiloProvider.ts`
- Modify: `packages/kilo-vscode/webview-ui/src/context/context-engine.tsx`

- [ ] **Step 1: Write save normalization test**

Create `packages/opencode/test/kilocode/context-engine/save-config.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ContextEngineConfig } from "../../../src/kilocode/context-engine/config"

describe("context engine save", () => {
  test("normalizes saved draft", () => {
    const saved = ContextEngineConfig.normalize({ enabled: true, historian: { model: "openai/gpt-5.1" }, memory: { enabled: true } })
    expect(saved.enabled).toBe(true)
    expect(saved.historian.model).toBe("openai/gpt-5.1")
    expect(saved.memory.enabled).toBe(true)
    expect(saved.memory.embedding.provider).toBe("local")
  })
})
```

- [ ] **Step 2: Run save test**

```bash
bun test test/kilocode/context-engine/save-config.test.ts --timeout 20000
```

Expected: PASS.

- [ ] **Step 3: Add POST route**

In `packages/opencode/src/server/routes/instance/config.ts`, add request schema:

```ts
const ContextEngineSaveInput = z.object({ config: z.unknown() })
```

Add route next to GET `/context-engine`:

```ts
.post(
  "/context-engine",
  validator("json", ContextEngineSaveInput),
  async (c) =>
    jsonRequest("ConfigRoutes.contextEngine.save", c, function* () {
      const input = c.req.valid("json")
      const normalized = ContextEngineConfig.normalize(input.config)
      const cfg = yield* Config.Service
      await cfg.patch({ contextEngine: normalized })
      yield* cfg.invalidate(true)
      return { config: normalized }
    }),
)
```

If `cfg.patch` does not exist, implement this route using the existing config write helper pattern in the repo. Do not write raw JSON by hand; use the established config mutation helper.

- [ ] **Step 4: Add KiloProvider save handler**

In `packages/kilo-vscode/src/KiloProvider.ts`, add:

```ts
private async handleSaveContextEngineSettings(config: unknown): Promise<void> {
  try {
    const data = await this.pluginFetch<{ config: unknown }>("/config/context-engine", {
      method: "POST",
      body: JSON.stringify({ config }),
    })
    this.postMessage({ type: "contextEngineSettingsSaved", config: data.config })
  } catch (error) {
    this.postMessage({ type: "error", message: getErrorMessage(error) || "Failed to save Context Engine settings" })
  }
}
```

Wire message switch:

```ts
case "saveContextEngineSettings":
  await this.handleSaveContextEngineSettings(message.config)
  break
```

- [ ] **Step 5: Update webview context save function**

Modify `packages/kilo-vscode/webview-ui/src/context/context-engine.tsx` to include:

```tsx
const [saving, setSaving] = createSignal(false)
const save = (config: unknown) => {
  setSaving(true)
  vscode.postMessage({ type: "saveContextEngineSettings", config })
}
```

Handle saved message:

```tsx
if (message.type === "contextEngineSettingsSaved") {
  setConfig(message.config)
  setSaving(false)
  return
}
```

Expose `saving` and `save` in the provider value.

- [ ] **Step 6: Typecheck backend and webview**

```bash
bun run --cwd packages/opencode typecheck
bun run --cwd packages/kilo-vscode typecheck
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/server/routes/instance/config.ts packages/opencode/test/kilocode/context-engine/save-config.test.ts packages/kilo-vscode/src/KiloProvider.ts packages/kilo-vscode/webview-ui/src/context/context-engine.tsx
git commit -m "feat: save native context engine settings"
```

---

### Task 7: Legacy Config Migration

**Files:**
- Create: `packages/opencode/src/kilocode/context-engine/migration.ts`
- Modify: `packages/opencode/src/kilocode/context-engine/index.ts`
- Create: `packages/opencode/test/kilocode/context-engine/migration.test.ts`

- [ ] **Step 1: Write migration test**

Create `packages/opencode/test/kilocode/context-engine/migration.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ContextEngineMigration } from "../../../src/kilocode/context-engine/migration"

describe("ContextEngineMigration", () => {
  test("converts legacy Magic Context config", () => {
    const migrated = ContextEngineMigration.fromLegacyConfig({
      enabled: true,
      historian: { model: "openai/gpt-5.1", fallback_models: ["github-copilot/claude-sonnet-4-5"], two_pass: false },
      memory: { enabled: true, injection_budget_tokens: 8000 },
      embedding: { provider: "openai-compatible", model: "text-embedding-3-large" },
    })
    expect(migrated.enabled).toBe(true)
    expect(migrated.historian.model).toBe("openai/gpt-5.1")
    expect(migrated.historian.fallbackModels).toEqual(["github-copilot/claude-sonnet-4-5"])
    expect(migrated.historian.twoPass).toBe(false)
    expect(migrated.memory.enabled).toBe(true)
    expect(migrated.memory.injectionBudgetTokens).toBe(8000)
    expect(migrated.memory.embedding.provider).toBe("openai-compatible")
  })
})
```

- [ ] **Step 2: Run failing migration test**

```bash
bun test test/kilocode/context-engine/migration.test.ts --timeout 20000
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement migration**

Create `packages/opencode/src/kilocode/context-engine/migration.ts`:

```ts
import { isRecord } from "@/util/record"
import { ContextEngineConfig, type ContextEngineConfig as NativeConfig } from "./config"

export function fromLegacyConfig(value: unknown): NativeConfig {
  const legacy = isRecord(value) ? value : {}
  const memory = isRecord(legacy.memory) ? legacy.memory : {}
  const embedding = isRecord(legacy.embedding) ? legacy.embedding : {}
  return ContextEngineConfig.normalize({
    enabled: legacy.enabled,
    mode: legacy.mode,
    historian: legacy.historian,
    dreamer: legacy.dreamer,
    sidekick: legacy.sidekick,
    memory: { ...memory, embedding },
  })
}

export const ContextEngineMigration = { fromLegacyConfig }
```

Modify `packages/opencode/src/kilocode/context-engine/index.ts`:

```ts
export * from "./config"
export * from "./model-options"
export * from "./migration"
```

- [ ] **Step 4: Run migration test**

```bash
bun test test/kilocode/context-engine/migration.test.ts --timeout 20000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/kilocode/context-engine/migration.ts packages/opencode/src/kilocode/context-engine/index.ts packages/opencode/test/kilocode/context-engine/migration.test.ts
git commit -m "feat: migrate legacy magic context config"
```

---

### Task 8: Native Service Lifecycle

**Files:**
- Create: `packages/opencode/src/kilocode/context-engine/service.ts`
- Modify: `packages/opencode/src/kilocode/context-engine/index.ts`
- Create: `packages/opencode/test/kilocode/context-engine/service.test.ts`

- [ ] **Step 1: Write lifecycle test**

Create `packages/opencode/test/kilocode/context-engine/service.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ContextEngineService } from "../../../src/kilocode/context-engine/service"

describe("ContextEngineService", () => {
  test("reports disabled status", async () => {
    const service = ContextEngineService.create({ enabled: false })
    await service.start()
    expect(service.status()).toEqual({ enabled: false, historian: "stopped", memory: "stopped" })
    await service.stop()
  })

  test("reports enabled status", async () => {
    const service = ContextEngineService.create({ enabled: true })
    await service.start()
    expect(service.status()).toEqual({ enabled: true, historian: "ready", memory: "ready" })
    await service.stop()
  })
})
```

- [ ] **Step 2: Run failing lifecycle test**

```bash
bun test test/kilocode/context-engine/service.test.ts --timeout 20000
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement no-op lifecycle service**

Create `packages/opencode/src/kilocode/context-engine/service.ts`:

```ts
import { ContextEngineConfig } from "./config"

export type ContextEngineStatus = { enabled: boolean; historian: "stopped" | "ready"; memory: "stopped" | "ready" }

export function create(input: unknown) {
  const config = ContextEngineConfig.normalize(input)
  let started = false
  return {
    async start() { started = true },
    async stop() { started = false },
    status(): ContextEngineStatus {
      if (!started || !config.enabled) return { enabled: false, historian: "stopped", memory: "stopped" }
      return { enabled: true, historian: "ready", memory: "ready" }
    },
  }
}

export const ContextEngineService = { create }
```

Modify `packages/opencode/src/kilocode/context-engine/index.ts`:

```ts
export * from "./config"
export * from "./model-options"
export * from "./migration"
export * from "./service"
```

- [ ] **Step 4: Run lifecycle test**

```bash
bun test test/kilocode/context-engine/service.test.ts --timeout 20000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/kilocode/context-engine/service.ts packages/opencode/src/kilocode/context-engine/index.ts packages/opencode/test/kilocode/context-engine/service.test.ts
git commit -m "feat: add native context engine lifecycle"
```

---

### Task 9: Legacy Plugin Conflict Detection

**Files:**
- Modify: `packages/opencode/src/plugin/manager.ts`
- Create: `packages/opencode/test/kilocode/context-engine/plugin-conflict.test.ts`

- [ ] **Step 1: Write conflict detection test**

Create `packages/opencode/test/kilocode/context-engine/plugin-conflict.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { PluginManager } from "../../../src/plugin/manager"

describe("legacy Magic Context plugin conflict", () => {
  test("detects legacy plugin IDs", () => {
    expect(PluginManager.isLegacyMagicContextPlugin("kilocode-magic-context")).toBe(true)
    expect(PluginManager.isLegacyMagicContextPlugin("magic-context")).toBe(true)
    expect(PluginManager.isLegacyMagicContextPlugin("@kilocode/kilo-indexing")).toBe(false)
  })
})
```

- [ ] **Step 2: Run failing test**

```bash
bun test test/kilocode/context-engine/plugin-conflict.test.ts --timeout 20000
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement helper**

Modify `packages/opencode/src/plugin/manager.ts`:

```ts
export function isLegacyMagicContextPlugin(id: string) {
  return id === "kilocode-magic-context" || id === "magic-context" || id.endsWith("/kilocode-magic-context")
}
```

- [ ] **Step 4: Run conflict test**

```bash
bun test test/kilocode/context-engine/plugin-conflict.test.ts --timeout 20000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/plugin/manager.ts packages/opencode/test/kilocode/context-engine/plugin-conflict.test.ts
git commit -m "feat: detect legacy magic context plugin"
```

---

### Task 10: Minimal Historian Boundary

**Files:**
- Create: `packages/opencode/src/kilocode/context-engine/historian.ts`
- Modify: `packages/opencode/src/kilocode/context-engine/index.ts`
- Create: `packages/opencode/test/kilocode/context-engine/historian.test.ts`

- [ ] **Step 1: Write historian decision test**

Create `packages/opencode/test/kilocode/context-engine/historian.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ContextEngineHistorian } from "../../../src/kilocode/context-engine/historian"

describe("ContextEngineHistorian", () => {
  test("does not run when disabled", () => {
    expect(ContextEngineHistorian.shouldRun({ engineEnabled: false, historianEnabled: true, messageCount: 200 })).toBe(false)
  })

  test("runs when enabled and history is large", () => {
    expect(ContextEngineHistorian.shouldRun({ engineEnabled: true, historianEnabled: true, messageCount: 200 })).toBe(true)
  })
})
```

- [ ] **Step 2: Run failing historian test**

```bash
bun test test/kilocode/context-engine/historian.test.ts --timeout 20000
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement historian boundary**

Create `packages/opencode/src/kilocode/context-engine/historian.ts`:

```ts
export type HistorianRunInput = { engineEnabled: boolean; historianEnabled: boolean; messageCount: number }

export function shouldRun(input: HistorianRunInput) {
  return input.engineEnabled && input.historianEnabled && input.messageCount >= 100
}

export const ContextEngineHistorian = { shouldRun }
```

Modify `packages/opencode/src/kilocode/context-engine/index.ts`:

```ts
export * from "./config"
export * from "./model-options"
export * from "./migration"
export * from "./service"
export * from "./historian"
```

- [ ] **Step 4: Run historian test**

```bash
bun test test/kilocode/context-engine/historian.test.ts --timeout 20000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/kilocode/context-engine/historian.ts packages/opencode/src/kilocode/context-engine/index.ts packages/opencode/test/kilocode/context-engine/historian.test.ts
git commit -m "feat: add context engine historian boundary"
```

---

### Task 11: Validation And VSIX

**Files:**
- Output: `packages/kilo-vscode/kilo-code-7.2.40.vsix`

- [ ] **Step 1: Run focused backend tests**

Run from `packages/opencode`:

```bash
bun test test/kilocode/context-engine --timeout 60000
```

Expected: all Context Engine tests PASS.

- [ ] **Step 2: Run backend typecheck**

```bash
bun run --cwd packages/opencode typecheck
```

Expected: PASS.

- [ ] **Step 3: Run VS Code typecheck**

```bash
bun run --cwd packages/kilo-vscode typecheck
```

Expected: PASS.

- [ ] **Step 4: Build extension**

Run from `packages/kilo-vscode`:

```bash
node esbuild.js --production
```

Expected: build finishes without errors.

- [ ] **Step 5: Package VSIX**

Run from `packages/kilo-vscode`:

```powershell
Remove-Item -Force kilo-code-*.vsix -ErrorAction SilentlyContinue
bunx vsce package --no-dependencies
```

Expected: `packages/kilo-vscode/kilo-code-7.2.40.vsix` exists.

- [ ] **Step 6: Manual acceptance**

Verify in VS Code:

```text
1. Kilo has a native Context Engine settings page.
2. No iframe chrome or nested Magic Context title appears.
3. No raw JSON editor appears.
4. API is displayed as API, not 代理.
5. Model dropdown shows configured Kilo provider models.
6. No provider configured state has a Configure API Provider action.
7. Save and refresh work.
8. Old Magic Context plugin is not required.
9. Old Magic Context plugin does not run in parallel when native engine is enabled.
```

- [ ] **Step 7: Commit validation fixes if needed**

If validation creates tracked changes or fixes are needed:

```bash
git add packages/opencode packages/kilo-vscode
git commit -m "fix: stabilize native context engine"
```

Do not commit `packages/kilo-vscode/kilo-code-7.2.40.vsix` unless explicitly requested.

---

## Self-Review

**Spec coverage:**
- Native built-in replacement: Tasks 1, 3, 4, 5, 6, 8.
- Stable provider/model picker: Tasks 2, 3, 4, 5.
- No iframe, no raw JSON, no nested UI: Task 5 and manual acceptance.
- Legacy migration: Task 7.
- Legacy plugin conflict: Task 9.
- First runtime boundary: Tasks 8 and 10.

**Placeholder scan:**
- The plan contains no `TBD` markers.
- Route save step explicitly says to use the existing config mutation helper if `cfg.patch` does not exist. The implementer must inspect existing config write patterns before editing config files.

**Type consistency:**
- Config key is consistently `contextEngine`.
- Model option shape is consistently `{ value, label, provider, model }`.
- Webview messages are consistently `loadContextEngineSettings`, `contextEngineSettingsLoaded`, `saveContextEngineSettings`, and `contextEngineSettingsSaved`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-native-context-engine.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
