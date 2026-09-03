const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadStep7() {
  const source = fs.readFileSync('flows/openai/background/steps/oauth-login.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageBackgroundStep7;`)({});
}

function makeExecutor(overrides = {}) {
  const events = { payloads: [], refreshStates: [], logs: [] };
  const api = loadStep7();
  const executor = api.createStep7Executor({
    addLog: async (message) => events.logs.push(String(message)),
    completeNodeFromBackground: async () => {},
    getErrorMessage: (error) => error?.message || String(error || ''),
    getLoginAuthStateLabel: (state) => state || 'unknown',
    getState: async () => ({}),
    isStep6RecoverableResult: () => false,
    isStep6SuccessResult: () => true,
    refreshOAuthUrlBeforeStep6: async (state) => {
      events.refreshStates.push(state);
      return 'https://oauth.example/login';
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_name, message) => {
      events.payloads.push(message.payload);
      return { step6Outcome: 'success', state: 'verification_page' };
    },
    STEP6_MAX_ATTEMPTS: 1,
    throwIfStopped: () => {},
    ...overrides,
  });
  return { executor, events };
}

test('step 7 resolves the selected imported account before identity validation and injects credentials', async () => {
  const completions = [];
  const { executor, events } = makeExecutor({
    resolveImportedAccountCredentials: (state) => {
      assert.equal(state.currentOpenAIAccountId, 'account-1');
      return { email: 'imported@example.com', password: 'secret-not-for-logs' };
    },
    completeNodeFromBackground: async (_nodeId, payload) => completions.push(payload),
  });

  await executor.executeStep7({
    openaiAccountSource: 'imported-pool',
    currentOpenAIAccountId: 'account-1',
  });

  assert.equal(events.payloads[0].email, 'imported@example.com');
  assert.equal(events.payloads[0].accountIdentifier, 'imported@example.com');
  assert.equal(events.payloads[0].loginIdentifierType, 'email');
  assert.equal(events.payloads[0].password, 'secret-not-for-logs');
  assert.equal(events.refreshStates[0].password, 'secret-not-for-logs');
  assert.equal(events.logs.some((message) => message.includes('secret-not-for-logs')), false);
  assert.equal(completions[0].currentOpenAIAccountId, 'account-1');
});

test('step 7 selects the first eligible imported account for a manual OAuth start', async () => {
  const runtimeUpdates = [];
  const { executor, events } = makeExecutor({
    pickOpenAIAccountForRun: (state, options) => {
      assert.equal(state.currentOpenAIAccountId, undefined);
      assert.deepEqual(options, { run: 1 });
      return { id: 'account-2' };
    },
    resolveImportedAccountCredentials: (state) => {
      assert.equal(state.currentOpenAIAccountId, 'account-2');
      return { email: 'manual-start@example.com', password: 'secret-not-for-logs' };
    },
    setState: async (updates) => runtimeUpdates.push(updates),
  });

  await executor.executeStep7({ openaiAccountSource: 'imported-pool' });

  assert.equal(events.payloads[0].email, 'manual-start@example.com');
  assert.equal(events.payloads[0].password, 'secret-not-for-logs');
  assert.deepEqual(runtimeUpdates, [{ currentOpenAIAccountId: 'account-2' }]);
});

test('step 7 does not override forced phone or bound-email relogin identity', async () => {
  const calls = [];
  const { executor, events } = makeExecutor({
    resolveImportedAccountCredentials: () => {
      calls.push('resolver-called');
      return { email: 'imported@example.com', password: 'secret' };
    },
    sendToContentScriptResilient: async (_name, message) => {
      events.payloads.push(message.payload);
      return message.payload.loginIdentifierType === 'phone'
        ? { step6Outcome: 'success', state: 'phone_verification_page' }
        : { step6Outcome: 'success', state: 'verification_page' };
    },
  });

  await executor.executeStep7({
    openaiAccountSource: 'imported-pool',
    currentOpenAIAccountId: 'account-1',
    forceLoginIdentifierType: 'phone',
    signupMethod: 'phone',
    phoneVerificationEnabled: true,
    signupPhoneNumber: '+15551234567',
  });
  await executor.executeStep7({
    openaiAccountSource: 'imported-pool',
    currentOpenAIAccountId: 'account-1',
    nodeId: 'relogin-bound-email',
    forceLoginIdentifierType: 'email',
    forceEmailLogin: true,
    email: 'bound@example.com',
  });

  assert.deepEqual(calls, []);
  assert.equal(events.payloads[0].accountIdentifier, '+15551234567');
  assert.equal(events.payloads[0].loginIdentifierType, 'phone');
  assert.equal(events.payloads[1].accountIdentifier, 'bound@example.com');
  assert.equal(events.payloads[1].email, 'bound@example.com');
});

test('step 7 fails explicitly when the selected imported account is missing or unavailable', async () => {
  for (const error of [new Error('OpenAI 账号池 accountId 不存在：missing'), new Error('OpenAI 账号池 accountId 不可用：disabled')]) {
    const { executor, events } = makeExecutor({
      resolveImportedAccountCredentials: () => { throw error; },
    });
    await assert.rejects(
      () => executor.executeStep7({
        openaiAccountSource: 'imported-pool',
        currentOpenAIAccountId: 'selected',
      }),
      /accountId.*(?:不存在|不可用)/
    );
    assert.equal(events.logs.some((message) => message.includes('secret')), false);
  }
});

test('step 7 leaves manual login unchanged when imported-pool source is inactive', async () => {
  const { executor, events } = makeExecutor({
    resolveImportedAccountCredentials: () => {
      throw new Error('imported resolver must not run');
    },
  });

  await executor.executeStep7({
    currentOpenAIAccountId: 'account-1',
    email: 'manual@example.com',
    password: 'manual-password',
  });

  assert.equal(events.payloads[0].email, 'manual@example.com');
  assert.equal(events.payloads[0].password, 'manual-password');
});

test('step 7 rejects imported-pool mode without a selected account', async () => {
  const { executor } = makeExecutor();
  await assert.rejects(
    () => executor.executeStep7({ openaiAccountSource: 'imported-pool' }),
    /未选择账号/
  );
});

test('step 7 does not retry imported-account credential failures or leak the password', async () => {
  const { executor, events } = makeExecutor({
    resolveImportedAccountCredentials: () => ({
      email: 'imported@example.com',
      password: 'do-not-leak',
    }),
    sendToContentScriptResilient: async () => {
      throw new Error('incorrect password: do-not-leak');
    },
    STEP6_MAX_ATTEMPTS: 3,
  });

  await assert.rejects(
    () => executor.executeStep7({
      openaiAccountSource: 'imported-pool',
      currentOpenAIAccountId: 'account-1',
    }),
    /incorrect password/
  );
  assert.equal(events.refreshStates.length, 1);
  assert.equal(events.logs.some((message) => message.includes('do-not-leak')), false);
});

test('step 7 marks a deleted or deactivated imported account used with an invalid note', async () => {
  const marked = [];
  const { executor, events } = makeExecutor({
    resolveImportedAccountCredentials: () => ({ email: 'invalid@example.com', password: 'do-not-leak' }),
    sendToContentScriptResilient: async () => {
      throw new Error('IMPORTED_ACCOUNT_INVALID::导入账号已被删除或停用。');
    },
    markCurrentOpenAIAccountUsed: async (state, options) => marked.push({ state, options }),
    STEP6_MAX_ATTEMPTS: 3,
  });

  await assert.rejects(
    () => executor.executeStep7({ openaiAccountSource: 'imported-pool', currentOpenAIAccountId: 'invalid' }),
    /IMPORTED_ACCOUNT_INVALID/
  );
  assert.equal(events.refreshStates.length, 1);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].state.currentOpenAIAccountId, 'invalid');
  assert.equal(marked[0].options.note, '已失效');
  assert.equal(events.logs.some((message) => message.includes('do-not-leak')), false);
});
