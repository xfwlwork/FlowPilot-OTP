const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`async function ${name}(`) >= 0
    ? source.indexOf(`async function ${name}(`)
    : source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) signatureEnded = true;
    }
    if (source[i] === '{' && signatureEnded) { braceStart = i; break; }
  }
  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1;
    if (source[end] === '}' && --depth === 0) { end += 1; break; }
  }
  return source.slice(start, end);
}

function makeApi(overrides = {}) {
  const persisted = [];
  const session = [];
  const broadcasts = [];
  const factory = new Function('utils', `
    const PERSISTED_SETTING_DEFAULTS = { openaiAccountPoolEntries: [], currentOpenAIAccountId: '' };
    const persisted = [], session = [], broadcasts = [];
    const self = { MultiPageOpenAIAccountPoolUtils: utils };
    const setPersistentSettings = async (updates) => { persisted.push(updates); };
    const setState = async (updates) => { session.push(updates); };
    const broadcastDataUpdate = (updates) => { broadcasts.push(updates); };
    const addLog = async () => {};
    const getState = async () => ({ openaiAccountPoolEntries: [], currentOpenAIAccountId: '' });
    ${extractFunction('normalizeOpenAIAccountPoolEntries')}
    ${extractFunction('getOpenAIAccountPoolEntries')}
    ${extractFunction('getEligibleOpenAIAccountPoolEntries')}
    ${extractFunction('pickOpenAIAccountForRun')}
    ${extractFunction('markCurrentOpenAIAccountUsed')}
    return { normalizeOpenAIAccountPoolEntries, getOpenAIAccountPoolEntries,
      getEligibleOpenAIAccountPoolEntries, pickOpenAIAccountForRun,
      markCurrentOpenAIAccountUsed, persisted, session, broadcasts };
  `);
  return factory(require('../openai-account-pool-utils'));
}

test('normalizes the independent OpenAI pool and filters enabled unused entries', () => {
  const api = makeApi();
  const state = { openaiAccountPoolEntries: [
    { id: 'a', email: 'A@EXAMPLE.COM', password: 'secret-a', enabled: true, used: false },
    { id: 'b', email: 'b@example.com', password: 'secret-b', enabled: false },
    { id: 'c', email: 'c@example.com', password: 'secret-c', used: true },
  ], customEmailPoolEntries: [{ email: 'custom@example.com' }] };
  assert.deepEqual(api.getEligibleOpenAIAccountPoolEntries(state).map((entry) => entry.id), ['a']);
  assert.equal(api.getOpenAIAccountPoolEntries(state)[0].email, 'a@example.com');
  assert.equal(api.getOpenAIAccountPoolEntries(state)[0].password, 'secret-a');
  assert.notEqual(api.getOpenAIAccountPoolEntries(state), state.customEmailPoolEntries);
});

test('selects deterministically by automatic round and by explicit account id', () => {
  const api = makeApi();
  const state = { openaiAccountPoolEntries: [
    { id: 'a', email: 'a@example.com', password: 'a', lastUsedAt: 10 },
    { id: 'b', email: 'b@example.com', password: 'b', lastUsedAt: 20 },
  ] };
  assert.equal(api.pickOpenAIAccountForRun(state, { autoRun: true, run: 1 }).id, 'a');
  assert.equal(api.pickOpenAIAccountForRun(state, { autoRun: true, run: 2 }).id, 'b');
  assert.throws(
    () => api.pickOpenAIAccountForRun(state, { autoRun: true, run: 3 }),
    /OpenAI 账号池不足以支持第 3 轮：仅有 2 个可用账号。/,
  );
  assert.equal(api.pickOpenAIAccountForRun(state, { accountId: 'b' }).id, 'b');
  assert.throws(() => api.pickOpenAIAccountForRun(state, { accountId: 'missing' }), /accountId.*not found|不存在/);
  assert.throws(() => api.pickOpenAIAccountForRun({ openaiAccountPoolEntries: [{ id: 'x', email: 'x@example.com', password: 'x', used: true }] }, { accountId: 'x' }), /unavailable|不可用/);
});

test('marks the current imported account used without logging its password', async () => {
  const api = makeApi();
  const result = await api.markCurrentOpenAIAccountUsed({
    currentOpenAIAccountId: 'a',
    openaiAccountPoolEntries: [{ id: 'a', email: 'a@example.com', password: 'do-not-log' }],
  });
  assert.equal(result.updated, true);
  assert.equal(api.persisted[0].openaiAccountPoolEntries[0].used, true);
  assert.match(String(api.persisted[0].openaiAccountPoolEntries[0].password), /do-not-log/);
  assert.equal(api.broadcasts[0].openaiAccountPoolEntries[0].lastUsedAt > 0, true);
  assert.equal(Object.prototype.hasOwnProperty.call(api.broadcasts[0].openaiAccountPoolEntries[0], 'password'), false);
});
