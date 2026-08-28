const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadSecurityUtils() {
  const source = fs.readFileSync('background/security-utils.js', 'utf8');
  const context = { console };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.MultiPageBackgroundSecurityUtils;
}

test('public state projection removes imported account passwords without mutating internal input', () => {
  const utils = loadSecurityUtils();
  const state = {
    password: 'flow-secret',
    openaiAccountPoolEntries: [
      { id: 'a', email: 'a@example.com', password: 'account-secret', used: false },
      { id: 'b', email: 'b@example.com', password: 'another-secret' },
    ],
    nested: { openaiAccountPoolEntries: [{ password: 'nested-secret', id: 'n' }] },
  };
  const publicState = utils.projectPublicState(state);
  assert.equal(JSON.stringify(publicState.openaiAccountPoolEntries), JSON.stringify([
    { id: 'a', email: 'a@example.com', used: false },
    { id: 'b', email: 'b@example.com' },
  ]));
  assert.equal(publicState.password, 'flow-secret');
  assert.equal(Object.hasOwn(publicState.nested.openaiAccountPoolEntries[0], 'password'), false);
  assert.equal(state.password, 'flow-secret');
  assert.equal(state.nested.openaiAccountPoolEntries[0].password, 'nested-secret');
  assert.equal(state.openaiAccountPoolEntries[0].password, 'account-secret');
});

test('message log metadata contains only safe message metadata', () => {
  const utils = loadSecurityUtils();
  const metadata = utils.buildMessageLogMetadata({
    type: 'IMPORT_OPENAI_ACCOUNTS', source: 'sidepanel', nodeId: 'import',
    payload: { password: 'do-not-log' }, password: 'also-do-not-log', token: 'secret',
  }, { tab: { id: 42 }, frameId: 3 });
  assert.equal(JSON.stringify(metadata), JSON.stringify({
    type: 'IMPORT_OPENAI_ACCOUNTS', source: 'sidepanel', nodeId: 'import', tabId: 42, frameId: 3,
  }));
  assert.doesNotMatch(JSON.stringify(metadata), /do-not-log|also-do-not-log|secret/);
});

test('GET_STATE uses injected public projection and retains internal state access', async () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const context = { self: {}, console, MultiPageFlowCapabilities: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  const internalState = { openaiAccountPoolEntries: [{ id: 'a', password: 'internal-secret' }] };
  const router = context.self.MultiPageBackgroundMessageRouter.createMessageRouter({
    getState: async () => internalState,
    getPublicState: async () => ({ openaiAccountPoolEntries: [{ id: 'a' }] }),
    normalizeNodeProtocolMessage: async (m) => m,
  });
  const result = await router.handleMessage({ type: 'GET_STATE' }, {});
  assert.deepEqual(result, { openaiAccountPoolEntries: [{ id: 'a' }] });
  assert.equal(internalState.openaiAccountPoolEntries[0].password, 'internal-secret');
});
