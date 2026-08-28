(function attachBackgroundSecurityUtils(root, factory) {
  root.MultiPageBackgroundSecurityUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundSecurityUtils() {
  function projectPublicState(value, insideOpenAIAccountPool = false) {
    if (Array.isArray(value)) {
      return value.map((item) => projectPublicState(item, insideOpenAIAccountPool));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      // The sidepanel must receive ordinary settings unchanged, including
      // management keys and Admin Auth. Only imported OpenAI account passwords
      // are intentionally excluded because the account-list UI never needs them.
      if (insideOpenAIAccountPool && /^(?:password|otpsecret)$/i.test(String(childKey))) {
        continue;
      }
      result[childKey] = projectPublicState(
        childValue,
        insideOpenAIAccountPool || String(childKey).toLowerCase() === 'openaiaccountpoolentries'
      );
    }
    return result;
  }

  function projectOpenAIPoolEntries(entries) {
    return projectPublicState(entries);
  }

  function buildMessageLogMetadata(message = {}, sender = {}) {
    const tabId = sender?.tab?.id;
    const frameId = sender?.frameId;
    return {
      type: String(message?.type || ''),
      source: String(message?.source || 'sidepanel'),
      ...(message?.nodeId !== undefined ? { nodeId: String(message.nodeId) } : {}),
      ...(tabId !== undefined ? { tabId } : {}),
      ...(frameId !== undefined ? { frameId } : {}),
    };
  }

  return { projectPublicState, projectOpenAIPoolEntries, buildMessageLogMetadata };
});
