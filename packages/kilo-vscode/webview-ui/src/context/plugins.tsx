import { Accessor, ParentComponent, createContext, createSignal, onCleanup, useContext } from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage, PluginListItem } from "../types/messages"

interface PluginsContextValue {
  plugins: Accessor<PluginListItem[]>
  loading: Accessor<boolean>
  refresh: () => void
}

const PluginsContext = createContext<PluginsContextValue>()

export const PluginsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [plugins, setPlugins] = createSignal<PluginListItem[]>([])
  const [loading, setLoading] = createSignal(true)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "pluginsLoaded") return
    setPlugins(message.plugins ?? [])
    setLoading(false)
  })

  const refresh = () => {
    setLoading(true)
    vscode.postMessage({ type: "requestPlugins" })
  }

  vscode.postMessage({ type: "requestPlugins" })
  onCleanup(unsubscribe)

  return <PluginsContext.Provider value={{ plugins, loading, refresh }}>{props.children}</PluginsContext.Provider>
}

export function usePlugins(): PluginsContextValue {
  const context = useContext(PluginsContext)
  if (!context) throw new Error("usePlugins must be used within a PluginsProvider")
  return context
}
