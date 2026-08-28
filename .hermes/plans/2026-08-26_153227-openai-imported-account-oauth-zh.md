# 导入 OpenAI 账号池并执行 OAuth 交付：实施计划

**目标：** 新增独立的「已导入 OpenAI 账号池」，使已有账号可跳过注册步骤 1–6，从 OAuth 登录节点开始执行账号交付。

**架构原则：** 已导入账号凭据必须与现有 `customEmailPoolEntries` 注册邮箱池完全分离。新账号池保存结构化凭据；在执行 OpenAI Step 7（`oauth-login`）前解析当前选中账号，并将身份与密码注入现有 OAuth 流程。执行范围以稳定的 `nodeId` 控制，不依赖易变的显示步骤号。

**技术栈：** Chrome MV3 扩展、原生 JavaScript/IIFE 全局模块、`chrome.storage`、Node 内置测试运行器（`node --test`）。

---

## 一、当前上下文与约束

- 本项目是浏览器直接加载的扩展，不使用 bundler；`package.json` 当前仅定义测试命令。
- 执行 Node/npm 前必须加载 NVM：
  ```bash
  . "$HOME/.nvm/nvm.sh" && npm run test
  ```
- 当前项目目录没有 `.git` 元数据，因此不可依赖分支、提交记录或 Git diff。
- OpenAI 工作流使用稳定节点 ID；OAuth 交付相关节点为：
  - `oauth-login`
  - `fetch-login-code`
  - `post-login-phone-verification`
  - `confirm-oauth`
  - `platform-verify`
- `flows/openai/background/steps/oauth-login.js` 的 Step 7 需要邮箱或手机号身份。仅设置执行范围并不能补齐身份信息。
- 现有 `customEmailPoolEntries` 仅保存邮箱、启用状态、使用状态、备注、时间戳；**不得向该注册邮箱池添加密码字段**。
- 当前基线：`npm run test` 已验证通过，结果为 **1436 passed / 0 failed**。

## 二、实施前需确认的产品决策

1. **导入格式**
   - 推荐 v1 格式：每行 `邮箱----密码`。
   - 可选备注：`邮箱----密码----备注`。
   - 需确认 v1 是否支持手机号账号或仅通过 OTP 登录而无密码的账号。

2. **账号生命周期**
   - 推荐默认状态：启用/禁用、已使用/未使用。
   - 推荐仅在完整 OAuth 交付成功后标记为已使用。
   - 需确认可恢复失败时的策略：继续同一账号重试、禁用账号，或保持未使用。

3. **登录验证码邮箱能力**
   - 导入邮箱和密码不代表插件能读取该邮箱中的 OpenAI OTP。
   - 需确认导入账号的邮箱是否均可由现有邮件提供商/轮询逻辑读取。

4. **功能范围**
   - 推荐 v1 仅对支持 OAuth 的 OpenAI 目标开放（CPA、Sub2API、Codex2API）。
   - 不改动 Session 交付路径。

---

## 三、总体方案

1. 新建独立的账号池工具模块，负责凭据导入、校验、规范化、去重和脱敏列表投影。
2. 在现有设置持久化/状态链路中增加独立账号池字段；后台提供可用账号筛选、按轮次选择和状态更新能力。
3. 在侧边栏新增独立的「导入 OpenAI 账号池」管理区，不与「自定义邮箱池」混用。
4. 新增账号来源选择：新注册账号 / 导入账号池；导入账号池时默认从 `oauth-login` 开始。
5. 在 Step 7 执行前将当前已选账号的邮箱、账号标识、标识类型和密码解析到执行状态。
6. 保持现有注册流程、自定义邮箱池、目标交付模式、手机号流程和旧的数字步骤兼容逻辑不变。

---

## 四、实施任务

### 任务 1：定义导入账号池数据模型与解析器

**目的：** 建立独立的 OpenAI 登录凭据模型，避免与注册邮箱池耦合。

**文件：**
- 新建：`openai-account-pool-utils.js`
- 新建：`tests/openai-account-pool-utils.test.js`
- 参考：`mail2925-utils.js:130-144`
- 参考：`sidepanel/custom-email-pool-manager.js`

#### 步骤 1.1：先编写失败测试

覆盖以下场景：

- `email----password` 解析为：
  ```js
  {
    id,
    email,
    password,
    enabled: true,
    used: false,
    note: '',
    lastUsedAt: 0
  }
  ```
- `email----password----note` 正确保留第二个分隔符后的备注内容。
- 空行、格式错误、缺密码、非法邮箱行被忽略，并提供明确的拒绝行统计/原因。
- 已持久化的旧版本或缺字段记录能被防御性规范化。
- 按规范化后的邮箱去重，并明确保留首条或末条的策略。
- 用于 UI 渲染的列表投影绝不能返回密码。

#### 步骤 1.2：确认测试先失败

```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/openai-account-pool-utils.test.js
```

预期：模块尚未存在，新增测试失败。

#### 步骤 1.3：实现最小工具模块

采用项目现有 IIFE/全局模块规范，导出范围明确的函数，例如：

- `normalizeOpenAiAccountPoolEntries(entries)`
- `parseOpenAiAccountPoolImport(text)`
- `getEligibleOpenAiAccountPoolEntries(entries)`
- `toOpenAiAccountPoolListItem(entry)`（密码脱敏/不返回）

ID 生成方式应与现有邮箱池管理器保持一致。任何展示型/日志型辅助函数均不得透传密码。

#### 步骤 1.4：运行聚焦测试

重复运行任务 1.2 的命令，预期全部通过。

---

### 任务 2：增加持久化状态与后台账号池辅助逻辑

**目的：** 使导入账号可被后台工作流和自动运行读取，同时不改变 `customEmailPoolEntries` 的语义。

**文件：**
- 修改：`core/flow-kernel/settings-schema.js`（修改前先定位默认值和规范化逻辑）
- 修改：`background.js`，重点查看现有自定义邮箱池辅助逻辑（约 `2357+`）及生命周期逻辑（约 `2544+`）
- 可能修改：`background/auto-run-controller.js:78-100`
- 新建：`tests/background-openai-account-pool.test.js`
- 参考：`tests/background-custom-email-pool.test.js`
- 参考：`tests/auto-run-fresh-attempt-reset.test.js`

#### 步骤 2.1：先编写失败测试

验证：

- 账号池通过预期设置持久化链路完成规范化。
- 可用账号仅包含 `enabled && !used` 的记录。
- 多轮运行按可用账号的稳定顺序确定性选择。
- 指定轮次没有对应账号时，报出与自定义邮箱池不同且可操作的错误。
- 完整流程成功后，仅当前选中的导入账号被标记为已使用并更新 `lastUsedAt`。
- 新一轮自动运行清理临时身份，但保留配置的账号池。

#### 步骤 2.2：确认测试先失败

```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/background-openai-account-pool.test.js
```

#### 步骤 2.3：实现设置和后台辅助函数

- 增加独立持久化字段，例如 `openaiAccountPoolEntries`，并遵循现有 schema 迁移风格。
- 新增命名清晰的 getter/selector，避免把「注册邮箱池」与「已有账号凭据池」混淆。
- 运行时状态仅保存当前账号的非敏感 ID；密码仅在确实需要执行登录时读取。
- 将「标记已使用」集中在单个辅助函数中，且只在工作流成功边界调用。
- 仅在必要时更新自动运行重置的保留状态，确保账号池配置保留而当前选择的临时账号被清理。

#### 步骤 2.4：运行聚焦回归测试

```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/background-openai-account-pool.test.js tests/background-custom-email-pool.test.js tests/auto-run-fresh-attempt-reset.test.js
```

预期：全部通过。

---

### 任务 3：在 OAuth Step 7 前解析并注入导入账号凭据

**目的：** 让 `oauth-login` 使用导入账号的身份和密码，同时保留当前手动登录逻辑。

**文件：**
- 修改：`flows/openai/background/steps/oauth-login.js:266+`
- 可能修改：`background.js:11705+`、`background.js:14109-14132`
- 可能修改：`background/message-router.js:370-443`
- 修改：`tests/background-step6-retry-limit.test.js`
- 新建：`tests/background-imported-account-oauth-login.test.js`
- 参考：`tests/background-step-execution-range.test.js`

#### 步骤 3.1：先编写失败测试

覆盖：

- 已导入的邮箱/密码会传递给 Step 7，并形成：`email`、`accountIdentifier`、`accountIdentifierType: 'email'` 和密码。
- 选择导入账号池时，在 Step 7 现有身份校验之前解析账号，因此不会触发「缺少登录账号」错误。
- 未启用导入模式时，手动邮箱/手机号登录行为保持不变。
- 选择的账号已不存在或不可用时，明确失败，绝不能静默换用其他账号。
- 密码不得进入日志 payload、错误文本或历史记录。

#### 步骤 3.2：确认测试先失败

```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/background-imported-account-oauth-login.test.js tests/background-step6-retry-limit.test.js
```

#### 步骤 3.3：实现单一凭据解析边界

- 先查找项目现有设置字段命名，再增加类似 `openaiAccountSource: 'imported-pool'` 的来源标记。
- 在 `step7Executor.executeStep7(state)` 前，或由其调用的专用 resolver 中，解析当前账号。
- 将解析结果注入 executor payload，不能覆盖强制手机号登录/绑定邮箱重新登录等现有特殊流程。
- 保持 `flows/openai/content/openai-auth.js` 现有 OTP 回退逻辑；账号池存在密码时，应优先将密码传入该流程。

#### 步骤 3.4：运行聚焦测试

重复步骤 3.2 命令，预期新增测试和既有 Step 7 测试全部通过。

---

### 任务 4：接入执行范围与起始节点

**目的：** 导入账号模式从 `oauth-login` 开始执行，不触发注册节点，且保持既有范围校验。

**文件：**
- 可能修改：`background.js:9788-9857`、`background.js:11705+`
- 修改：`data/step-definitions.js`
- 可能修改：`flows/openai/workflow.js:315-361`
- 修改：`tests/background-step-execution-range.test.js`
- 新建：`tests/background-imported-account-execution-range.test.js`

#### 步骤 4.1：先编写失败测试

验证：

- 导入账号 OAuth 模式以 `oauth-login` 作为第一个可执行节点。
- 之前的注册节点位于执行范围外，或按最终 UX 选择被明确跳过；不得执行。
- `fetch-login-code` 及后续 OAuth 节点依然可达。
- 手动执行范围外节点仍抛出当前的「范围已禁用」错误。
- 不同目标、Plus/手机号配置导致显示编号变化时，仍按 `nodeId` 正确解析。

#### 步骤 4.2：确认测试先失败

```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/background-imported-account-execution-range.test.js tests/background-step-execution-range.test.js tests/step-definitions-module.test.js
```

#### 步骤 4.3：实现最小起始节点逻辑

推荐做法：持久化账号来源，并导出/推导默认起始节点 `oauth-login`；将其接入现有允许节点计算逻辑，避免复制整套执行逻辑。**禁止硬编码显示步骤「7」**，因为 Plus、手机号等配置会改变显示顺序。

#### 步骤 4.4：运行聚焦测试

重复步骤 4.2 命令，预期全部通过。

---

### 任务 5：新增独立侧边栏账号池管理 UI

**目的：** 让操作者安全导入和维护登录凭据，且明确区别于注册邮箱池。

**文件：**
- 修改：`sidepanel/sidepanel.html:547-557` 及相邻的自定义邮箱池管理区域
- 新建：`sidepanel/openai-account-pool-manager.js`
- 修改：`sidepanel/sidepanel.html:1999-2045`，在 `sidepanel.js` 前加载新管理器
- 修改：`sidepanel/sidepanel.js:4139+` 及实际定位到的设置绑定处
- 新建：`tests/sidepanel-openai-account-pool.test.js`
- 参考：`sidepanel/custom-email-pool-manager.js`
- 参考：`tests/sidepanel-custom-email-pool.test.js`

#### 步骤 5.1：先编写失败 UI/模块测试

验证：

- 文案明确使用「导入 OpenAI 账号池」，不与「自定义邮箱池」混淆。
- 导入 textarea 说明已确认的分隔符格式。
- 列表仅展示邮箱、启用/使用状态、备注和操作按钮；不展示原始密码。
- UI 写入专属 `openaiAccountPoolEntries` 设置字段。
- 账号来源选择只在支持 OAuth 的 OpenAI 目标/模式中启用。

#### 步骤 5.2：确认测试先失败

```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/sidepanel-openai-account-pool.test.js tests/sidepanel-custom-email-pool.test.js
```

#### 步骤 5.3：实现 UI 管理器与绑定

- 遵循 `custom-email-pool-manager.js` 的 IIFE/模块模式，但密码只在持久化记录和导入/编辑路径中存在。
- 密码默认完全不渲染；除非后续明确要求并接受风险，否则不提供「显示密码」功能。
- 导入后反馈新增/重复/拒绝数量，反馈中不能回显原始密码。
- 批量启用/禁用、标记未使用、删除、清空等操作仅在与现有池管理器交互风格一致时提供。
- 使用项目现有设置持久化机制绑定账号来源和池状态。

#### 步骤 5.4：运行聚焦测试

重复步骤 5.2 命令，预期全部通过。

---

### 任务 6：接入自动运行与账号历史生命周期

**目的：** 多轮自动运行按预期消费导入账号，且不泄露凭据。

**文件：**
- 修改：`background.js:12527+`（`ensureAutoEmailReady` 周边；新增独立账号准备路径，不应滥用邮箱选择函数）
- 修改：`background/auto-run-controller.js`
- 修改：`background/account-run-history.js`
- 新建：`tests/auto-run-imported-openai-account.test.js`
- 参考：`tests/background-auto-run-module.test.js`
- 参考：`tests/auto-run-fresh-attempt-reset.test.js`

#### 步骤 6.1：先编写失败测试

验证：

- 第 1、2 轮以确定顺序选择不同的可用导入账号。
- 可恢复 OAuth 失败遵循已确认生命周期策略，不会意外切换为另一个账号。
- 完整工作流成功后，恰好一次标记当前账号为已使用。
- 账号历史可按允许范围记录邮箱或账号 ID，但绝不能含密码。
- 账号池耗尽时，自动运行结束/阻止并给出明确错误。

#### 步骤 6.2：确认测试先失败

```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/auto-run-imported-openai-account.test.js tests/background-auto-run-module.test.js
```

#### 步骤 6.3：实现选择与生命周期接入

- 在新一轮开始、首个允许 OAuth 节点执行前选择导入账号。
- 同一轮内的可恢复重试保持使用同一个账号。
- 轮次清理时清除运行时敏感数据。
- 只在已确认成功边界标记已使用；不得仅以 Step 7 成功判断整个交付成功。
- `addLog`、错误装饰、账号历史中均不能记录敏感字段。

#### 步骤 6.4：运行聚焦测试

重复步骤 6.2 命令，预期全部通过。

---

### 任务 7：回归验证与 Chrome 手工冒烟测试

**目的：** 确保新功能不破坏既有流程，且不会暴露密码。

**文件：**
- 审查：任务 1–6 的全部变更文件
- 可选文档更新：仅在产品需要记录配置方式时修改 `README.md` 和/或 `项目文件结构说明.md`

#### 步骤 7.1：对所有修改后的 JavaScript 做语法检查

示例：

```bash
. "$HOME/.nvm/nvm.sh" && node --check openai-account-pool-utils.js && node --check sidepanel/openai-account-pool-manager.js && node --check background.js
```

预期：所有命令成功退出。

#### 步骤 7.2：运行完整测试套件

```bash
. "$HOME/.nvm/nvm.sh" && npm run test
```

预期：0 失败；如果新增测试，应更新总测试数基线。

#### 步骤 7.3：在 Chrome 中手工冒烟测试

重新加载解压扩展后验证：

1. 选择支持 OAuth 的 OpenAI 目标及「导入账号池」来源。
2. 用已确认格式导入两个测试账号。
3. 确认管理列表不显示原始密码。
4. 从 OAuth 登录开始，确认注册节点不会执行。
5. 确认 Step 7 使用当前选中账号邮箱，并进入既有登录流程。
6. 确认日志和账号历史中不包含密码。
7. 确认成功/失败后的账号状态符合已确认策略。

#### 步骤 7.4：进行敏感信息与范围审查

若后续 Git 可用，审查 diff；否则审查变更文件清单。搜索新增的 `password` 字符串插值和日志调用，清除可能暴露凭据的代码。在语法检查、完整测试、敏感信息审查均完成前，不得宣称任务完成。

---

## 五、风险与权衡

- **凭据存储风险：** `chrome.storage` 不是安全保险库。必须明确存储范围、禁止在列表/日志/历史中显示密码，并尽量减少密码在运行时状态中的复制。
- **OTP 邮箱兼容性：** 有邮箱和密码不代表可以读取 OpenAI 登录验证码。v1 应复用现有邮件提供商能力校验，并在无法读取时明确报错。
- **OpenAI 页面变化：** 内容脚本依赖当前登录页面的路由和文案。新功能只负责提供凭据，不应破坏现有 OTP 回退路径。
- **工作流编号变化：** 目标、Plus、手机号配置均可能改变显示步骤号；所有新逻辑必须使用 `nodeId`。
- **失败处置不明确：** 自动禁用/删除失败账号可能误伤有效账号。在产品策略确认前采用保守状态变更。

## 六、最终验收标准

- 已导入账号使用独立账号池管理，不与自定义注册邮箱池混用。
- 选择可用导入账号后，OAuth 流程从 `oauth-login` 开始，且能获得必要的邮箱/密码状态。
- 手动登录、注册、自定义邮箱池、手机号、Session 交付、执行范围等现有能力保持可用且具备回归测试。
- UI 列表、日志、错误文本、账号历史均不暴露原始密码。
- 全量测试和所有变更 JavaScript 的语法检查在 NVM Node 环境中通过。
