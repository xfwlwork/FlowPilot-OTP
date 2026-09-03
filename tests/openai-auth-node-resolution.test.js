const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('flows/openai/content/openai-auth.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

const api = new Function(`
${extractFunction('isEmailVerificationPage')}
${extractFunction('isImportedAccountInvalidPage')}
${extractFunction('resolveCommandNodeId')}
return {
  isImportedAccountInvalidPage,
  resolveCommandNodeId,
};
`)();

test('recognizes the OpenAI deleted or deactivated account page', () => {
  const originalLocation = global.location;
  const originalDocument = global.document;
  const originalPageTextSnapshot = global.getPageTextSnapshot;
  global.location = { pathname: '/email-verification' };
  global.document = { body: { textContent: 'You do not have an account because it has been deleted or deactivated.' } };
  global.getPageTextSnapshot = () => global.document.body.textContent;
  try {
    assert.equal(api.isImportedAccountInvalidPage(), true);
  } finally {
    global.location = originalLocation;
    global.document = originalDocument;
    global.getPageTextSnapshot = originalPageTextSnapshot;
  }
});

test('recognizes the OpenAI deleted or deactivated account password page', () => {
  const originalLocation = global.location;
  const originalDocument = global.document;
  const originalPageTextSnapshot = global.getPageTextSnapshot;
  global.location = { pathname: '/log-in/password' };
  global.document = {
    body: {
      textContent: '身份验证错误 你没有账户，因为该账户已被删除或停用。错误代码：account_deactivated',
    },
  };
  global.getPageTextSnapshot = () => global.document.body.textContent;
  try {
    assert.equal(api.isImportedAccountInvalidPage(), true);
  } finally {
    global.location = originalLocation;
    global.document = originalDocument;
    global.getPageTextSnapshot = originalPageTextSnapshot;
  }
});

test('signup page resolves bound-email relogin verification nodes from dynamic visible steps', () => {
  assert.equal(
    api.resolveCommandNodeId({
      type: 'FILL_CODE',
      step: 8,
      payload: { visibleStep: 15 },
    }),
    'fetch-bound-email-login-code'
  );
  assert.equal(
    api.resolveCommandNodeId({
      type: 'SUBMIT_PHONE_VERIFICATION_CODE',
      step: 16,
      payload: { visibleStep: 16 },
    }),
    'post-bound-email-phone-verification'
  );
  assert.equal(
    api.resolveCommandNodeId({
      type: 'FILL_CODE',
      step: 8,
      payload: { nodeId: 'fetch-bound-email-login-code', visibleStep: 15 },
    }),
    'fetch-bound-email-login-code'
  );
});
