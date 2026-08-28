const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const VALID_CODE = 'ilUTmu195dD7ZtMI-huPjKMXjR65M6K-dloR3XzL1vTnypRYqC';

function loadModules() {
  const stateSource = fs.readFileSync('flows/grok/background/state.js', 'utf8');
  const runnerSource = fs.readFileSync('flows/grok/background/sub2api-oauth-runner.js', 'utf8');
  const scope = {};
  return new Function('self', `${stateSource}; ${runnerSource}; return {
    state: self.MultiPageBackgroundGrokState,
    runner: self.MultiPageBackgroundGrokSub2ApiOAuthRunner,
  };`)(scope);
}

function createInitialState(oauth = {}) {
  return {
    nodeStatuses: {
      'grok-upload-sso-to-webchat2api': 'completed',
      'grok-start-sub2api-oauth': 'completed',
      'grok-complete-sub2api-oauth': 'failed',
    },
    settingsState: {
      flows: {
        grok: {
          targets: {
            sub2api: {
              sub2apiUrl: 'https://sub2api.example.com',
              sub2apiEmail: 'admin@example.com',
              sub2apiPassword: 'admin-secret',
              sub2apiGroupName: 'grok-pool',
              sub2apiGroupNames: ['grok-pool'],
              sub2apiAccountPriority: 2,
              sub2apiDefaultProxyName: '',
            },
          },
        },
      },
    },
    runtimeState: {
      flowState: {
        grok: {
          register: { email: 'round@example.com' },
          upload: {
            targetId: 'webchat2api',
            status: 'uploaded',
            uploadedAt: 100,
            message: 'ok',
            targetUrl: 'https://webchat.example.com/api/remote-account/inject',
          },
          oauth,
        },
      },
    },
  };
}

function createHarness(options = {}) {
  const modules = loadModules();
  let currentState = modules.state.buildStateView(options.initialState || createInitialState());
  const writes = [];
  const logs = [];
  const completed = [];
  const removedTabs = [];
  const unregisteredTabs = [];
  const preparedContexts = [];
  const createdAccounts = [];
  const directScriptCalls = [];
  const directConsentResults = [...(options.directConsentResults || [])];
  const directPageStates = [...(options.directPageStates || [])];
  const directScriptPage = options.directScriptPage || null;
  const events = [];
  let ensureReadyCount = 0;
  const pageStates = [...(options.pageStates || [])];
  let nextTabId = 70;
  let clock = 2_000_000;

  const api = {
    async prepareGrokOAuth() {
      const context = {
        accountName: 'round@example.com',
        authUrl: 'https://auth.x.ai/oauth2/authorize?state=secret-state',
        sessionId: `session-${preparedContexts.length + 1}`,
        state: `state-${preparedContexts.length + 1}`,
        proxyId: null,
        groupIds: [31],
        targetUrl: 'https://sub2api.example.com/api/v1/admin/grok/oauth/auth-url',
      };
      preparedContexts.push(context);
      return context;
    },
    async createGrokAccountFromOAuth(_state, context, code) {
      createdAccounts.push({ context, code });
      return {
        account: { id: 101, name: 'round@example.com' },
        targetUrl: 'https://sub2api.example.com/api/v1/admin/grok/oauth/create-from-oauth',
        verifiedStatus: 'SUB2API 已创建 Grok OAuth 账号：round@example.com。',
      };
    },
  };

  const runner = modules.runner.createGrokSub2ApiOAuthRunner({
    addLog: async (message) => logs.push(message),
    chrome: {
      scripting: {
        async executeScript(options) {
          directScriptCalls.push(options);
          if (directScriptPage) {
            const previousWindow = global.window;
            const previousDocument = global.document;
            const previousLocation = global.location;
            global.window = directScriptPage.window;
            global.document = directScriptPage.document;
            global.location = directScriptPage.location;
            try {
              return [{ result: options.func(...(options.args || [])) }];
            } finally {
              global.window = previousWindow;
              global.document = previousDocument;
              global.location = previousLocation;
            }
          }
          if (options.args?.[0] === 'inspect-state') {
            events.push('direct-inspect');
            return [{ result: directPageStates.length ? directPageStates.shift() : null }];
          }
          events.push('direct-consent');
          return directConsentResults.shift() || [{ result: { clicked: false } }];
        },
      },
      tabs: {
        async remove(tabId) { removedTabs.push(tabId); },
        async update() {},
      },
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      events.push(`completed:${nodeId}`);
      completed.push({ nodeId, payload });
    },
    createSub2ApiApi: () => api,
    ensureContentScriptReadyOnTab: async () => { ensureReadyCount += 1; },
    getState: async () => currentState,
    getTabId: async () => currentState.runtimeState.flowState.grok.oauth?.authTabId ?? null,
    isTabAlive: async () => Number.isInteger(currentState.runtimeState.flowState.grok.oauth?.authTabId),
    normalizeSub2ApiUrl: (value) => value,
    registerTab: async () => {},
    unregisterTab: options.unregisterTab || (async (source, tabId) => { unregisteredTabs.push({ source, tabId }); }),
    reuseOrCreateTab: async () => nextTabId++,
    sendToContentScriptResilient: async (_source, message) => {
      events.push(message.type);
      if (message.type === 'EXECUTE_GROK_SUB2API_OAUTH_ACTION') {
        return { submitted: true };
      }
      return pageStates.shift() || { state: 'loading' };
    },
    setState: async (patch) => {
      writes.push(JSON.parse(JSON.stringify(patch)));
      currentState = modules.state.buildStateView({ ...currentState, ...patch });
    },
    sleepWithStop: async (ms) => {
      if (options.advanceClock) {
        clock += Math.max(0, Number(ms) || 0);
      }
    },
    throwIfStopped: () => {},
    waitForTabStableComplete: async () => {},
    GROK_SUB2API_OAUTH_INJECT_FILES: ['content/utils.js', 'flows/grok/content/sub2api-oauth-page.js'],
    now: options.now || (() => clock),
    preOAuthSettleMs: options.preOAuthSettleMs ?? 0,
    oauthSignInStuckMs: options.oauthSignInStuckMs ?? 45_000,
    oauthSignInMaxReloads: options.oauthSignInMaxReloads ?? 1,
    oauthReloadDelayMs: options.oauthReloadDelayMs ?? 0,
    postConsentWaitMs: options.postConsentWaitMs ?? 0,
  });

  return {
    api,
    completed,
    createdAccounts,
    directScriptCalls,
    events,
    getState: () => currentState,
    getEnsureReadyCount: () => ensureReadyCount,
    logs,
    preparedContexts,
    removedTabs,
    runner,
    unregisteredTabs,
    writes,
  };
}

test('Grok SUB2API OAuth start stores hidden context and opens the authorization tab', async () => {
  const harness = createHarness({
    pageStates: [
      { state: 'loading', url: 'https://auth.x.ai/oauth2/authorize' },
      { state: 'consent_page', url: 'https://auth.x.ai/oauth2/authorize' },
    ],
  });

  await harness.runner.executeGrokStartSub2ApiOAuth({ nodeId: 'grok-start-sub2api-oauth', step: 5 });
  const runtime = harness.getState().runtimeState.flowState.grok;

  assert.equal(harness.preparedContexts.length, 1);
  assert.equal(runtime.oauth.sessionId, 'session-1');
  assert.equal(runtime.oauth.state, 'state-1');
  assert.equal(runtime.oauth.authTabId, 70);
  assert.equal(runtime.oauth.status, 'awaiting_authorization');
  assert.equal(harness.completed.at(-1).nodeId, 'grok-start-sub2api-oauth');
  assert.equal(harness.getEnsureReadyCount() >= 1, true);
  assert.equal(harness.logs.filter((message) => message.includes('Chrome 页面加载已稳定')).length, 1);
  assert.equal(harness.logs.filter((message) => message.includes('内容脚本 PING 已连通')).length, 1);
  assert.deepEqual(harness.events.slice(-5), [
    'direct-inspect',
    'GET_GROK_SUB2API_OAUTH_STATE',
    'direct-inspect',
    'GET_GROK_SUB2API_OAUTH_STATE',
    'completed:grok-start-sub2api-oauth',
  ]);
  assert.equal(harness.logs.some((message) => message.includes('session-1') || message.includes('state-1')), false);
});

test('Grok SUB2API OAuth start uses a direct page probe when the content message path is stale', async () => {
  const harness = createHarness({
    directPageStates: [
      { state: 'loading' },
      { state: 'consent_page' },
    ],
  });

  await harness.runner.executeGrokStartSub2ApiOAuth({ nodeId: 'grok-start-sub2api-oauth', step: 7 });

  assert.equal(harness.completed.at(-1).nodeId, 'grok-start-sub2api-oauth');
  assert.deepEqual(harness.events.slice(-3), [
    'direct-inspect',
    'direct-inspect',
    'completed:grok-start-sub2api-oauth',
  ]);
  assert.equal(harness.events.includes('GET_GROK_SUB2API_OAUTH_STATE'), false);
  assert.equal(harness.logs.some((message) => (
    message.includes('secret-state')
      || message.includes('session-1')
      || message.includes('state-1')
      || message.includes('response_type=code')
  )), false);
});

test('Grok SUB2API OAuth start ignores a code page on /sign-in until consent is visible', async () => {
  const harness = createHarness({
    directPageStates: [
      { state: 'code_page', pathname: '/sign-in', diagnostic: { host: 'accounts.x.ai', path: '/sign-in' } },
      { state: 'sign_in', pathname: '/sign-in', diagnostic: { host: 'accounts.x.ai', path: '/sign-in' } },
      { state: 'consent_page', pathname: '/oauth2/consent', diagnostic: { host: 'accounts.x.ai', path: '/oauth2/consent' } },
    ],
  });

  await harness.runner.executeGrokStartSub2ApiOAuth({ nodeId: 'grok-start-sub2api-oauth' });

  assert.equal(harness.completed.at(-1).nodeId, 'grok-start-sub2api-oauth');
  assert.equal(harness.createdAccounts.length, 0);
  assert.equal(harness.logs.some((message) => message.includes('忽略未授权 code 状态')), true);
});

test('Grok SUB2API OAuth completion clicks allow, reads code locally, and creates the account', async () => {
  const harness = createHarness({
    initialState: createInitialState({
      sessionId: 'session-existing',
      state: 'state-existing',
      authUrl: 'https://auth.x.ai/oauth2/authorize',
      authTabId: 72,
      proxyId: null,
      groupIds: [31],
      status: 'awaiting_authorization',
      startedAt: 1_999_000,
    }),
    pageStates: [
      { state: 'consent_page', url: 'https://auth.x.ai/oauth2/authorize' },
      { state: 'code_page', code: VALID_CODE, url: 'https://accounts.x.ai/oauth2/consent', pathname: '/oauth2/consent' },
    ],
  });

  await harness.runner.executeGrokCompleteSub2ApiOAuth({ nodeId: 'grok-complete-sub2api-oauth', step: 6 });
  const runtime = harness.getState().runtimeState.flowState.grok;

  assert.equal(harness.createdAccounts.length, 1);
  assert.equal(harness.getEnsureReadyCount() >= 2, true);
  assert.equal(harness.createdAccounts[0].code, VALID_CODE);
  assert.equal(runtime.oauth.sessionId, '');
  assert.equal(runtime.oauth.state, '');
  assert.equal(runtime.oauth.authUrl, '');
  assert.equal(runtime.oauth.status, 'completed');
  assert.equal(runtime.upload.status, 'uploaded');
  assert.equal(harness.writes.some((patch) => (
    patch?.runtimeState?.flowState?.grok?.oauth?.status === 'authorizing'
      && patch?.runtimeState?.flowState?.grok?.upload?.status === 'authorizing'
  )), true);
  assert.equal(harness.completed.at(-1).nodeId, 'grok-complete-sub2api-oauth');
  assert.equal(JSON.stringify(harness.writes).includes(VALID_CODE), false);
  assert.equal(harness.logs.some((message) => message.includes(VALID_CODE)), false);
  assert.deepEqual(harness.removedTabs, [72]);
  assert.deepEqual(harness.unregisteredTabs, [{ source: 'grok-sub2api-oauth-page', tabId: 72 }]);
});

test('Grok SUB2API OAuth completion rejects a code page on /sign-in before consent', async () => {
  const harness = createHarness({
    initialState: createInitialState({
      sessionId: 'session-existing',
      state: 'state-existing',
      authUrl: 'https://accounts.x.ai/oauth2/consent',
      authTabId: 72,
      groupIds: [31],
      status: 'awaiting_authorization',
      startedAt: 1_999_000,
    }),
    directConsentResults: [
      [{ result: { clicked: false, state: 'sign_in', pathname: '/sign-in', diagnostic: { path: '/sign-in' } } }],
      [{ result: { clicked: true, state: 'consent_submitted', pathname: '/oauth2/consent', diagnostic: { path: '/oauth2/consent' } } }],
    ],
    pageStates: [
      { state: 'code_page', code: VALID_CODE, url: 'https://accounts.x.ai/sign-in', pathname: '/sign-in' },
      { state: 'code_page', code: VALID_CODE, url: 'https://accounts.x.ai/oauth2/consent', pathname: '/oauth2/consent' },
    ],
  });

  await harness.runner.executeGrokCompleteSub2ApiOAuth({ nodeId: 'grok-complete-sub2api-oauth' });

  assert.equal(harness.createdAccounts.length, 1);
  assert.equal(harness.createdAccounts[0].code, VALID_CODE);
  assert.equal(harness.logs.some((message) => message.includes('丢弃不可信 code 状态')), true);
});

test('Grok SUB2API OAuth completion reopens one authorization tab after a persistent sign-in page', async () => {
  const harness = createHarness({
    initialState: createInitialState({
      sessionId: 'session-existing',
      state: 'state-existing',
      authUrl: 'https://accounts.x.ai/oauth2/consent',
      authTabId: 72,
      groupIds: [31],
      status: 'awaiting_authorization',
      startedAt: 1_999_000,
    }),
    advanceClock: true,
    oauthSignInStuckMs: 1_000,
    directConsentResults: [
      [{ result: { clicked: false, state: 'sign_in', pathname: '/sign-in', diagnostic: { path: '/sign-in' } } }],
      [{ result: { clicked: false, state: 'sign_in', pathname: '/sign-in', diagnostic: { path: '/sign-in' } } }],
      [{ result: { clicked: false, state: 'sign_in', pathname: '/sign-in', diagnostic: { path: '/sign-in' } } }],
      [{ result: { clicked: true, state: 'consent_submitted', pathname: '/oauth2/consent', diagnostic: { path: '/oauth2/consent' } } }],
    ],
    pageStates: [
      { state: 'sign_in', pathname: '/sign-in', url: 'https://accounts.x.ai/sign-in' },
      { state: 'sign_in', pathname: '/sign-in', url: 'https://accounts.x.ai/sign-in' },
      { state: 'code_page', code: VALID_CODE, pathname: '/oauth2/consent', url: 'https://accounts.x.ai/oauth2/consent' },
    ],
  });

  await harness.runner.executeGrokCompleteSub2ApiOAuth({ nodeId: 'grok-complete-sub2api-oauth' });

  assert.equal(harness.createdAccounts.length, 1);
  assert.equal(harness.removedTabs.includes(72), true);
  assert.equal(harness.logs.some((message) => message.includes('持续停在登录页')), true);
});

test('Grok SUB2API OAuth completion directly clicks consent when the content script keeps loading', async () => {
  const harness = createHarness({
    initialState: createInitialState({
      sessionId: 'session-existing',
      state: 'state-existing',
      authUrl: 'https://auth.x.ai/oauth2/authorize',
      authTabId: 72,
      proxyId: null,
      groupIds: [31],
      status: 'awaiting_authorization',
      startedAt: 1_999_000,
    }),
    directConsentResults: [[{ result: { clicked: true } }]],
    pageStates: [
      { state: 'loading', url: 'https://auth.x.ai/oauth2/authorize' },
      { state: 'code_page', code: VALID_CODE, url: 'https://accounts.x.ai/oauth2/consent', pathname: '/oauth2/consent' },
    ],
  });

  await harness.runner.executeGrokCompleteSub2ApiOAuth({ nodeId: 'grok-complete-sub2api-oauth' });

  assert.equal(harness.directScriptCalls.length, 1);
  assert.deepEqual(harness.directScriptCalls[0].target, { tabId: 72 });
  assert.equal(typeof harness.directScriptCalls[0].func, 'function');
  assert.equal(harness.events[0], 'direct-consent');
  assert.equal(harness.createdAccounts.length, 1);
  assert.equal(harness.logs.some((message) => message.includes('正在自动确认 Grok OAuth 授权')), true);
});

test('Grok SUB2API OAuth diagnostics do not repeat unchanged DOM and content states', async () => {
  const harness = createHarness({
    initialState: createInitialState({
      sessionId: 'session-existing',
      state: 'state-existing',
      authUrl: 'https://accounts.x.ai/oauth2/consent',
      authTabId: 72,
      proxyId: null,
      groupIds: [31],
      status: 'awaiting_authorization',
      startedAt: 1_999_000,
    }),
    directConsentResults: [
      [{ result: { state: 'consent_waiting', clicked: false } }],
      [{ result: { state: 'consent_waiting', clicked: false } }],
      [{ result: { state: 'consent_waiting', clicked: false } }],
    ],
    pageStates: [
      { state: 'loading' },
      { state: 'loading' },
      { state: 'code_page', code: VALID_CODE, url: 'https://accounts.x.ai/oauth2/consent', pathname: '/oauth2/consent' },
    ],
  });

  await harness.runner.executeGrokCompleteSub2ApiOAuth({ nodeId: 'grok-complete-sub2api-oauth' });

  assert.equal(harness.logs.filter((message) => message.includes('授权页状态：')).length, 1);
  assert.equal(harness.logs.filter((message) => message.includes('内容脚本状态：state=loading')).length, 1);
});

test('Grok SUB2API OAuth completion clicks allow when consent page also contains code-page copy', async () => {
  let clickCount = 0;
  const allowButton = {
    disabled: false,
    textContent: '允许',
    value: '',
    click() { clickCount += 1; },
    getAttribute() { return ''; },
    getBoundingClientRect() { return { width: 250, height: 40 }; },
  };
  const harness = createHarness({
    initialState: createInitialState({
      sessionId: 'session-existing',
      state: 'state-existing',
      authUrl: 'https://accounts.x.ai/oauth2/consent',
      authTabId: 72,
      proxyId: null,
      groupIds: [31],
      status: 'awaiting_authorization',
      startedAt: 1_999_000,
    }),
    directScriptPage: {
      window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
      document: {
        title: 'Authorize Grok Build',
        body: { textContent: '授权 Grok Build 输入此代码以完成登录' },
        readyState: 'complete',
        querySelectorAll: () => [allowButton],
      },
      location: { hostname: 'accounts.x.ai', pathname: '/oauth2/consent' },
    },
    pageStates: [{ state: 'code_page', code: VALID_CODE, url: 'https://accounts.x.ai/oauth2/consent', pathname: '/oauth2/consent' }],
  });

  await harness.runner.executeGrokCompleteSub2ApiOAuth({ nodeId: 'grok-complete-sub2api-oauth' });

  assert.equal(clickCount, 1);
  assert.equal(harness.createdAccounts.length, 1);
  assert.equal(harness.logs.filter((message) => (
    message.includes('[Grok OAuth 诊断]') && message.includes('已点击允许')
  )).length, 1);
  assert.equal(harness.logs.some((message) => message.includes('clicked=no')), false);
});

test('Grok SUB2API OAuth retry regenerates an errored session without touching webchat completion', async () => {
  const harness = createHarness({
    initialState: createInitialState({
      status: 'error',
      lastError: 'old failure',
      startedAt: 1_000,
    }),
    pageStates: [
      { state: 'consent_page', url: 'https://auth.x.ai/oauth2/authorize' },
      { state: 'code_page', code: VALID_CODE, url: 'https://accounts.x.ai/oauth2/consent', pathname: '/oauth2/consent' },
    ],
  });

  await harness.runner.executeGrokCompleteSub2ApiOAuth({ nodeId: 'grok-complete-sub2api-oauth', step: 8 });

  assert.equal(harness.preparedContexts.length, 1);
  assert.equal(harness.createdAccounts[0].context.sessionId, 'session-1');
  assert.equal(harness.getState().nodeStatuses['grok-upload-sso-to-webchat2api'], 'completed');
});

test('Grok SUB2API OAuth completion preserves a reopened authorization tab id', async () => {
  const harness = createHarness({
    initialState: createInitialState({
      sessionId: 'session-existing',
      state: 'state-existing',
      authUrl: 'https://auth.x.ai/oauth2/authorize',
      authTabId: null,
      groupIds: [31],
      status: 'awaiting_authorization',
      startedAt: 1_999_000,
    }),
    pageStates: [{ state: 'code_page', code: VALID_CODE, url: 'https://accounts.x.ai/oauth2/consent', pathname: '/oauth2/consent' }],
  });

  await harness.runner.executeGrokCompleteSub2ApiOAuth({ nodeId: 'grok-complete-sub2api-oauth' });

  const authorizingPatch = harness.writes.find((patch) => (
    patch?.runtimeState?.flowState?.grok?.oauth?.status === 'authorizing'
  ));
  assert.equal(authorizingPatch.runtimeState.flowState.grok.oauth.authTabId, 70);
});

test('Grok SUB2API OAuth cleanup closes the authorization tab without discarding a reusable session', async () => {
  const harness = createHarness({
    initialState: createInitialState({
      sessionId: 'session-existing',
      state: 'state-existing',
      authUrl: 'https://auth.x.ai/oauth2/authorize',
      authTabId: 72,
      groupIds: [31],
      status: 'awaiting_authorization',
      startedAt: 1_999_000,
    }),
  });

  await harness.runner.cleanupAuthorizationTab();

  const oauth = harness.getState().runtimeState.flowState.grok.oauth;
  assert.deepEqual(harness.removedTabs, [72]);
  assert.deepEqual(harness.unregisteredTabs, [{ source: 'grok-sub2api-oauth-page', tabId: 72 }]);
  assert.equal(oauth.authTabId, null);
  assert.equal(oauth.sessionId, 'session-existing');
  assert.equal(oauth.state, 'state-existing');
});

test('Grok SUB2API OAuth account creation stays successful when tab unregister cleanup fails', async () => {
  const harness = createHarness({
    initialState: createInitialState({
      sessionId: 'session-existing',
      state: 'state-existing',
      authUrl: 'https://auth.x.ai/oauth2/authorize',
      authTabId: 72,
      groupIds: [31],
      status: 'awaiting_authorization',
      startedAt: 1_999_000,
    }),
    pageStates: [{ state: 'code_page', code: VALID_CODE, url: 'https://accounts.x.ai/oauth2/consent', pathname: '/oauth2/consent' }],
    unregisterTab: async () => { throw new Error('registry unavailable'); },
  });

  await assert.doesNotReject(
    harness.runner.executeGrokCompleteSub2ApiOAuth({ nodeId: 'grok-complete-sub2api-oauth' })
  );
  assert.equal(harness.createdAccounts.length, 1);
  assert.equal(harness.completed.at(-1).nodeId, 'grok-complete-sub2api-oauth');
});
