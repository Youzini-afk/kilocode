import { Config } from "@/config/config"
import { EffectBridge } from "@/effect/bridge"
import { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionPrompt } from "@/session/prompt"
import { Provider } from "@/provider/provider"
import * as Tool from "@/tool/tool"
import { Cause, Effect, Exit, Schema } from "effect"

type PromptOps = {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

type Member = {
  model: string
  variant?: string | null
  prompt?: string
}

type Result = {
  name: string
  model: string
  status: "completed" | "failed" | "timed_out"
  text?: string
  error?: string
}

class TimeoutError extends Error {}

function timed(cause: Cause.Cause<unknown>) {
  return cause.reasons.some((reason) => Cause.isFailReason(reason) && reason.error instanceof TimeoutError)
}

const id = "council_session"

const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({ description: "The prompt to send to all councillors" }),
  preset: Schema.optional(Schema.String).annotate({
    description: "Optional council preset name from agentTeam.council.presets",
  }),
})

function presets(cfg: Config.Info) {
  return cfg.agentTeam?.council?.presets as Record<string, Record<string, Member>> | undefined
}

function fallback(cfg: Config.Info): Record<string, Member> | undefined {
  const model = cfg.agentTeam?.roles?.councillor?.model ?? cfg.model
  if (!model) return undefined
  return { default: { model } }
}

function members(cfg: Config.Info, name: string) {
  return presets(cfg)?.[name] ?? fallback(cfg)
}

function text(msg: MessageV2.WithParts) {
  return msg.parts.findLast((part) => part.type === "text")?.text ?? ""
}

function prompt(input: { name: string; base: string; extra?: string }) {
  return [
    `You are councillor ${input.name}, an independent technical reviewer in a Kilo Council session.`,
    "Provide your own analysis. Do not coordinate with other councillors. Be concise, concrete, and state uncertainty.",
    input.extra ? `\nAdditional councillor instruction:\n${input.extra}` : undefined,
    "",
    "Council prompt:",
    input.base,
  ]
    .filter((item) => item !== undefined)
    .join("\n")
}

function format(results: Result[], preset: string, council: string) {
  const completed = results.filter((item) => item.status === "completed").length
  return [
    `<council_results preset="${preset}" completed="${completed}" total="${results.length}">`,
    "",
    "Original prompt:",
    council,
    "",
    ...results.map((item) =>
      [
        `## ${item.name}`,
        `model: ${item.model}`,
        `status: ${item.status}`,
        item.status === "completed" ? `<response>\n${item.text ?? ""}\n</response>` : `error: ${item.error}`,
      ].join("\n"),
    ),
    "",
    "</council_results>",
    "",
    "Synthesize these independent councillor responses into a final recommendation. Call out disagreements and confidence.",
  ].join("\n")
}

export const CouncilTool = Tool.define(
  id,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("CouncilTool.run")(function* (
      input: {
        name: string
        member: Member
        params: Schema.Schema.Type<typeof Parameters>
        timeout: number
        retries: number
      },
      ctx: Tool.Context,
      ops: PromptOps,
    ) {
      const child = yield* sessions.create({
        parentID: ctx.sessionID,
        title: `Council ${input.name}`,
        permission: [{ permission: "task", pattern: "*", action: "deny" }],
      })
      const model = Provider.parseModel(input.member.model)
      const variant = input.member.variant ?? undefined
      const bridge = yield* EffectBridge.make()
      const cancelEffect = ops.cancel(child.id).pipe(Effect.ignore)

      function onAbort() {
        bridge.fork(cancelEffect)
      }

      return yield* Effect.acquireUseRelease(
        Effect.gen(function* () {
          ctx.abort.addEventListener("abort", onAbort)
          if (ctx.abort.aborted) yield* cancelEffect
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(
              prompt({ name: input.name, base: input.params.prompt, extra: input.member.prompt }),
            )
            const runAttempt = (attempt: number): Effect.Effect<{ result: MessageV2.WithParts; attempts: number }, Error> =>
              ops
                .prompt({
                  messageID: MessageID.ascending(),
                  sessionID: child.id,
                  model,
                  variant,
                  agent: "councillor",
                  tools: { task: false },
                  parts,
                })
                .pipe(
                  Effect.timeoutOrElse({
                    duration: input.timeout,
                    orElse: () =>
                      Effect.gen(function* () {
                        yield* cancelEffect
                        return yield* Effect.fail(new TimeoutError("Council councillor timed out"))
                      }),
                  }),
                  Effect.flatMap((result) => {
                    if (text(result).trim() !== "" || attempt > input.retries) {
                      return Effect.succeed({ result, attempts: attempt })
                    }
                    return runAttempt(attempt + 1)
                  }),
                )
            const attempt = yield* runAttempt(1)
            return {
              name: input.name,
              model: input.member.model,
              status: "completed" as const,
              text: text(attempt.result),
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.succeed({
                name: input.name,
                model: input.member.model,
                status: timed(cause) ? ("timed_out" as const) : ("failed" as const),
                error: Cause.pretty(cause),
              }),
            ),
          ),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancelEffect
          }).pipe(Effect.ensuring(Effect.sync(() => ctx.abort.removeEventListener("abort", onAbort)))),
      )
    })

    return {
      description:
        "Launch a Kilo Council session. Sends one prompt to configured councillor models and returns independent responses for synthesis.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          if (ctx.agent !== "council") {
            return yield* Effect.fail(new Error(`Council sessions can only be invoked by the council agent`))
          }
          if (cfg.agentTeam?.enabled !== true || cfg.agentTeam.council?.enabled !== true) {
            return yield* Effect.fail(new Error("Agent Team Council is not enabled"))
          }
          const ops = ctx.extra?.promptOps as PromptOps | undefined
          if (!ops) return yield* Effect.fail(new Error("council_session requires promptOps in ctx.extra"))

          const preset = params.preset ?? cfg.agentTeam.council.defaultPreset ?? "default"
          const selected = members(cfg, preset)
          if (!selected || Object.keys(selected).length === 0) {
            return yield* Effect.fail(
              new Error(`Council preset "${preset}" is not configured and no fallback model is available`),
            )
          }

          const entries = Object.entries(selected)
          const mode = cfg.agentTeam.council.executionMode ?? "parallel"
          const retries = cfg.agentTeam.council.councillorRetries ?? 0
          const concurrency = mode === "serial" ? 1 : (cfg.agentTeam.council.maxConcurrency ?? "unbounded")
          yield* ctx.metadata({
            title: "Council",
            metadata: { preset, total: entries.length, executionMode: mode, maxConcurrency: concurrency, retries },
          })
          const timeout = cfg.agentTeam.council.timeoutMs ?? 180000
          const results = yield* Effect.forEach(
            entries,
            ([name, member]) => run({ name, member, params, timeout, retries }, ctx, ops),
            { concurrency },
          )
          const completed = results.filter((item) => item.status === "completed").length

          return {
            title: "Council",
            metadata: { preset, total: results.length, completed, executionMode: mode, maxConcurrency: concurrency, retries },
            output: format(results, preset, params.prompt),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
