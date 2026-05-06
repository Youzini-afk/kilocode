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
  onToggleEnabled: (v: boolean) => void
  onPatchRole: (next: Partial<RoleConfig>) => void
}

const RoleRow: Component<RoleRowProps> = (props) => {
  const language = useLanguage()
  const { findModel } = useProvider()

  const modelSelection = createMemo(() => parseModelString(props.cfg().model ?? undefined))

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
        <div style={{ color: "var(--text-muted)", "font-size": "12px", "margin-top": "3px" }}>{props.description}</div>
        <Button variant="ghost" size="small" onClick={props.onToggleOpen} style={{ padding: "0", "margin-top": "6px" }}>
          {props.open
            ? language.t("settings.agentTeam.role.advanced.hide")
            : language.t("settings.agentTeam.role.advanced.show")}
        </Button>
      </div>
      <div class="agent-team-role-controls">
        <div class="agent-team-role-control agent-team-role-control-model">
          <span class="agent-team-role-control-label">{language.t("settings.agentTeam.column.model")}</span>
          <ModelSelectorBase
            value={modelSelection()}
            onSelect={(providerID, modelID) =>
              props.onPatchRole({ model: providerID && modelID ? `${providerID}/${modelID}` : null })
            }
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.agentTeam.model.default")}
          />
        </div>
        <div class="agent-team-role-control agent-team-role-control-variant">
          <span class="agent-team-role-control-label">{language.t("settings.agentTeam.column.variant")}</span>
          <Select
            options={variantList()}
            current={currentVariant()}
            value={(c: Choice) => c.value}
            label={(c: Choice) => c.label}
            onSelect={(c: Choice | undefined) => props.onPatchRole({ variant: c?.value || null })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
        <div class="agent-team-role-control agent-team-role-control-temperature">
          <span class="agent-team-role-control-label">{language.t("settings.agentTeam.column.temperature")}</span>
          <TextField
            type="number"
            value={
              props.cfg().temperature === undefined || props.cfg().temperature === null
                ? ""
                : String(props.cfg().temperature)
            }
            placeholder={language.t("settings.agentTeam.temperature.default")}
            onChange={(value) => {
              const n = Number.parseFloat(value)
              props.onPatchRole({
                temperature: value.trim() && Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : null,
              })
            }}
          />
        </div>
        <div class="agent-team-role-control agent-team-role-control-enabled">
          <span class="agent-team-role-control-label">{language.t("settings.agentTeam.column.enabled")}</span>
          <Switch checked={props.enabled()} onChange={props.onToggleEnabled} hideLabel>
            {props.title}
          </Switch>
        </div>
      </div>
      <Show when={props.open}>
        <div class="agent-team-role-policy">
          <TextField
            value={props.cfg().displayName ?? ""}
            placeholder={language.t("settings.agentTeam.displayName.placeholder")}
            onChange={(value) => props.onPatchRole({ displayName: value.trim() || null })}
          />
          <TextField
            value={(props.cfg().skills ?? []).join(", ")}
            placeholder={language.t("settings.agentTeam.skills.placeholder")}
            onChange={(value) =>
              props.onPatchRole({
                skills: value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <TextField
            value={(props.cfg().mcps ?? []).join(", ")}
            placeholder={language.t("settings.agentTeam.mcps.placeholder")}
            onChange={(value) =>
              props.onPatchRole({
                mcps: value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
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
  const [open, setOpen] = createSignal<Record<string, boolean>>({})

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

  function patchCouncil(next: NonNullable<AgentTeamConfig["council"]>) {
    patch({ council: next })
  }

  function patchAuto(next: NonNullable<AgentTeamConfig["autoContinue"]>) {
    patch({ autoContinue: next })
  }

  function roleEnabled(id: Role) {
    if (id === "council") return team().council?.enabled === true && cfg(id).enabled !== false
    return cfg(id).enabled ?? true
  }

  function toggle(id: Role, value: boolean) {
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
    roles.map((id) => ({
      id,
      title: language.t(`settings.agentTeam.role.${id}.title`),
      description: language.t(`settings.agentTeam.role.${id}.description`),
    })),
  )

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
            {(item) => (
              <RoleRow
                id={item.id}
                title={item.title}
                description={item.description}
                open={!!open()[`role:${item.id}`]}
                onToggleOpen={() => setOpen((prev) => ({ ...prev, [`role:${item.id}`]: !prev[`role:${item.id}`] }))}
                cfg={() => cfg(item.id)}
                enabled={() => roleEnabled(item.id)}
                onToggleEnabled={(v) => toggle(item.id, v)}
                onPatchRole={(next) => patchRole(item.id, next)}
              />
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
