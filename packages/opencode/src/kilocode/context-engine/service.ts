import { ContextEngineConfig } from "./config"

export type ContextEngineStatus = {
  enabled: boolean
  historian: "stopped" | "ready"
  memory: "stopped" | "ready"
}

export function create(input: unknown) {
  const cfg = ContextEngineConfig.normalize(input)
  const state = { started: false }
  return {
    async start() {
      state.started = true
    },
    async stop() {
      state.started = false
    },
    status(): ContextEngineStatus {
      if (!state.started || !cfg.enabled) return { enabled: false, historian: "stopped", memory: "stopped" }
      return { enabled: true, historian: "ready", memory: "ready" }
    },
  }
}

export const ContextEngineService = { create }
