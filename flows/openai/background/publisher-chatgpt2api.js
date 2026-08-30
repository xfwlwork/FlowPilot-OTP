(function attachBackgroundOpenAiPublisherChatgpt2Api(root, factory) {
  root.MultiPageBackgroundOpenAiPublisherChatgpt2Api = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundOpenAiPublisherChatgpt2ApiModule() {
  const CHATGPT2API_ACCOUNTS_PATH = '/api/accounts';
  const CHATGPT2API_OAUTH_START_PATH = '/api/accounts/oauth/start';
  const CHATGPT2API_OAUTH_FINISH_PATH = '/api/accounts/oauth/finish';
  const CHATGPT2API_CALLBACK_POLL_MS = 300;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanString(value = '') {
    return String(value ?? '').trim();
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : cleanString(error) || '未知错误';
  }

  function redactSensitiveText(value = '', secrets = []) {
    let result = String(value || '');
    const values = new Set(secrets.map(cleanString).filter(Boolean));
    for (const candidate of secrets) {
      try {
        const parsed = new URL(cleanString(candidate));
        for (const key of ['code', 'state']) {
          const parameter = cleanString(parsed.searchParams.get(key));
          if (parameter) values.add(parameter);
        }
      } catch (_error) {
        // Non-URL secrets are already included as literal values above.
      }
    }
    for (const secret of [...values].sort((left, right) => right.length - left.length)) {
      result = result.split(secret).join('[REDACTED]');
    }
    return result;
  }

  async function readResponse(response) {
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }
    return { text, json };
  }

  function readChatgpt2ApiDetailMessage(detail) {
    if (Array.isArray(detail)) {
      return cleanString(detail.map((item) => {
        if (isPlainObject(item)) {
          const loc = Array.isArray(item.loc)
            ? item.loc.map((part) => cleanString(part)).filter((part) => part && part !== 'body').join('.')
            : cleanString(item.loc);
          const message = cleanString(item.msg || item.message || item.error || item.type);
          return [loc, message].filter(Boolean).join(': ');
        }
        return cleanString(item);
      }).filter(Boolean).join('; '));
    }
    if (isPlainObject(detail)) {
      const error = detail.error;
      return cleanString(
        (isPlainObject(error) ? error.message : error)
        || detail.message
        || detail.msg
      );
    }
    return cleanString(detail);
  }

  function buildChatgpt2ApiSuccessMessage(payload = {}) {
    if (!isPlainObject(payload)) {
      return '';
    }
    const hasCounts = ['added', 'skipped', 'refreshed'].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
    if (!hasCounts) {
      return cleanString(payload.message || '');
    }
    const added = Math.max(0, Number(payload.added) || 0);
    const skipped = Math.max(0, Number(payload.skipped) || 0);
    const refreshed = Math.max(0, Number(payload.refreshed) || 0);
    const errors = Array.isArray(payload.errors) ? payload.errors.length : 0;
    return `新增 ${added} 个，跳过 ${skipped} 个，刷新 ${refreshed} 个${errors ? `，失败 ${errors} 个` : ''}`;
  }

  function readChatgpt2ApiResponseMessage(body = {}, fallback = '') {
    const error = body?.json?.error;
    return cleanString(
      (isPlainObject(error) ? error.message : error)
      || body?.json?.message
      || readChatgpt2ApiDetailMessage(body?.json?.detail)
      || buildChatgpt2ApiSuccessMessage(body?.json)
      || fallback
    );
  }

  function normalizeChatgpt2ApiBaseUrl(value = '') {
    const rawUrl = cleanString(value);
    if (!rawUrl) {
      throw new Error('缺少 ChatGPT2API 地址。');
    }
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
    let parsed = null;
    try {
      parsed = new URL(withProtocol);
    } catch (_error) {
      throw new Error('ChatGPT2API 地址格式无效，请检查配置。');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('ChatGPT2API 地址只支持 http 或 https。');
    }
    return parsed.origin;
  }

  function buildChatgpt2ApiAccountsUrl(value = '') {
    return `${normalizeChatgpt2ApiBaseUrl(value)}${CHATGPT2API_ACCOUNTS_PATH}`;
  }

  function buildChatgpt2ApiOAuthStartUrl(value = '') {
    return `${normalizeChatgpt2ApiBaseUrl(value)}${CHATGPT2API_OAUTH_START_PATH}`;
  }

  function buildChatgpt2ApiOAuthFinishUrl(value = '') {
    return `${normalizeChatgpt2ApiBaseUrl(value)}${CHATGPT2API_OAUTH_FINISH_PATH}`;
  }

  function normalizeChatgpt2ApiAdminKey(value = '') {
    return cleanString(value);
  }

  function resolveOpenAiChatgpt2ApiConfig(state = {}) {
    const nestedConfig = state?.settingsState?.flows?.openai?.targets?.chatgpt2api || {};
    return {
      baseUrl: cleanString(nestedConfig.baseUrl || state?.openaiChatgpt2ApiUrl),
      apiKey: normalizeChatgpt2ApiAdminKey(nestedConfig.apiKey ?? state?.openaiChatgpt2ApiAdminKey ?? ''),
    };
  }

  function buildOpenAiSessionImportPayload(session = null, accessToken = '') {
    const token = cleanString(accessToken || session?.access_token || session?.accessToken);
    if (!token) {
      throw new Error('缺少 ChatGPT 会话 accessToken。');
    }
    return {
      tokens: [token],
    };
  }

  async function uploadOpenAiSessionToChatgpt2Api(baseUrl, apiKey, sessionState = {}, fetchImpl) {
    const endpointUrl = buildChatgpt2ApiAccountsUrl(baseUrl);
    const normalizedApiKey = normalizeChatgpt2ApiAdminKey(apiKey);
    if (!normalizedApiKey) {
      throw new Error('缺少 ChatGPT2API Admin Key。');
    }

    const response = await fetchImpl(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedApiKey}`,
      },
      body: JSON.stringify(buildOpenAiSessionImportPayload(
        isPlainObject(sessionState?.session) ? sessionState.session : null,
        sessionState?.accessToken
      )),
    });
    const body = await readResponse(response);
    if (!response.ok) {
      const message = readChatgpt2ApiResponseMessage(body, response.statusText) || `HTTP ${response.status}`;
      throw new Error(`ChatGPT2API 会话上传失败：${message}`);
    }
    return {
      endpointUrl,
      message: readChatgpt2ApiResponseMessage(body, '') || '上传成功',
      raw: body.json,
    };
  }

  function parseChatgpt2ApiAuthorizeUrl(value = '') {
    const rawValue = cleanString(value);
    let parsed = null;
    try {
      parsed = new URL(rawValue);
    } catch (_error) {
      throw new Error('ChatGPT2API OAuth start 未返回有效 authorize_url。');
    }
    if (
      parsed.origin.toLowerCase() !== 'https://auth.openai.com'
      || parsed.username
      || parsed.password
    ) {
      throw new Error('ChatGPT2API OAuth authorize_url 不是受支持的 OpenAI 登录地址。');
    }
    return rawValue;
  }

  function parseChatgpt2ApiCallbackUrl(value = '') {
    const rawValue = cleanString(value);
    let parsed = null;
    try {
      parsed = new URL(rawValue);
    } catch (_error) {
      return '';
    }
    if (
      parsed.origin.toLowerCase() !== 'https://platform.openai.com'
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/auth/callback'
      || !cleanString(parsed.searchParams.get('code'))
      || !cleanString(parsed.searchParams.get('state'))
    ) {
      return '';
    }
    return rawValue;
  }

  async function postChatgpt2ApiJson(endpointUrl, apiKey, payload, fetchImpl, errorPrefix) {
    const normalizedApiKey = normalizeChatgpt2ApiAdminKey(apiKey);
    if (!normalizedApiKey) {
      throw new Error('缺少 ChatGPT2API Admin Key。');
    }
    const response = await fetchImpl(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedApiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await readResponse(response);
    if (!response.ok) {
      const message = readChatgpt2ApiResponseMessage(body, response.statusText) || `HTTP ${response.status}`;
      throw new Error(`${errorPrefix}：${message}`);
    }
    if (!isPlainObject(body.json)) {
      throw new Error(`${errorPrefix}：响应不是有效 JSON。`);
    }
    return body.json;
  }

  async function startOpenAiOAuthImportOnChatgpt2Api(baseUrl, apiKey, fetchImpl) {
    const endpointUrl = buildChatgpt2ApiOAuthStartUrl(baseUrl);
    const payload = await postChatgpt2ApiJson(
      endpointUrl,
      apiKey,
      { email_hint: '' },
      fetchImpl,
      'ChatGPT2API OAuth start 失败'
    );
    const sessionId = cleanString(payload.session_id);
    const expiresInSeconds = Math.floor(Number(payload.expires_in));
    if (!sessionId) {
      throw new Error('ChatGPT2API OAuth start 未返回 session_id。');
    }
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error('ChatGPT2API OAuth start 未返回有效 expires_in。');
    }
    return {
      endpointUrl,
      sessionId,
      authorizeUrl: parseChatgpt2ApiAuthorizeUrl(payload.authorize_url),
      expiresInSeconds,
    };
  }

  async function finishOpenAiOAuthImportOnChatgpt2Api(baseUrl, apiKey, sessionId, callbackUrl, fetchImpl) {
    const normalizedSessionId = cleanString(sessionId);
    const normalizedCallbackUrl = parseChatgpt2ApiCallbackUrl(callbackUrl);
    if (!normalizedSessionId) {
      throw new Error('缺少 ChatGPT2API OAuth session_id。');
    }
    if (!normalizedCallbackUrl) {
      throw new Error('缺少有效的 ChatGPT2API OAuth callback URL。');
    }
    const endpointUrl = buildChatgpt2ApiOAuthFinishUrl(baseUrl);
    const payload = await postChatgpt2ApiJson(
      endpointUrl,
      apiKey,
      { session_id: normalizedSessionId, callback: normalizedCallbackUrl },
      fetchImpl,
      'ChatGPT2API OAuth finish 失败'
    );
    return {
      endpointUrl,
      message: buildChatgpt2ApiSuccessMessage(payload) || cleanString(payload.message) || '导入成功',
      raw: payload,
    };
  }

  function createOpenAiChatgpt2ApiPublisher(deps = {}) {
    const {
      addLog = async () => {},
      broadcastDataUpdate = null,
      completeNodeFromBackground,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getStepIdByKeyForState = null,
      getState = async () => ({}),
      getTabId = async () => null,
      markCurrentOpenAIAccountUsed = null,
      setState = async () => {},
      sleepWithStop = async () => {},
      chrome = null,
    } = deps;

    if (typeof completeNodeFromBackground !== 'function') {
      throw new Error('OpenAI ChatGPT2API 上传器缺少 completeNodeFromBackground。');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('OpenAI ChatGPT2API 上传器缺少 fetch 支持。');
    }

    let sessionReader = null;

    function getSessionReader() {
      if (sessionReader) {
        return sessionReader;
      }
      const factory = deps.createOpenAiSessionReader
        || self.MultiPageBackgroundOpenAiSessionReader?.createOpenAiSessionReader;
      if (typeof factory !== 'function') {
        throw new Error('OpenAI 会话读取模块未加载。');
      }
      sessionReader = factory(deps);
      return sessionReader;
    }

    async function log(message, level = 'info', nodeId = '') {
      await addLog(message, level, nodeId ? { nodeId } : {});
    }

    async function setUploadState(patch = {}) {
      const updates = {
        openaiChatgpt2ApiUploadStatus: cleanString(patch.status),
        openaiChatgpt2ApiUploadedAt: Math.max(0, Number(patch.uploadedAt) || 0),
        openaiChatgpt2ApiUploadMessage: cleanString(patch.message),
        openaiChatgpt2ApiTargetUrl: cleanString(patch.targetUrl),
      };
      await setState(updates);
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate(updates);
      }
      return updates;
    }

    function resolveVisibleStep(state = {}, stepKey = '') {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      if (visibleStep > 0) {
        return visibleStep;
      }
      const resolvedStep = typeof getStepIdByKeyForState === 'function'
        ? Math.floor(Number(getStepIdByKeyForState(stepKey, state)) || 0)
        : 0;
      if (resolvedStep > 0) {
        return resolvedStep;
      }
      throw new Error(`无法解析 ${stepKey || 'OpenAI ChatGPT2API 交付节点'} 的当前步骤，请检查 workflow 装配。`);
    }

    async function executeOpenAiUploadSessionToChatgpt2Api(state = {}) {
      const nodeId = cleanString(state?.nodeId) || 'openai-upload-session-to-chatgpt2api';
      const visibleStep = resolveVisibleStep(state, nodeId);
      const currentState = await getState();
      let failureTargetUrl = '';
      try {
        const targetConfig = resolveOpenAiChatgpt2ApiConfig(currentState);
        const endpointUrl = buildChatgpt2ApiAccountsUrl(targetConfig.baseUrl);
        failureTargetUrl = endpointUrl;
        const apiKey = normalizeChatgpt2ApiAdminKey(targetConfig.apiKey);
        if (!apiKey) {
          throw new Error('缺少 ChatGPT2API Admin Key。');
        }

        await setUploadState({
          status: 'reading_session',
          uploadedAt: 0,
          message: '',
          targetUrl: endpointUrl,
        });
        await log(`步骤 ${visibleStep}：正在读取当前 ChatGPT 会话，准备上传到 ChatGPT2API...`, 'info', nodeId);
        const sessionState = await getSessionReader().readCurrentSessionFromState(currentState, {
          visibleStep,
          targetLabel: 'ChatGPT2API',
          requiredFields: ['accessToken'],
        });

        await setUploadState({
          status: 'uploading',
          uploadedAt: 0,
          message: '',
          targetUrl: endpointUrl,
        });
        await log(`步骤 ${visibleStep}：正在上传 ChatGPT 会话到 ChatGPT2API...`, 'info', nodeId);
        const uploadResult = await uploadOpenAiSessionToChatgpt2Api(
          targetConfig.baseUrl,
          apiKey,
          sessionState,
          fetchImpl
        );
        const payload = await setUploadState({
          status: 'uploaded',
          uploadedAt: Date.now(),
          message: uploadResult.message || '上传成功',
          targetUrl: uploadResult.endpointUrl,
        });
        await log(`步骤 ${visibleStep}：ChatGPT 会话已上传到 ChatGPT2API，状态：${uploadResult.message || '上传成功'}。`, 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const message = getErrorMessage(error);
        await setUploadState({
          status: 'error',
          uploadedAt: 0,
          message,
          targetUrl: failureTargetUrl,
        });
        await log(`步骤 ${visibleStep}：${message}`, 'error', nodeId);
        throw error;
      }
    }

    async function startOpenAiChatgpt2ApiOAuthImport(state = {}) {
      const currentState = await getState();
      const targetConfig = resolveOpenAiChatgpt2ApiConfig(currentState);
      const endpointUrl = buildChatgpt2ApiOAuthStartUrl(targetConfig.baseUrl);
      await setUploadState({
        status: 'starting_oauth',
        uploadedAt: 0,
        message: '',
        targetUrl: endpointUrl,
      });
      try {
        const result = await startOpenAiOAuthImportOnChatgpt2Api(
          targetConfig.baseUrl,
          targetConfig.apiKey,
          fetchImpl
        );
        const expiresAt = Date.now() + result.expiresInSeconds * 1000;
        await setState({
          openaiChatgpt2ApiOAuthSessionId: result.sessionId,
          openaiChatgpt2ApiOAuthAuthorizeUrl: result.authorizeUrl,
          openaiChatgpt2ApiOAuthExpiresAt: expiresAt,
          openaiChatgpt2ApiOAuthCallbackUrl: '',
          oauthUrl: result.authorizeUrl,
        });
        await setUploadState({
          status: 'oauth_login',
          uploadedAt: 0,
          message: 'OAuth 登录地址已创建',
          targetUrl: result.endpointUrl,
        });
        return result.authorizeUrl;
      } catch (error) {
        const message = redactSensitiveText(getErrorMessage(error), [targetConfig.apiKey]);
        await setUploadState({ status: 'error', uploadedAt: 0, message, targetUrl: endpointUrl });
        throw new Error(message);
      }
    }

    async function executeChatgpt2ApiCaptureOAuthCallback(state = {}) {
      const nodeId = cleanString(state?.nodeId) || 'chatgpt2api-capture-oauth-callback';
      const visibleStep = resolveVisibleStep(state, nodeId);
      let endpointUrl = '';
      try {
        const currentState = await getState();
        endpointUrl = buildChatgpt2ApiOAuthFinishUrl(resolveOpenAiChatgpt2ApiConfig(currentState).baseUrl);
        const expiresAt = Math.floor(Number(currentState?.openaiChatgpt2ApiOAuthExpiresAt) || 0);
        if (!cleanString(currentState?.openaiChatgpt2ApiOAuthSessionId) || !expiresAt) {
          throw new Error('ChatGPT2API OAuth 会话不存在，请从 OAuth 登录步骤重新开始。');
        }
        const storedCallbackUrl = parseChatgpt2ApiCallbackUrl(currentState?.openaiChatgpt2ApiOAuthCallbackUrl);
        if (storedCallbackUrl) {
          await setUploadState({ status: 'callback_captured', uploadedAt: 0, message: '已捕获 OAuth 回调', targetUrl: endpointUrl });
          await log(`步骤 ${visibleStep}：已使用验证码步骤捕获的 ChatGPT2API OAuth 回调。`, 'ok', nodeId);
          await completeNodeFromBackground(nodeId, { callbackCaptured: true });
          return;
        }
        const tabId = Number(await getTabId('openai-auth')) || 0;
        if (!tabId || !chrome?.tabs?.get) {
          throw new Error('未找到 ChatGPT2API OAuth 登录标签页。');
        }
        await setUploadState({ status: 'waiting_callback', uploadedAt: 0, message: '', targetUrl: endpointUrl });
        await log(`步骤 ${visibleStep}：正在等待 ChatGPT2API OAuth 回调...`, 'info', nodeId);
        while (Date.now() < expiresAt) {
          const tab = await chrome.tabs.get(tabId).catch(() => null);
          if (!tab?.id) {
            throw new Error('ChatGPT2API OAuth 登录标签页已关闭。');
          }
          const callbackUrl = parseChatgpt2ApiCallbackUrl(tab.url);
          if (callbackUrl) {
            await setState({ openaiChatgpt2ApiOAuthCallbackUrl: callbackUrl });
            await setUploadState({ status: 'callback_captured', uploadedAt: 0, message: '已捕获 OAuth 回调', targetUrl: endpointUrl });
            await log(`步骤 ${visibleStep}：已捕获 ChatGPT2API OAuth 回调。`, 'ok', nodeId);
            await completeNodeFromBackground(nodeId, { callbackCaptured: true });
            return;
          }
          await sleepWithStop(CHATGPT2API_CALLBACK_POLL_MS);
        }
        throw new Error('ChatGPT2API OAuth 会话已过期，未捕获到回调地址。');
      } catch (error) {
        const message = getErrorMessage(error);
        await setUploadState({ status: 'error', uploadedAt: 0, message, targetUrl: endpointUrl });
        await log(`步骤 ${visibleStep}：${message}`, 'error', nodeId);
        throw error;
      }
    }

    async function executeChatgpt2ApiFinishOAuthImport(state = {}) {
      const nodeId = cleanString(state?.nodeId) || 'chatgpt2api-finish-oauth-import';
      const visibleStep = resolveVisibleStep(state, nodeId);
      const currentState = await getState();
      const targetConfig = resolveOpenAiChatgpt2ApiConfig(currentState);
      const endpointUrl = buildChatgpt2ApiOAuthFinishUrl(targetConfig.baseUrl);
      try {
        const expiresAt = Math.floor(Number(currentState?.openaiChatgpt2ApiOAuthExpiresAt) || 0);
        if (!expiresAt || Date.now() >= expiresAt) {
          throw new Error('ChatGPT2API OAuth 会话已过期，请从 OAuth 登录步骤重新开始。');
        }
        await setUploadState({
          status: 'finishing_oauth',
          uploadedAt: 0,
          message: '',
          targetUrl: endpointUrl,
        });
        await log(`步骤 ${visibleStep}：正在完成 ChatGPT2API OAuth 导入...`, 'info', nodeId);
        const result = await finishOpenAiOAuthImportOnChatgpt2Api(
          targetConfig.baseUrl,
          targetConfig.apiKey,
          currentState?.openaiChatgpt2ApiOAuthSessionId,
          currentState?.openaiChatgpt2ApiOAuthCallbackUrl,
          fetchImpl
        );
        if (typeof markCurrentOpenAIAccountUsed === 'function') {
          try {
            await markCurrentOpenAIAccountUsed(currentState);
          } catch (markError) {
            await log(`步骤 ${visibleStep}：远程导入已成功，但账号池标记已用失败：${getErrorMessage(markError)}`, 'warn', nodeId);
          }
        }
        await setState({
          openaiChatgpt2ApiOAuthSessionId: '',
          openaiChatgpt2ApiOAuthAuthorizeUrl: '',
          openaiChatgpt2ApiOAuthExpiresAt: 0,
          openaiChatgpt2ApiOAuthCallbackUrl: '',
        });
        const payload = await setUploadState({
          status: 'uploaded',
          uploadedAt: Date.now(),
          message: result.message,
          targetUrl: result.endpointUrl,
        });
        await log(`步骤 ${visibleStep}：ChatGPT2API OAuth 账号导入完成，状态：${result.message}。`, 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
      } catch (error) {
        const message = redactSensitiveText(getErrorMessage(error), [
          targetConfig.apiKey,
          currentState?.openaiChatgpt2ApiOAuthSessionId,
          currentState?.openaiChatgpt2ApiOAuthCallbackUrl,
        ]);
        await setUploadState({ status: 'error', uploadedAt: 0, message, targetUrl: endpointUrl });
        await log(`步骤 ${visibleStep}：${message}`, 'error', nodeId);
        throw new Error(message);
      }
    }

    return {
      executeChatgpt2ApiCaptureOAuthCallback,
      executeChatgpt2ApiFinishOAuthImport,
      executeOpenAiUploadSessionToChatgpt2Api,
      startOpenAiChatgpt2ApiOAuthImport,
    };
  }

  return {
    buildChatgpt2ApiAccountsUrl,
    buildChatgpt2ApiOAuthFinishUrl,
    buildChatgpt2ApiOAuthStartUrl,
    buildOpenAiSessionImportPayload,
    createOpenAiChatgpt2ApiPublisher,
    finishOpenAiOAuthImportOnChatgpt2Api,
    normalizeChatgpt2ApiBaseUrl,
    parseChatgpt2ApiCallbackUrl,
    startOpenAiOAuthImportOnChatgpt2Api,
    uploadOpenAiSessionToChatgpt2Api,
  };
});
