import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import type { ContextEngineAgentConfig, ContextEngineConfig, ContextEngineMode } from "../../types/messages"
import SettingsRow from "./SettingsRow"
import { ContextEngineModelSelect } from "./ContextEngineModelSelect"

type AgentKey = "historian" | "dreamer" | "sidekick"
type Agent = { key: AgentKey; title: string; description: string }

const modes: { value: ContextEngineMode; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "light", label: "Light" },
  { value: "advanced", label: "Advanced" },
]

const defaults: Required<Pick<ContextEngineConfig, "enabled" | "mode">> & {
  historian: ContextEngineAgentConfig & { twoPass: boolean }
  dreamer: ContextEngineAgentConfig
  sidekick: ContextEngineAgentConfig
  memory: NonNullable<ContextEngineConfig["memory"]>
} = {
  enabled: false,
  mode: "recommended",
  historian: { enabled: true, model: "", fallbackModels: [], variant: "", thinkingLevel: "medium", twoPass: true },
  dreamer: { enabled: false, model: "", fallbackModels: [], variant: "", thinkingLevel: "medium" },
  sidekick: { enabled: false, model: "", fallbackModels: [], variant: "", thinkingLevel: "medium" },
  memory: {
    enabled: false,
    injectionBudgetTokens: 4000,
    autoPromote: true,
    retrievalCountPromotionThreshold: 3,
    embedding: { provider: "local", model: "Xenova/all-MiniLM-L6-v2", endpoint: "", apiKey: "" },
  },
}

function mergeConfig(config: ContextEngineConfig | undefined): ContextEngineConfig {
  return {
    ...defaults,
    ...(config ?? {}),
    historian: { ...defaults.historian, ...(config?.historian ?? {}) },
    dreamer: { ...defaults.dreamer, ...(config?.dreamer ?? {}) },
    sidekick: { ...defaults.sidekick, ...(config?.sidekick ?? {}) },
    memory: {
      ...defaults.memory,
      ...(config?.memory ?? {}),
      embedding: { ...defaults.memory.embedding, ...(config?.memory?.embedding ?? {}) },
    },
  }
}

export const ContextEngineTab: Component = () => {
  const config = useConfig()
  const language = useLanguage()
  const provider = useProvider()
  const vscode = useVSCode()

  const [draft, setDraft] = createSignal(mergeConfig(config.config().contextEngine))
  const [dirty, setDirty] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const engine = createMemo(() => draft())
  const count = createMemo(
    () =>
      provider
        .models()
        .filter((model) => model.providerID === "kilo" || provider.connected().includes(model.providerID)).length,
  )

  const agents = createMemo<Agent[]>(() => [
    {
      key: "historian",
      title: language.t("settings.contextEngine.historian.title"),
      description: language.t("settings.contextEngine.historian.description"),
    },
    {
      key: "dreamer",
      title: language.t("settings.contextEngine.dreamer.title"),
      description: language.t("settings.contextEngine.dreamer.description"),
    },
    {
      key: "sidekick",
      title: language.t("settings.contextEngine.sidekick.title"),
      description: language.t("settings.contextEngine.sidekick.description"),
    },
  ])

  const patch = (partial: ContextEngineConfig) => {
    setDraft(mergeConfig({ ...engine(), ...partial }))
    setDirty(true)
  }

  const patchAgent = (key: AgentKey, partial: ContextEngineAgentConfig) => {
    patch({ [key]: { ...engine()[key], ...partial } })
  }

  const refresh = () => {
    setDirty(false)
    setSaving(false)
    vscode.postMessage({ type: "loadContextEngineSettings" })
    vscode.postMessage({ type: "requestProviders" })
  }

  const diagnose = () => {
    showToast({
      variant: "default",
      title: language.t("settings.contextEngine.diagnose.title"),
      description: language.t("settings.contextEngine.diagnose.description", {
        models: count(),
        status: engine().enabled
          ? language.t("settings.contextEngine.status.enabled")
          : language.t("settings.contextEngine.status.disabled"),
      }),
    })
  }

  const providers = () => vscode.postMessage({ type: "openSettingsPanel", tab: "providers" })
  const save = () => {
    setSaving(true)
    vscode.postMessage({ type: "saveContextEngineSettings", config: engine() })
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "contextEngineSettingsLoaded" && !dirty()) {
      setDraft(mergeConfig(message.config as ContextEngineConfig))
      return
    }
    if (message.type === "contextEngineSettingsSaved") {
      setDraft(mergeConfig(message.config as ContextEngineConfig))
      setDirty(false)
      setSaving(false)
      return
    }
    if (message.type === "error" && saving()) {
      setSaving(false)
    }
  })

  onMount(refresh)
  onCleanup(unsubscribe)

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
          <Button variant="secondary" size="small" onClick={refresh}>
            {language.t("settings.contextEngine.refresh")}
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
          <Switch checked={engine().enabled === true} onChange={(enabled) => patch({ enabled })} hideLabel>
            {language.t("settings.contextEngine.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.contextEngine.mode.title")}
          description={language.t("settings.contextEngine.mode.description")}
          last
        >
          <Select
            options={modes}
            current={modes.find((item) => item.value === engine().mode)}
            value={(item) => item.value}
            label={(item) => language.t(`settings.contextEngine.mode.${item.value}`)}
            onSelect={(item) => patch({ mode: item?.value })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
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

      <section style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <h4 style={{ margin: 0 }}>{language.t("settings.contextEngine.api.title")}</h4>
        <Card>
          <For each={agents()}>
            {(agent, index) => (
              <>
                <SettingsRow title={agent.title} description={agent.description}>
                  <Switch
                    checked={engine()[agent.key]?.enabled === true}
                    onChange={(enabled) => patchAgent(agent.key, { enabled })}
                    hideLabel
                  >
                    {agent.title}
                  </Switch>
                </SettingsRow>
                <SettingsRow
                  title={language.t("settings.contextEngine.model.title")}
                  description={language.t("settings.contextEngine.model.description")}
                  last={index() === agents().length - 1}
                >
                  <ContextEngineModelSelect
                    value={engine()[agent.key]?.model ?? ""}
                    models={count()}
                    onChange={(model) => patchAgent(agent.key, { model })}
                    onOpenProviders={providers}
                  />
                </SettingsRow>
              </>
            )}
          </For>
        </Card>
      </section>

      <section style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <h4 style={{ margin: 0 }}>{language.t("settings.contextEngine.memory.title")}</h4>
        <Card>
          <SettingsRow
            title={language.t("settings.contextEngine.memory.enabled.title")}
            description={language.t("settings.contextEngine.memory.enabled.description")}
            last
          >
            <Switch
              checked={engine().memory?.enabled === true}
              onChange={(enabled) => patch({ memory: { ...engine().memory, enabled } })}
              hideLabel
            >
              {language.t("settings.contextEngine.memory.enabled.title")}
            </Switch>
          </SettingsRow>
        </Card>
      </section>
    </div>
  )
}
