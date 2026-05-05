import { Component, For, Show, createMemo, createSignal, createEffect, onCleanup } from "solid-js"
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

function progressLabel(action: string, stage: string, t: Translate) {
  return t(`settings.plugins.progress.${action}.${stage}`)
}

function initialProgressStage(action: "install" | "enable" | "remove" | "update" | "resolve") {
  if (action === "install") return "downloading"
  if (action === "update") return "updating"
  if (action === "remove") return "removing"
  return "applying"
}

function pluginActionError(error: string | undefined) {
  if (!error) return undefined
  try {
    const parsed = JSON.parse(error) as { message?: unknown; data?: { message?: unknown } }
    const message = typeof parsed.data?.message === "string" ? parsed.data.message : parsed.message
    if (typeof message === "string") return pluginActionError(message)
  } catch {}
  const lines = error
    .replaceAll("\\n", "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("at "))
  const important = lines.filter(
    (line) => !line.startsWith("ProcessRunFailedError:") && !line.startsWith("Command failed"),
  )
  return (important.length ? important : lines).slice(0, 6).join("\n") || error
}

function statusColor(item: PluginListItem) {
  if (item.conflictStatus === "blocked" || item.conflictStatus === "pending-resolution")
    return "var(--vscode-errorForeground)"
  if (item.conflictStatus === "warning") return "var(--vscode-editorWarning-foreground)"
  return "var(--text-weak-base, var(--vscode-descriptionForeground))"
}

function hasManagedChanges(item: PluginListItem) {
  return Boolean(item.managedChanges?.length)
}

function hasUnresolvedBlockingConflict(item: PluginListItem) {
  return item.conflictStatus === "blocked" || item.conflictStatus === "pending-resolution"
}

function firstInstallRequestId(busy: Record<string, string>) {
  return Object.keys(busy).find((id) => busy[id] === "install")
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
  const [progress, setProgress] = createSignal<Record<string, string>>({})
  const [settingsPanel, setSettingsPanel] = createSignal<{ pluginId: string; url: string; title: string } | null>(null)
  let settingsIframe: HTMLIFrameElement | undefined

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
    setProgress((prev) => {
      const next = { ...prev }
      if (!action) delete next[id]
      return next
    })
  }

  const setProgressText = (id: string, text: string | null) => {
    setProgress((prev) => {
      const next = { ...prev }
      if (text) next[id] = text
      else delete next[id]
      return next
    })
  }

  const install = () => {
    const value = url().trim()
    if (!value || !trusted()) return
    const id = requestId("plugin-install")
    const text = progressLabel("install", initialProgressStage("install"), language.t)
    setAction(id, "install")
    setProgressText(id, text)
    showToast({ title: text })
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
    const text = progressLabel(name, initialProgressStage(name), language.t)
    setAction(id, name)
    setAction(plugin.id, name)
    setProgressText(id, text)
    setProgressText(plugin.id, text)
    showToast({ title: text })
    fn(id)
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "pluginActionResult") {
      setAction(message.requestId, null)
      setBusy({})
      setProgress({})
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
          description: pluginActionError(message.error),
        })
      }
      plugins.refresh()
      return
    }
    if (message.type === "openPluginSettingsPanel") {
      setSettingsPanel({ pluginId: message.pluginId, url: message.url, title: message.title })
      return
    }
    if (message.type === "pluginSettingsRpcResult") {
      if (settingsPanel()?.pluginId === message.pluginId) {
        settingsIframe?.contentWindow?.postMessage(message, "*")
      }
    }
  })
  onCleanup(unsubscribe)

  createEffect(() => {
    if (!installing()) return
    const id = firstInstallRequestId(busy())
    const text = progress()[id ?? ""]
    if (text) return
    setProgressText(id ?? "install", language.t("settings.plugins.progress.install.starting"))
  })

  const installProgress = createMemo(() => progress()[firstInstallRequestId(busy()) ?? ""])

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <Show when={settingsPanel()}>
        {(panel) => (
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: "6px", right: "6px", "z-index": 1 }}>
              <IconButton
                variant="ghost"
                size="small"
                icon="close"
                title={language.t("settings.plugins.settings.close")}
                onClick={() => setSettingsPanel(null)}
              />
            </div>
            <iframe
              ref={settingsIframe}
              title={panel().title}
              src={panel().url}
              sandbox="allow-scripts allow-forms"
              style={{
                width: "100%",
                height: "560px",
                border: "0",
                background: "var(--vscode-editor-background)",
              }}
            />
          </div>
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
          <div
            style={{ display: "grid", "grid-template-columns": "1fr 1fr auto", gap: "8px", "align-items": "center" }}
          >
            <TextField
              value={ref()}
              placeholder={language.t("settings.plugins.install.ref.placeholder")}
              onChange={setRef}
            />
            <TextField
              value={subpath()}
              placeholder={language.t("settings.plugins.install.path.placeholder")}
              onChange={setSubpath}
            />
            <Button variant="primary" onClick={install} disabled={!url().trim() || !trusted() || installing()}>
              {installing()
                ? (installProgress() ?? language.t("settings.plugins.progress.install.starting"))
                : language.t("settings.plugins.install.button")}
            </Button>
          </div>
          <div style={{ "font-size": "12px" }}>
            <Checkbox checked={trusted()} onChange={setTrusted}>
              <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                {language.t("settings.plugins.install.trust")}
              </span>
            </Checkbox>
          </div>
        </div>
      </Card>

      <Show when={plugins.plugins().length > 0} fallback={<Card>{loadingLabel()}</Card>}>
        <For each={plugins.plugins()}>
          {(plugin) => (
            <Card>
              <div style={{ display: "flex", gap: "12px", "align-items": "flex-start" }}>
                <Switch
                  checked={plugin.enabled}
                  disabled={Boolean(busy()[plugin.id]) || (!plugin.enabled && hasUnresolvedBlockingConflict(plugin))}
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
                    <span
                      style={{
                        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        "font-size": "12px",
                      }}
                    >
                      {label(plugin, language.t)}
                    </span>
                    <Show when={progress()[plugin.id]}>
                      {(text) => (
                        <span style={{ color: "var(--vscode-progressBar-background)", "font-size": "12px" }}>
                          {text()}
                        </span>
                      )}
                    </Show>
                  </div>
                  <Show when={plugin.description}>
                    <div
                      style={{
                        "font-size": "12px",
                        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                      }}
                    >
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
