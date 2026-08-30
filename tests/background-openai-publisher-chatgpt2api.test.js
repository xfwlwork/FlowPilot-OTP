const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadPublisherApi() {
  const source = fs.readFileSync('flows/openai/background/publisher-chatgpt2api.js', 'utf8');
  const globalScope = {};
  new Function('self', `${source}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundOpenAiPublisherChatgpt2Api;
}

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    text: async () => JSON.stringify(payload),
  };
}

test('OpenAI ChatGPT2API publisher exposes helpers and normalizes to accounts endpoint', () => {
  const api = loadPublisherApi();

  assert.equal(typeof api?.createOpenAiChatgpt2ApiPublisher, 'function');
  assert.equal(
    api.buildChatgpt2ApiAccountsUrl('https://remote.example.com/admin/deep/path'),
    'https://remote.example.com/api/accounts'
  );
  assert.equal(
    api.buildChatgpt2ApiAccountsUrl('remote.example.com/admin'),
    'http://remote.example.com/api/accounts'
  );
  assert.equal(api.buildChatgpt2ApiOAuthStartUrl('https://remote.example.com/admin'), 'https://remote.example.com/api/accounts/oauth/start');
  assert.equal(api.buildChatgpt2ApiOAuthFinishUrl('https://remote.example.com/admin'), 'https://remote.example.com/api/accounts/oauth/finish');
});

test('OpenAI ChatGPT2API OAuth start and finish use bearer admin auth and exact request bodies', async () => {
  const api = loadPublisherApi();
  const requests = [];
  const callback = 'https://platform.openai.com/auth/callback?code=code-value&state=state-value';
  const fetchImpl = async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization, body: JSON.parse(options.body) });
    return createJsonResponse(url.endsWith('/start')
      ? { session_id: 'session-value', authorize_url: 'https://auth.openai.com/api/accounts/authorize?state=x', expires_in: '600' }
      : { added: 1, skipped: 0, refreshed: 1, errors: [] });
  };

  const started = await api.startOpenAiOAuthImportOnChatgpt2Api('https://remote.example.com/admin/path', 'admin-key', fetchImpl);
  const finished = await api.finishOpenAiOAuthImportOnChatgpt2Api(
    'https://remote.example.com/admin/path', 'admin-key', started.sessionId, callback, fetchImpl
  );

  assert.deepEqual(requests, [{
    url: 'https://remote.example.com/api/accounts/oauth/start',
    authorization: 'Bearer admin-key',
    body: { email_hint: '' },
  }, {
    url: 'https://remote.example.com/api/accounts/oauth/finish',
    authorization: 'Bearer admin-key',
    body: { session_id: 'session-value', callback },
  }]);
  assert.equal(started.expiresInSeconds, 600);
  assert.equal(finished.message, '新增 1 个，跳过 0 个，刷新 1 个');
});

test('OpenAI ChatGPT2API OAuth rejects untrusted authorize and incomplete callback URLs', async () => {
  const api = loadPublisherApi();
  await assert.rejects(() => api.startOpenAiOAuthImportOnChatgpt2Api(
    'https://remote.example.com', 'admin-key', async () => createJsonResponse({
      session_id: 'session-value', authorize_url: 'https://evil.example.com/login', expires_in: 600,
    })
  ), /不是受支持的 OpenAI 登录地址/);
  assert.equal(api.parseChatgpt2ApiCallbackUrl('https://platform.openai.com/auth/callback?code=only-code'), '');
  assert.equal(api.parseChatgpt2ApiCallbackUrl('https://evil.example.com/auth/callback?code=x&state=y'), '');
});

test('OpenAI ChatGPT2API OAuth surfaces FastAPI errors and rejects non-JSON success responses', async () => {
  const api = loadPublisherApi();
  await assert.rejects(() => api.startOpenAiOAuthImportOnChatgpt2Api(
    'https://remote.example.com', 'admin-key', async () => createJsonResponse({ detail: 'admin auth required' }, 401)
  ), /admin auth required/);
  await assert.rejects(() => api.startOpenAiOAuthImportOnChatgpt2Api(
    'https://remote.example.com', 'admin-key', async () => ({
      ok: true, status: 200, statusText: 'OK', text: async () => '<html>not json</html>',
    })
  ), /响应不是有效 JSON/);
});

test('OpenAI ChatGPT2API OAuth executor captures callback, finishes once, and marks account used', async () => {
  const api = loadPublisherApi();
  const callback = 'https://platform.openai.com/auth/callback?code=secret-code&state=secret-state';
  const completed = [];
  const logs = [];
  const requests = [];
  let marked = 0;
  let liveState = {
    targetId: 'chatgpt2api',
    openaiAccountSource: 'imported-pool',
    openaiChatgpt2ApiUrl: 'https://remote.example.com/admin',
    openaiChatgpt2ApiAdminKey: 'admin-key',
    openaiChatgpt2ApiOAuthSessionId: 'session-value',
    openaiChatgpt2ApiOAuthExpiresAt: Date.now() + 60000,
  };
  const publisher = api.createOpenAiChatgpt2ApiPublisher({
    addLog: async (message) => logs.push(message),
    chrome: { tabs: { get: async () => ({ id: 7, url: callback }) } },
    completeNodeFromBackground: async (nodeId, payload) => completed.push({ nodeId, payload }),
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return createJsonResponse({ added: 1, skipped: 0, refreshed: 1, errors: [] });
    },
    getState: async () => ({ ...liveState }),
    getTabId: async () => 7,
    markCurrentOpenAIAccountUsed: async () => { marked += 1; },
    setState: async (patch) => { liveState = { ...liveState, ...patch }; },
    sleepWithStop: async () => {},
  });

  await publisher.executeChatgpt2ApiCaptureOAuthCallback({ nodeId: 'chatgpt2api-capture-oauth-callback', visibleStep: 9 });
  await publisher.executeChatgpt2ApiFinishOAuthImport({ nodeId: 'chatgpt2api-finish-oauth-import', visibleStep: 10 });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { session_id: 'session-value', callback });
  assert.equal(marked, 1);
  assert.deepEqual(completed.map((entry) => entry.nodeId), ['chatgpt2api-capture-oauth-callback', 'chatgpt2api-finish-oauth-import']);
  assert.equal(liveState.openaiChatgpt2ApiOAuthSessionId, '');
  assert.equal(logs.some((message) => message.includes('session-value') || message.includes('secret-code') || message.includes('secret-state')), false);
});

test('OpenAI ChatGPT2API publisher builds token import payload', () => {
  const api = loadPublisherApi();

  assert.deepEqual(api.buildOpenAiSessionImportPayload(
    {
      accessToken: 'session-token',
      user: { email: 'flow@example.com' },
    },
    ''
  ), {
    tokens: ['session-token'],
  });

  assert.throws(
    () => api.buildOpenAiSessionImportPayload(null, ''),
    /缺少 ChatGPT 会话 accessToken/
  );
});

test('OpenAI ChatGPT2API publisher posts tokens with bearer admin key', async () => {
  const api = loadPublisherApi();
  const requests = [];

  const result = await api.uploadOpenAiSessionToChatgpt2Api(
    'https://remote.example.com/admin/deep/path',
    ' admin-secret ',
    {
      session: {
        accessToken: 'session-token',
        user: { email: 'flow@example.com' },
      },
      accessToken: 'session-token',
    },
    async (url, options = {}) => {
      requests.push({
        url,
        method: options.method,
        authorization: options.headers?.Authorization,
        contentType: options.headers?.['Content-Type'],
        body: JSON.parse(options.body),
      });
      return createJsonResponse({ added: 1, skipped: 0, refreshed: 1, errors: [] });
    }
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://remote.example.com/api/accounts');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].authorization, 'Bearer admin-secret');
  assert.equal(requests[0].contentType, 'application/json');
  assert.deepEqual(requests[0].body, { tokens: ['session-token'] });
  assert.equal(result.endpointUrl, 'https://remote.example.com/api/accounts');
  assert.equal(result.message, '新增 1 个，跳过 0 个，刷新 1 个');
});

test('OpenAI ChatGPT2API publisher surfaces validation detail on upload failure', async () => {
  const api = loadPublisherApi();

  await assert.rejects(
    () => api.uploadOpenAiSessionToChatgpt2Api(
      'https://remote.example.com/admin',
      'admin-secret',
      { accessToken: 'session-token' },
      async () => createJsonResponse({
        detail: [{
          loc: ['body', 'tokens'],
          msg: 'tokens is required',
          type: 'value_error',
        }],
      }, 422)
    ),
    /tokens: tokens is required/
  );
});

test('OpenAI ChatGPT2API executor reads latest state and writes upload status without leaking secrets', async () => {
  const api = loadPublisherApi();
  const requests = [];
  const logs = [];
  const broadcasts = [];
  const completed = [];
  const sessionReadCalls = [];
  const stepResolutionCalls = [];
  let liveState = {
    openaiChatgpt2ApiUrl: '',
    openaiChatgpt2ApiAdminKey: '',
    settingsState: {
      flows: {
        openai: {
          targets: {
            chatgpt2api: {
              baseUrl: 'https://remote.example.com/admin',
              apiKey: 'live-admin-key',
            },
          },
        },
      },
    },
  };
  const publisher = api.createOpenAiChatgpt2ApiPublisher({
    addLog: async (message, level) => logs.push({ message, level }),
    broadcastDataUpdate: (updates) => broadcasts.push(updates),
    completeNodeFromBackground: async (nodeId, payload) => completed.push({ nodeId, payload }),
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async (state, options) => {
        sessionReadCalls.push({ state, options });
        return {
          session: {
            accessToken: 'live-session-token',
            user: { email: 'flow@example.com' },
          },
          accessToken: 'live-session-token',
          tabId: 91,
        };
      },
    }),
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url,
        authorization: options.headers?.Authorization,
        body: JSON.parse(options.body),
      });
      return createJsonResponse({ added: 1, skipped: 0, refreshed: 1, errors: [] });
    },
    getStepIdByKeyForState: (stepKey, state) => {
      stepResolutionCalls.push({ stepKey, state });
      return 7;
    },
    getState: async () => ({ ...liveState }),
    setState: async (updates = {}) => {
      liveState = { ...liveState, ...updates };
    },
  });

  const executionState = {
    nodeId: 'openai-upload-session-to-chatgpt2api',
    openaiChatgpt2ApiAdminKey: 'stale-key',
  };
  await publisher.executeOpenAiUploadSessionToChatgpt2Api(executionState);

  assert.deepEqual(stepResolutionCalls, [{
    stepKey: 'openai-upload-session-to-chatgpt2api',
    state: executionState,
  }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://remote.example.com/api/accounts');
  assert.equal(requests[0].authorization, 'Bearer live-admin-key');
  assert.deepEqual(requests[0].body, { tokens: ['live-session-token'] });
  assert.equal(sessionReadCalls.length, 1);
  assert.deepEqual(sessionReadCalls[0].options, {
    visibleStep: 7,
    targetLabel: 'ChatGPT2API',
    requiredFields: ['accessToken'],
  });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].nodeId, 'openai-upload-session-to-chatgpt2api');
  assert.equal(completed[0].payload.openaiChatgpt2ApiUploadStatus, 'uploaded');
  assert.equal(completed[0].payload.openaiChatgpt2ApiUploadMessage, '新增 1 个，跳过 0 个，刷新 1 个');
  assert.equal(completed[0].payload.openaiChatgpt2ApiTargetUrl, 'https://remote.example.com/api/accounts');
  assert.equal(typeof completed[0].payload.openaiChatgpt2ApiUploadedAt, 'number');
  assert.equal(broadcasts.some((entry) => entry.openaiChatgpt2ApiUploadStatus === 'uploaded'), true);
  assert.equal(logs.some(({ message }) => message.includes('live-session-token') || message.includes('live-admin-key')), false);
  assert.equal(
    logs.some(({ message }) => message.includes('ChatGPT 会话已上传到 ChatGPT2API，状态：新增 1 个，跳过 0 个，刷新 1 个。')),
    true
  );
});

test('OpenAI ChatGPT2API executor persists failure state without completing or leaking secrets', async () => {
  const api = loadPublisherApi();
  const logs = [];
  const completed = [];
  let liveState = {
    settingsState: {
      flows: {
        openai: {
          targets: {
            chatgpt2api: {
              baseUrl: 'https://remote.example.com/admin',
              apiKey: 'secret-admin-key',
            },
          },
        },
      },
    },
  };
  const publisher = api.createOpenAiChatgpt2ApiPublisher({
    addLog: async (message, level) => logs.push({ message, level }),
    completeNodeFromBackground: async (nodeId, payload) => completed.push({ nodeId, payload }),
    createOpenAiSessionReader: () => ({
      readCurrentSessionFromState: async () => ({
        session: { accessToken: 'secret-session-token' },
        accessToken: 'secret-session-token',
      }),
    }),
    fetchImpl: async () => createJsonResponse({ error: 'invalid admin key' }, 403),
    getState: async () => ({ ...liveState }),
    setState: async (updates = {}) => {
      liveState = { ...liveState, ...updates };
    },
  });

  await assert.rejects(
    () => publisher.executeOpenAiUploadSessionToChatgpt2Api({
      nodeId: 'openai-upload-session-to-chatgpt2api',
      visibleStep: 7,
    }),
    /ChatGPT2API 会话上传失败：invalid admin key/
  );

  assert.equal(completed.length, 0);
  assert.equal(liveState.openaiChatgpt2ApiUploadStatus, 'error');
  assert.equal(liveState.openaiChatgpt2ApiUploadedAt, 0);
  assert.equal(liveState.openaiChatgpt2ApiUploadMessage, 'ChatGPT2API 会话上传失败：invalid admin key');
  assert.equal(liveState.openaiChatgpt2ApiTargetUrl, 'https://remote.example.com/api/accounts');
  assert.equal(logs.some(({ message }) => message.includes('secret-session-token') || message.includes('secret-admin-key')), false);
});
