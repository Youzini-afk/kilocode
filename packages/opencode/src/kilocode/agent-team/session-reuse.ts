import type { Config } from "@/config/config"
import type { MessageV2 } from "@/session/message-v2"

type Entry = {
  alias: string
  taskID: string
  agent: string
  label: string
  created: number
  used: number
}

type Resolved = {
  taskID?: string
  entry?: Entry
}

const state = new Map<string, Map<string, Entry[]>>()
const counters = new Map<string, Map<string, number>>()
const clock = { value: 0 }

const prefix: Record<string, string> = {
  architect: "arc",
  planner: "pln",
  explore: "exp",
  librarian: "lib",
  oracle: "ora",
  designer: "des",
  fixer: "fix",
  observer: "obs",
  council: "cnc",
  councillor: "clr",
}

const START = "<resumable_sessions>"
const END = "</resumable_sessions>"

function primary(caller: string) {
  return caller === "team" || caller === "secretary"
}

function active(cfg: Config.Info, caller = "team") {
  if (!primary(caller)) return false
  if (cfg.agentTeam?.enabled !== true) return false
  return cfg.agentTeam.sessionReuse?.enabled !== false
}

function max(cfg: Config.Info) {
  return cfg.agentTeam?.sessionReuse?.maxSessionsPerAgent ?? 2
}

function clean(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

function time() {
  clock.value += 1
  return clock.value
}

function label(input: { description?: string; prompt?: string; agent: string }) {
  const description = clean(input.description)
  if (description) return description.slice(0, 48)
  const prompt = (input.prompt ?? "").split(/\r?\n/).map(clean).find(Boolean)
  return (prompt ?? `recent ${input.agent} task`).slice(0, 48)
}

function maps(parent: string, create: boolean) {
  const existing = state.get(parent)
  if (existing || !create) return existing
  const next = new Map<string, Entry[]>()
  state.set(parent, next)
  return next
}

function group(parent: string, agent: string, create: boolean) {
  const map = maps(parent, create)
  if (!map) return undefined
  const existing = map.get(agent)
  if (existing || !create) return existing
  const next: Entry[] = []
  map.set(agent, next)
  return next
}

function counts(parent: string) {
  const existing = counters.get(parent)
  if (existing) return existing
  const next = new Map<string, number>()
  counters.set(parent, next)
  return next
}

function alias(parent: string, agent: string) {
  const map = counts(parent)
  const next = (map.get(agent) ?? 0) + 1
  map.set(agent, next)
  return `${prefix[agent] ?? agent.slice(0, 3)}-${next}`
}

function trim(parent: string, agent: string, limit: number) {
  const entries = group(parent, agent, false)
  if (!entries) return
  const next = entries.toSorted((a, b) => b.used - a.used).slice(0, limit)
  const map = maps(parent, false)
  if (!map) return
  if (next.length > 0) {
    map.set(agent, next)
    return
  }
  map.delete(agent)
  if (map.size === 0) state.delete(parent)
}

function line(agent: string, entries: Entry[]) {
  return `- ${agent}: ${entries
    .toSorted((a, b) => b.used - a.used)
    .map((entry) => `${entry.alias} ${entry.label} [${entry.taskID}]`)
    .join("; ")}`
}

export namespace AgentTeamSessionReuse {
  export function resolve(input: {
    cfg: Config.Info
    caller: string
    parent: string
    agent: string
    taskID?: string
  }): Resolved {
    const taskID = clean(input.taskID)
    if (!taskID) return {}
    if (!active(input.cfg, input.caller)) return { taskID }
    const match = group(input.parent, input.agent, false)?.find(
      (entry) => entry.alias === taskID || entry.taskID === taskID,
    )
    if (!match) return { taskID }
    match.used = time()
    return { taskID: match.taskID, entry: match }
  }

  export function remember(input: {
    cfg: Config.Info
    caller: string
    parent: string
    agent: string
    taskID: string
    description?: string
    prompt?: string
  }) {
    if (!active(input.cfg, input.caller)) return undefined
    const entries = group(input.parent, input.agent, true)
    if (!entries) return undefined
    const existing = entries.find((entry) => entry.taskID === input.taskID)
    if (existing) {
      existing.label = label(input)
      existing.used = time()
      trim(input.parent, input.agent, max(input.cfg))
      return existing
    }
    const now = time()
    const entry: Entry = {
      alias: alias(input.parent, input.agent),
      taskID: input.taskID,
      agent: input.agent,
      label: label(input),
      created: now,
      used: now,
    }
    entries.push(entry)
    trim(input.parent, input.agent, max(input.cfg))
    return entry
  }

  export function drop(input: { parent: string; agent: string; taskID: string }) {
    const entries = group(input.parent, input.agent, false)
    if (!entries) return
    const next = entries.filter((entry) => entry.taskID !== input.taskID && entry.alias !== input.taskID)
    const map = maps(input.parent, false)
    if (!map) return
    if (next.length > 0) {
      map.set(input.agent, next)
      return
    }
    map.delete(input.agent)
    if (map.size === 0) state.delete(input.parent)
  }

  export function clear(sessionID: string) {
    state.delete(sessionID)
    counters.delete(sessionID)
    for (const [parent, map] of state.entries()) {
      for (const [agent, entries] of map.entries()) {
        const next = entries.filter((entry) => entry.taskID !== sessionID)
        if (next.length > 0) {
          map.set(agent, next)
          continue
        }
        map.delete(agent)
      }
      if (map.size === 0) state.delete(parent)
    }
  }

  export function format(input: { cfg: Config.Info; caller: string; parent: string }) {
    if (!active(input.cfg, input.caller)) return undefined
    const map = maps(input.parent, false)
    if (!map) return undefined
    const lines = [...map.entries()]
      .filter(([, entries]) => entries.length > 0)
      .toSorted((a, b) => Math.max(...b[1].map((entry) => entry.used)) - Math.max(...a[1].map((entry) => entry.used)))
      .map(([agent, entries]) => line(agent, entries))
    if (lines.length === 0) return undefined
    return [
      "### Resumable specialist sessions",
      "Use these aliases as task_id only when continuing the same specialist thread.",
      "Prefer the newest matching alias. Start fresh for unrelated work or when old context may confuse the agent.",
      "Each alias shows the raw child session id in brackets for diagnostics; use the short alias in normal task calls.",
      "",
      ...lines,
    ].join("\n")
  }

  export function inject(input: { cfg: Config.Info; messages: MessageV2.WithParts[] }) {
    const message = input.messages.findLast((item) => item.info.role === "user" && primary(item.info.agent))
    if (!message) return
    if (!active(input.cfg, message.info.agent)) return
    const reminder = format({ cfg: input.cfg, caller: message.info.agent, parent: message.info.sessionID })
    if (!reminder) return
    const part = message.parts.find((item): item is MessageV2.TextPart => item.type === "text")
    if (!part) return
    if (part.text.includes(START)) return
    part.text = [part.text, "", START, reminder, END].join("\n")
  }
}
