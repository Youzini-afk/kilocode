import { Component, For, JSX, Show, createMemo, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { ModelSelectorBase } from "../shared/ModelSelector"
import { parseModelString } from "../../../../src/shared/provider-model"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import type { AgentTeamConfig, AgentTeamRole, AgentTeamRoleConfig } from "../../types/messages"
import SettingsRow from "./SettingsRow"

type Role = Exclude<AgentTeamRole, "councillor" | "team">
type RoleConfig = AgentTeamRoleConfig

interface Choice {
  value: string
  label: string
}

const roles: Role[] = ["orchestrator", "explorer", "librarian", "oracle", "designer", "fixer", "observer", "council"]
const efforts = ["low", "medium", "high", "xhigh"]

function int(value: string, fallback: number) {
  const next = Number.parseInt(value, 10)
  if (!Number.isFinite(next) || next < 0) return fallback
  return next
}

function temp(value: string) {
  const next = Number.parseFloat(value)
  if (!Number.isFinite(next)) return null
  return Math.max(0, Math.min(2, next))
}

function csv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function unique(items: string[]) {
  return Array.from(new Set(items))
}

const AgentTeamTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const { findModel } = useProvider()
  const [open, setOpen] = createSignal<Record<string, boolean>>({})

  const team = () => config().agentTeam ?? {}
  const cfg = (id: AgentTeamRole): RoleConfig => {
    if (id === "orchestrator") return team().roles?.orchestrator ?? team().roles?.team ?? {}
    return team().roles?.[id] ?? {}
  }
  const on = (value: boolean | undefined, fallback = true) => value ?? fallback

  function patch(next: Partial<AgentTeamConfig>) {
    updateConfig({ agentTeam: { ...team(), ...next } })
  }

  function patchRole(id: AgentTeamRole, next: Partial<RoleConfig>) {
    patch({
      roles: {
        ...team().roles,
        [id]: {
          ...cfg(id),
          ...next,
        },
      },
    })
  }

  function patchReuse(next: NonNullable<AgentTeamConfig["sessionReuse"]>) {
    patch({ sessionReuse: { ...team().sessionReuse, ...next } })
  }

  function patchCouncil(next: NonNullable<AgentTeamConfig["council"]>) {
    patch({ council: { ...team().council, ...next } })
  }

  function patchAuto(next: NonNullable<AgentTeamConfig["autoContinue"]>) {
    patch({ autoContinue: { ...team().autoContinue, ...next } })
  }

  function enabled(id: Role) {
    if (id === "council") return team().council?.enabled === true && cfg(id).enabled !== false
    return on(cfg(id).enabled)
  }

  function toggle(id: Role, value: boolean) {
    if (id === "council") patchCouncil({ enabled: value })
    patchRole(id, { enabled: value })
  }

  const model = (id: AgentTeamRole) => parseModelString(cfg(id).model ?? undefined)
  const select = (id: AgentTeamRole) => (providerID: string, modelID: string) => {
    patchRole(id, { model: providerID && modelID ? `${providerID}/${modelID}` : null })
  }

  function variants(id: AgentTeamRole) {
    const found = findModel(model(id))
    return unique(["", ...efforts, ...Object.keys(found?.variants ?? {})]).map((item) => ({
      value: item,
      label: item
        ? efforts.includes(item)
          ? language.t(`settings.agentTeam.variant.${item}`)
          : item
        : language.t("settings.agentTeam.variant.default"),
    }))
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
    roles.map((id) => ({
      id,
      title: language.t(`settings.agentTeam.role.${id}.title`),
      description: language.t(`settings.agentTeam.role.${id}.description`),
    })),
  )

  function variant(id: Role) {
    const list = variants(id)
    return list.find((item) => item.value === (cfg(id).variant ?? "")) ?? list[0]
  }

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
        <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "minmax(180px, 1.2fr) minmax(220px, 1fr) 150px 96px 72px",
              gap: "8px",
              "align-items": "center",
              color: "var(--text-muted)",
              "font-size": "12px",
              "padding-inline": "4px",
            }}
          >
            <span>{language.t("settings.agentTeam.column.agent")}</span>
            <span>{language.t("settings.agentTeam.column.model")}</span>
            <span>{language.t("settings.agentTeam.column.variant")}</span>
            <span>{language.t("settings.agentTeam.column.temperature")}</span>
            <span>{language.t("settings.agentTeam.column.enabled")}</span>
          </div>
          <For each={rows()}>
            {(item) => (
              <div
                style={{
                  display: "grid",
                  "grid-template-columns": "minmax(180px, 1.2fr) minmax(220px, 1fr) 150px 96px 72px",
                  gap: "8px",
                  "align-items": "center",
                  padding: "10px",
                  border: "1px solid var(--border-weak-base)",
                  "border-radius": "8px",
                  background: enabled(item.id)
                    ? "var(--vscode-editor-background)"
                    : "var(--surface-muted, rgba(127,127,127,0.06))",
                }}
              >
                <div>
                  <div style={{ "font-weight": 600 }}>{item.title}</div>
                  <div style={{ color: "var(--text-muted)", "font-size": "12px", "margin-top": "3px" }}>
                    {item.description}
                  </div>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => setOpen((prev) => ({ ...prev, [`role:${item.id}`]: !prev[`role:${item.id}`] }))}
                    style={{ padding: "0", "margin-top": "6px" }}
                  >
                    {open()[`role:${item.id}`]
                      ? language.t("settings.agentTeam.role.advanced.hide")
                      : language.t("settings.agentTeam.role.advanced.show")}
                  </Button>
                </div>
                <ModelSelectorBase
                  value={model(item.id)}
                  onSelect={select(item.id)}
                  placement="bottom-start"
                  allowClear
                  clearLabel={language.t("settings.agentTeam.model.default")}
                />
                <Select
                  options={variants(item.id)}
                  current={variant(item.id)}
                  value={(choice: Choice) => choice.value}
                  label={(choice: Choice) => choice.label}
                  onSelect={(choice: Choice | undefined) => patchRole(item.id, { variant: choice?.value || null })}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
                <TextField
                  type="number"
                  value={
                    cfg(item.id).temperature === undefined || cfg(item.id).temperature === null
                      ? ""
                      : String(cfg(item.id).temperature)
                  }
                  placeholder={language.t("settings.agentTeam.temperature.default")}
                  onChange={(value) => patchRole(item.id, { temperature: value.trim() ? temp(value) : null })}
                />
                <Switch checked={enabled(item.id)} onChange={(value) => toggle(item.id, value)} hideLabel>
                  {item.title}
                </Switch>
                <Show when={open()[`role:${item.id}`]}>
                  <div
                    style={{
                      "grid-column": "1 / -1",
                      display: "grid",
                      "grid-template-columns": "1fr 1fr 1fr",
                      gap: "8px",
                    }}
                  >
                    <TextField
                      value={cfg(item.id).displayName ?? ""}
                      placeholder={language.t("settings.agentTeam.displayName.placeholder")}
                      onChange={(value) => patchRole(item.id, { displayName: value.trim() || null })}
                    />
                    <TextField
                      value={(cfg(item.id).skills ?? []).join(", ")}
                      placeholder={language.t("settings.agentTeam.skills.placeholder")}
                      onChange={(value) => patchRole(item.id, { skills: csv(value) })}
                    />
                    <TextField
                      value={(cfg(item.id).mcps ?? []).join(", ")}
                      placeholder={language.t("settings.agentTeam.mcps.placeholder")}
                      onChange={(value) => patchRole(item.id, { mcps: csv(value) })}
                    />
                  </div>
                </Show>
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
        <Show when={team().autoContinue?.enabled === true}>
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
