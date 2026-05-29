import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { KiloTask } from "../kilocode/tool/task" // kilocode_change
import { KiloCostPropagation } from "../kilocode/session/cost-propagation" // kilocode_change
import { AgentTeamSessionReuse } from "@/kilocode/agent-team/session-reuse" // kilocode_change
import { AgentTeamRuntime } from "@/kilocode/agent-team/runtime" // kilocode_change
import { KiloSessionProcessor } from "../kilocode/session/processor" // kilocode_change
import { errorMessage } from "@/util/error" // kilocode_change
import { Cause, Effect, Exit, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const parent = yield* sessions.get(ctx.sessionID)
      // kilocode_change start — inherit edit/bash/MCP restrictions from calling agent
      const caller = yield* agent.get(ctx.agent)
      const handoff = KiloTask.handoff({ cfg, caller, next, name: params.subagent_type })
      KiloTask.validateRoute({ cfg, caller, next, name: params.subagent_type, handoff })
      KiloTask.validateCaller({ caller, session: parent })
      const rules = KiloTask.inherited({ caller, session: parent, mcp: cfg.mcp, handoff })
      // kilocode_change end

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const canTask = handoff && next.permission.some((rule) => rule.permission === id) // kilocode_change
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const reuse = AgentTeamSessionReuse.resolve({
        cfg,
        caller: ctx.agent,
        parent: ctx.sessionID,
        agent: params.subagent_type,
        taskID: params.task_id,
      }) // kilocode_change
      const taskID = reuse.taskID
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(
            Effect.catchCause(() =>
              Effect.sync(() => {
                if (reuse.entry) {
                  AgentTeamSessionReuse.drop({
                    parent: ctx.sessionID,
                    agent: params.subagent_type,
                    taskID: reuse.entry.taskID,
                  })
                }
                return undefined
              }),
            ),
          )
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(parent.permission ?? []).filter(
              (rule) => rule.permission === "external_directory" || rule.action === "deny",
            ),
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
            // kilocode_change start — deny task + propagate caller restrictions, except Secretary -> Orchestrator handoff
            ...(handoff ? KiloTask.marker() : []),
            ...KiloTask.permissions(rules, { task: handoff }),
            // kilocode_change end
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      // kilocode_change start — prefer valid subagent overrides, safely inheriting when overrides go stale
      const selected = yield* KiloTask.resolveModel({
        name: next.name,
        agent: next,
        config: cfg,
        parent: {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        },
      })
      const model = selected.model
      const variant = selected.variant
      const configured = next.modelChain?.map((item) => ({ model: item, variant })) ?? []
      const chain =
        configured.length > 0 &&
        configured[0]?.model.modelID === model.modelID &&
        configured[0]?.model.providerID === model.providerID
          ? configured
          : [{ model, variant }]
      // kilocode_change end

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
          variant, // kilocode_change
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))
      const runCancel = yield* EffectBridge.make()

      const messageID = MessageID.ascending()
      const cancel = ops.cancel(nextSession.id)
      const timeout = KiloTask.subtaskTimeout(cfg) // kilocode_change

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        // kilocode_change start - snapshot child cost so we propagate only the delta on resume (#6321)
        Effect.gen(function* () {
          ctx.abort.addEventListener("abort", onAbort)
          return yield* KiloCostPropagation.childCost(sessions, nextSession.id)
        }),
        // kilocode_change end
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            KiloSessionProcessor.markReviewTelemetry(parts, params.command) // kilocode_change - carry review command into child session telemetry
            // kilocode_change start - retry delegated Agent Team roles through configured fallback models
            const runChain = (
              items: typeof chain,
            ): Effect.Effect<{ result: MessageV2.WithParts; pick: (typeof chain)[number] }> => {
              const pick = items[0]
              if (!pick) return Effect.die(new Error("No task model available"))
              return ops
                .prompt({
                  messageID,
                  sessionID: nextSession.id,
                  model: {
                    modelID: pick.model.modelID,
                    providerID: pick.model.providerID,
                  },
                  variant: pick.variant,
                  agent: next.name,
                  tools: {
                    ...(canTodo ? {} : { todowrite: false }),
                    ...(canTask ? {} : { task: false }),
                    ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                  },
                  parts,
                })
                .pipe(
                  Effect.map((result) => ({ result, pick })),
                  Effect.catchCause((cause) => {
                    const rest = items.slice(1)
                    if (rest.length > 0) return runChain(rest)
                    return Effect.failCause(cause)
                  }),
                )
            }
            const active: Effect.Effect<{ result: MessageV2.WithParts; pick: (typeof chain)[number] }, Error> =
              timeout > 0
                ? runChain(chain).pipe(
                    Effect.timeoutOrElse({
                      duration: timeout,
                      orElse: () =>
                        Effect.gen(function* () {
                          yield* cancel.pipe(Effect.ignore)
                          return yield* Effect.fail(KiloTask.timeoutError(next.name, timeout))
                        }),
                    }),
                  )
                : runChain(chain)
            const attempt = yield* active
            const result = attempt.result
            // kilocode_change end

            const entry = AgentTeamSessionReuse.remember({
              cfg,
              caller: ctx.agent,
              parent: ctx.sessionID,
              agent: params.subagent_type,
              taskID: nextSession.id,
              description: params.description,
              prompt: params.prompt,
            }) // kilocode_change

            // kilocode_change start - expose terminal child assistant errors through the task tool boundary
            if (result.info.role === "assistant" && result.info.error) {
              return yield* Effect.fail(new Error(errorMessage(result.info.error)))
            }
            // kilocode_change end

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model: attempt.pick.model, // kilocode_change
                variant: attempt.pick.variant, // kilocode_change
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                entry ? `task_alias: ${entry.alias} (short alias for the same task_id)` : undefined,
                "",
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
              ]
                .filter((item) => item !== undefined)
                .join("\n"),
            }
          }),
        // kilocode_change start - propagate subagent cost delta to parent on every exit path (#6321)
        (costBefore, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancel
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                ctx.abort.removeEventListener("abort", onAbort)
                const costAfter = yield* KiloCostPropagation.childCost(sessions, nextSession.id)
                yield* KiloCostPropagation.propagate(sessions, ctx.sessionID, ctx.messageID, costAfter - costBefore)
              }),
            ),
          ),
        // kilocode_change end
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        // kilocode_change start - return retry guidance for failed Agent Team delegation
        Effect.gen(function* () {
          const cfg = yield* config.get()
          return yield* run(params, ctx).pipe(
            Effect.catchCause((cause) => {
              const result = AgentTeamRuntime.taskFailure({
                cfg,
                caller: ctx.agent,
                sessionID: ctx.sessionID,
                params,
                cause: Cause.pretty(cause),
              })
              if (result) return Effect.succeed(result)
              return Effect.failCause(cause)
            }),
          )
        }).pipe(Effect.orDie),
      // kilocode_change end
    }
  }),
)
