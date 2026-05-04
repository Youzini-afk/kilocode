import { Component, For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { usePlugins } from "../../context/plugins"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage, PluginListItem } from "../../types/messages"

type ScopeOption = { value: "global" | "local"; label: string }

const scopes: ScopeOption[] = [
  { value: "global", label: "Global" },
  { value: "local", label: "Project" },
]

function requestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function label(item: PluginListItem) {
  const bits: string[] = [item.source, item.scope]
  if (item.version) bits.push(`v${item.version}`)
  if (item.kinds.length) bits.push(item.kinds.join("+"))
  return bits.join(" · ")
}

const PluginsTab: Component = () => {
  const vscode = useVSCode()
  const plugins = usePlugins()
  const [url, setUrl] = createSignal("")
  const [ref, setRef] = createSignal("")
  const [subpath, setSubpath] = createSignal("")
  const [scope, setScope] = createSignal<ScopeOption>(scopes[0]!)
  const [trusted, setTrusted] = createSignal(false)
  const [busy, setBusy] = createSignal<Record<string, string>>({})
  const [settingsPanel, setSettingsPanel] = createSignal<{ pluginId: string; url: string; title: string } | null>(null)

  const loadingLabel = createMemo(() => (plugins.loading() ? "Loading plugins..." : "No plugins configured."))

  const setAction = (id: string, action: string | null) => {
    setBusy((prev) => {
      const next = { ...prev }
      if (action) next[id] = action
      else delete next[id]
      return next
    })
  }

  const install = () => {
    const value = url().trim()
    if (!value || !trusted()) return
    const id = requestId("plugin-install")
    setAction(id, "install")
    vscode.postMessage({
      type: "installPlugin",
      requestId: id,
      url: value,
      ref: ref().trim() || undefined,
      path: subpath().trim() || undefined,
      scope: scope().value,
      trusted: trusted(),
      force: true,
    })
  }

  const action = (plugin: PluginListItem, name: "enable" | "remove" | "update", fn: (id: string) => void) => {
    const id = requestId(`plugin-${name}`)
    setAction(id, name)
    setAction(plugin.id, name)
    fn(id)
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "pluginActionResult") {
      setAction(message.requestId, null)
      setBusy({})
      if (message.success) {
        if (message.action === "install") {
          setUrl("")
          setRef("")
          setSubpath("")
          setTrusted(false)
        }
        showToast({ variant: "success", title: `Plugin ${message.action} complete` })
      } else {
        showToast({ variant: "error", title: `Plugin ${message.action} failed`, description: message.error })
      }
      plugins.refresh()
      return
    }
    if (message.type === "openPluginSettingsPanel") {
      setSettingsPanel({ pluginId: message.pluginId, url: message.url, title: message.title })
    }
  })
  onCleanup(unsubscribe)

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <Show when={settingsPanel()}>
        {(panel) => (
          <Card>
            <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "8px" }}>
              <div style={{ flex: 1, "font-weight": 600 }}>{panel().title}</div>
              <IconButton variant="ghost" size="small" icon="close" onClick={() => setSettingsPanel(null)} />
            </div>
            <iframe
              title={panel().title}
              src={panel().url}
              sandbox="allow-scripts allow-forms"
              style={{
                width: "100%",
                height: "560px",
                border: "1px solid var(--border-weak-base)",
                "border-radius": "6px",
                background: "var(--vscode-editor-background)",
              }}
            />
          </Card>
        )}
      </Show>

      <Card>
        <div style={{ display: "grid", gap: "8px" }}>
          <div style={{ display: "grid", "grid-template-columns": "1fr 120px", gap: "8px" }}>
            <TextField value={url()} placeholder="https://github.com/org/kilo-plugin.git" onChange={setUrl} />
            <Select
              options={scopes}
              current={scope()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => item && setScope(item)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </div>
          <div style={{ display: "grid", "grid-template-columns": "1fr 1fr auto", gap: "8px", "align-items": "center" }}>
            <TextField value={ref()} placeholder="ref/branch (optional)" onChange={setRef} />
            <TextField value={subpath()} placeholder="packages/plugin (optional)" onChange={setSubpath} />
            <Button variant="primary" onClick={install} disabled={!url().trim() || !trusted() || Boolean(busy()["plugin-install"])}>
              Install
            </Button>
          </div>
          <label style={{ display: "flex", gap: "8px", "align-items": "flex-start", "font-size": "12px" }}>
            <Checkbox checked={trusted()} onChange={setTrusted} />
            <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
              I trust this plugin source. Git plugins can install dependencies, run build scripts, and execute code locally.
            </span>
          </label>
        </div>
      </Card>

      <Show when={plugins.plugins().length > 0} fallback={<Card>{loadingLabel()}</Card>}>
        <For each={plugins.plugins()}>
          {(plugin) => (
            <Card>
              <div style={{ display: "flex", gap: "12px", "align-items": "flex-start" }}>
                <Switch
                  checked={plugin.enabled}
                  disabled={plugin.scope === "builtin" || Boolean(busy()[plugin.id])}
                  onChange={(enabled) =>
                    action(plugin, "enable", (id) =>
                      vscode.postMessage({ type: "setPluginEnabled", requestId: id, id: plugin.id, enabled }),
                    )
                  }
                  hideLabel
                >
                  {plugin.displayName}
                </Switch>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
                    <strong>{plugin.displayName}</strong>
                    <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))", "font-size": "12px" }}>
                      {label(plugin)}
                    </span>
                  </div>
                  <Show when={plugin.description}>
                    <div style={{ "font-size": "12px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                      {plugin.description}
                    </div>
                  </Show>
                  <Show when={plugin.error}>
                    <div style={{ "font-size": "12px", color: "var(--vscode-errorForeground)" }}>{plugin.error}</div>
                  </Show>
                  <div
                    style={{
                      "font-family": "var(--vscode-editor-font-family, monospace)",
                      "font-size": "11px",
                      color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {plugin.spec}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
                  <IconButton
                    variant="ghost"
                    size="small"
                    icon="edit"
                    title="Open config"
                    onClick={() => vscode.postMessage({ type: "openPluginConfig", id: plugin.id })}
                  />
                  <Show when={plugin.settings?.available}>
                    <IconButton
                      variant="ghost"
                      size="small"
                      icon="settings-gear"
                      title="Open plugin settings"
                      onClick={() => vscode.postMessage({ type: "openPluginSettings", pluginId: plugin.id })}
                    />
                  </Show>
                  <Show when={plugin.source === "git"}>
                    <IconButton
                      variant="ghost"
                      size="small"
                      icon="download"
                      title="Update"
                      disabled={Boolean(busy()[plugin.id])}
                      onClick={() =>
                        action(plugin, "update", (id) =>
                          vscode.postMessage({ type: "updatePlugin", requestId: id, id: plugin.id }),
                        )
                      }
                    />
                  </Show>
                  <IconButton
                    variant="ghost"
                    size="small"
                    icon="trash"
                    title="Remove"
                    disabled={plugin.scope === "builtin" || Boolean(busy()[plugin.id])}
                    onClick={() =>
                      action(plugin, "remove", (id) =>
                        vscode.postMessage({
                          type: "removePlugin",
                          requestId: id,
                          id: plugin.id,
                          deleteManaged: plugin.managed,
                        }),
                      )
                    }
                  />
                </div>
              </div>
            </Card>
          )}
        </For>
      </Show>
    </div>
  )
}

export default PluginsTab
