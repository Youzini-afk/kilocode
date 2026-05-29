import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "../../src/tool/truncate"
import { ToolRegistry } from "../../src/tool/registry"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

afterEach(async () => {
  await disposeAllInstances()
})

const seed = Effect.fn("NestedTaskToolTest.seed")(function* () {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Parent" })
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* sessions.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        const id = MessageID.ascending()
        return {
          info: {
            id,
            role: "assistant",
            parentID: input.messageID ?? MessageID.ascending(),
            sessionID: input.sessionID,
            mode: input.agent ?? "general",
            agent: input.agent ?? "general",
            cost: 0,
            path: { cwd: "/tmp", root: "/tmp" },
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ref.modelID,
            providerID: ref.providerID,
            time: { created: Date.now() },
            finish: "stop",
          },
          parts: [
            {
              id: PartID.ascending(),
              messageID: id,
              sessionID: input.sessionID,
              type: "text",
              text: "done",
            },
          ],
        } satisfies MessageV2.WithParts
      }),
  }
}

describe("Kilo task nesting", () => {
  it.live("allows primary agents to delegate one level to a subagent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "explore",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)
        expect(kids[0]?.id).toBe(result.metadata.sessionId)
        expect(kids[0]?.parentID).toBe(chat.id)
        expect(seen?.sessionID).toBe(result.metadata.sessionId)
        expect(seen?.agent).toBe("explore")
      }),
    ),
  )

  it.live("keeps nested task disabled outside Agent Team even when global task permission allows it", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const tool = yield* TaskTool
          const def = yield* tool.init()
          let seen: SessionPrompt.PromptInput | undefined
          const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

          const result = yield* def.execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "explore",
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          const child = yield* sessions.get(result.metadata.sessionId)
          expect(seen?.tools?.task).toBe(false)
          expect(child.permission).toEqual(
            expect.arrayContaining([
              {
                permission: "task",
                pattern: "*",
                action: "deny",
              },
            ]),
          )
        }),
      {
        config: {
          permission: {
            task: "allow",
          },
        },
      },
    ),
  )

  it.live("allows Agent Team child delegation when max-depth budget remains", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const child = yield* sessions.create({ parentID: chat.id, title: "child" })
          const user = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: child.id,
            agent: "fixer",
            model: ref,
            time: { created: Date.now() },
          })
          const msg: MessageV2.Assistant = {
            ...assistant,
            id: MessageID.ascending(),
            parentID: user.id,
            sessionID: child.id,
            mode: "fixer",
            agent: "fixer",
          }
          yield* sessions.updateMessage(msg)
          const tool = yield* TaskTool
          const def = yield* tool.init()
          let seen: SessionPrompt.PromptInput | undefined
          const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

          const result = yield* def.execute(
            {
              description: "fix nested",
              prompt: "continue implementation",
              subagent_type: "fixer",
            },
            {
              sessionID: child.id,
              messageID: msg.id,
              agent: "fixer",
              abort: new AbortController().signal,
              extra: { promptOps },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          const grandchild = yield* sessions.get(result.metadata.sessionId)
          expect(grandchild.parentID).toBe(child.id)
          expect(result.metadata.delegationDepth).toBe(2)
          expect(result.metadata.delegationMaxDepth).toBe(3)
          expect(seen?.tools?.task).toBeUndefined()
          expect(grandchild.permission).not.toEqual(
            expect.arrayContaining([
              {
                permission: "task",
                pattern: "*",
                action: "deny",
              },
            ]),
          )
        }),
      {
        config: {
          agentTeam: { enabled: true, subtask: { maxDepth: 3 } },
        },
      },
    ),
  )

  it.live("blocks Agent Team delegation beyond max-depth", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const child = yield* sessions.create({ parentID: chat.id, title: "child" })
          const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })
          const user = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: grandchild.id,
            agent: "fixer",
            model: ref,
            time: { created: Date.now() },
          })
          const msg: MessageV2.Assistant = {
            ...assistant,
            id: MessageID.ascending(),
            parentID: user.id,
            sessionID: grandchild.id,
            mode: "fixer",
            agent: "fixer",
          }
          yield* sessions.updateMessage(msg)
          const tool = yield* TaskTool
          const def = yield* tool.init()
          const promptOps = stubOps()

          const exit = yield* def
            .execute(
              {
                description: "fix nested",
                prompt: "continue implementation",
                subagent_type: "fixer",
              },
              {
                sessionID: grandchild.id,
                messageID: msg.id,
                agent: "fixer",
                abort: new AbortController().signal,
                extra: { promptOps },
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )
            .pipe(Effect.exit)

          expect(exit._tag).toBe("Failure")
          if (exit._tag === "Failure") expect(Cause.pretty(exit.cause)).toContain("current depth 2; maxDepth is 2")
        }),
      {
        config: {
          agentTeam: { enabled: true, subtask: { maxDepth: 2 } },
        },
      },
    ),
  )
})
