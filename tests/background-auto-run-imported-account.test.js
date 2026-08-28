const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractActiveEnsureAutoEmailReady() {
  const marker = 'async function ensureAutoEmailReady(';
  const start = source.lastIndexOf(marker);
  if (start < 0) {
    throw new Error('missing active ensureAutoEmailReady');
  }

  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error('missing active ensureAutoEmailReady body');
}

function createApi({ state, pickImpl }) {
  const bundle = extractActiveEnsureAutoEmailReady();
  return new Function('initialState', 'pickImpl', `
    let currentState = initialState;
    const setStateCalls = [];
    const logs = [];
    async function getState() { return currentState; }
    async function setState(patch) {
      setStateCalls.push(patch);
      currentState = { ...currentState, ...patch };
    }
    function pickOpenAIAccountForRun(state, options) { return pickImpl(state, options); }
    async function addLog(message, level) { logs.push({ message, level }); }
    function isHotmailProvider() { return false; }
    function isLuckmailProvider() { return false; }
    function isYydsMailProvider() { return false; }
    function isGeneratedAliasProvider() { return false; }
    function isCustomMailProvider() { return false; }
    function isCustomEmailPoolGenerator() { return false; }
    function shouldUseCustomRegistrationEmail() { return false; }
    ${bundle}
    return { ensureAutoEmailReady, setStateCalls, logs, getCurrentState: () => currentState };
  `)(state, pickImpl);
}

test('active auto-run ensureAutoEmailReady selects imported accounts for runs 1 and 2', async () => {
  const accounts = [
    { id: 'account-1', email: 'first@example.com', password: 'first-secret' },
    { id: 'account-2', email: 'second@example.com', password: 'second-secret' },
  ];
  const pickCalls = [];
  const api = createApi({
    state: { openaiAccountSource: 'imported-pool' },
    pickImpl(state, options) {
      pickCalls.push({ state, options });
      return accounts[options.run - 1];
    },
  });

  assert.equal(await api.ensureAutoEmailReady(1, 2, 1), 'first@example.com');
  assert.equal(await api.ensureAutoEmailReady(2, 2, 1), 'second@example.com');
  assert.deepEqual(pickCalls.map(({ options }) => options), [{ run: 1 }, { run: 2 }]);
  assert.deepEqual(api.setStateCalls, [
    {
      currentOpenAIAccountId: 'account-1', email: 'first@example.com', accountIdentifier: 'first@example.com',
      accountIdentifierType: 'email', password: 'first-secret',
    },
    {
      currentOpenAIAccountId: 'account-2', email: 'second@example.com', accountIdentifier: 'second@example.com',
      accountIdentifierType: 'email', password: 'second-secret',
    },
  ]);
  assert.equal(api.logs.some(({ message }) => message.includes('first-secret') || message.includes('second-secret')), false);
});

test('active auto-run ensureAutoEmailReady propagates imported-pool overflow without changing state', async () => {
  const api = createApi({
    state: { openaiAccountSource: 'imported-pool' },
    pickImpl(_state, { run }) {
      throw new Error(`OpenAI 账号池不足以支持第 ${run} 轮：仅有 2 个可用账号。`);
    },
  });

  await assert.rejects(() => api.ensureAutoEmailReady(3, 3, 1), /不足以支持第 3 轮/);
  assert.deepEqual(api.setStateCalls, []);
  assert.deepEqual(api.logs, []);
});

test('active auto-run ensureAutoEmailReady leaves non-imported sources unchanged', async () => {
  const api = createApi({
    state: { openaiAccountSource: '', email: 'existing@example.com' },
    pickImpl() {
      throw new Error('should not choose imported account');
    },
  });

  assert.equal(await api.ensureAutoEmailReady(1, 1, 1), 'existing@example.com');
  assert.deepEqual(api.setStateCalls, []);
  assert.deepEqual(api.logs, []);
});
