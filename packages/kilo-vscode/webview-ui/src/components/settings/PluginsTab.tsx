import { Component, For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import type { UiI18nParams } from "@kilocode/kilo-ui/context"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../../context/language"
import { usePlugins } from "../../context/plugins"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage, PluginListItem } from "../../types/messages"

type ScopeOption = { value: "global" | "local"; label: string }
type Translate = (key: string, params?: UiI18nParams) => string

function requestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function sourceLabel(item: PluginListItem, t: Translate) {
  return t(`settings.plugins.source.${item.source}`)
}

function scopeLabel(item: PluginListItem, t: Translate) {
  return t(`settings.plugins.scope.${item.scope}`)
}

function kindLabel(kind: PluginListItem["kinds"][number], t: Translate) {
  return t(`settings.plugins.kind.${kind}`)
}

function label(item: PluginListItem, t: Translate) {
  const bits: string[] = [sourceLabel(item, t), scopeLabel(item, t)]
  if (item.version) bits.push(t("settings.plugins.version", { version: item.version }))
  if (item.kinds.length) bits.push(item.kinds.map((kind) => kindLabel(kind, t)).join("+"))
  return bits.join(" · ")
}

function statusLabel(item: PluginListItem, t: Translate) {
  if (item.conflictStatus === "pending-resolution") return t("settings.plugins.status.needsResolution")
  if (item.conflictStatus === "blocked") return t("settings.plugins.status.blocked")
  if (item.conflictStatus === "warning") return t("settings.plugins.status.warning")
  return item.enabled ? t("settings.plugins.status.enabled") : t("settings.plugins.status.disabled")
}

function statusColor(item: PluginListItem) {
  if (item.conflictStatus === "blocked" || item.conflictStatus === "pending-resolution") return "var(--vscode-errorForeground)"
  if (item.conflictStatus === "warning") return "var(--vscode-editorWarning-foreground)"
  return "var(--text-weak-base, var(--vscode-descriptionForeground))"
}

function hasManagedChanges(item: PluginListItem) {
  return Boolean(item.managedChanges?.length)
}

function hasUnresolvedBlockingConflict(item: PluginListItem) {
  return item.conflictStatus === "blocked" || item.conflictStatus === "pending-resolution"
}

const PluginsTab: Component = () => {
  const language = useLanguage()
  const vscode = useVSCode()
  const plugins = usePlugins()
  const [url, setUrl] = createSignal("")
  const [ref, setRef] = createSignal("")
  const [subpath, setSubpath] = createSignal("")
  const [scope, setScope] = createSignal<"global" | "local">("global")
  const [trusted, setTrusted] = createSignal(false)
  const [busy, setBusy] = createSignal<Record<string, string>>({})
  const [settingsPanel, setSettingsPanel] = createSignal<{ pluginId: string; url: string; title: string } | null>(null)

  const scopeOptions = createMemo<ScopeOption[]>(() => [
    { value: "global", label: language.t("settings.plugins.scope.global") },
    { value: "local", label: language.t("settings.plugins.scope.local") },
  ])
  const selectedScope = createMemo(() => scopeOptions().find((item) => item.value === scope()) ?? scopeOptions()[0]!)
  const loadingLabel = createMemo(() =>
    plugins.loading() ? language.t("settings.plugins.loading") : language.t("settings.plugins.empty"),
  )
  const installing = createMemo(() => Object.values(busy()).includes("install"))

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
      scope: scope(),
      trusted: trusted(),
      force: true,
    })
  }

  const restoreManagedChanges = (plugin: PluginListItem) => {
    if (!hasManagedChanges(plugin)) return false
    return window.confirm(language.t("settings.plugins.restore.confirm", { plugin: plugin.displayName }))
  }

  const action = (
    plugin: PluginListItem,
    name: "enable" | "remove" | "update" | "resolve",
    fn: (id: string) => void,
  ) => {
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
        showToast({ variant: "success", title: language.t(`settings.plugins.toast.${message.action}.success`) })
      } else {
        showToast({
          variant: "error",
          title: language.t(`settings.plugins.toast.${message.action}.error`),
          description: message.error,
        })
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
              <IconButton
                variant="ghost"
                size="small"
                icon="close"
                title={language.t("settings.plugins.settings.close")}
                onClick={() => setSettingsPanel(null)}
              />
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
            <TextField
              value={url()}
              placeholder={language.t("settings.plugins.install.url.placeholder")}
              onChange={setUrl}
            />
            <Select
              options={scopeOptions()}
              current={selectedScope()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => item && setScope(item.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </div>
          <div style={{ display: "grid", "grid-template-columns": "1fr 1fr auto", gap: "8px", "align-items": "center" }}>
            <TextField value={ref()} placeholder={language.t("settings.plugins.install.ref.placeholder")} onChange={setRef} />
            <TextField
              value={subpath()}
              placeholder={language.t("settings.plugins.install.path.placeholder")}
              onChange={setSubpath}
            />
            <Button variant="primary" onClick={install} disabled={!url().trim() || !trusted() || installing()}>
              {language.t("settings.plugins.install.button")}
            </Button>
          </div>
          <label style={{ display: "flex", gap: "8px", "align-items": "flex-start", "font-size": "12px" }}>
            <Checkbox checked={trusted()} onChange={setTrusted} />
            <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
              {language.t("settings.plugins.install.trust")}
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
                  disabled={
                    plugin.scope === "builtin" ||
                    Boolean(busy()[plugin.id]) ||
                    (!plugin.enabled && hasUnresolvedBlockingConflict(plugin))
                  }
                  onChange={(enabled) =>
                    action(plugin, "enable", (id) =>
                      vscode.postMessage({
                        type: "setPluginEnabled",
                        requestId: id,
                        id: plugin.id,
                        enabled,
                        restoreManagedChanges: !enabled ? restoreManagedChanges(plugin) : undefined,
                      }),
                    )
                  }
                  hideLabel
                >
                  {plugin.displayName}
                </Switch>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
                    <strong>{plugin.displayName}</strong>
                    <span
                      style={{
                        color: statusColor(plugin),
                        "font-size": "11px",
                        border: "1px solid var(--border-weak-base)",
                        "border-radius": "999px",
                        padding: "1px 6px",
                      }}
                    >
                      {statusLabel(plugin, language.t)}
                    </span>
                    <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))", "font-size": "12px" }}>
                      {label(plugin, language.t)}
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
                  <Show when={plugin.conflicts?.length}>
                    <div style={{ display: "grid", gap: "8px", "margin-top": "10px" }}>
                      <For each={plugin.conflicts ?? []}>
                        {(conflict) => (
                          <div
                            style={{
                              display: "grid",
                              gap: "8px",
                              padding: "10px",
                              border: "1px solid var(--border-weak-base)",
                              "border-radius": "6px",
                            }}
                          >
                            <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
                              {conflict.reason}
                            </div>
                            <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
                              <For each={conflict.resolutions}>
                                {(resolution) => (
                                  <Button
                                    variant={resolution.recommended ? "primary" : "secondary"}
                                    size="small"
                                    disabled={Boolean(busy()[plugin.id])}
                                    onClick={() =>
                                      action(plugin, "resolve", (id) =>
                                        vscode.postMessage({
                                          type: "resolvePluginConflict",
                                          requestId: id,
                                          id: plugin.id,
                                          conflictId: conflict.id,
                                          resolutionId: resolution.id,
                                        }),
                                      )
                                    }
                                  >
                                    {resolution.label}
                                  </Button>
                                )}
                              </For>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
                <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
                  <IconButton
                    variant="ghost"
                    size="small"
                    icon="edit"
                    title={language.t("settings.plugins.tooltip.openConfig")}
                    onClick={() => vscode.postMessage({ type: "openPluginConfig", id: plugin.id })}
                  />
                  <Show when={plugin.settings?.available}>
                    <IconButton
                      variant="ghost"
                      size="small"
                      icon="settings-gear"
                      title={language.t("settings.plugins.tooltip.openSettings")}
                      onClick={() => vscode.postMessage({ type: "openPluginSettings", pluginId: plugin.id })}
                    />
                  </Show>
                  <Show when={plugin.source === "git"}>
                    <IconButton
                      variant="ghost"
                      size="small"
                      icon="download"
                      title={language.t("settings.plugins.tooltip.update")}
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
                    title={language.t("settings.plugins.tooltip.remove")}
                    disabled={plugin.scope === "builtin" || Boolean(busy()[plugin.id])}
                    onClick={() =>
                      action(plugin, "remove", (id) =>
                        vscode.postMessage({
                          type: "removePlugin",
                          requestId: id,
                          id: plugin.id,
                          deleteManaged: plugin.managed,
                          restoreManagedChanges: restoreManagedChanges(plugin),
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
