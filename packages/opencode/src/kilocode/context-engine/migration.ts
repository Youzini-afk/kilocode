import { isRecord } from "@/util/record"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { ContextEngineConfig } from "./config"

export function fromLegacyConfig(value: unknown): ContextEngineConfig.Info {
  const input = isRecord(value) ? value : {}
  const memory = isRecord(input.memory) ? input.memory : {}
  const embed = isRecord(input.embedding) ? input.embedding : memory.embedding
  return ContextEngineConfig.normalize({
    enabled: input.enabled,
    mode: input.mode,
    historian: input.historian,
    dreamer: input.dreamer,
    sidekick: input.sidekick,
    memory: { ...memory, embedding: embed },
  })
}

export async function fromLegacyFile(file: string): Promise<ContextEngineConfig.Info | undefined> {
  const source = Bun.file(file)
  if (!(await source.exists())) return
  const text = await source.text()
  const errors: ParseError[] = []
  const data = parseJsonc(text.trim() || "{}", errors, { allowTrailingComma: true })
  if (errors.length) return
  return fromLegacyConfig(data)
}

export const ContextEngineMigration = { fromLegacyConfig, fromLegacyFile }
