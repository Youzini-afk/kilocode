# Magic Context 与 Agent Team 全面升级优化规划

## 背景

Kilo 内置的两套能力来自两个上游开源项目的二次开发：

- **Magic Context**（上下文管理）— 源自 `cortexkit/magic-context`
- **Agent Team**（内置 agent 编排）— 源自 `oh-my-opencode-slim`（OMO Slim）

两个上游都已经大幅迭代，本文档盘点差异、确定升级目标、并给出分阶段路线图。本文档是规划与决策记录，不含实现代码。

### 版本与规模快照

| 项目 | 上游版本 | 上游 src 文件数 | Kilo 内置 src 文件数 |
|---|---|---|---|
| Magic Context | v0.21.8 | 388 | 323 |
| OMO Slim (Agent Team) | v1.1.1 | 202 | 6（已原生化进 opencode core） |

### 两套能力的本质差异（决定升级策略）

- **Magic Context**：上游仍是同构 OpenCode 插件，Kilo 版是它的「换皮 + 适配」分支。上游领先多个版本（v0.16 → v0.21.8），积累了大量真实新能力和 bugfix。
  → 策略：**逐特性 cherry-pick**，保留 Kilo 适配层。
- **Agent Team**：OMO 是 plugin-hook 架构，Kilo 已经把它的核心能力**原生化**进 CLI runtime / task / session / config，且更安全、更集中。
  → 策略：**不迁移架构，只吸收 prompt / 策略 / 文案**，外加少量明确决策的能力增强。

---

## 必须保留的 Kilo 适配层（红线）

以下内容是 Kilo 化的根基，任何上游同步都**不得覆盖**：

- 包名与 SDK：`@kilocode/plugin`、`@kilocode/sdk`（上游是 `@opencode-ai/*` / `@cortexkit/*`）
- 配置文件名：`kilo-magic-context.jsonc`（上游是 `magic-context.jsonc`）
- 运行时数据路径：Kilo runtime data path + `setKiloRuntimeInfo`（上游改成了共享 `cortexkit/magic-context` path）
- 模型上下文限制覆盖：`setModelContextLimitOverrides` + `model_context_limits`
- Kilo settings RPC / `PluginModule` / 热 reload（上游无同等 Kilo settings 集成）
- Kilo schema 文件：`assets/kilo-magic-context.schema.json` 及 schema id
- Kilo-only 配置键：`model_context_limits`、`compaction_markers`
- Kilo 角色：`secretary`、`team`、`architect`、`planner`
- Kilo storage 默认 harness：`kilo`（上游默认 `opencode`）
- Fork 隔离规则：优先放 `packages/opencode/src/kilocode/`，必须改 shared 文件时加 `kilocode_change`

---

## Part A — Magic Context 升级

### A.1 上游领先的关键能力（Kilo 缺失）

#### 高价值 / 强依赖（需要架构决策）

1. **Per-project embedding registry**
   从全局单例 embedding 升级为按项目隔离：provider 指纹、模型切换时擦除 stale embedding、features 快照、后台 sweep。解决多项目 / 多模型 embedding 互相污染。
   - 上游：`features/magic-context/project-embedding-registry.ts`、`memory/embedding-identity.ts`、`memory/embedding.ts`（`embedTextForProject` / `getProjectEmbeddingSnapshot`）
   - 影响链路：`ctx-search` / `ctx-memory` / auto-search / dreamer 全链路 + storage 迁移
   - 依赖：project identity + storage migration

2. **Storage schema 大跃进（v10 → v21）**
   新增列 / 表：`tool_owner_message_id`、`project_key_files`(+version)、`subagent_invocations`、`session_meta.last_todo_state`、`observed_safe_input_tokens`、`cache_alert_sent`，含 race / atomic 测试。
   - 上游：`features/magic-context/storage-db.ts`、`migrations.ts`、`migrations-v10..v21.test.ts`、`migrations-race.test.ts`
   - 注意：Kilo migration 有 `finalizeQuietly` 资源释放逻辑，不能直接覆盖；默认 harness 必须保持 `kilo`

3. **Tool-owner 复合身份**
   用 `(callId, tool_owner_message_id)` 复合身份替代裸 callId，修复跨 turn callID 碰撞污染会话 tags 的真实 bug（上游 0.17 重点修复）。
   - 上游：`tool-owner-backfill.ts`、`hooks/magic-context/read-session-chunk.ts`、`tag-messages.ts`
   - 依赖：storage migration + 历史数据 backfill

4. **Synthetic todowrite 注入**
   用真实 `todowrite` tool part 替代自定义 `<current-todos>` 注入，cache 更稳、不易 cache-bust。
   - 上游：`hooks/magic-context/todo-view.ts`、`transform-postprocess-phase.ts`、`transform-todo-state.test.ts`
   - 依赖：`session_meta.last_todo_state` + 需验证 Kilo todowrite tool 的 wire shape 是否一致

5. **Key-files 注入**
   dreamer 根据 read history 识别高频关键文件，版本化存储后作为 `<key-files>` block 注入系统 prompt。
   - 上游：`features/magic-context/key-files/*`、`hooks/magic-context/key-files-block.ts`
   - 依赖：`project_key_files` 表 + project identity

#### 低风险 / 可早迁

6. **`ctx-memory` fail-closed 权限**：默认 `allowedActions` 从 dreamer 全量动作改为 `["write","delete"]`，并保持 full action schema 可见、改用 runtime 检查 `toolContext.agent`。安全 hardening。
7. **`shared/stable-json`**：纯工具函数，为 embedding fingerprint / config hash 铺路。
8. **`message-index-async`**：异步化消息索引，减少同步阻塞。
9. **`cache-busting-signals`**：cache rebuild 诊断逻辑（不写新列的部分先迁）。
10. **boundary-execution 纯判断函数**：先迁纯函数 + 测试，暂不接 deferred drain / storage 副作用。

### A.2 冲突点（需决策）

- **模型上下文限制刷新策略**（**仅 Magic Context**，与 Agent Team 无关）：指 Magic Context 插件入口刷新「模型 context window 大小」的策略——上游 one-shot（启动刷一次，怕周期刷新回退到错误 / 更小的 limit），Kilo 当前 periodic 每 5 分钟刷新一次。只影响 token 估算 / 压缩触发。
  - 决定（D3）：改为 **Kilo `model_context_limits` override 优先 + guarded one-shot**（仅在明显坏值时 retry），保留 Kilo 覆盖最高优先级。
  - **实现时必查（自定义提供商）**：必须验证 context limit 解析能正确读到**自定义 / 自托管 provider** 的 context window，而不是只认 models.dev 内置表里的模型。OpenCode 生态里常见坑是自定义 provider 模型解析不到 context window → 回退到一个错误的默认值（过小 → 过早压缩，或过大 → 超窗报错）。
    - 检查点：自定义 provider 模型走的解析路径、拿不到时的 fallback 值、以及用户能否用 `model_context_limits` 显式覆盖兜底。
    - 验证：用一个自定义 provider 模型实测 context limit 读数是否正确。
- **data-path**：上游共享 `cortexkit/magic-context` path vs Kilo 独立 runtime path。
  - 决定（D4）：**需要兼容上游**。Kilo runtime path 仍作为主写入路径（红线不变），但增加一层兼容/迁移：能检测并读取上游 / legacy 路径的数据，必要时一次性迁移到 Kilo path。目标是用户从上游插件切到 Kilo 内置版时历史 memory / notes / embedding 不丢。
  - 实现注意：上游 `shared/data-path.ts` 有 legacy OpenCode → cortexkit 的迁移逻辑可参考；Kilo 侧用 `setKiloRuntimeInfo` 驱动主 path，兼容层只做「读 + 一次性迁移」，不把主写入路径改成 cortexkit。
- **dreamer runnable 判定**：上游 `isDreamerRunnable(config)` 统一判断（支持 agent-disable）vs Kilo explicit `dreamer.enabled` + settings UI。
  - 建议：保留 Kilo `enabled` 字段语义，把上游判定逻辑适配成 Kilo helper。

### A.3 Magic Context 分阶段路线

- **MC-Phase 1（低风险，纯逻辑 / 安全）**
  - `ctx-memory` fail-closed 权限 hardening
  - `shared/stable-json`
  - `cache-busting-signals` 诊断（不写新列部分）
  - boundary-execution 纯判断函数 + 测试
  - `message-index-async`
  - 验证：`packages/magic-context` 下 `bun run typecheck`、targeted `bun test`

- **MC-Phase 2（storage 迁移基座，后续一切的前提）**
  - 设计 Kilo migration 批次：`tool_owner_message_id`、`last_todo_state`、`observed_safe_input_tokens`、`cache_alert_sent`、`project_key_files`、`subagent_invocations`
  - 默认 harness 保持 `kilo`，保留 Kilo migration 资源释放逻辑
  - 先落地 tool-owner backfill（修真实 bug）
  - 引入上游 migration race / atomic 测试（适配 Kilo schema 默认值）

- **MC-Phase 3（per-project embedding，价值最高）**
  - 迁移 `project-embedding-registry` + `embedding-identity`
  - `ctx-search` / `ctx-memory` 接 `embedTextForProject` + project snapshot
  - 注入 `ensureProjectRegistered` 全链路（tool-registry / transform / auto-search / dreamer）
  - 落地模型刷新策略决策（override 优先 + guarded one-shot）

- **MC-Phase 4（上下文质量增强）**
  - synthetic todowrite 注入（先验证 Kilo todowrite wire shape）
  - key-files 注入
  - boundary-execution 完整链路（deferred execute drain）

- **MC-Phase 5（TUI / settings 增强，按需）**
  - context DB 新字段展示（tool calls、project identity、key files、work metrics）
  - announcement 能力（接 Kilo settings / UI，不改 Kilo TUI 配置路径）
  - data-path 兼容层（D4）：读 + 一次性迁移上游 / legacy 路径数据到 Kilo path
    - 注：兼容层可视复杂度提前到 MC-Phase 2/3，与 storage 迁移一起做，避免历史 embedding / memory 丢失

---

## Part B — Agent Team 升级

### B.1 Kilo 已领先（OMO 同等能力已原生化）

以下 OMO 能力 Kilo 已有原生实现，且更可靠，**不迁移 OMO plugin 架构**：

- session reuse、caller / route 校验、nested delegation 限制 → Kilo `tool/task.ts`、`kilocode/tool/task.ts`、`agent-team/session-reuse.ts`
- auto-continue → Kilo `agent-team/auto-continue.ts`
- council → Kilo `agent-team/council.ts`（原生 Effect 架构）
- capabilities → Kilo `agent-team/capabilities.ts`（比 OMO 分散式更好的集中抽象）
- Kilo 独有角色：`secretary` / `team` / `architect` / `planner`

### B.2 可吸收项（纯 prompt / 策略，低风险）

1. **Explorer prompt**：工具选择规则（regex→grep，结构→ast_grep，文件名→glob）+ XML-ish 输出格式
   - 源 `src/agents/explorer.ts` → 目标 `agent-team/agents.ts`
2. **Council prompt**：强制 synthesis 输出结构（Council Response / Councillor Details / Council Summary）+ consensus confidence
   - 源 `src/agents/council.ts` → 目标 `agent-team/agents.ts`
3. **Fixer prompt**：`<summary>/<changes>/<verification>` 输出结构
   - 源 `src/agents/fixer.ts` → 目标 `agent-team/agents.ts`
4. **Observer prompt**：精确可见文本 / OCR，不要改写错误信息
   - 源 `src/agents/observer.ts` → 目标 `agent-team/agents.ts`
5. **Todo hygiene 文案**：两条轻量提醒（任务变化时更新 todo；收尾时不要留 in_progress）
   - 源 `src/hooks/todo-continuation/todo-hygiene.ts` → 目标 Kilo Agent Team runtime reminder（吸收文案，不迁 hook）
6. **capabilities profiles 文案**：把 OMO 更丰富的 trigger / use / avoid 补进 Kilo `capabilities.ts` 的 profiles（尤其 Explorer / Librarian / Observer / Fixer）

注意：OMO prompt 里的「Stats: 2x faster / 1/2 cost」这类硬数字**不照搬**，只保留「更快 / 更低成本 / 更适合」的定性描述，避免误导。

### B.3 需要决策的能力增强

#### 决策 1 — Nested delegation 改为 max-depth【已决定：采纳 OMO max-depth】

- 现状：Kilo 严格单层。orchestrator（team）可委派给 specialist，但 specialist 在子会话内**不能再委派**，唯一例外是 Secretary→Team handoff。
  - 实现位置：`packages/opencode/src/kilocode/tool/task.ts`（route / caller 校验、嵌套禁止）
- OMO：深度计数器（默认 max depth 3），允许多层嵌套。
- **决定**：采纳 OMO 风格的 max-depth，让 specialist（如 fixer / oracle）能按需向下委派 explorer 等取证 / 执行，减少 orchestrator 来回中转。
- **必须配套的安全护栏**（采纳的前提）：
  - 可配置深度上限 `agentTeam.maxDelegationDepth`，默认建议 `2`（即 orchestrator → specialist → 一层），上限不超过 `3`
  - 每层 / 每会话的 subtask 数量与 token 预算约束，防止扇出爆炸
  - 调用链可视化：在 task 输出 / metadata 中体现 `depth` 与 parent 链，保证可解释
  - 保留现有 caller / route 安全校验（primary agent 不可作 subagent、hidden agent 不可被调等）
  - 循环 / 自委派检测，避免 A→B→A
  - 达到深度上限时给清晰错误提示，引导回 orchestrator 协调
- 风险：高（影响安全、成本、递归复杂度、可解释性）。落地时单独切片，配独立测试。

#### 决策 2 — `auto_continue` tool 缺口【已定：实现原生 tool，先核实现状】

- 现象：Kilo orchestrator prompt 提到「Use the `auto_continue` tool」（`agent-team/agents.ts` 约 267-270 行），但原生 runtime 似乎没有注册对应的 `Tool.define`。
- 风险：agent 可能调用不存在的工具。
- **决定**：实现一个原生 `auto_continue` tool，给 orchestrator 真正的运行时开关（开 / 关 / toggle），映射到 `agentTeam.autoContinue`。
- 落地前先核实是否已存在 native `auto_continue` tool：
  - 若不存在 → 新增原生 tool，并确保只有 primary（`team` / `secretary`）可调用。
  - 若已存在但未注册到对应 agent → 修正注册 / 权限。
  - 同步检查 prompt 文案与 tool 行为一致。

#### 决策 3 — Council 并发 / 重试 / 成本控制

- 现状：Kilo council `concurrency: "unbounded"`，无串行模式 / 无重试 / 无并发上限（`agent-team/council.ts` 约 187-191 行）。
- OMO：支持 `councillor_execution_mode`（parallel / serial）、`councillor_retries`（仅对 "Empty response from provider" 重试，默认 3 次）、timeout 细分 `timed_out` 状态。
- 建议：为 `agentTeam.council` 增加可选 `executionMode` / `maxConcurrency` / `councillorRetries`；把 timeout 失败从 `failed` 细分出 `timed_out`；strict preset 错误时列出 available presets。
- 风险：中（影响 latency / cost / UI）。

### B.4 明确不迁移（OMO 架构遗留）

- 所有 plugin hook 组合架构
- `task-session-manager`、`todo-continuation` hook（Kilo 已原生）
- plugin agent factory / custom agent discovery / `disabled_agents`（Kilo 用 `roles.<role>.enabled`）
- `multiplexer` / `tmux` / `zellij` / `divoom` / `interview` / `auto-update` 等产品插件能力
- `foreground-fallback` hook（与 Kilo native session loop 冲突）
- legacy council `master/master_timeout/master_fallback`

### B.5 Agent Team 分阶段路线

- **AT-Phase 1（低风险 prompt / 策略吸收）**
  - Explorer / Council / Fixer / Observer prompt 吸收
  - Todo hygiene 文案接入 Kilo runtime reminder
  - capabilities profiles 文案增强
  - 核实并修复 `auto_continue` tool 缺口
  - 验证：`packages/opencode` 下 `bun run typecheck`、targeted `bun test`

- **AT-Phase 2（council 增强）**
  - `executionMode` / `maxConcurrency` / `councillorRetries` schema + 实现
  - `timed_out` 状态细分；strict preset 诊断
  - 同步 cloud schema（`Config.Info` 新增键需镜像到 cloud 仓库 `apps/web/src/app/config.json/extras.ts`）

- **AT-Phase 3（max-depth nested delegation）**
  - `agentTeam.maxDelegationDepth` 配置 + depth 跟踪
  - 预算 / 扇出约束 + 循环检测 + 调用链可视化
  - 独立测试覆盖（深度上限、循环、预算耗尽、错误提示）
  - 同步 cloud schema

---

## 验证与流程约束

- **不在 root 跑 `bun test`**（root 会拒绝）；到具体 package 跑。
- Magic Context：`packages/magic-context` 下 `bun run typecheck`、`bun test <targeted>`、`bun run lint`。
- CLI / Agent Team：`packages/opencode` 下 `bun run typecheck`、`bun test <targeted>`。
- 跨包：root 下 `bun run lint`、`bun turbo typecheck`。
- 改 shared opencode 文件：加 `kilocode_change` 标记，跑 `bun run script/check-opencode-annotations.ts`。
- 改 server endpoints：root 下 `./script/generate.ts` 重新生成 SDK。
- 新增 `Config.Info` 配置键：镜像到 cloud 仓库的 JSON schema。
- 用户可见变更：加 changeset（`bunx changeset add`）。
- 当前环境注意：仓库缺 `node_modules`，需先 `bun install` 才能跑 typecheck / test（`@kilocode/plugin`、`ai-tokenizer`、`bun-types` 等依赖未安装）。

---

## 执行顺序建议（汇总）

按「价值 / 风险 / 依赖」排序，推荐整体推进顺序：

1. AT-Phase 1（prompt 吸收 + auto_continue 核实）— 低风险、见效快、无依赖
2. MC-Phase 1（纯逻辑 / 安全）— 低风险、无 storage 依赖
3. MC-Phase 2（storage 迁移基座）— 中高风险、是 MC-Phase 3/4 的前提
4. MC-Phase 3（per-project embedding）— 高风险、价值最高
5. AT-Phase 2（council 增强）— 中风险、独立
6. MC-Phase 4（上下文质量增强）— 高风险、依赖 Phase 2
7. AT-Phase 3（max-depth）— 高风险、独立切片
8. MC-Phase 5（TUI / settings）— 按需

### 已完成

- `fix(magic-context): scope ctx_note mutations`（commit `dd79e93fd9`）— ctx_note 的 session/project 作用域保护 + smart note 文案同步。属于 MC-Phase 1 的先行项。

---

## 决策记录（待补充 / 已定）

| 编号 | 决策点 | 状态 | 结论 |
|---|---|---|---|
| D1 | nested delegation：单层 vs max-depth | 已定 | 采纳 OMO max-depth，配深度上限 + 预算 + 可视化护栏 |
| D2 | `auto_continue` tool 是否存在 / 如何修 | 已定 | 实现原生 `auto_continue` tool（开 / 关 / toggle，映射 `agentTeam.autoContinue`）；先核实现状 |
| D3 | 模型上下文限制刷新策略（仅 MC） | 已定 | override 优先 + guarded one-shot；实现时必查自定义 provider context window 解析 |
| D4 | data-path 是否兼容上游 | 已定 | 兼容上游：Kilo path 为主，增加读 + 一次性迁移兼容层，历史数据不丢 |
| D5 | council 并发 / 重试 / 成本控制 | 已定 | 增加可选 schema：`executionMode` / `maxConcurrency` / `councillorRetries` + `timed_out` 状态 |
| D6 | synthetic todowrite 是否兼容 Kilo wire shape | 待验证 | 需先验证再迁 |
