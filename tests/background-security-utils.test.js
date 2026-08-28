const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const securityUtils = (() => {
  const source = fs.readFileSync('background/security-utils.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundSecurityUtils;`)(globalScope);
})();

const messageRouterApi = (() => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = { console };
  return new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);
})();

test('public state projection removes imported OpenAI account passwords without mutating internal state', () => {
  const internalState = {
    openaiAccountPoolEntries: [{
      id: 'account-1',
      email: 'account@example.com',
      password: 'private-password',
      enabled: true,
      used: false,
    }],
    nested: { retained: true },
  };

  const publicState = securityUtils.projectPublicState(internalState);

  assert.equal(Object.hasOwn(publicState.openaiAccountPoolEntries[0], 'password'), false);
  assert.equal(internalState.openaiAccountPoolEntries[0].password, 'private-password');
  assert.deepEqual(publicState.nested, { retained: true });
});

test('public state projection preserves ordinary settings while removing nested OpenAI account passwords', () => {
  const internalState = {
    activeFlowId: 'openai',
    settingsState: {
      openaiAccountPoolEntries: [{ id: 'nested-account', email: 'nested@example.com', password: 'pool-secret' }],
      services: {
        account: { customPassword: 'custom-secret' },
        proxy: { ipProxyPassword: 'proxy-secret' },
      },
      flows: {
        openai: { targets: { cpa: { vpsPassword: 'vps-secret' }, sub2api: { sub2apiPassword: 'sub2api-secret' } } },
      },
    },
    accountRunHistory: [{ email: 'history@example.com', password: 'history-secret', finalStatus: 'success' }],
    providers: {
      paypalPassword: 'paypal-secret',
      cloud: { cloudMailAdminPassword: 'mail-secret', luckmailApiKey: 'luckmail-secret' },
      sms: { heroSmsApiKey: 'hero-secret', fiveSimApiKey: 'five-secret', nexSmsApiKey: 'nex-secret' },
      duckDdgToken: 'duck-secret',
    },
    nonSensitive: { enabled: true, endpoint: 'https://example.test' },
  };

  const publicState = securityUtils.projectPublicState(internalState);

  assert.equal(publicState.settingsState.services.account.customPassword, 'custom-secret');
  assert.equal(publicState.settingsState.flows.openai.targets.cpa.vpsPassword, 'vps-secret');
  assert.equal(publicState.accountRunHistory[0].password, 'history-secret');
  assert.equal(publicState.providers.cloud.cloudMailAdminPassword, 'mail-secret');
  assert.equal(publicState.providers.cloud.luckmailApiKey, 'luckmail-secret');
  assert.equal(Object.hasOwn(publicState.settingsState.openaiAccountPoolEntries[0], 'password'), false);
  assert.deepEqual(publicState.nonSensitive, internalState.nonSensitive);
  assert.equal(internalState.settingsState.openaiAccountPoolEntries[0].password, 'pool-secret');
  assert.equal(internalState.accountRunHistory[0].password, 'history-secret');
});

test('message log metadata contains only safe routing metadata', () => {
  const metadata = securityUtils.buildMessageLogMetadata({
    type: 'SAVE_SETTING',
    source: 'sidepanel',
    nodeId: 'oauth-login',
    payload: {
      openaiAccountPoolEntries: [{ password: 'private-password' }],
    },
  }, {
    tab: { id: 11 },
    frameId: 0,
  });

  assert.deepEqual(metadata, {
    type: 'SAVE_SETTING',
    source: 'sidepanel',
    nodeId: 'oauth-login',
    tabId: 11,
    frameId: 0,
  });
  assert.equal(JSON.stringify(metadata).includes('private-password'), false);
});

test('public account list projection keeps entries without passwords', () => {
  const entries = securityUtils.projectPublicState({
    openaiAccountPoolEntries: [{ id: 'account-1', email: 'account@example.com', password: 'private-password' }],
  }).openaiAccountPoolEntries;
  const utils = require('../openai-account-pool-utils');
  assert.equal(utils.normalizeOpenAIAccountListEntries(entries).length, 1);
  assert.equal(Object.hasOwn(entries[0], 'password'), false);
});

test('message router merges passwords when SAVE_SETTING receives public pool rows', async () => {
  const internalState = { openaiAccountPoolEntries: [{ id: 'account-1', email: 'account@example.com', password: 'private-password' }] };
  let saved;
  const router = messageRouterApi.createMessageRouter({
    getState: async () => internalState,
    getPublicState: async () => securityUtils.projectPublicState(internalState),
    buildPersistentSettingsPayload: (value) => value,
    buildLuckmailSessionSettingsPayload: () => ({}),
    mergeOpenAIAccountPoolEntries: (existing, requested) => [{ ...existing[0], ...requested[0], password: existing[0].password }],
    setPersistentSettings: async (value) => { saved = value; return value; },
    setState: async () => {},
    validateModeSwitch: () => ({ ok: true, normalizedUpdates: {} }),
    resolveSignupMethod: () => 'email',
    normalizeSignupMethod: () => 'email',
    getNodeIdsForState: () => [],
    broadcastDataUpdate: () => {},
  });
  const response = await router.handleMessage({
    type: 'SAVE_SETTING',
    payload: { openaiAccountPoolEntries: [{ id: 'account-1', email: 'account@example.com', enabled: false }] },
  }, {});
  assert.equal(saved.openaiAccountPoolEntries[0].password, 'private-password');
  assert.equal(Object.hasOwn(response.state.openaiAccountPoolEntries[0], 'password'), false);
});

test('GET_STATE responds with the injected public state projection', async () => {
  const internalState = {
    openaiAccountPoolEntries: [{
      id: 'account-1',
      email: 'account@example.com',
      password: 'private-password',
    }],
    settingsState: { services: { account: { customPassword: 'custom-secret' } } },
    accountRunHistory: [{ password: 'history-secret' }],
  };
  const router = messageRouterApi.createMessageRouter({
    getState: async () => internalState,
    getPublicState: async () => securityUtils.projectPublicState(internalState),
  });

  const response = await router.handleMessage({ type: 'GET_STATE' }, {});

  assert.equal(Object.hasOwn(response.openaiAccountPoolEntries[0], 'password'), false);
  assert.equal(response.settingsState.services.account.customPassword, 'custom-secret');
  assert.equal(internalState.openaiAccountPoolEntries[0].password, 'private-password');
  assert.equal(internalState.settingsState.services.account.customPassword, 'custom-secret');
});
