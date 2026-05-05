import { Component, createSignal, onCleanup, onMount } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { usePlugins } from "../../context/plugins"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"

const PluginSettingsFrame: Component<{ pluginId: string }> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const plugins = usePlugins()
  const [frame, setFrame] = createSignal<{ url: string; title: string } | null>(null)
  let settingsIframe: HTMLIFrameElement | undefined

  onMount(() => vscode.postMessage({ type: "openPluginSettings", pluginId: props.pluginId }))

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "pluginSettingsRpcResult" && message.pluginId === props.pluginId) {
      settingsIframe?.contentWindow?.postMessage(message, "*")
      return
    }
    if (message.type !== "openPluginSettingsPanel") return
    if (message.pluginId !== props.pluginId) return
    setFrame({ url: message.url, title: message.title })
  })
  onCleanup(unsubscribe)

  const plugin = () => plugins.plugins().find((item) => item.id === props.pluginId)

  return (
    <Card>
      {frame() ? (
        <iframe
          ref={settingsIframe}
          title={frame()!.title}
          src={frame()!.url}
          sandbox="allow-scripts allow-forms"
          style={{
            width: "100%",
            height: "640px",
            border: "1px solid var(--border-weak-base)",
            "border-radius": "6px",
            background: "var(--vscode-editor-background)",
          }}
        />
      ) : (
        <div style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
          {language.t("settings.plugins.settings.loading", { plugin: plugin()?.displayName ?? props.pluginId })}
        </div>
      )}
    </Card>
  )
}

export default PluginSettingsFrame
