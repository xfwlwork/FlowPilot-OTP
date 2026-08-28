# Imported OpenAI Account OAuth Delivery Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a dedicated imported OpenAI account pool so pre-existing accounts can be selected for OAuth delivery without running registration steps 1–6.

**Architecture:** Keep imported account credentials separate from the existing `customEmailPoolEntries` registration-email queue. Persist a structured credential pool in the existing settings/state path, resolve the selected account into OpenAI Step 7 state, and run the existing OAuth nodes (`oauth-login` onward) through an explicitly selected execution range. Reuse current sidepanel IIFE/global-module conventions and Node built-in test patterns.

**Tech Stack:** Chrome MV3 extension, plain JavaScript/IIFE modules, `chrome.storage`, Node built-in test runner (`node --test`).

---

## Current Context and Constraints

- This repository is direct-load extension code, not a bundled application; `package.json` currently only provides `npm run test`.
- Use the Node runtime available through NVM before testing:
  ```bash
  . "$HOME/.nvm/nvm.sh" && npm run test
  ```
- The repository folder has no `.git` metadata. Do not include commit steps unless Git is initialized later.
- OpenAI execution is keyed by stable node IDs, not UI numbering. Relevant delivery nodes are `oauth-login`, `fetch-login-code`, `post-login-phone-verification`, `confirm-oauth`, and `platform-verify`.
- `flows/openai/background/steps/oauth-login.js` currently requires an email/phone identity in runtime state; an execution range alone cannot satisfy this prerequisite.
- Existing `customEmailPoolEntries` records contain only email, enable/used state, notes, and timestamps; do not add passwords to this registration-email pool.
- Current full baseline: `npm run test` passes with 1436 tests.

## Behavior Decisions to Confirm Before Implementation

1. Import format: recommended default is one account per line as `email----password`, with optional note as `email----password----note`. Confirm whether phone identifiers or OTP-only accounts must be supported in v1.
2. Lifecycle: recommended default is enabled/disabled and used status; mark an account used only after full selected OAuth delivery success. Confirm expected behavior on recoverable failures (retry same account vs. disable vs. leave unused).
3. Verification mail: imported-account OAuth still needs the existing email-provider configuration/polling mechanism to obtain login OTPs. Confirm whether the imported email domain can always be read through an existing provider.
4. Scope: recommended v1 exposes the pool only for OpenAI OAuth-compatible targets (CPA, Sub2API, Codex2API), and does not alter session-delivery paths.

## Proposed Approach

1. Create a credential-pool utility/module with strict normalization and import parsing.
2. Add a persisted settings field and background helpers for reading eligible entries, deterministically selecting one per auto-run round, and updating entry lifecycle state.
3. Add sidepanel management UI separate from the custom registration-email pool: multiline import, list, enable/disable, used status, notes, delete/clear operations.
4. Add a delivery source selector for "new registration" versus "imported account pool" and a clear execution-start UX that resolves to `oauth-login` for imported accounts.
5. Resolve selected imported credentials into `email`, `accountIdentifier`, `accountIdentifierType`, and password state before Step 7 executes.
6. Preserve existing registration flow, custom email pool behavior, account delivery modes, and numeric display-step compatibility.

## Implementation Tasks

### Task 1: Define the imported-account pool data model and parser

**Objective:** Introduce a standalone model that validates and normalizes imported OpenAI login credentials without coupling it to registration-email pools.

**Files:**
- Create: `openai-account-pool-utils.js`
- Create: `tests/openai-account-pool-utils.test.js`
- Reference: `mail2925-utils.js:130-144`
- Reference: `sidepanel/custom-email-pool-manager.js`

**Step 1: Write failing tests**

Cover these cases:
- Parse `email----password` into `{ id, email, password, enabled: true, used: false, note: '', lastUsedAt: 0 }`.
- Parse optional `email----password----note` while preserving text after the second delimiter as note content.
- Ignore blank, malformed, missing-password, and invalid-email rows with explicit rejected-row reporting.
- Normalize persisted legacy/partial records defensively.
- Deduplicate by normalized email, retaining the intended first/last policy explicitly.
- Never return passwords from a list projection intended for UI rendering/logging.

**Step 2: Run focused test and verify expected failure**

Run:
```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/openai-account-pool-utils.test.js
```

Expected: failure because the module does not exist yet.

**Step 3: Implement minimal utility functions**

Use an IIFE/global attachment matching repository conventions. Export narrowly scoped functions such as:
- `normalizeOpenAiAccountPoolEntries(entries)`
- `parseOpenAiAccountPoolImport(text)`
- `getEligibleOpenAiAccountPoolEntries(entries)`
- `toOpenAiAccountPoolListItem(entry)` (redacts password)

Use generated stable IDs consistent with existing pool managers. Do not log or surface raw passwords through display helpers.

**Step 4: Run focused test**

Run the Task 1 command again.

Expected: all parser/model cases pass.

---

### Task 2: Add persisted state/schema support and background pool helpers

**Objective:** Make imported credential-pool entries available to background workflow execution and auto-run without modifying `customEmailPoolEntries` semantics.

**Files:**
- Modify: `core/flow-kernel/settings-schema.js` (locate actual persisted defaults/normalizers before editing)
- Modify: `background.js` near existing custom-pool helpers around `2357+` and lifecycle helpers around `2544+`
- Modify: `background/auto-run-controller.js:78-100` only if fresh-attempt preservation requires it
- Create: `tests/background-openai-account-pool.test.js`
- Reference: `tests/background-custom-email-pool.test.js`
- Reference: `tests/auto-run-fresh-attempt-reset.test.js`

**Step 1: Write failing background tests**

Test:
- Pool state normalizes through the intended settings persistence path.
- Eligible selection includes only enabled, unused entries.
- Per-round selection follows deterministic indexing among eligible entries.
- A missing Nth account produces an actionable error distinct from custom email pool errors.
- Completing the workflow marks only the selected imported account used and records `lastUsedAt`.
- Starting a fresh auto-run attempt clears runtime selected-account identity but preserves the configured pool.

**Step 2: Run focused test and verify failure**

Run:
```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/background-openai-account-pool.test.js
```

Expected: failure because imported-pool state/helpers are absent.

**Step 3: Implement settings and helpers**

- Add a dedicated persisted field, e.g. `openaiAccountPoolEntries`, preserving the project’s existing schema migration style.
- Add getters/selectors with names that make registration-email and imported-login credential pools impossible to confuse.
- Store the currently selected account by opaque `id` in runtime state; do not duplicate or log password unnecessarily.
- Implement lifecycle updates through a single helper invoked only after workflow success.
- Update fresh-auto-run reset keep-state logic only as needed to retain configuration while clearing selected runtime account state.

**Step 4: Run focused tests**

Run the Task 2 command and relevant neighboring regression tests:
```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/background-openai-account-pool.test.js tests/background-custom-email-pool.test.js tests/auto-run-fresh-attempt-reset.test.js
```

Expected: all pass.

---

### Task 3: Resolve imported credentials before OAuth Step 7

**Objective:** Allow `oauth-login` to receive the imported account identity and password while retaining all current direct/manual-login behavior.

**Files:**
- Modify: `flows/openai/background/steps/oauth-login.js:266+`
- Modify: `background.js:11705+` and `background.js:14109-14132` only if executor dependencies/state preparation require it
- Modify: `background/message-router.js:370-443` only if new explicit message fields must be normalized
- Modify: `tests/background-step6-retry-limit.test.js`
- Create: `tests/background-imported-account-oauth-login.test.js`
- Reference: `tests/background-step-execution-range.test.js`

**Step 1: Write failing Step 7 tests**

Cover:
- Imported email/password are passed to Step 7 as `email`, `accountIdentifier`, `accountIdentifierType: 'email'`, and password.
- The explicit imported-account source resolves the selected account before Step 7 validation, so it does not throw the existing missing-login-account error.
- Existing manually entered email/phone behavior remains unchanged when imported mode is off.
- A stale/missing selected account fails clearly and never silently falls back to another account.
- Password values are never written into log payloads or error strings.

**Step 2: Run focused test and verify failure**

Run:
```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/background-imported-account-oauth-login.test.js tests/background-step6-retry-limit.test.js
```

Expected: imported-account cases fail before implementation.

**Step 3: Implement a single credential-resolution boundary**

- Add a state flag/source value such as `openaiAccountSource: 'imported-pool'` only after locating existing setting naming conventions.
- Resolve the selected pool entry immediately before `step7Executor.executeStep7(state)` or inside a narrowly named resolver called by it.
- Apply resolved values to the executor payload without overwriting explicitly forced phone/bound-email relogin flows.
- Keep existing OTP fallback behavior in `flows/openai/content/openai-auth.js`; it should receive a password when the pool entry contains one.

**Step 4: Run focused tests**

Run the Task 3 command again.

Expected: imported-account and existing Step 7 tests pass.

---

### Task 4: Add explicit execution range/start-node integration

**Objective:** Ensure imported accounts begin at OAuth login rather than registration, while preserving range enforcement and visible step numbering.

**Files:**
- Modify: `background.js:9788-9857` and `background.js:11705+` only after tracing current range persistence/UI wiring
- Modify: `data/step-definitions.js`
- Modify: `flows/openai/workflow.js:315-361` only if workflow composition needs an imported-account delivery-only route
- Modify: `tests/background-step-execution-range.test.js`
- Create: `tests/background-imported-account-execution-range.test.js`

**Step 1: Write failing tests**

Test:
- Imported-account OAuth mode allows `oauth-login` as the first executable node.
- Earlier registration nodes are outside the selected range or are explicitly skipped according to the final UX choice; they must not execute.
- `fetch-login-code` and downstream OAuth nodes remain reachable.
- Manual attempts to execute a node outside the selected range still raise the existing range-disabled error.
- Numeric display-order changes caused by account delivery mode remain correctly resolved by node ID.

**Step 2: Run focused test and verify failure**

Run:
```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/background-imported-account-execution-range.test.js tests/background-step-execution-range.test.js tests/step-definitions-module.test.js
```

Expected: imported-range behavior fails before implementation.

**Step 3: Implement minimal range/start behavior**

Preferred design: save/imported source selection and derive default start node `oauth-login`; feed it into the existing allowed-node helper rather than duplicating execution logic. Do not hard-code historical numeric step 7 because payment and phone-specific workflow variations alter display order.

**Step 4: Run focused tests**

Run the Task 4 command again.

Expected: all pass.

---

### Task 5: Build the separate sidepanel credential-pool UI

**Objective:** Let operators import and manage credentials safely without exposing passwords in the regular list or confusing this feature with the registration email pool.

**Files:**
- Modify: `sidepanel/sidepanel.html:547-557` and the adjacent custom-pool management area
- Create: `sidepanel/openai-account-pool-manager.js`
- Modify: `sidepanel/sidepanel.html:1999-2045` to load the new manager before `sidepanel.js`
- Modify: `sidepanel/sidepanel.js:4139+` and related settings binding locations discovered during implementation
- Create: `tests/sidepanel-openai-account-pool.test.js`
- Reference: `sidepanel/custom-email-pool-manager.js`
- Reference: `tests/sidepanel-custom-email-pool.test.js`

**Step 1: Write failing UI/module tests**

Test source/module-level expectations consistent with project patterns:
- Dedicated UI labels distinguish "导入 OpenAI 账号池" from "自定义邮箱池".
- Import textarea describes the confirmed delimiter format.
- Rendered rows show email, enable/used status, note, and controls but not password.
- UI writes to the dedicated `openaiAccountPoolEntries` settings field.
- Source selector activates only for supported OpenAI OAuth targets/modes.

**Step 2: Run focused test and verify failure**

Run:
```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/sidepanel-openai-account-pool.test.js tests/sidepanel-custom-email-pool.test.js
```

Expected: imported-pool UI cases fail before implementation.

**Step 3: Implement the UI manager and bindings**

- Follow `custom-email-pool-manager.js` IIFE/module pattern but keep password only in the persisted record and import/editor path.
- Render password as masked or omit it entirely; do not add a reveal action unless explicitly required and approved.
- Provide import result feedback with added/duplicate/rejected counts, using no raw password echoes.
- Add bulk enable/disable, mark unused, delete selected, and clear actions only when matching existing pool-manager conventions.
- Bind source selection and pool state through the project’s normal settings persistence mechanism.

**Step 4: Run focused tests**

Run the Task 5 command again.

Expected: all pass.

---

### Task 6: Wire auto-run selection and lifecycle into account history

**Objective:** Make multi-round execution consume imported accounts predictably and retain useful outcome state without leaking credentials.

**Files:**
- Modify: `background.js:12527+` (`ensureAutoEmailReady` vicinity; add a distinct account-ready path rather than overloading email selection)
- Modify: `background/auto-run-controller.js`
- Modify: `background/account-run-history.js`
- Create: `tests/auto-run-imported-openai-account.test.js`
- Reference: `tests/background-auto-run-module.test.js`
- Reference: `tests/auto-run-fresh-attempt-reset.test.js`

**Step 1: Write failing auto-run tests**

Cover:
- Round 1 and round 2 choose distinct eligible imported accounts deterministically.
- A recoverable OAuth failure follows the confirmed lifecycle policy without selecting a different account unexpectedly.
- Full workflow success marks the correct account used exactly once.
- Account-history records identify the selected email/entry ID as permitted but never include password.
- Pool exhaustion ends/blocks auto-run with an actionable message.

**Step 2: Run focused test and verify failure**

Run:
```bash
. "$HOME/.nvm/nvm.sh" && node --test tests/auto-run-imported-openai-account.test.js tests/background-auto-run-module.test.js
```

Expected: imported-pool auto-run cases fail before implementation.

**Step 3: Implement selection/lifecycle integration**

- Select an imported account at fresh-run start before the first allowed OAuth node executes.
- Retain the same selected account through retry attempts for that round.
- Clear its runtime secret on round cleanup.
- Mark used only after the configured success boundary; do not infer success from Step 7 alone.
- Keep sensitive fields out of `addLog`, error decoration, and account history.

**Step 4: Run focused tests**

Run the Task 6 command again.

Expected: all pass.

---

### Task 7: Regression validation and manual extension smoke test

**Objective:** Verify the feature does not regress existing flows and that sensitive data is not exposed in source/UI logs.

**Files:**
- Review: all files changed in Tasks 1–6
- Optional documentation update only if the product documents account-pool configuration: `README.md` and/or `项目文件结构说明.md`

**Step 1: Run syntax checks on changed JavaScript files**

Run `node --check` for every modified/created `.js` file with NVM loaded. Example:
```bash
. "$HOME/.nvm/nvm.sh" && node --check openai-account-pool-utils.js && node --check sidepanel/openai-account-pool-manager.js && node --check background.js
```

Expected: each command exits successfully.

**Step 2: Run the full test suite**

Run:
```bash
. "$HOME/.nvm/nvm.sh" && npm run test
```

Expected: 0 failures; update the baseline total if tests were added.

**Step 3: Manual Chrome smoke test**

Load/reload the unpacked extension and verify:
1. Choose an OpenAI OAuth-capable target and imported-account source.
2. Import two test entries using the confirmed input format.
3. Confirm list UI never displays raw passwords.
4. Select/start at OAuth login and confirm registration nodes do not run.
5. Confirm Step 7 receives the selected email and proceeds to the existing login behavior.
6. Confirm logs/account history do not include a password.
7. Confirm success/failure lifecycle matches the confirmed policy.

**Step 4: Review scope and secret exposure**

Inspect changed code/diff if Git is later available; otherwise inspect the changed file list. Search for new `password` log interpolation and remove any that can expose credentials. Do not report completion until this review and the full suite pass.

## Risks and Tradeoffs

- **Sensitive credential storage:** `chrome.storage` is not a secure vault. The UI must clearly communicate storage scope, redact passwords from rendering/logs/history, and avoid unnecessarily copying secrets into runtime state.
- **OTP mailbox compatibility:** possessing email/password does not guarantee the extension can retrieve a login OTP. v1 should reuse existing mail provider capability checks and fail clearly when no configured reader can access the imported account mailbox.
- **OpenAI auth UI drift:** current content automation depends on observed login routes/labels. Preserve the existing OTP fallback and keep new behavior limited to providing credentials.
- **Workflow variability:** do not depend on numeric steps; use node IDs because target, Plus, and phone options change display order.
- **Lifecycle ambiguity:** automatic disable/delete on failure could discard valid accounts. Default to conservative state changes until the operator confirms policy.

## Final Acceptance Criteria

- Imported credentials are managed in a dedicated pool separate from custom registration email pools.
- For an eligible selected account, OAuth execution begins at `oauth-login` and supplies required email/password state.
- Existing manual login, registration, custom email pool, phone, session delivery, and execution-range behaviors remain covered and passing.
- Pool list, logs, errors, and account history never expose raw passwords.
- Full test suite and changed-file syntax checks pass under NVM.
