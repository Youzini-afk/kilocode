import { describe, expect } from "bun:test"
import { Effect, Layer, Result, Schema } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { emptyConsoleState } from "@/config/console-state"
import { AutoContinueTool, Params } from "@/kilocode/tool/auto-continue"
import { MessageID, SessionID } from "@/session/schema"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

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
    defaultAgent: () => Effect.succeed("team"),
    generate: () => Effect.succeed({ identifier: "generated", whenToUse: "never", systemPrompt: "test" }),
  }),
)

const updates: Config.Info[] = []
let current: Config.Info = {}

const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    get: () => Effect.succeed(current),
    getGlobal: () => Effect.succeed({}),
    getConsoleState: () => Effect.succeed(emptyConsoleState),
    update: (cfg) =>
      Effect.sync(() => {
        updates.push(cfg)
        current = {
          ...current,
          agentTeam: {
            ...current.agentTeam,
            ...cfg.agentTeam,
            autoContinue: { ...current.agentTeam?.autoContinue, ...cfg.agentTeam?.autoContinue },
          },
        }
      }),
    updateGlobal: (cfg) => Effect.succeed({ info: cfg, changed: false }),
    invalidate: () => Effect.void,
    directories: () => Effect.succeed([]),
    waitForDependencies: () => Effect.void,
    warnings: () => Effect.succeed([]),
  }),
)

const it = testEffect(Layer.mergeAll(Truncate.defaultLayer, agent, config))
const accepts = (input: unknown) => Result.isSuccess(Schema.decodeUnknownResult(Params)(input))

const ctx = {
  sessionID: SessionID.descending(),
  messageID: MessageID.ascending(),
  agent: "team",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
} satisfies Tool.Context

const asked: unknown[] = []
const guarded = {
  ...ctx,
  ask: (req) =>
    Effect.sync(() => {
      asked.push(req)
    }),
} satisfies Tool.Context

const init = Effect.fn("AutoContinueToolTest.init")(function* () {
  const info = yield* AutoContinueTool
  return yield* Tool.init(info)
})

describe("AutoContinueTool", () => {
  it.live("validates tool actions", () =>
    Effect.sync(() => {
      expect(accepts({ action: "enable" })).toBe(true)
      expect(accepts({ action: "disable" })).toBe(true)
      expect(accepts({ action: "status" })).toBe(true)
      expect(accepts({ action: "toggle" })).toBe(true)
      expect(accepts({ action: "start" })).toBe(false)
    }),
  )

  it.live("reports status without updating config", () =>
    Effect.gen(function* () {
      current = { agentTeam: { enabled: true, autoContinue: { enabled: true, maxContinuations: 8, cooldownMs: 123 } } }
      updates.length = 0

      const tool = yield* init()
      const result = yield* tool.execute({ action: "status" }, ctx)

      expect(result.output).toContain("enabled: true")
      expect(result.output).toContain("maxContinuations: 8")
      expect(result.output).toContain("cooldownMs: 123")
      expect(result.metadata.enabled).toBe(true)
      expect(updates).toHaveLength(0)
    }),
  )

  it.live("enables and disables project auto-continue", () =>
    Effect.gen(function* () {
      current = {
        agentTeam: { enabled: true, roles: { fixer: { enabled: true } }, autoContinue: { maxContinuations: 7 } },
      } as Config.Info
      updates.length = 0
      asked.length = 0

      const tool = yield* init()
      const enabled = yield* tool.execute({ action: "enable" }, guarded)
      const disabled = yield* tool.execute({ action: "disable" }, guarded)

      expect(enabled.metadata.enabled).toBe(true)
      expect(disabled.metadata.enabled).toBe(false)
      expect(updates).toEqual([
        { agentTeam: { autoContinue: { enabled: true } } },
        { agentTeam: { autoContinue: { enabled: false } } },
      ])
      expect(asked).toHaveLength(2)
      expect(asked[0]).toMatchObject({ permission: "auto_continue", patterns: ["*"], metadata: { action: "enable" } })
      expect(current.agentTeam?.roles?.fixer?.enabled).toBe(true)
      expect(current.agentTeam?.autoContinue?.maxContinuations).toBe(7)
    }),
  )

  it.live("does not enable Agent Team when auto-continue is toggled while disabled", () =>
    Effect.gen(function* () {
      current = { agentTeam: { enabled: false, autoContinue: { enabled: false } } }
      updates.length = 0
      asked.length = 0

      const tool = yield* init()
      const result = yield* tool.execute({ action: "toggle" }, guarded)

      expect(result.title).toBe("Auto-continue unavailable")
      expect(result.metadata.agentTeamEnabled).toBe(false)
      expect(updates).toHaveLength(0)
      expect(asked).toHaveLength(0)
    }),
  )

  it.live("does not update config when Agent Team config is absent", () =>
    Effect.gen(function* () {
      current = {}
      updates.length = 0
      asked.length = 0

      const tool = yield* init()
      const result = yield* tool.execute({ action: "enable" }, guarded)

      expect(result.title).toBe("Auto-continue unavailable")
      expect(result.metadata.agentTeamEnabled).toBe(false)
      expect(updates).toHaveLength(0)
      expect(asked).toHaveLength(0)
    }),
  )

  it.live("rejects specialist agents", () =>
    Effect.gen(function* () {
      current = { agentTeam: { enabled: true } }
      updates.length = 0

      const tool = yield* init()
      const result = yield* tool.execute({ action: "status" }, { ...ctx, agent: "fixer" }).pipe(Effect.exit)

      expect(result._tag).toBe("Failure")
      expect(updates).toHaveLength(0)
    }),
  )
})
