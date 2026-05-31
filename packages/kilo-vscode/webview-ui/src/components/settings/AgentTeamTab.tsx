import { Component, For, JSX, Show, createMemo, createSignal, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { parseModelString } from "../../../../src/shared/provider-model"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useSession } from "../../context/session"
import type { AgentTeamConfig, AgentTeamRole, AgentTeamRoleConfig } from "../../types/messages"
import { KILO_GATEWAY_ID, isSmall, providerSortKey, sanitizeName } from "../shared/model-selector-utils"
import SettingsRow from "./SettingsRow"

type Role = Exclude<AgentTeamRole, "councillor" | "team">
type RoleConfig = AgentTeamRoleConfig

interface Choice {
  value: string
  label: string
}

interface ModelOption {
  id: string
  name: string
}

interface ModelGroup {
  providerID: string
  providerName: string
  models: ModelOption[]
}

interface PolicyOption {
  value: string
  label: string
  description: string
}

interface RoleGroup {
  key: string
  roles: Role[]
}

const roleGroups: RoleGroup[] = [
  { key: "entry", roles: ["secretary", "orchestrator"] },
  { key: "strategy", roles: ["architect", "planner"] },
  { key: "discovery", roles: ["explorer", "librarian", "observer"] },
  { key: "execution", roles: ["designer", "fixer"] },
  { key: "review", roles: ["oracle", "council"] },
]
const efforts = ["low", "medium", "high", "xhigh", "max"]
const maxFallbacks = 3
const roleCapabilities: Record<Role, { skills: string[]; mcps: string[] }> = {
  secretary: { skills: ["kilo-config"], mcps: [] },
  orchestrator: { skills: ["*"], mcps: ["*", "!context7"] },
  architect: { skills: ["kilo-config", "review-work"], mcps: ["websearch", "context7"] },
  planner: { skills: ["kilo-config", "review-work"], mcps: [] },
  explorer: { skills: ["kilo-config"], mcps: [] },
  librarian: { skills: ["kilo-config"], mcps: ["websearch", "context7", "grep_app"] },
  oracle: { skills: ["review-work", "kilo-config"], mcps: [] },
  designer: { skills: ["frontend-ui-ux", "browser-verification"], mcps: ["kilo-playwright"] },
  fixer: { skills: ["kilo-config", "git-master"], mcps: [] },
  observer: { skills: [], mcps: [] },
  council: { skills: ["review-work"], mcps: [] },
}

function token(value: string) {
  if (value.startsWith("!")) return value.slice(1)
  return value
}

function names(lists: string[][]) {
  return Array.from(
    new Set(
      lists
        .flat()
        .map(token)
        .filter((item) => item && item !== "*"),
    ),
  ).sort((a, b) => a.localeCompare(b))
}

function groupsFor(groups: ModelGroup[], current: ReturnType<typeof parseModelString>) {
  if (!current || groups.some((group) => group.providerID === current.providerID)) return groups
  return [
    ...groups,
    {
      providerID: current.providerID,
      providerName: current.providerID,
      models: [{ id: current.modelID, name: current.modelID }],
    },
  ]
}

function first(groups: ModelGroup[]) {
  const group = groups[0]
  const model = group?.models[0]
  if (!group || !model) return undefined
  return `${group.providerID}/${model.id}`
}

interface FallbackRowProps {
  value: string
  modelGroups: () => ModelGroup[]
  onChange: (value: string) => void
  onRemove: () => void
}

const FallbackRow: Component<FallbackRowProps> = (props) => {
  const language = useLanguage()
  const selection = createMemo(() => parseModelString(props.value))
  const providerID = createMemo(() => selection()?.providerID ?? "")
  const modelID = createMemo(() => selection()?.modelID ?? "")
  const groups = createMemo(() => groupsFor(props.modelGroups(), selection()))
  const models = createMemo(() => groups().find((group) => group.providerID === providerID())?.models ?? [])

  function updateProvider(next: string) {
    if (!next) {
      props.onRemove()
      return
    }
    const model = groups().find((group) => group.providerID === next)?.models[0]
    if (model) props.onChange(`${next}/${model.id}`)
  }

  function updateModel(next: string) {
    if (!providerID() || !next) return
    props.onChange(`${providerID()}/${next}`)
  }

  return (
    <div class="agent-team-fallback-row">
      <select
        class="agent-team-native-control"
        value={providerID()}
        onChange={(event) => updateProvider(event.currentTarget.value)}
      >
        <For each={groups()}>
          {(group) => (
            <option value={group.providerID} selected={group.providerID === providerID()}>
              {group.providerName}
            </option>
          )}
        </For>
      </select>
      <select
        class="agent-team-native-control"
        value={modelID()}
        disabled={!providerID() || models().length === 0}
        onChange={(event) => updateModel(event.currentTarget.value)}
      >
        <For each={models()}>
          {(model) => (
            <option value={model.id} selected={model.id === modelID()}>
              {model.name}
            </option>
          )}
        </For>
      </select>
      <Button variant="ghost" size="small" onClick={props.onRemove}>
        {language.t("settings.agentTeam.fallback.remove")}
      </Button>
    </div>
  )
}

type TokenState = "allow" | "deny" | "inherit" | "off"

interface PolicyPickerProps {
  title: string
  description: string
  allLabel: string
  empty: string
  values: () => string[]
  options: () => PolicyOption[]
  defaulted: () => boolean
  defaults: string[]
  onChange: (values: string[]) => void
}

function state(values: string[], value: string): TokenState {
  if (values.includes(`!${value}`)) return "deny"
  if (values.includes(value)) return "allow"
  if (values.includes("*")) return "inherit"
  return "off"
}

function set(values: string[], value: string, next: Exclude<TokenState, "inherit">) {
  const rest = values.filter((item) => item !== value && item !== `!${value}`)
  if (next === "allow") return [...rest, value]
  if (next === "deny") return [...rest, `!${value}`]
  return rest
}

const PolicyPicker: Component<PolicyPickerProps> = (props) => {
  const language = useLanguage()
  const active = createMemo(() => props.values())

  function toggleAll(checked: boolean) {
    const rest = active().filter((item) => item !== "*" && (checked || !item.startsWith("!")))
    props.onChange(checked ? ["*", ...rest] : rest)
  }

  function cycle(value: string) {
    const current = state(active(), value)
    if (current === "off") {
      props.onChange(set(active(), value, "allow"))
      return
    }
    if (current === "deny") {
      props.onChange(set(active(), value, "off"))
      return
    }
    props.onChange(set(active(), value, "deny"))
  }

  return (
    <div class="agent-team-role-policy-section">
      <div class="agent-team-policy-header">
        <div>
          <div class="agent-team-role-policy-title">{props.title}</div>
          <div class="agent-team-role-policy-description">{props.description}</div>
        </div>
        <Button variant="ghost" size="small" onClick={() => props.onChange([...props.defaults])}>
          {props.defaulted()
            ? language.t("settings.agentTeam.policy.recommendedActive")
            : language.t("settings.agentTeam.policy.restore")}
        </Button>
      </div>
      <label class="agent-team-native-check agent-team-policy-all">
        <input
          type="checkbox"
          checked={active().includes("*")}
          onChange={(event) => toggleAll(event.currentTarget.checked)}
        />
        <span>{props.allLabel}</span>
      </label>
      <Show when={props.options().length > 0} fallback={<div class="agent-team-policy-empty">{props.empty}</div>}>
        <div class="agent-team-policy-token-list">
          <For each={props.options()}>
            {(option) => {
              const current = createMemo(() => state(active(), option.value))
              return (
                <button
                  type="button"
                  class={`agent-team-policy-token agent-team-policy-token-${current()}`}
                  onClick={() => cycle(option.value)}
                >
                  <span class="agent-team-policy-token-label">{option.label}</span>
                  <span class="agent-team-policy-token-state">
                    {language.t(`settings.agentTeam.policy.state.${current()}`)}
                  </span>
                  <Show when={option.description}>
                    <span class="agent-team-policy-token-description">{option.description}</span>
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-role row — isolated component so each role's memos are independent.
// This prevents a model change in one role from invalidating other roles'
// variant lists (which would reset Kobalte's selectedOption and blank the trigger).
// ---------------------------------------------------------------------------
interface RoleRowProps {
  id: Role
  title: string
  description: string
  open: boolean
  onToggleOpen: () => void
  cfg: () => RoleConfig
  enabled: () => boolean
  modelGroups: () => ModelGroup[]
  skillOptions: () => PolicyOption[]
  mcpOptions: () => PolicyOption[]
  defaultSkills: string[]
  defaultMcps: string[]
  onToggleEnabled: (v: boolean) => void
  onPatchRole: (next: Partial<RoleConfig>) => void
  fixedEnabled?: boolean
}

const RoleRow: Component<RoleRowProps> = (props) => {
  const language = useLanguage()
  const { findModel } = useProvider()

  const modelSelection = createMemo(() => parseModelString(props.cfg().model ?? undefined))
  const providerID = createMemo(() => modelSelection()?.providerID ?? "")
  const modelID = createMemo(() => modelSelection()?.modelID ?? "")

  const modelGroups = createMemo<ModelGroup[]>(() => groupsFor(props.modelGroups(), modelSelection()))

  const selectedProviderModels = createMemo(
    () => modelGroups().find((group) => group.providerID === providerID())?.models ?? [],
  )

  function updateProvider(nextProviderID: string) {
    if (!nextProviderID) {
      props.onPatchRole({ model: null })
      return
    }
    const firstModel = modelGroups().find((group) => group.providerID === nextProviderID)?.models[0]
    props.onPatchRole({ model: firstModel ? `${nextProviderID}/${firstModel.id}` : null })
  }

  function updateModel(nextModelID: string) {
    if (!providerID() || !nextModelID) {
      props.onPatchRole({ model: null })
      return
    }
    props.onPatchRole({ model: `${providerID()}/${nextModelID}` })
  }

  const fallbackModels = createMemo(() => props.cfg().fallbackModels ?? [])
  const roleSkills = createMemo(() => props.cfg().skills ?? props.defaultSkills)
  const roleMcps = createMemo(() => props.cfg().mcps ?? props.defaultMcps)

  function updateFallback(index: number, value: string | undefined) {
    const next = [...fallbackModels()]
    if (value) next[index] = value
    if (!value) next.splice(index, 1)
    props.onPatchRole({ fallbackModels: next })
  }

  function addFallback() {
    const value = first(modelGroups())
    if (!value) return
    props.onPatchRole({ fallbackModels: [...fallbackModels(), value] })
  }

  const variantList = createMemo<Choice[]>(() => {
    const found = findModel(modelSelection())
    return [
      { value: "", label: language.t("settings.agentTeam.variant.default") },
      ...efforts.map((e) => ({ value: e, label: language.t(`settings.agentTeam.variant.${e}`) })),
      ...Object.keys(found?.variants ?? {})
        .filter((k) => !efforts.includes(k))
        .map((k) => ({ value: k, label: k })),
    ]
  })

  const currentVariant = createMemo(
    () => variantList().find((item) => item.value === (props.cfg().variant ?? "")) ?? variantList()[0],
  )

  return (
    <div
      class="agent-team-role-row"
      style={{
        background: props.enabled()
          ? "var(--vscode-editor-background)"
          : "var(--surface-muted, rgba(127,127,127,0.06))",
      }}
    >
      <div class="agent-team-role-summary">
        <div style={{ "font-weight": 600 }}>{props.title}</div>
        <div style={{ color: "var(--text-muted)", "font-size": "var(--font-size-small)", "margin-top": "3px" }}>
          {props.description}
        </div>
        <Button variant="ghost" size="small" onClick={props.onToggleOpen} style={{ padding: "0", "margin-top": "6px" }}>
          {props.open
            ? language.t("settings.agentTeam.role.advanced.hide")
            : language.t("settings.agentTeam.role.advanced.show")}
        </Button>
      </div>
      <div class="agent-team-role-controls">
        <div class="agent-team-role-control agent-team-role-control-provider">
          <span class="agent-team-role-control-label">{language.t("settings.providers.title")}</span>
          <select
            class="agent-team-native-control"
            value={providerID()}
            onChange={(event) => updateProvider(event.currentTarget.value)}
          >
            <option value="" selected={providerID() === ""}>
              {language.t("settings.agentTeam.model.default")}
            </option>
            <For each={modelGroups()}>
              {(group) => (
                <option value={group.providerID} selected={group.providerID === providerID()}>
                  {group.providerName}
                </option>
              )}
            </For>
          </select>
        </div>
        <div class="agent-team-role-control agent-team-role-control-model">
          <span class="agent-team-role-control-label">{language.t("settings.agentTeam.column.model")}</span>
          <select
            class="agent-team-native-control"
            value={modelID()}
            disabled={!providerID() || selectedProviderModels().length === 0}
            onChange={(event) => updateModel(event.currentTarget.value)}
          >
            <Show
              when={providerID()}
              fallback={
                <option value="" selected={modelID() === ""}>
                  {language.t("settings.agentTeam.model.default")}
                </option>
              }
            >
              <Show
                when={selectedProviderModels().length > 0}
                fallback={
                  <option value="" selected={modelID() === ""}>
                    {language.t("dialog.model.empty")}
                  </option>
                }
              >
                <For each={selectedProviderModels()}>
                  {(model) => (
                    <option value={model.id} selected={model.id === modelID()}>
                      {model.name}
                    </option>
                  )}
                </For>
              </Show>
            </Show>
          </select>
        </div>
        <div class="agent-team-role-control agent-team-role-control-variant">
          <span class="agent-team-role-control-label">{language.t("settings.agentTeam.column.variant")}</span>
          <select
            class="agent-team-native-control"
            value={currentVariant()?.value ?? ""}
            onChange={(event) => props.onPatchRole({ variant: event.currentTarget.value || null })}
          >
            <For each={variantList()}>
              {(choice) => (
                <option value={choice.value} selected={choice.value === (props.cfg().variant ?? "")}>
                  {choice.label}
                </option>
              )}
            </For>
          </select>
        </div>
        <div class="agent-team-role-control agent-team-role-control-temperature">
          <span class="agent-team-role-control-label">{language.t("settings.agentTeam.column.temperature")}</span>
          <input
            class="agent-team-native-control"
            type="number"
            value={
              props.cfg().temperature === undefined || props.cfg().temperature === null
                ? ""
                : String(props.cfg().temperature)
            }
            placeholder={language.t("settings.agentTeam.temperature.default")}
            onChange={(event) => {
              const value = event.currentTarget.value
              const n = Number.parseFloat(value)
              props.onPatchRole({
                temperature: value.trim() && Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : null,
              })
            }}
          />
        </div>
        <div class="agent-team-role-control agent-team-role-control-enabled">
          <span class="agent-team-role-control-label">{language.t("settings.agentTeam.column.enabled")}</span>
          <Show
            when={!props.fixedEnabled}
            fallback={
              <div class="agent-team-native-check">
                <span>{language.t("settings.agentTeam.role.alwaysAvailable")}</span>
              </div>
            }
          >
            <label class="agent-team-native-check">
              <input
                type="checkbox"
                checked={props.enabled()}
                onChange={(event) => props.onToggleEnabled(event.currentTarget.checked)}
              />
              <span>{props.title}</span>
            </label>
          </Show>
        </div>
      </div>
      <Show when={props.open}>
        <div class="agent-team-role-policy">
          <div class="agent-team-role-policy-section">
            <div class="agent-team-role-policy-title">{language.t("settings.agentTeam.fallback.title")}</div>
            <div class="agent-team-role-policy-description">
              {language.t("settings.agentTeam.fallback.description")}
            </div>
            <div class="agent-team-fallback-list">
              <For each={fallbackModels()}>
                {(value, index) => (
                  <FallbackRow
                    value={value}
                    modelGroups={modelGroups}
                    onChange={(next) => updateFallback(index(), next)}
                    onRemove={() => updateFallback(index(), undefined)}
                  />
                )}
              </For>
              <Show when={fallbackModels().length < maxFallbacks && modelGroups().length > 0}>
                <Button variant="secondary" size="small" onClick={addFallback}>
                  {language.t("settings.agentTeam.fallback.add")}
                </Button>
              </Show>
            </div>
          </div>
          <div class="agent-team-role-policy-section">
            <div class="agent-team-role-policy-title">{language.t("settings.agentTeam.displayName.title")}</div>
            <input
              class="agent-team-native-control"
              value={props.cfg().displayName ?? ""}
              placeholder={language.t("settings.agentTeam.displayName.placeholder")}
              onChange={(event) => props.onPatchRole({ displayName: event.currentTarget.value.trim() || null })}
            />
          </div>
          <PolicyPicker
            title={language.t("settings.agentTeam.skills.title")}
            description={language.t("settings.agentTeam.skills.description")}
            allLabel={language.t("settings.agentTeam.skills.all")}
            empty={language.t("settings.agentTeam.skills.empty")}
            values={roleSkills}
            options={props.skillOptions}
            defaulted={() => props.cfg().skills === undefined}
            defaults={props.defaultSkills}
            onChange={(skills) => props.onPatchRole({ skills })}
          />
          <PolicyPicker
            title={language.t("settings.agentTeam.mcps.title")}
            description={language.t("settings.agentTeam.mcps.description")}
            allLabel={language.t("settings.agentTeam.mcps.all")}
            empty={language.t("settings.agentTeam.mcps.empty")}
            values={roleMcps}
            options={props.mcpOptions}
            defaulted={() => props.cfg().mcps === undefined}
            defaults={props.defaultMcps}
            onChange={(mcps) => props.onPatchRole({ mcps })}
          />
        </div>
      </Show>
    </div>
  )
}

function int(value: string, fallback: number) {
  const next = Number.parseInt(value, 10)
  if (!Number.isFinite(next) || next < 0) return fallback
  return next
}

function positive(value: string, fallback: number) {
  const next = Number.parseInt(value, 10)
  if (!Number.isFinite(next) || next < 1) return fallback
  return next
}

const AgentTeamTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const { connected, models } = useProvider()
  const session = useSession()
  const [open, setOpen] = createSignal<Record<string, boolean>>({})

  onMount(() => {
    session.refreshSkills()
    session.refreshMcpStatus()
  })

  const team = () => config().agentTeam ?? {}
  const cfg = (id: AgentTeamRole): RoleConfig => {
    if (id === "orchestrator") return team().roles?.orchestrator ?? team().roles?.team ?? {}
    return team().roles?.[id] ?? {}
  }

  function patch(next: Partial<AgentTeamConfig>) {
    updateConfig({ agentTeam: next })
  }

  function patchRole(id: AgentTeamRole, next: Partial<RoleConfig>) {
    patch({ roles: { [id]: next } })
  }

  function patchReuse(next: NonNullable<AgentTeamConfig["sessionReuse"]>) {
    patch({ sessionReuse: next })
  }

  function patchSubtask(next: NonNullable<AgentTeamConfig["subtask"]>) {
    patch({ subtask: next })
  }

  function patchCouncil(next: NonNullable<AgentTeamConfig["council"]>) {
    patch({ council: next })
  }

  function patchAuto(next: NonNullable<AgentTeamConfig["autoContinue"]>) {
    patch({ autoContinue: next })
  }

  function roleEnabled(id: Role) {
    if (id === "secretary") return true
    if (id === "council") return team().council?.enabled === true && cfg(id).enabled !== false
    return cfg(id).enabled ?? true
  }

  function capability(id: Role) {
    return roleCapabilities[id]
  }

  function mcpStatus(name: string) {
    const cfg = config().mcp?.[name]
    if (cfg?.enabled === false) return language.t("settings.agentTeam.mcps.status.disabled")
    const status = session.mcpStatus()[name]?.status
    if (!status) return language.t("settings.agentTeam.mcps.status.configured")
    return language.t(`settings.agentTeam.mcps.status.${status}`)
  }

  function toggle(id: Role, value: boolean) {
    if (id === "secretary") return
    if (id !== "council") {
      patchRole(id, { enabled: value })
      return
    }
    patch({ council: { enabled: value }, roles: { [id]: { enabled: value } } })
  }

  function section(key: string) {
    return (props: { title: string; description: string; children: JSX.Element }) => (
      <Card style={{ padding: "0", overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "12px",
            padding: "12px 14px",
            "border-bottom": "1px solid var(--border-weak-base)",
            background: "var(--surface-base, var(--vscode-editorWidget-background))",
          }}
        >
          <div>
            <h4 style={{ margin: 0 }}>{props.title}</h4>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)" }}>{props.description}</p>
          </div>
          <Show when={key !== "overview"}>
            <Button
              variant="ghost"
              size="small"
              onClick={() => setOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }))}
            >
              {open()[key] === false
                ? language.t("settings.agentTeam.section.expand")
                : language.t("settings.agentTeam.section.collapse")}
            </Button>
          </Show>
        </div>
        <Show when={key === "overview" || open()[key] !== false}>
          <div style={{ padding: "12px 14px" }}>{props.children}</div>
        </Show>
      </Card>
    )
  }

  const Overview = section("overview")
  const Routing = section("routing")
  const Collaboration = section("collaboration")
  const Advanced = section("advanced")

  const rows = createMemo(() =>
    roleGroups.map((group) => ({
      key: group.key,
      title: language.t(`settings.agentTeam.group.${group.key}.title`),
      description: language.t(`settings.agentTeam.group.${group.key}.description`),
      roles: group.roles.map((id) => ({
        id,
        title: language.t(`settings.agentTeam.role.${id}.title`),
        description: language.t(`settings.agentTeam.role.${id}.description`),
      })),
    })),
  )

  const skillOptions = createMemo<PolicyOption[]>(() => {
    const map = new Map<string, PolicyOption>()
    for (const skill of session.skills()) {
      map.set(skill.name, {
        value: skill.name,
        label: skill.name,
        description:
          skill.location === "builtin"
            ? `${language.t("settings.agentTeam.skills.builtin")} · ${skill.description}`
            : skill.description,
      })
    }
    for (const name of names(Object.values(roleCapabilities).map((item) => item.skills))) {
      if (map.has(name)) continue
      map.set(name, {
        value: name,
        label: name,
        description: language.t("settings.agentTeam.skills.missing"),
      })
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  })

  const mcpOptions = createMemo<PolicyOption[]>(() => {
    const map = new Map<string, PolicyOption>()
    for (const name of Object.keys(config().mcp ?? {})) {
      map.set(name, {
        value: name,
        label: name,
        description: mcpStatus(name),
      })
    }
    for (const name of names(Object.values(roleCapabilities).map((item) => item.mcps))) {
      if (map.has(name)) continue
      map.set(name, {
        value: name,
        label: name,
        description: language.t("settings.agentTeam.mcps.missing"),
      })
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  })

  const connectedSet = createMemo(() => new Set(connected()))
  const modelGroups = createMemo<ModelGroup[]>(() => {
    const grouped = new Map<string, ModelGroup>()
    for (const model of models()) {
      if (model.providerID !== KILO_GATEWAY_ID && !connectedSet().has(model.providerID)) continue
      if (isSmall(model)) continue
      const group = grouped.get(model.providerID) ?? {
        providerID: model.providerID,
        providerName: model.providerName,
        models: [],
      }
      group.models.push({ id: model.id, name: sanitizeName(model.name) })
      grouped.set(model.providerID, group)
    }

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        models: [...group.models].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort(
        (a, b) =>
          providerSortKey(a.providerID) - providerSortKey(b.providerID) || a.providerName.localeCompare(b.providerName),
      )
  })

  const tuned = () => team().autoContinue?.enabled === true || team().autoContinue?.autoEnable === true

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <Overview
        title={language.t("settings.agentTeam.enabled.title")}
        description={language.t("settings.agentTeam.enabled.description")}
      >
        <SettingsRow
          title={language.t("settings.agentTeam.enabled.title")}
          description={language.t("settings.agentTeam.enabled.description")}
        >
          <Switch checked={team().enabled === true} onChange={(enabled) => patch({ enabled })} hideLabel>
            {language.t("settings.agentTeam.enabled.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.agentTeam.takeover.title")}
          description={language.t("settings.agentTeam.takeover.description")}
          last
        >
          <Switch
            checked={team().takeoverDefault !== false}
            onChange={(takeoverDefault) => patch({ takeoverDefault })}
            hideLabel
          >
            {language.t("settings.agentTeam.takeover.title")}
          </Switch>
        </SettingsRow>
      </Overview>

      <Routing
        title={language.t("settings.agentTeam.roles.title")}
        description={language.t("settings.agentTeam.roles.description")}
      >
        <div class="agent-team-role-list">
          <For each={rows()}>
            {(group) => (
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                <div
                  style={{
                    padding: "2px 2px 0",
                    color: "var(--text-muted)",
                    "font-size": "var(--font-size-small)",
                  }}
                >
                  <div style={{ color: "var(--text-base)", "font-weight": 600 }}>{group.title}</div>
                  <div style={{ "margin-top": "2px" }}>{group.description}</div>
                </div>
                <For each={group.roles}>
                  {(item) => (
                    <RoleRow
                      id={item.id}
                      title={item.title}
                      description={item.description}
                      open={!!open()[`role:${item.id}`]}
                      onToggleOpen={() =>
                        setOpen((prev) => ({ ...prev, [`role:${item.id}`]: !prev[`role:${item.id}`] }))
                      }
                      cfg={() => cfg(item.id)}
                      enabled={() => roleEnabled(item.id)}
                      modelGroups={modelGroups}
                      skillOptions={skillOptions}
                      mcpOptions={mcpOptions}
                      defaultSkills={capability(item.id).skills}
                      defaultMcps={capability(item.id).mcps}
                      onToggleEnabled={(v) => toggle(item.id, v)}
                      onPatchRole={(next) => patchRole(item.id, next)}
                      fixedEnabled={item.id === "secretary"}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Routing>

      <Collaboration
        title={language.t("settings.agentTeam.collaboration.title")}
        description={language.t("settings.agentTeam.collaboration.description")}
      >
        <SettingsRow
          title={language.t("settings.agentTeam.sessionReuse.title")}
          description={language.t("settings.agentTeam.sessionReuse.description")}
        >
          <Switch
            checked={team().sessionReuse?.enabled !== false}
            onChange={(enabled) => patchReuse({ enabled })}
            hideLabel
          >
            {language.t("settings.agentTeam.sessionReuse.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.agentTeam.sessionReuse.max.title")}
          description={language.t("settings.agentTeam.sessionReuse.max.description")}
          last
        >
          <TextField
            type="number"
            value={String(team().sessionReuse?.maxSessionsPerAgent ?? 2)}
            onChange={(value) => patchReuse({ maxSessionsPerAgent: int(value, 2) })}
          />
        </SettingsRow>
      </Collaboration>

      <Advanced
        title={language.t("settings.agentTeam.advanced.title")}
        description={language.t("settings.agentTeam.advanced.description")}
      >
        <SettingsRow
          title={language.t("settings.agentTeam.subtask.timeout.title")}
          description={language.t("settings.agentTeam.subtask.timeout.description")}
        >
          <TextField
            type="number"
            value={String(team().subtask?.timeoutMs ?? 300000)}
            onChange={(value) => patchSubtask({ timeoutMs: int(value, 300000) })}
          />
        </SettingsRow>
        <Show when={team().council?.enabled === true}>
          <SettingsRow
            title={language.t("settings.agentTeam.council.timeout.title")}
            description={language.t("settings.agentTeam.council.timeout.description")}
          >
            <TextField
              type="number"
              value={String(team().council?.timeoutMs ?? 180000)}
              onChange={(value) => patchCouncil({ timeoutMs: int(value, 180000) })}
            />
          </SettingsRow>
        </Show>
        <SettingsRow
          title={language.t("settings.agentTeam.autoContinue.title")}
          description={language.t("settings.agentTeam.autoContinue.description")}
        >
          <Switch
            checked={team().autoContinue?.enabled === true}
            onChange={(enabled) => patchAuto({ enabled })}
            hideLabel
          >
            {language.t("settings.agentTeam.autoContinue.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.agentTeam.autoContinue.autoEnable.title")}
          description={language.t("settings.agentTeam.autoContinue.autoEnable.description")}
          last={!tuned()}
        >
          <Switch
            checked={team().autoContinue?.autoEnable === true}
            onChange={(autoEnable) => patchAuto({ autoEnable })}
            hideLabel
          >
            {language.t("settings.agentTeam.autoContinue.autoEnable.title")}
          </Switch>
        </SettingsRow>
        <Show when={team().autoContinue?.autoEnable === true}>
          <SettingsRow
            title={language.t("settings.agentTeam.autoContinue.threshold.title")}
            description={language.t("settings.agentTeam.autoContinue.threshold.description")}
          >
            <TextField
              type="number"
              value={String(team().autoContinue?.autoEnableThreshold ?? 4)}
              onChange={(value) => patchAuto({ autoEnableThreshold: positive(value, 4) })}
            />
          </SettingsRow>
        </Show>
        <Show when={tuned()}>
          <SettingsRow
            title={language.t("settings.agentTeam.autoContinue.max.title")}
            description={language.t("settings.agentTeam.autoContinue.max.description")}
          >
            <TextField
              type="number"
              value={String(team().autoContinue?.maxContinuations ?? 5)}
              onChange={(value) => patchAuto({ maxContinuations: int(value, 5) })}
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.agentTeam.autoContinue.cooldown.title")}
            description={language.t("settings.agentTeam.autoContinue.cooldown.description")}
            last
          >
            <TextField
              type="number"
              value={String(team().autoContinue?.cooldownMs ?? 3000)}
              onChange={(value) => patchAuto({ cooldownMs: int(value, 3000) })}
            />
          </SettingsRow>
        </Show>
      </Advanced>
    </div>
  )
}

export default AgentTeamTab
