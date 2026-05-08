import { Config } from "@/config/config"
import { makeRuntime } from "@/effect/run-service"
import { Instance } from "@/project/instance"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Todo } from "@/session/todo"
import * as Log from "@opencode-ai/core/util/log"

type Reason = "completed" | "interrupted" | "error"

const log = Log.create({ service: "agent-team-auto-continue" })
const timers = new Map<SessionID, ReturnType<typeof setTimeout>>()
const counts = new Map<SessionID, number>()
const MARK = "<agent_team_auto_continue>"

type UserMessage = MessageV2.WithParts & { info: MessageV2.User }

function enabled(cfg: Config.Info) {
  if (cfg.agentTeam?.enabled !== true) return false
  const auto = cfg.agentTeam.autoContinue
  return auto?.enabled === true || auto?.autoEnable === true
}

function primary(cfg: Config.Info, agent: string) {
  if (agent === "secretary") return cfg.agentTeam?.secretary?.enabled === true
  return agent === "team"
}

function allowed(cfg: Config.Info, todos: Todo.Info[]) {
  if (cfg.agentTeam?.enabled !== true) return false
  const auto = cfg.agentTeam.autoContinue
  if (auto?.enabled === true) return true
  if (auto?.autoEnable !== true) return false
  return todos.length >= (auto.autoEnableThreshold ?? 4)
}

function text(msg: MessageV2.WithParts | undefined) {
  return msg?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function asksQuestion(value: string | undefined) {
  if (!value) return false
  const clean = value.trim().toLowerCase()
  if (clean.endsWith("?")) return true
  return ["please confirm", "need confirmation", "should i", "do you want"].some((item) => clean.includes(item))
}

function unfinished(todos: Todo.Info[]) {
  return todos.filter((todo) => !["completed", "cancelled"].includes(todo.status))
}

function prompt(todos: Todo.Info[]) {
  const list = todos.map((todo) => `- [${todo.status}] ${todo.content} (${todo.priority})`).join("\n")
  return [
    MARK,
    "Auto-continue is enabled for Kilo Agent Team.",
    "Continue only the unfinished todo items below. Do not ask for confirmation unless you are blocked or need missing user input.",
    "",
    "Unfinished todos:",
    list,
    MARK,
  ].join("\n")
}

export namespace AgentTeamAutoContinue {
  export function isAutoPrompt(parts: Array<{ type: string; text?: string }>) {
    return parts.some((part) => part.type === "text" && part.text?.includes(MARK) === true)
  }

  export function schedule(input: { sessionID: SessionID; cfg: Config.Info; reason: Reason }) {
    if (!enabled(input.cfg)) return
    if (input.reason !== "completed") return
    if (timers.has(input.sessionID)) return

    const cooldown = input.cfg.agentTeam?.autoContinue?.cooldownMs ?? 3000
    const timer = setTimeout(() => {
      timers.delete(input.sessionID)
      run(input).catch((err) => log.warn("auto-continue failed", { sessionID: input.sessionID, err }))
    }, cooldown)
    timers.set(input.sessionID, timer)
  }

  export function cancel(sessionID: SessionID) {
    const timer = timers.get(sessionID)
    if (timer) clearTimeout(timer)
    timers.delete(sessionID)
    counts.delete(sessionID)
  }

  async function run(input: { sessionID: SessionID; cfg: Config.Info }) {
    const session = await Session.get(input.sessionID)
    await Instance.provide({
      directory: session.directory,
      fn: async () => {
        const messages = await Session.messages({ sessionID: input.sessionID, limit: 20 })
        const user = messages.findLast((msg): msg is UserMessage => msg.info.role === "user")
        if (!user || !primary(input.cfg, user.info.agent)) {
          counts.delete(input.sessionID)
          return
        }

        const auto = text(user)?.includes(MARK) === true
        if (!auto) counts.set(input.sessionID, 0)

        const count = counts.get(input.sessionID) ?? 0
        const max = input.cfg.agentTeam?.autoContinue?.maxContinuations ?? 5
        if (count >= max) return

        const assistant = messages.findLast((msg) => msg.info.role === "assistant")
        if (asksQuestion(text(assistant))) return

        const todo = makeRuntime(Todo.Service, Todo.defaultLayer)
        const remaining = unfinished(await todo.runPromise((svc) => svc.get(input.sessionID)))
        if (remaining.length === 0) {
          counts.delete(input.sessionID)
          return
        }
        if (!allowed(input.cfg, remaining)) return

        counts.set(input.sessionID, count + 1)
        const item = await import("@/session/prompt")
        const runtime = makeRuntime(item.SessionPrompt.Service, item.SessionPrompt.defaultLayer)
        await runtime.runPromise((svc) =>
          svc.prompt({
            sessionID: input.sessionID,
            agent: user.info.agent,
            model: user.info.model,
            parts: [{ type: "text", text: prompt(remaining), synthetic: true }],
          }),
        )
        await runtime.runPromise((svc) => svc.loop({ sessionID: input.sessionID }))
      },
    })
  }
}
