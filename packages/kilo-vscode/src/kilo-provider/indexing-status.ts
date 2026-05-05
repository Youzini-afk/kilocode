import type { IndexingStatus } from "../services/cli-backend/types"

export type IndexingStatusContext = {
  cached: () => unknown
  setCached: (msg: unknown) => void
  server: () => { baseUrl: string; password: string } | null
  workspace: () => string
  post: (msg: unknown) => void
}

export async function fetchAndSendIndexingStatus(ctx: IndexingStatusContext) {
  const cfg = ctx.server()
  if (!cfg) {
    const cached = ctx.cached()
    if (cached) ctx.post(cached)
    return
  }

  try {
    const dir = ctx.workspace()
    const auth = Buffer.from(`kilo:${cfg.password}`).toString("base64")
    const res = await fetch(`${cfg.baseUrl}/indexing/status`, {
      headers: {
        Authorization: `Basic ${auth}`,
        ...(dir ? { "x-kilo-directory": dir } : {}),
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const status = (await res.json()) as IndexingStatus
    const msg = { type: "indexingStatusLoaded" as const, status }
    ctx.setCached(msg)
    ctx.post(msg)
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch indexing status:", error)
  }
}
