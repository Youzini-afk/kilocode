import { Component, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { ModelSelectorBase } from "../shared/ModelSelector"
import { useLanguage } from "../../context/language"
import type { ModelSelection } from "../../types/messages"

type Props = {
  value: string
  models: number
  onChange: (value: string) => void
  onOpenProviders: () => void
}

function selection(value: string): ModelSelection | null {
  const [providerID, ...parts] = value.split("/")
  const modelID = parts.join("/")
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

export const ContextEngineModelSelect: Component<Props> = (props) => {
  const language = useLanguage()
  return (
    <div style={{ display: "flex", "align-items": "center", gap: "8px", "justify-content": "flex-end" }}>
      <Show when={props.models > 0}>
        <ModelSelectorBase
          value={selection(props.value)}
          allowClear
          clearLabel={language.t("settings.contextEngine.model.default")}
          placement="bottom-end"
          onSelect={(providerID, modelID) => props.onChange(providerID && modelID ? `${providerID}/${modelID}` : "")}
        />
      </Show>
      <Show when={props.models === 0}>
        <Button variant="secondary" size="small" onClick={props.onOpenProviders}>
          {language.t("settings.contextEngine.configureApi")}
        </Button>
      </Show>
    </div>
  )
}
