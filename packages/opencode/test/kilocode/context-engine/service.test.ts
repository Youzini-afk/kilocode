import { describe, expect, test } from "bun:test"
import { ContextEngineService } from "../../../src/kilocode/context-engine/service"

describe("ContextEngineService", () => {
  test("reports disabled status", async () => {
    const service = ContextEngineService.create({ enabled: false })

    await service.start()
    expect(service.status()).toEqual({ enabled: false, historian: "stopped", memory: "stopped" })
  })

  test("reports enabled status", async () => {
    const service = ContextEngineService.create({ enabled: true })

    await service.start()
    expect(service.status()).toEqual({ enabled: true, historian: "ready", memory: "ready" })
  })

  test("reports stopped status before and after lifecycle", async () => {
    const service = ContextEngineService.create({ enabled: true })

    expect(service.status()).toEqual({ enabled: false, historian: "stopped", memory: "stopped" })
    await service.start()
    await service.stop()
    expect(service.status()).toEqual({ enabled: false, historian: "stopped", memory: "stopped" })
  })
})
