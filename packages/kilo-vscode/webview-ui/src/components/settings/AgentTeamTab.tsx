import { Component, For, Show } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { ModelSelectorBase } from "../shared/ModelSelector"
import { parseModelString } from "../../../../src/shared/provider-model"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { AgentTeamConfig, AgentTeamRole } from "../../types/messages"
import SettingsRow from "./SettingsRow"

type Role = Exclude<AgentTeamRole, "councillor">

const roles: Role[] = ["librarian", "oracle", "designer", "fixer", "observer", "council"]

function int(value: string, fallback: number) {
  const next = Number.parseInt(value, 10)
  if (!Number.isFinite(next) || next < 0) return fallback
  return next
}

const AgentTeamTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()

  const team = () => config().agentTeam ?? {}
  const cfg = (id: AgentTeamRole) => team().roles?.[id] ?? {}
  const on = (value: boolean | undefined, fallback = true) => value ?? fallback

  function patch(next: Partial<AgentTeamConfig>) {
    updateConfig({ agentTeam: { ...team(), ...next } })
  }

  function patchRole(id: AgentTeamRole, next: Partial<NonNullable<AgentTeamConfig["roles"]>[AgentTeamRole]>) {
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

  const model = (id: AgentTeamRole) => parseModelString(cfg(id).model ?? undefined)
  const select = (id: AgentTeamRole) => (providerID: string, modelID: string) => {
    patchRole(id, { model: providerID && modelID ? `${providerID}/${modelID}` : null })
  }

  return (
    <div>
      <Card style={{ "margin-bottom": "16px" }}>
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
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentTeam.roles.title")}</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <For each={roles}>
          {(id, index) => (
            <SettingsRow
              title={language.t(`settings.agentTeam.role.${id}.title`)}
              description={language.t(`settings.agentTeam.role.${id}.description`)}
              last={index() === roles.length - 1}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "8px", "justify-content": "flex-end" }}>
                <ModelSelectorBase
                  value={model(id)}
                  onSelect={select(id)}
                  placement="bottom-end"
                  allowClear
                  clearLabel={language.t("settings.agentTeam.model.default")}
                />
                <Switch checked={on(cfg(id).enabled)} onChange={(enabled) => patchRole(id, { enabled })} hideLabel>
                  {language.t(`settings.agentTeam.role.${id}.title`)}
                </Switch>
              </div>
            </SettingsRow>
          )}
        </For>
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>
        {language.t("settings.agentTeam.collaboration.title")}
      </h4>
      <Card style={{ "margin-bottom": "16px" }}>
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
      </Card>

      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>{language.t("settings.agentTeam.advanced.title")}</h4>
      <Card>
        <SettingsRow
          title={language.t("settings.agentTeam.council.title")}
          description={language.t("settings.agentTeam.council.description")}
        >
          <Switch
            checked={team().council?.enabled === true}
            onChange={(enabled) => patchCouncil({ enabled })}
            hideLabel
          >
            {language.t("settings.agentTeam.council.title")}
          </Switch>
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
      </Card>
    </div>
  )
}

export default AgentTeamTab
