import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Tag } from "@kilocode/kilo-ui/tag"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import type {
  ContextEngineConfig,
  ContextEngineDoctorResult,
  ContextEngineEmbeddingProvider,
  ContextEngineSettingsPayload,
  ContextEngineThinkingLevel,
} from "../../types/messages"
import SettingsRow from "./SettingsRow"
import { ContextEngineModelSelect } from "./ContextEngineModelSelect"

type Profile = "light" | "recommended" | "advanced"
type Section = "agents" | "memory" | "runtime" | "advanced"
type Option<T extends string> = { value: T; label: string }
type Call = { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }

const PLUGIN_ID = "kilocode-magic-context"
const LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2"

const profiles: Option<Profile>[] = [
  { value: "recommended", label: "Recommended" },
  { value: "light", label: "Light" },
  { value: "advanced", label: "Advanced" },
]

const embeddings: Option<ContextEngineEmbeddingProvider>[] = [
  { value: "local", label: "Local" },
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "off", label: "Off" },
]

const thinking: Option<ContextEngineThinkingLevel | "default">[] = [
  { value: "default", label: "Default" },
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
]

const defaults: ContextEngineConfig = {
  enabled: true,
  ctx_reduce_enabled: true,
  cache_ttl: "5m",
  nudge_interval_tokens: 10000,
  execute_threshold_percentage: 65,
  protected_tags: 20,
  auto_drop_tool_age: 100,
  drop_tool_structure: true,
  clear_reasoning_age: 50,
  iteration_nudge_threshold: 15,
  history_budget_percentage: 0.15,
  historian_timeout_ms: 300000,
  compaction_markers: true,
  historian: { two_pass: false },
  dreamer: {
    enabled: false,
    schedule: "02:00-06:00",
    max_runtime_minutes: 120,
    tasks: ["consolidate", "verify", "archive-stale", "improve"],
    task_timeout_minutes: 20,
    inject_docs: true,
    user_memories: { enabled: true, promotion_threshold: 3 },
    pin_key_files: { enabled: false, token_budget: 10000, min_reads: 4 },
  },
  sidekick: { enabled: false, timeout_ms: 30000 },
  embedding: { provider: "local", model: LOCAL_EMBEDDING_MODEL },
  memory: {
    enabled: true,
    injection_budget_tokens: 4000,
    auto_promote: true,
    retrieval_count_promotion_threshold: 3,
  },
  commit_cluster_trigger: { enabled: true, min_clusters: 3 },
  compressor: {
    enabled: true,
    min_compartment_ratio: 1000,
    max_merge_depth: 5,
    cooldown_ms: 600000,
    max_compartments_per_pass: 15,
    grace_compartments: 10,
  },
  experimental: {
    temporal_awareness: false,
    git_commit_indexing: { enabled: false, since_days: 365, max_commits: 2000 },
    auto_search: { enabled: false, score_threshold: 0.6, min_prompt_chars: 20 },
    caveman_text_compression: { enabled: false, min_chars: 500 },
  },
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {})) as T
}

function merge(base: unknown, value: unknown): unknown {
  if (!record(base)) return clone(value)
  if (!record(value)) return clone(base)
  return Object.entries(value).reduce<Record<string, unknown>>((next, entry) => {
    const key = entry[0]
    const item = entry[1]
    next[key] = record(next[key]) && record(item) ? merge(next[key], item) : clone(item)
    return next
  }, clone(base))
}

function normalize(value?: unknown): ContextEngineConfig {
  const cfg = merge(defaults, value) as ContextEngineConfig
  delete (cfg as Record<string, unknown>).configWarnings
  return cfg
}

function read(root: unknown, path: readonly string[]) {
  return path.reduce<unknown>((node, key) => (record(node) ? node[key] : undefined), root)
}

function write(root: ContextEngineConfig, path: readonly string[], value: unknown): ContextEngineConfig {
  const next = clone(root) as Record<string, unknown>
  const key = path[0]
  if (!key) return next as ContextEngineConfig
  if (path.length === 1) {
    if (value === undefined) delete next[key]
    if (value !== undefined) next[key] = value
    return next as ContextEngineConfig
  }
  const child = record(next[key]) ? next[key] : {}
  next[key] = write(child as ContextEngineConfig, path.slice(1), value)
  return next as ContextEngineConfig
}

function bool(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function num(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return fallback
}

function parseNumber(value: string, fallback: number, options?: { integer?: boolean; min?: number; max?: number }) {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) return fallback
  const fixed = options?.integer ? Math.round(parsed) : parsed
  if (options?.min !== undefined && fixed < options.min) return options.min
  if (options?.max !== undefined && fixed > options.max) return options.max
  return fixed
}

function clean(value: ContextEngineConfig) {
  const cfg = clone(value) as Record<string, unknown>
  delete cfg.configWarnings
  return cfg
}

function label<T extends string>(items: Option<T>[], value: T | undefined) {
  return items.find((item) => item.value === value)
}

export const ContextEngineTab: Component = () => {
  const language = useLanguage()
  const provider = useProvider()
  const vscode = useVSCode()
  const calls = new Map<string, Call>()
  const seq = { value: 0 }

  const [draft, setDraft] = createSignal<ContextEngineConfig>(normalize())
  const [meta, setMeta] = createSignal<ContextEngineSettingsPayload | undefined>()
  const [profile, setProfile] = createSignal<Profile>("recommended")
  const [dirty, setDirty] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [open, setOpen] = createSignal<Record<Section, boolean>>({
    agents: true,
    memory: true,
    runtime: true,
    advanced: false,
  })

  const engine = createMemo(() => draft())
  const count = createMemo(
    () =>
      provider
        .models()
        .filter((model) => model.providerID === "kilo" || provider.connected().includes(model.providerID)).length,
  )

  const rpc = <T,>(method: string, params?: unknown) => {
    const requestId = `context-engine-${Date.now()}-${seq.value}`
    seq.value += 1
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        calls.delete(requestId)
        reject(new Error(language.t("settings.contextEngine.error.timeout")))
      }, 30000)
      calls.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timeout })
      vscode.postMessage({ type: "pluginSettingsRpc", pluginId: PLUGIN_ID, requestId, method, params })
    })
  }

  const value = (path: readonly string[], fallback?: unknown) => read(engine(), path) ?? fallback
  const checked = (path: readonly string[], fallback = false) => bool(value(path, fallback), fallback)
  const string = (path: readonly string[], fallback = "") => text(value(path, fallback), fallback)
  const number = (path: readonly string[], fallback: number) => num(value(path, fallback), fallback)

  const patch = (path: readonly string[], next: unknown) => {
    setDraft((prev) => write(prev, path, next))
    setDirty(true)
  }

  const patchText = (path: readonly string[], next: string) => {
    patch(path, next.trim() || undefined)
  }

  const patchNumber = (
    path: readonly string[],
    next: string,
    fallback: number,
    options?: { integer?: boolean; min?: number; max?: number },
  ) => {
    patch(path, parseNumber(next, fallback, options))
  }

  const patchAgentModel = (agent: "historian" | "dreamer" | "sidekick", model: string) => {
    patch([agent, "model"], model || undefined)
  }

  const patchThinking = (agent: "historian" | "dreamer" | "sidekick", item?: Option<ContextEngineThinkingLevel | "default">) => {
    patch([agent, "thinking_level"], item?.value === "default" ? undefined : item?.value)
  }

  const applyPayload = (payload: ContextEngineSettingsPayload) => {
    const cfg = normalize(payload.effective ?? payload.raw ?? {})
    setDraft(cfg)
    setMeta(payload)
    setDirty(false)
  }

  const refresh = async () => {
    setLoading(true)
    setSaving(false)
    vscode.postMessage({ type: "requestProviders" })
    try {
      const payload = await rpc<ContextEngineSettingsPayload>("config.read")
      applyPayload(payload)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.contextEngine.error.load"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const enabled = checked(["enabled"], true)
      const payload = await rpc<ContextEngineSettingsPayload>("config.save", {
        expectedMtimeMs: meta()?.target?.mtimeMs ?? null,
        config: clean(engine()),
      })
      applyPayload(payload)
      if (enabled) {
        vscode.postMessage({ type: "updateConfig", config: { compaction: { auto: false, prune: false } } })
      }
      showToast({ variant: "success", title: language.t("settings.contextEngine.toast.saved") })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.contextEngine.error.save"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const diagnose = async () => {
    try {
      const result = await rpc<ContextEngineDoctorResult>("doctor")
      const checks = result.checks?.map((item) => `${item.name}: ${item.status}`).join(" · ")
      showToast({
        title: language.t("settings.contextEngine.diagnose.title"),
        description: checks || language.t("settings.contextEngine.diagnose.description", {
          models: count(),
          status: result.enabled
            ? language.t("settings.contextEngine.status.enabled")
            : language.t("settings.contextEngine.status.disabled"),
        }),
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.contextEngine.error.diagnose"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const providers = () => vscode.postMessage({ type: "openSettingsPanel", tab: "providers" })

  const applyProfile = (next: Profile) => {
    setProfile(next)
    const cfg = engine()
    const common = {
      ...cfg,
      enabled: true,
      ctx_reduce_enabled: true,
      memory: { ...cfg.memory, enabled: true, auto_promote: true },
      embedding: { ...cfg.embedding, provider: "local" as const, model: LOCAL_EMBEDDING_MODEL },
      compaction_markers: true,
    }
    if (next === "light") {
      setDraft(
        normalize({
          ...common,
          dreamer: { ...common.dreamer, enabled: false },
          sidekick: { ...common.sidekick, enabled: false },
          compressor: { ...common.compressor, enabled: false },
          experimental: {
            ...common.experimental,
            auto_search: { ...common.experimental?.auto_search, enabled: false },
            git_commit_indexing: { ...common.experimental?.git_commit_indexing, enabled: false },
          },
        }),
      )
      setDirty(true)
      return
    }
    if (next === "advanced") {
      setDraft(
        normalize({
          ...common,
          historian: { ...common.historian, two_pass: true },
          dreamer: { ...common.dreamer, enabled: true },
          sidekick: { ...common.sidekick, enabled: true },
          compressor: { ...common.compressor, enabled: true },
          experimental: {
            ...common.experimental,
            auto_search: { ...common.experimental?.auto_search, enabled: true },
            git_commit_indexing: { ...common.experimental?.git_commit_indexing, enabled: true },
          },
        }),
      )
      setDirty(true)
      return
    }
    setDraft(
      normalize({
        ...common,
        historian: { ...common.historian, two_pass: true },
        dreamer: { ...common.dreamer, enabled: false },
        sidekick: { ...common.sidekick, enabled: true },
        compressor: { ...common.compressor, enabled: true },
      }),
    )
    setDirty(true)
  }

  const toggle = (id: Section) => {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const SectionCard: Component<{ id: Section; title: string; description: string; children: JSX.Element }> = (props) => (
    <section style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
        <div>
          <h4 style={{ margin: 0 }}>{props.title}</h4>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)" }}>{props.description}</p>
        </div>
        <Button variant="secondary" size="small" onClick={() => toggle(props.id)}>
          {open()[props.id]
            ? language.t("settings.contextEngine.section.collapse")
            : language.t("settings.contextEngine.section.expand")}
        </Button>
      </div>
      <Show when={open()[props.id]}>
        <Card>{props.children}</Card>
      </Show>
    </section>
  )

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "pluginSettingsRpcResult" || message.pluginId !== PLUGIN_ID) return
    const call = calls.get(message.requestId)
    if (!call) return
    clearTimeout(call.timeout)
    calls.delete(message.requestId)
    if (message.error) {
      call.reject(new Error(message.error))
      return
    }
    call.resolve(message.result)
  })

  onMount(refresh)
  onCleanup(() => {
    unsubscribe()
    calls.forEach((call) => clearTimeout(call.timeout))
    calls.clear()
  })

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
        <div>
          <h3 style={{ margin: 0 }}>{language.t("settings.contextEngine.title")}</h3>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)" }}>
            {language.t("settings.contextEngine.description")}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", "justify-content": "flex-end" }}>
          <Button variant="secondary" size="small" onClick={refresh} disabled={loading()}>
            {loading() ? language.t("settings.contextEngine.loading") : language.t("settings.contextEngine.refresh")}
          </Button>
          <Button variant="secondary" size="small" icon="console" onClick={diagnose}>
            {language.t("settings.contextEngine.diagnose")}
          </Button>
          <Button variant="primary" size="small" onClick={save} disabled={!dirty() || saving()}>
            {saving() ? language.t("settings.saveBar.saving") : language.t("settings.contextEngine.save")}
          </Button>
        </div>
      </div>

      <Card>
        <SettingsRow
          title={language.t("settings.contextEngine.enabled.title")}
          description={language.t("settings.contextEngine.enabled.description")}
        >
          <Switch checked={checked(["enabled"], true)} onChange={(next) => patch(["enabled"], next)} hideLabel>
            {language.t("settings.contextEngine.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.contextEngine.mode.title")}
          description={language.t("settings.contextEngine.mode.description")}
        >
          <Select
            options={profiles}
            current={label(profiles, profile())}
            value={(item) => item.value}
            label={(item) => language.t(`settings.contextEngine.mode.${item.value}`)}
            onSelect={(item) => item && applyProfile(item.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.contextEngine.models.title")}
          description={language.t("settings.contextEngine.models.description")}
          last
        >
          <Tag>{language.t("settings.contextEngine.models.count", { count: count() })}</Tag>
        </SettingsRow>
      </Card>

      <Show when={count() === 0}>
        <Card>
          <SettingsRow
            title={language.t("settings.contextEngine.noModels.title")}
            description={language.t("settings.contextEngine.noModels.description")}
            last
          >
            <Button variant="secondary" size="small" onClick={providers}>
              {language.t("settings.contextEngine.configureApi")}
            </Button>
          </SettingsRow>
        </Card>
      </Show>

      <SectionCard
        id="agents"
        title={language.t("settings.contextEngine.agents.title")}
        description={language.t("settings.contextEngine.agents.description")}
      >
        <>
          <SettingsRow
            title={language.t("settings.contextEngine.historian.title")}
            description={language.t("settings.contextEngine.historian.description")}
          >
            <Tag>{language.t("settings.contextEngine.historian.core")}</Tag>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.model.title")}
            description={language.t("settings.contextEngine.model.description")}
          >
            <ContextEngineModelSelect
              value={string(["historian", "model"])}
              models={count()}
              onChange={(model) => patchAgentModel("historian", model)}
              onOpenProviders={providers}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.historian.twoPass.title")}
            description={language.t("settings.contextEngine.historian.twoPass.description")}
          >
            <Switch
              checked={checked(["historian", "two_pass"], false)}
              onChange={(next) => patch(["historian", "two_pass"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.historian.twoPass.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.thinking.title")}
            description={language.t("settings.contextEngine.thinking.description")}
          >
            <Select
              options={thinking}
              current={label(thinking, (string(["historian", "thinking_level"]) || "default") as ContextEngineThinkingLevel | "default")}
              value={(item) => item.value}
              label={(item) => language.t(`settings.contextEngine.thinking.${item.value}`)}
              onSelect={(item) => patchThinking("historian", item)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.dreamer.title")}
            description={language.t("settings.contextEngine.dreamer.description")}
          >
            <Switch
              checked={checked(["dreamer", "enabled"], false)}
              onChange={(next) => patch(["dreamer", "enabled"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.dreamer.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.model.title")}
            description={language.t("settings.contextEngine.model.description")}
          >
            <ContextEngineModelSelect
              value={string(["dreamer", "model"])}
              models={count()}
              onChange={(model) => patchAgentModel("dreamer", model)}
              onOpenProviders={providers}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.dreamer.schedule.title")}
            description={language.t("settings.contextEngine.dreamer.schedule.description")}
          >
            <TextField
              value={string(["dreamer", "schedule"], "02:00-06:00")}
              placeholder="02:00-06:00"
              onChange={(next) => patchText(["dreamer", "schedule"], next)}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.sidekick.title")}
            description={language.t("settings.contextEngine.sidekick.description")}
          >
            <Switch
              checked={checked(["sidekick", "enabled"], false)}
              onChange={(next) => patch(["sidekick", "enabled"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.sidekick.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.model.title")}
            description={language.t("settings.contextEngine.model.description")}
            last
          >
            <ContextEngineModelSelect
              value={string(["sidekick", "model"])}
              models={count()}
              onChange={(model) => patchAgentModel("sidekick", model)}
              onOpenProviders={providers}
            />
          </SettingsRow>
        </>
      </SectionCard>

      <SectionCard
        id="memory"
        title={language.t("settings.contextEngine.memory.title")}
        description={language.t("settings.contextEngine.memory.description")}
      >
        <>
          <SettingsRow
            title={language.t("settings.contextEngine.memory.enabled.title")}
            description={language.t("settings.contextEngine.memory.enabled.description")}
          >
            <Switch
              checked={checked(["memory", "enabled"], true)}
              onChange={(next) => patch(["memory", "enabled"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.memory.enabled.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.memory.budget.title")}
            description={language.t("settings.contextEngine.memory.budget.description")}
          >
            <TextField
              type="number"
              value={String(number(["memory", "injection_budget_tokens"], 4000))}
              placeholder="4000"
              onChange={(next) => patchNumber(["memory", "injection_budget_tokens"], next, 4000, { integer: true, min: 500, max: 20000 })}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.memory.autoPromote.title")}
            description={language.t("settings.contextEngine.memory.autoPromote.description")}
          >
            <Switch
              checked={checked(["memory", "auto_promote"], true)}
              onChange={(next) => patch(["memory", "auto_promote"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.memory.autoPromote.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.memory.promotionThreshold.title")}
            description={language.t("settings.contextEngine.memory.promotionThreshold.description")}
          >
            <TextField
              type="number"
              value={String(number(["memory", "retrieval_count_promotion_threshold"], 3))}
              placeholder="3"
              onChange={(next) => patchNumber(["memory", "retrieval_count_promotion_threshold"], next, 3, { integer: true, min: 1 })}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.embedding.storage.title")}
            description={language.t("settings.contextEngine.embedding.storage.description")}
          >
            <Tag>{language.t("settings.contextEngine.embedding.storage.sqlite")}</Tag>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.embedding.provider.title")}
            description={language.t("settings.contextEngine.embedding.provider.description")}
          >
            <Select
              options={embeddings}
              current={label(embeddings, string(["embedding", "provider"], "local") as ContextEngineEmbeddingProvider)}
              value={(item) => item.value}
              label={(item) => language.t(`settings.contextEngine.embedding.provider.${item.value}`)}
              onSelect={(item) => patch(["embedding", "provider"], item?.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.embedding.model.title")}
            description={language.t("settings.contextEngine.embedding.model.description")}
            last={string(["embedding", "provider"], "local") !== "openai-compatible"}
          >
            <TextField
              value={string(["embedding", "model"], LOCAL_EMBEDDING_MODEL)}
              placeholder={LOCAL_EMBEDDING_MODEL}
              onChange={(next) => patchText(["embedding", "model"], next)}
            />
          </SettingsRow>
          <Show when={string(["embedding", "provider"], "local") === "openai-compatible"}>
            <SettingsRow
              title={language.t("settings.contextEngine.embedding.endpoint.title")}
              description={language.t("settings.contextEngine.embedding.endpoint.description")}
            >
              <TextField
                value={string(["embedding", "endpoint"])}
                placeholder="https://api.openai.com/v1/embeddings"
                onChange={(next) => patchText(["embedding", "endpoint"], next)}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.contextEngine.embedding.apiKey.title")}
              description={language.t("settings.contextEngine.embedding.apiKey.description")}
              last
            >
              <TextField
                type="password"
                value={string(["embedding", "api_key"])}
                placeholder="{env:OPENAI_API_KEY}"
                onChange={(next) => patchText(["embedding", "api_key"], next)}
              />
            </SettingsRow>
          </Show>
        </>
      </SectionCard>

      <SectionCard
        id="runtime"
        title={language.t("settings.contextEngine.runtime.title")}
        description={language.t("settings.contextEngine.runtime.description")}
      >
        <>
          <SettingsRow
            title={language.t("settings.contextEngine.ctxReduce.title")}
            description={language.t("settings.contextEngine.ctxReduce.description")}
          >
            <Switch
              checked={checked(["ctx_reduce_enabled"], true)}
              onChange={(next) => patch(["ctx_reduce_enabled"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.ctxReduce.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.executeThreshold.title")}
            description={language.t("settings.contextEngine.executeThreshold.description")}
          >
            <TextField
              type="number"
              value={String(number(["execute_threshold_percentage"], 65))}
              placeholder="65"
              onChange={(next) => patchNumber(["execute_threshold_percentage"], next, 65, { min: 20, max: 80 })}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.historyBudget.title")}
            description={language.t("settings.contextEngine.historyBudget.description")}
          >
            <TextField
              type="number"
              value={String(number(["history_budget_percentage"], 0.15))}
              placeholder="0.15"
              onChange={(next) => patchNumber(["history_budget_percentage"], next, 0.15, { min: 0.05, max: 0.5 })}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.protectedTags.title")}
            description={language.t("settings.contextEngine.protectedTags.description")}
          >
            <TextField
              type="number"
              value={String(number(["protected_tags"], 20))}
              placeholder="20"
              onChange={(next) => patchNumber(["protected_tags"], next, 20, { integer: true, min: 1, max: 100 })}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.compactionMarkers.title")}
            description={language.t("settings.contextEngine.compactionMarkers.description")}
          >
            <Switch
              checked={checked(["compaction_markers"], true)}
              onChange={(next) => patch(["compaction_markers"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.compactionMarkers.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.commitTrigger.title")}
            description={language.t("settings.contextEngine.commitTrigger.description")}
          >
            <Switch
              checked={checked(["commit_cluster_trigger", "enabled"], true)}
              onChange={(next) => patch(["commit_cluster_trigger", "enabled"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.commitTrigger.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.commitTrigger.min.title")}
            description={language.t("settings.contextEngine.commitTrigger.min.description")}
            last
          >
            <TextField
              type="number"
              value={String(number(["commit_cluster_trigger", "min_clusters"], 3))}
              placeholder="3"
              onChange={(next) => patchNumber(["commit_cluster_trigger", "min_clusters"], next, 3, { integer: true, min: 1 })}
            />
          </SettingsRow>
        </>
      </SectionCard>

      <SectionCard
        id="advanced"
        title={language.t("settings.contextEngine.advanced.title")}
        description={language.t("settings.contextEngine.advanced.description")}
      >
        <>
          <SettingsRow
            title={language.t("settings.contextEngine.historian.timeout.title")}
            description={language.t("settings.contextEngine.historian.timeout.description")}
          >
            <TextField
              type="number"
              value={String(number(["historian_timeout_ms"], 300000))}
              placeholder="300000"
              onChange={(next) => patchNumber(["historian_timeout_ms"], next, 300000, { integer: true, min: 60000 })}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.compressor.enabled.title")}
            description={language.t("settings.contextEngine.compressor.enabled.description")}
          >
            <Switch
              checked={checked(["compressor", "enabled"], true)}
              onChange={(next) => patch(["compressor", "enabled"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.compressor.enabled.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.compressor.depth.title")}
            description={language.t("settings.contextEngine.compressor.depth.description")}
          >
            <TextField
              type="number"
              value={String(number(["compressor", "max_merge_depth"], 5))}
              placeholder="5"
              onChange={(next) => patchNumber(["compressor", "max_merge_depth"], next, 5, { integer: true, min: 1, max: 5 })}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.experimental.autoSearch.title")}
            description={language.t("settings.contextEngine.experimental.autoSearch.description")}
          >
            <Switch
              checked={checked(["experimental", "auto_search", "enabled"], false)}
              onChange={(next) => patch(["experimental", "auto_search", "enabled"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.experimental.autoSearch.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.experimental.gitIndex.title")}
            description={language.t("settings.contextEngine.experimental.gitIndex.description")}
          >
            <Switch
              checked={checked(["experimental", "git_commit_indexing", "enabled"], false)}
              onChange={(next) => patch(["experimental", "git_commit_indexing", "enabled"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.experimental.gitIndex.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.contextEngine.experimental.temporal.title")}
            description={language.t("settings.contextEngine.experimental.temporal.description")}
            last
          >
            <Switch
              checked={checked(["experimental", "temporal_awareness"], false)}
              onChange={(next) => patch(["experimental", "temporal_awareness"], next)}
              hideLabel
            >
              {language.t("settings.contextEngine.experimental.temporal.title")}
            </Switch>
          </SettingsRow>
        </>
      </SectionCard>
    </div>
  )
}
