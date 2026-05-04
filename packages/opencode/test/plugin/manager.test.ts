import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { parse as parseJsonc } from "jsonc-parser"
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
})
