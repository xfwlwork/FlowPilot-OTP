const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const manager = fs.readFileSync('sidepanel/openai-account-pool-manager.js', 'utf8');
const sidepanel = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

test('sidepanel exposes an independent imported OpenAI account pool section', () => {
  assert.match(html, /导入 OpenAI 账号池/);
  assert.match(html, /id="row-openai-account-pool"/);
  assert.match(html, /id="select-openai-account-source"/);
  assert.match(html, /id="input-openai-account-pool-import"/);
  assert.match(html, /id="openai-account-pool-list"/);
  assert.match(html, /邮箱----密码(?:----备注)?/);
  assert.match(html, /cpa/);
  assert.match(html, /sub2api/);
  assert.match(html, /codex2api/);
});

test('OpenAI account pool import action merges local state, persists it, and keeps rendering password-free', () => {
  assert.match(sidepanel, /importEntries:\s*async \(text\)\s*=>\s*\{[\s\S]*?OpenAIAccountPoolUtils\.importOpenAIAccounts\(openAIAccountPoolEntriesState, text\)/);
  assert.match(sidepanel, /openAIAccountPoolEntriesState\s*=\s*OpenAIAccountPoolUtils\.normalizeOpenAIAccountListEntries\(result\.accounts\)/);
  assert.match(sidepanel, /markSettingsDirty\(true\);\s*await saveSettings\(\{ silent: true \}\);/);
  assert.doesNotMatch(sidepanel, /IMPORT_OPENAI_ACCOUNT_POOL/);
  assert.match(manager, /projectOpenAIAccountsForList/);
  assert.doesNotMatch(manager, /entry\.password/);
});

test('sidepanel preserves password-free OpenAI account rows when saving and receiving updates', () => {
  assert.match(sidepanel, /openaiAccountPoolEntries:\s*[\s\S]*?normalizeOpenAIAccountListEntries\(/);
  assert.match(sidepanel, /message\.payload\.openaiAccountPoolEntries[\s\S]*?normalizeOpenAIAccountListEntries\(/);
  assert.doesNotMatch(sidepanel, /openaiAccountPoolEntries:\s*[\s\S]{0,500}?normalizeOpenAIAccounts\(/);
});

test('OpenAI account pool actions mutate password-free rows without dropping them', () => {
  assert.match(manager, /const before = normalize\(state\.getEntries\?\.\(\)\);/);
  assert.match(manager, /const after = normalize\(mutator\(before\.map\(\(entry\) => \(\{ \.\.\.entry \}\)\)\)\);/);
  assert.match(manager, /credential-bearing normalizer here turns every row into an invalid/);
});

test('sidepanel saves an explicit switch back to not using the imported account pool', () => {
  assert.match(sidepanel, /selectOpenAIAccountSource\.value[\s\S]*?\?\? latestState\?\.openaiAccountSource/);
  assert.doesNotMatch(sidepanel, /selectOpenAIAccountSource\?\.value\)\s*\|\| latestState\?\.openaiAccountSource/);
});
