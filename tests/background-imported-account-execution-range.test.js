const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
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
    if (source[i] === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function createApi(nodes) {
  const nodeSteps = Object.fromEntries(nodes.map((id, index) => [id, index + 1]));
  const bundle = [
    'isPlainObjectValue',
    'normalizeStepExecutionRangeFlowId',
    'hasStepExecutionRangeShape',
    'normalizePositiveStepNumber',
    'normalizeStepExecutionRangeEntry',
    'normalizeStepExecutionRangeByFlow',
    'getStepExecutionRangeForState',
    'isStepAllowedByExecutionRangeForState',
    'isNodeExecutionAllowedForState',
    'getExecutionAllowedNodeIdsForState',
    'assertNodeExecutionAllowedForState',
  ].map(extractFunction).join('\n');
  return new Function(`
const DEFAULT_ACTIVE_FLOW_ID = 'openai';
function getNodeIdsForState() { return ${JSON.stringify(nodes)}; }
function getStepIdByNodeIdForState(nodeId) { return ${JSON.stringify(nodeSteps)}[String(nodeId || '').trim()] || 0; }
${bundle}
return { getExecutionAllowedNodeIdsForState, isNodeExecutionAllowedForState, assertNodeExecutionAllowedForState };
`)();
}

const NORMAL_NODES = [
  'open-chatgpt', 'submit-signup-email', 'fill-password', 'fetch-signup-code',
  'fill-profile', 'wait-registration-success', 'oauth-login', 'fetch-login-code',
  'post-login-phone-verification', 'confirm-oauth', 'platform-verify',
];

for (const options of [
  {},
  { targetId: 'sub2api', plusModeEnabled: true },
  { targetId: 'codex2api', signupMethod: 'phone' },
]) {
  test(`imported pool starts OAuth by nodeId (${options.targetId || 'cpa'})`, () => {
    const api = createApi(NORMAL_NODES);
    const state = {
      ...options,
      openaiAccountSource: 'imported-pool',
      stepExecutionRangeByFlow: {},
    };
    const allowed = api.getExecutionAllowedNodeIdsForState(state);
    assert.equal(allowed[0], 'oauth-login');
    assert.equal(allowed.includes('open-chatgpt'), false);
    assert.equal(allowed.includes('submit-signup-email'), false);
    assert.equal(allowed.includes('fill-password'), false);
    assert.deepEqual(allowed, NORMAL_NODES.slice(6));
    assert.equal(api.isNodeExecutionAllowedForState('fetch-login-code', state), true);
    assert.equal(api.isNodeExecutionAllowedForState('confirm-oauth', state), true);
  });
}

test('imported pool respects an existing node execution range and keeps manual guard', () => {
  const api = createApi(NORMAL_NODES);
  const state = {
    activeFlowId: 'openai',
    openaiAccountSource: 'imported-pool',
    stepExecutionRangeByFlow: { openai: { enabled: true, fromStep: 8, toStep: 11 } },
  };
  assert.deepEqual(api.getExecutionAllowedNodeIdsForState(state), NORMAL_NODES.slice(7));
  assert.throws(
    () => api.assertNodeExecutionAllowedForState('open-chatgpt', state, '手动执行节点'),
    /执行范围禁用/
  );
  assert.throws(
    () => api.assertNodeExecutionAllowedForState('submit-signup-email', state, '手动执行节点'),
    /执行范围禁用/
  );
  assert.doesNotThrow(() => api.assertNodeExecutionAllowedForState('fetch-login-code', state, '手动执行节点'));
});

test('non-imported mode remains governed only by the configured range', () => {
  const api = createApi(NORMAL_NODES);
  const state = {
    activeFlowId: 'openai',
    openaiAccountSource: '',
    stepExecutionRangeByFlow: { openai: { enabled: true, fromStep: 1, toStep: 7 } },
  };
  assert.equal(api.getExecutionAllowedNodeIdsForState(state)[0], 'open-chatgpt');
  assert.equal(api.isNodeExecutionAllowedForState('oauth-login', state), true);
});
