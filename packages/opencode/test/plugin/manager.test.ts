import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { parse as parseJsonc } from "jsonc-parser"
import type { Config } from "../../src/config/config"
import { ConfigPlugin } from "../../src/config/plugin"
import { PluginLoader } from "../../src/plugin/loader"
import { PluginManager } from "../../src/plugin/manager"
import { tmpdir } from "../fixture/fixture"

describe("plugin.manager", () => {
  test("runtime options strip Kilo metadata and disabled plugins are skipped", () => {
    const spec: ConfigPlugin.Spec = [
      "acme",
      {
        custom: true,
        [ConfigPlugin.KILO_META_KEY]: {
          enabled: false,
          install: { type: "git", url: "https://example.com/acme.git" },
        },
      },
    ]

    expect(ConfigPlugin.pluginEnabled(spec)).toBe(false)
    expect(ConfigPlugin.runtimePluginOptions(spec)).toEqual({ custom: true })
  })

  test("loader does not resolve disabled plugins", async () => {
    const loaded = await PluginLoader.loadExternal({
      kind: "server",
      items: [
        {
          scope: "global",
          source: "test",
          spec: [
            "definitely-missing-plugin",
            {
              [ConfigPlugin.KILO_META_KEY]: {
                enabled: false,
              },
            },
          ],
        },
      ],
    })

    expect(loaded).toEqual([])
  })

  test("reads kilo-plugin manifest metadata", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "plugin")
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "kilocode-magic-context",
          version: "1.2.3",
          description: "Magic",
          exports: {
            "./server": "./dist/index.js",
          },
          "kilo-plugin": {
            id: "kilocode-magic-context",
            displayName: "Magic Context",
            kinds: ["server", "tui"],
            config: { file: "kilo-magic-context.jsonc" },
            settings: { title: "Magic Context", entry: "settings/index.html" },
            capabilities: [{ id: "context.management", label: "Context management", mode: "exclusive" }],
            conflicts: [
              {
                id: "native.compaction",
                type: "nativeFeature",
                feature: "native.compaction",
                severity: "blocking",
                reason: "Magic manages context.",
                resolutions: [
                  {
                    id: "use-plugin",
                    label: "Use Magic Context",
                    actions: [{ type: "setNativeFeature", feature: "native.compaction.auto", enabled: false }],
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    )

    const manifest = await PluginManager.readKiloManifest(pathToFileURL(dir).href)
    expect(manifest.id).toBe("kilocode-magic-context")
    expect(manifest.displayName).toBe("Magic Context")
    expect(manifest.kinds).toEqual(["server", "tui"])
    expect(manifest.settings?.entry).toBe("settings/index.html")
    expect(manifest.capabilities).toEqual([{ id: "context.management", label: "Context management", mode: "exclusive" }])
    expect(manifest.conflicts[0]?.id).toBe("native.compaction")
  })

  test("toggles enabled state in JSONC config", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.jsonc")
    await Bun.write(
      file,
      `{
  // keep
  "plugin": [
    "acme"
  ]
}
`,
    )

    await PluginManager.setEnabled(
      {
        plugin: ["acme"],
        plugin_origins: [{ spec: "acme", source: file, scope: "global" }],
      },
      { id: "acme", enabled: false, directory: tmp.path },
    )

    const text = await fs.readFile(file, "utf8")
    expect(text).toContain("// keep")
    const parsed = parseJsonc(text) as { plugin: unknown[] }
    expect(parsed.plugin).toEqual([["acme", { $kilo: { enabled: false } }]])
  })

  test("reports blocking conflicts and resolves them with managed restore metadata", async () => {
    await using tmp = await tmpdir()
    const pluginDir = path.join(tmp.path, "plugin")
    const file = path.join(tmp.path, "kilo.jsonc")
    await fs.mkdir(pluginDir, { recursive: true })
    await Bun.write(
      path.join(pluginDir, "package.json"),
      JSON.stringify(
        {
          name: "kilocode-magic-context",
          version: "1.2.3",
          exports: { "./server": "./dist/index.js" },
          "kilo-plugin": {
            id: "kilocode-magic-context",
            displayName: "Magic Context",
            kinds: ["server"],
            config: { file: "kilo-magic-context.jsonc", schema: "assets/kilo-magic-context.schema.json" },
            capabilities: [{ id: "context.management", mode: "exclusive" }],
            conflicts: [
              {
                id: "native.compaction",
                type: "nativeFeature",
                feature: "native.compaction",
                severity: "blocking",
                reason: "Magic Context manages context.",
                resolutions: [
                  {
                    id: "use-plugin",
                    label: "Use Magic Context",
                    recommended: true,
                    actions: [
                      { type: "setNativeFeature", feature: "native.compaction.auto", enabled: false },
                      { type: "setNativeFeature", feature: "native.compaction.prune", enabled: false },
                      { type: "createPluginConfig" },
                      { type: "setPluginEnabled", enabled: true },
                    ],
                  },
                  {
                    id: "keep-native",
                    label: "Keep Kilo native",
                    actions: [{ type: "setPluginEnabled", enabled: false }],
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    )
    const spec = pathToFileURL(pluginDir).href
    await Bun.write(
      file,
      JSON.stringify(
        {
          plugin: [[spec, { $kilo: { enabled: false } }]],
          compaction: { auto: true },
        },
        null,
        2,
      ),
    )

    const pluginSpec: ConfigPlugin.Spec = [spec, { $kilo: { enabled: false } }]
    const config: Config.Info = {
      plugin: [pluginSpec],
      plugin_origins: [{ spec: pluginSpec, source: file, scope: "global" }],
      compaction: { auto: true },
    }
    const [item] = await PluginManager.list(config)
    expect(item?.conflictStatus).toBe("pending-resolution")

    await PluginManager.resolveConflict(config, {
      id: "kilocode-magic-context",
      conflictId: "native.compaction",
      resolutionId: "use-plugin",
      directory: tmp.path,
    })

    const resolved = parseJsonc(await fs.readFile(file, "utf8")) as {
      plugin: [string, { $kilo: { enabled: boolean; managedChanges: unknown[] } }][]
      compaction: { auto?: boolean; prune?: boolean }
    }
    expect(resolved.compaction).toEqual({ auto: false, prune: false })
    expect(resolved.plugin[0]?.[1].$kilo.enabled).toBe(true)
    expect(resolved.plugin[0]?.[1].$kilo.managedChanges.length).toBe(1)
    expect(await fs.stat(path.join(tmp.path, "kilo-magic-context.jsonc")).then(() => true, () => false)).toBe(true)

    await PluginManager.setEnabled(
      {
        plugin: resolved.plugin as ConfigPlugin.Spec[],
        plugin_origins: [{ spec: resolved.plugin[0] as ConfigPlugin.Spec, source: file, scope: "global" }],
        compaction: resolved.compaction,
      },
      { id: "kilocode-magic-context", enabled: false, restoreManagedChanges: true, directory: tmp.path },
    )

    const restored = parseJsonc(await fs.readFile(file, "utf8")) as {
      plugin: [string, { $kilo: { enabled: boolean; managedChanges?: unknown[]; resolvedConflicts?: Array<{ resolutionId: string }> } }][]
      compaction: { auto?: boolean; prune?: boolean }
    }
    expect(restored.compaction).toEqual({ auto: true })
    expect(restored.plugin[0]?.[1].$kilo.enabled).toBe(false)
    expect(restored.plugin[0]?.[1].$kilo.managedChanges).toBeUndefined()
    expect(restored.plugin[0]?.[1].$kilo.resolvedConflicts?.[0]?.resolutionId).toBe("keep-native")
  })

  test("records keep-native conflict resolution without enabling the plugin", async () => {
    await using tmp = await tmpdir()
    const pluginDir = path.join(tmp.path, "plugin")
    const file = path.join(tmp.path, "kilo.jsonc")
    await fs.mkdir(pluginDir, { recursive: true })
    await Bun.write(
      path.join(pluginDir, "package.json"),
      JSON.stringify(
        {
          name: "kilocode-magic-context",
          version: "1.2.3",
          exports: { "./server": "./dist/index.js" },
          "kilo-plugin": {
            id: "kilocode-magic-context",
            displayName: "Magic Context",
            conflicts: [
              {
                id: "native.compaction",
                type: "nativeFeature",
                feature: "native.compaction",
                severity: "blocking",
                reason: "Magic Context manages context.",
                resolutions: [
                  {
                    id: "keep-native",
                    label: "Keep Kilo native",
                    actions: [{ type: "setPluginEnabled", enabled: false }],
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    )
    const spec = pathToFileURL(pluginDir).href
    const pluginSpec: ConfigPlugin.Spec = [spec, { $kilo: { enabled: false } }]
    await Bun.write(file, JSON.stringify({ plugin: [pluginSpec], compaction: { auto: true } }, null, 2))

    await PluginManager.resolveConflict(
      {
        plugin: [pluginSpec],
        plugin_origins: [{ spec: pluginSpec, source: file, scope: "global" }],
        compaction: { auto: true },
      },
      {
        id: "kilocode-magic-context",
        conflictId: "native.compaction",
        resolutionId: "keep-native",
        directory: tmp.path,
      },
    )

    const resolved = parseJsonc(await fs.readFile(file, "utf8")) as {
      plugin: [string, { $kilo: { enabled: boolean; resolvedConflicts?: Array<{ resolutionId: string }> } }][]
      compaction: { auto?: boolean }
    }
    expect(resolved.plugin[0]?.[1].$kilo.enabled).toBe(false)
    expect(resolved.plugin[0]?.[1].$kilo.resolvedConflicts?.[0]?.resolutionId).toBe("keep-native")
    const [item] = await PluginManager.list({
      plugin: resolved.plugin as ConfigPlugin.Spec[],
      plugin_origins: [{ spec: resolved.plugin[0] as ConfigPlugin.Spec, source: file, scope: "global" }],
      compaction: resolved.compaction,
    })
    expect(item?.conflictStatus).toBe("ok")
    await expect(
      PluginManager.setEnabled(
        {
          plugin: resolved.plugin as ConfigPlugin.Spec[],
          plugin_origins: [{ spec: resolved.plugin[0] as ConfigPlugin.Spec, source: file, scope: "global" }],
          compaction: resolved.compaction,
        },
        { id: "kilocode-magic-context", enabled: true, directory: tmp.path },
      ),
    ).rejects.toThrow("unresolved blocking conflicts")
  })
})
