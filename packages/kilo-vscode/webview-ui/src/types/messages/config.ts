import type { PermissionConfig } from "./permissions"
import type { AgentConfig } from "./agents"
import type { ProviderConfig } from "./providers"

type SdkIndexingStatus = import("@kilocode/sdk/v2/client").IndexingStatus

export interface McpConfig {
  type?: "local" | "remote"
  command?: string[] | string
  args?: string[]
  env?: Record<string, string>
  environment?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

export interface CommandConfig {
  template: string
  description?: string
  agent?: string
  model?: string
}

export interface SkillsConfig {
  paths?: string[]
  urls?: string[]
}

export interface CompactionConfig {
  auto?: boolean
  prune?: boolean
}

export interface WatcherConfig {
  ignore?: string[]
}

export interface ExperimentalConfig {
  disable_paste_summary?: boolean
  batch_tool?: boolean
  semantic_indexing?: boolean
  codebase_search?: boolean
  agent_manager_tool?: boolean
  primary_tools?: string[]
  continue_loop_on_deny?: boolean
  mcp_timeout?: number
}

export interface CommitMessageConfig {
  prompt?: string
}

export type IndexingProvider =
  | "kilo"
  | "openai"
  | "ollama"
  | "openai-compatible"
  | "gemini"
  | "mistral"
  | "vercel-ai-gateway"
  | "bedrock"
  | "openrouter"
  | "voyage"

export interface IndexingConfig {
  enabled?: boolean
  provider?: IndexingProvider
  model?: string
  dimension?: number
  vectorStore?: "lancedb" | "qdrant"
  kilo?: { apiKey?: string; baseUrl?: string; organizationId?: string }
  openai?: { apiKey?: string }
  ollama?: { baseUrl?: string }
  "openai-compatible"?: { baseUrl?: string; apiKey?: string }
  gemini?: { apiKey?: string }
  mistral?: { apiKey?: string }
  "vercel-ai-gateway"?: { apiKey?: string }
  bedrock?: { region?: string; profile?: string }
  openrouter?: { apiKey?: string; specificProvider?: string }
  voyage?: { apiKey?: string }
  qdrant?: { url?: string; apiKey?: string }
  lancedb?: { directory?: string }
  searchMinScore?: number
  searchMaxResults?: number
  embeddingBatchSize?: number
  scannerMaxBatchRetries?: number
}

export type KiloEmbeddingModel = {
  id: string
  name: string
  dimension: number
  scoreThreshold: number
  note?: string
}

export type KiloEmbeddingModelCatalog = {
  defaultModel: string
  models: KiloEmbeddingModel[]
  aliases: Record<string, string>
}

export type IndexingStatus = SdkIndexingStatus

export type ContextEngineMode = "recommended" | "light" | "advanced"
export type ContextEngineEmbeddingProvider = "local" | "openai-compatible" | "off"
export type ContextEngineThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
export type ContextEngineDreamTask = "consolidate" | "verify" | "archive-stale" | "improve" | "maintain-docs"

export interface ContextEngineAgentConfig {
  enabled?: boolean
  model?: string
  fallbackModels?: string[]
  fallback_models?: string[] | string
  variant?: string
  thinkingLevel?: string
  thinking_level?: ContextEngineThinkingLevel
  twoPass?: boolean
  two_pass?: boolean
  disable?: boolean
  timeout_ms?: number
  system_prompt?: string
}

export interface ContextEngineDreamerConfig extends ContextEngineAgentConfig {
  enabled?: boolean
  schedule?: string
  max_runtime_minutes?: number
  tasks?: ContextEngineDreamTask[]
  task_timeout_minutes?: number
  inject_docs?: boolean
  user_memories?: {
    enabled?: boolean
    promotion_threshold?: number
  }
  pin_key_files?: {
    enabled?: boolean
    token_budget?: number
    min_reads?: number
  }
}

export interface ContextEngineSidekickConfig extends ContextEngineAgentConfig {
  enabled?: boolean
  timeout_ms?: number
}

export interface ContextEngineEmbeddingConfig {
  provider?: ContextEngineEmbeddingProvider
  model?: string
  endpoint?: string
  api_key?: string
  apiKey?: string
}

export interface ContextEngineMemoryConfig {
  enabled?: boolean
  injection_budget_tokens?: number
  injectionBudgetTokens?: number
  auto_promote?: boolean
  autoPromote?: boolean
  retrieval_count_promotion_threshold?: number
  retrievalCountPromotionThreshold?: number
  embedding?: ContextEngineEmbeddingConfig
}

export interface ContextEngineConfig {
  $schema?: string
  enabled?: boolean
  auto_update?: boolean
  ctx_reduce_enabled?: boolean
  mode?: ContextEngineMode
  historian?: ContextEngineAgentConfig
  dreamer?: ContextEngineDreamerConfig
  sidekick?: ContextEngineSidekickConfig
  cache_ttl?: string | { default: string; [model: string]: string }
  nudge_interval_tokens?: number
  execute_threshold_percentage?: number | { default: number; [model: string]: number }
  execute_threshold_tokens?: { default?: number; [model: string]: number | undefined }
  model_context_limits?: { default?: number; [model: string]: number | undefined }
  protected_tags?: number
  auto_drop_tool_age?: number
  drop_tool_structure?: boolean
  clear_reasoning_age?: number
  iteration_nudge_threshold?: number
  history_budget_percentage?: number
  historian_timeout_ms?: number
  commit_cluster_trigger?: {
    enabled?: boolean
    min_clusters?: number
  }
  compaction_markers?: boolean
  compressor?: {
    enabled?: boolean
    min_compartment_ratio?: number
    max_merge_depth?: number
    cooldown_ms?: number
    max_compartments_per_pass?: number
    grace_compartments?: number
  }
  experimental?: {
    temporal_awareness?: boolean
    git_commit_indexing?: {
      enabled?: boolean
      since_days?: number
      max_commits?: number
    }
    auto_search?: {
      enabled?: boolean
      score_threshold?: number
      min_prompt_chars?: number
    }
    caveman_text_compression?: {
      enabled?: boolean
      min_chars?: number
    }
  }
  embedding?: ContextEngineEmbeddingConfig
  memory?: ContextEngineMemoryConfig
  disabled_hooks?: string[]
  command?: Record<string, unknown>
  configWarnings?: string[]
}

export interface ContextEngineModelOption {
  value: string
  label: string
  provider: string
  model: string
}

export interface ContextEngineSettingsPayload {
  target?: {
    scope?: string
    path?: string
    exists?: boolean
    format?: string
    mtimeMs?: number | null
  }
  project?: {
    path?: string | null
    exists?: boolean
    overriddenKeys?: string[]
  }
  schemaUrl?: string
  raw?: ContextEngineConfig
  projectRaw?: ContextEngineConfig
  effective?: ContextEngineConfig
}

export interface ContextEngineDoctorResult {
  ok?: boolean
  enabled?: boolean
  storageDir?: string
  warnings?: string[]
  checks?: Array<{ name: string; status: string }>
}

export type AgentTeamRole =
  | "secretary"
  | "orchestrator"
  | "team"
  | "architect"
  | "planner"
  | "explorer"
  | "librarian"
  | "oracle"
  | "designer"
  | "fixer"
  | "observer"
  | "council"
  | "councillor"

export interface AgentTeamRoleConfig {
  enabled?: boolean
  model?: string | null
  fallbackModels?: string[]
  variant?: string | null
  temperature?: number | null
  skills?: string[]
  mcps?: string[]
  options?: Record<string, unknown>
  displayName?: string | null
}

export interface AgentTeamSessionReuseConfig {
  enabled?: boolean
  maxSessionsPerAgent?: number
}

export interface AgentTeamCouncilConfig {
  enabled?: boolean
  defaultPreset?: string
  timeoutMs?: number
}

export interface AgentTeamAutoContinueConfig {
  enabled?: boolean
  autoEnable?: boolean
  autoEnableThreshold?: number
  maxContinuations?: number
  cooldownMs?: number
}

export interface AgentTeamConfig {
  enabled?: boolean
  takeoverDefault?: boolean
  roles?: Partial<Record<AgentTeamRole, AgentTeamRoleConfig>>
  sessionReuse?: AgentTeamSessionReuseConfig
  council?: AgentTeamCouncilConfig
  autoContinue?: AgentTeamAutoContinueConfig
}

export interface BrowserSettings {
  enabled: boolean
  useSystemChrome: boolean
  headless: boolean
}

export type TerminalCommandDisplay = "expanded" | "collapsed"

export interface Config {
  permission?: PermissionConfig
  model?: string | null
  small_model?: string | null
  default_agent?: string | null
  agent?: Record<string, AgentConfig>
  provider?: Record<string, ProviderConfig>
  disabled_providers?: string[]
  enabled_providers?: string[]
  mcp?: Record<string, McpConfig>
  command?: Record<string, CommandConfig>
  instructions?: string[]
  skills?: SkillsConfig
  snapshot?: boolean
  remote_control?: boolean
  terminal_command_display?: TerminalCommandDisplay
  share?: "manual" | "auto" | "disabled"
  username?: string
  watcher?: WatcherConfig
  formatter?: false | Record<string, unknown>
  lsp?: false | Record<string, unknown>
  compaction?: CompactionConfig
  commit_message?: CommitMessageConfig
  tools?: Record<string, boolean>
  layout?: "auto" | "stretch"
  auto_collapse_reasoning?: boolean
  experimental?: ExperimentalConfig
  indexing?: IndexingConfig
  contextEngine?: ContextEngineConfig
  agentTeam?: AgentTeamConfig
  plugin?: Array<string | [string, Record<string, unknown>]>
}

export interface FeatureFlags {
  indexing: boolean
}
