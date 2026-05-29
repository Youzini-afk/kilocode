import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { emptyConsoleState } from "@/config/console-state"
import { CouncilTool } from "@/kilocode/agent-team/council"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionPrompt } from "@/session/prompt"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { ModelID, ProviderID } from "@/provider/schema"
import { ProjectID } from "@/project/schema"
import { testEffect } from "../lib/effect"

let current: Config.Info = {}

const agent = Layer.succeed(
  Agent.Service,
  Agent.Service.of({
    get: (name) =>
      Effect.succeed({
        name,
        mode: "primary",
        permission: [],
        options: {},
      }),
    list: () => Effect.succeed([]),
    defaultAgent: () => Effect.succeed("council"),
    generate: () => Effect.succeed({ identifier: "generated", whenToUse: "never", systemPrompt: "test" }),
  }),
)

const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    get: () => Effect.succeed(current),
    getGlobal: () => Effect.succeed({}),
    getConsoleState: () => Effect.succeed(emptyConsoleState),
    update: () => Effect.void,
    updateGlobal: (cfg) => Effect.succeed({ info: cfg, changed: false }),
    invalidate: () => Effect.void,
    directories: () => Effect.succeed([]),
    waitForDependencies: () => Effect.void,
    warnings: () => Effect.succeed([]),
  }),
)

const sessions = Layer.succeed(
  Session.Service,
  Session.Service.of({
    create: (input) =>
      Effect.succeed({
        id: SessionID.descending(),
        slug: "council-child",
        projectID: ProjectID.make("project_council"),
        directory: "/tmp",
        title: input?.title ?? "Council child",
        parentID: input?.parentID,
        permission: input?.permission,
        time: { created: Date.now(), updated: Date.now() },
        version: "test",
      }),
    list: () => Effect.succeed([]),
    fork: () => Effect.die("unused"),
    touch: () => Effect.void,
    get: () => Effect.die("unused"),
    setTitle: () => Effect.void,
    setArchived: () => Effect.void,
    setPermission: () => Effect.void,
    setRevert: () => Effect.void,
    clearRevert: () => Effect.void,
    setSummary: () => Effect.void,
    diff: () => Effect.succeed([]),
    messages: () => Effect.succeed([]),
    children: () => Effect.succeed([]),
    remove: () => Effect.void,
    updateMessage: (msg) => Effect.succeed(msg),
    removeMessage: () => Effect.die("unused"),
    removePart: () => Effect.die("unused"),
    getPart: () => Effect.succeed(undefined),
    updatePart: (part) => Effect.succeed(part),
    updatePartDelta: () => Effect.void,
    findMessage: () => Effect.succeedNone,
  }),
)

const it = testEffect(Layer.mergeAll(agent, config, sessions, Truncate.defaultLayer))

function reply(input: SessionPrompt.PromptInput, value: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: "councillor",
      agent: "councillor",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ModelID.make("model"),
      providerID: input.model?.providerID ?? ProviderID.make("provider"),
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text: value,
      },
    ],
  }
}

function ctx(meta: unknown[]) {
  return {
    sessionID: SessionID.descending(),
    messageID: MessageID.ascending(),
    agent: "council",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: (input) =>
      Effect.sync(() => {
        meta.push(input.metadata)
      }),
    ask: () => Effect.void,
  } satisfies Tool.Context
}

const init = Effect.fn("CouncilToolTest.init")(function* () {
  const info = yield* CouncilTool
  return yield* Tool.init(info)
})

describe("CouncilTool", () => {
  it.live("runs serial council with empty-response retries", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const ids: MessageID[] = []
      const meta: unknown[] = []
      current = {
        agentTeam: {
          enabled: true,
          council: {
            enabled: true,
            executionMode: "serial",
            councillorRetries: 1,
            presets: {
              default: {
                alpha: { model: "test/a" },
                beta: { model: "test/b" },
              },
            },
          },
        },
      } as Config.Info

      const ops = {
        cancel: () => Effect.void,
        resolvePromptParts: (template: string) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input: SessionPrompt.PromptInput) =>
          Effect.sync(() => {
            ids.push(input.messageID ?? MessageID.ascending())
            calls.push(`${input.model?.modelID}:${calls.length}`)
            return reply(input, calls.length === 1 ? "" : `reply ${calls.length}`)
          }),
      }

      const tool = yield* init()
      const result = yield* tool.execute({ prompt: "decide" }, { ...ctx(meta), extra: { promptOps: ops } })

      expect(calls).toEqual(["a:0", "a:1", "b:2"])
      expect(new Set(ids).size).toBe(3)
      expect(meta[0]).toEqual({ preset: "default", total: 2, executionMode: "serial", maxConcurrency: 1, retries: 1 })
      expect(result.metadata).toMatchObject({ completed: 2, executionMode: "serial", maxConcurrency: 1, retries: 1 })
      expect(result.output).toContain("## alpha")
      expect(result.output).toContain("reply 2")
      expect(result.output).toContain("## beta")
      expect(result.output).toContain("reply 3")
    }),
  )

  it.live("marks councillor timeout as timed_out", () =>
    Effect.gen(function* () {
      current = {
        agentTeam: {
          enabled: true,
          council: {
            enabled: true,
            timeoutMs: 1,
            presets: { default: { alpha: { model: "test/a" } } },
          },
        },
      } as Config.Info
      let cancels = 0

      const ops = {
        cancel: () =>
          Effect.sync(() => {
            cancels += 1
          }),
        resolvePromptParts: (template: string) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: () =>
          Effect.sleep(20).pipe(Effect.as(reply({ sessionID: SessionID.descending(), parts: [] }, "late"))),
      }

      const tool = yield* init()
      const result = yield* tool.execute({ prompt: "decide" }, { ...ctx([]), extra: { promptOps: ops } })

      expect(result.metadata).toMatchObject({ completed: 0, executionMode: "parallel", maxConcurrency: "unbounded" })
      expect(result.output).toContain("status: timed_out")
      expect(cancels).toBeGreaterThan(0)
    }),
  )
})
