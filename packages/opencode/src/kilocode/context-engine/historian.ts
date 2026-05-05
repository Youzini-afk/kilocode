export type HistorianRunInput = {
  engineEnabled: boolean
  historianEnabled: boolean
  messageCount: number
}

export function shouldRun(input: HistorianRunInput) {
  return input.engineEnabled && input.historianEnabled && input.messageCount >= 100
}

export const ContextEngineHistorian = { shouldRun }
