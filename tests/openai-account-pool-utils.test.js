const test = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../openai-account-pool-utils.js');

test('normalizeOpenAIAccount normalizes persisted account fields', () => {
  const account = utils.normalizeOpenAIAccount({
    id: 'account-1',
    email: ' Demo@Example.COM ',
    password: 'secret',
    enabled: 0,
    used: 1,
    note: '  Import batch A  ',
    lastUsedAt: '123',
  });

  assert.deepStrictEqual(account, {
    id: 'account-1',
    email: 'demo@example.com',
    password: 'secret',
    enabled: false,
    used: true,
    note: 'Import batch A',
    lastUsedAt: 123,
  });
});

test('normalizeOpenAIAccounts removes invalid records and deduplicates normalized emails', () => {
  const accounts = utils.normalizeOpenAIAccounts([
    null,
    'not-an-object',
    { id: 'first', email: 'Demo@Example.com', password: 'first' },
    { id: 'duplicate', email: ' demo@example.COM ', password: 'second' },
    { id: 'invalid', email: 'not-an-email', password: 'secret' },
    { id: 'missing-password', email: 'missing@example.com' },
    { id: 'blank-password', email: 'blank@example.com', password: ' \t\n ' },
    { id: 'padded-password', email: 'padded@example.com', password: ' secret ' },
  ]);

  assert.deepStrictEqual(accounts, [
    {
      id: 'first',
      email: 'demo@example.com',
      password: 'first',
      enabled: true,
      used: false,
      note: '',
      lastUsedAt: 0,
    },
    {
      id: 'padded-password',
      email: 'padded@example.com',
      password: ' secret ',
      enabled: true,
      used: false,
      note: '',
      lastUsedAt: 0,
    },
  ]);
});

test('isEligibleOpenAIAccount normalizes persisted boolean representations', () => {
  const base = { email: 'demo@example.com', password: 'secret' };

  assert.equal(utils.isEligibleOpenAIAccount({ ...base, enabled: 'true', used: 'false' }), true);
  assert.equal(utils.isEligibleOpenAIAccount({ ...base, enabled: 0, used: false }), false);
  assert.equal(utils.isEligibleOpenAIAccount({ ...base, enabled: 'false', used: false }), false);
  assert.equal(utils.isEligibleOpenAIAccount({ ...base, enabled: true, used: 1 }), false);
  assert.equal(utils.isEligibleOpenAIAccount({ ...base, enabled: true, used: 'false' }), true);
  assert.equal(utils.isEligibleOpenAIAccount({ ...base, password: '  ' }), false);
});

test('parseOpenAIAccountImportText parses email----password with optional note and rejects malformed lines', () => {
  const parsed = utils.parseOpenAIAccountImportText(`
 邮箱 ---- 密码 ---- 备注 
First@Example.com----pass-1
second@example.com----pass-2----  batch one  
bad-email----pass-3
third@example.com
  `);

  assert.deepStrictEqual(parsed.accounts, [
    { email: 'first@example.com', password: 'pass-1', note: '' },
    { email: 'second@example.com', password: 'pass-2', note: 'batch one' },
  ]);
  assert.deepStrictEqual(parsed.rejected, [
    { lineNumber: 4, reason: 'invalid_email' },
    { lineNumber: 5, reason: 'invalid_format' },
  ]);
  assert.equal(JSON.stringify(parsed).includes('pass-3'), false);
});

test('parseOpenAIAccountImportText preserves delimiters after the second field in notes', () => {
  const parsed = utils.parseOpenAIAccountImportText(
    'demo@example.com----pass-1----第一段----第二段'
  );

  assert.deepStrictEqual(parsed.accounts, [{
    email: 'demo@example.com',
    password: 'pass-1',
    note: '第一段----第二段',
  }]);
  assert.deepStrictEqual(parsed.rejected, []);
});

test('parseOpenAIAccountImportText accepts email----password----OTP Secret and preserves its normalized value', () => {
  const parsed = utils.parseOpenAIAccountImportText(
    'shardiyapoonma@gmail.com----sSvexoCptKKcl----ul2x65zpy7c3bmjdrl2lzaacpofwko4d----OTP 登录'
  );

  assert.deepStrictEqual(parsed.accounts, [{
    email: 'shardiyapoonma@gmail.com',
    password: 'sSvexoCptKKcl',
    otpSecret: 'UL2X65ZPY7C3BMJDRL2LZAACPOFWKO4D',
    note: 'OTP 登录',
  }]);
  assert.deepStrictEqual(parsed.rejected, []);
});

test('generateTotpCode produces the RFC 6238 SHA-1 six-digit code', async () => {
  const code = await utils.generateTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', {
    timestamp: 59000,
  });
  assert.equal(code, '287082');
});

test('re-importing an account adds its OTP Secret without resetting usage status', () => {
  const result = utils.importOpenAIAccounts([
    { id: 'existing', email: 'demo@example.com', password: 'old-password', used: true, lastUsedAt: 123 },
  ], 'demo@example.com----new-password----JBSWY3DPEHPK3PXP');

  assert.equal(result.feedback.added, 0);
  assert.equal(result.feedback.duplicate, 1);
  assert.deepStrictEqual(result.accounts, [{
    id: 'existing', email: 'demo@example.com', password: 'new-password',
    otpSecret: 'JBSWY3DPEHPK3PXP', enabled: true, used: true, note: '', lastUsedAt: 123,
  }]);
});

test('importOpenAIAccounts reports added, duplicate, and rejected rows', () => {
  const result = utils.importOpenAIAccounts([
    { id: 'existing', email: 'existing@example.com', password: 'old' },
  ], `
existing@example.com----new
new@example.com----secret----imported
invalid----secret
`);

  assert.deepStrictEqual(result.accounts.map(utils.projectOpenAIAccountForList), [
    { id: 'existing', email: 'existing@example.com', enabled: true, used: false, note: '', lastUsedAt: 0 },
    { id: result.added[0].id, email: 'new@example.com', enabled: true, used: false, note: 'imported', lastUsedAt: 0 },
  ]);
  assert.deepStrictEqual(result.duplicate, [{ email: 'existing@example.com', note: '' }]);
  assert.deepStrictEqual(result.rejected, [{ lineNumber: 3, reason: 'invalid_email' }]);
  assert.deepStrictEqual(result.feedback, { added: 1, duplicate: 1, rejected: 1 });
  assert.equal(JSON.stringify(result).includes('secret'), true);
  assert.equal(JSON.stringify(result.rejected).includes('secret'), false);
});

test('eligible selection excludes disabled and used accounts and chooses least recently used', () => {
  const picked = utils.pickEligibleOpenAIAccount([
    { id: 'used', email: 'used@example.com', password: 'x', used: true, lastUsedAt: 1 },
    { id: 'disabled', email: 'disabled@example.com', password: 'x', enabled: false, lastUsedAt: 1 },
    { id: 'later', email: 'later@example.com', password: 'x', lastUsedAt: 10 },
    { id: 'first', email: 'first@example.com', password: 'x', lastUsedAt: 2 },
  ]);

  assert.equal(picked.id, 'first');
  assert.deepStrictEqual(utils.getEligibleOpenAIAccounts([{ id: 'ok', email: 'ok@example.com', password: 'x' }, { id: 'used', email: 'used@example.com', password: 'x', used: true }]).map((account) => account.id), ['ok']);
});

test('safe list projections never expose account passwords', () => {
  const projected = utils.projectOpenAIAccountsForList([
    { id: 'safe', email: 'safe@example.com', password: 'do-not-leak', note: 'note' },
  ]);

  assert.deepStrictEqual(projected, [{
    id: 'safe', email: 'safe@example.com', enabled: true, used: false, note: 'note', lastUsedAt: 0,
  }]);
  assert.equal(JSON.stringify(projected).includes('do-not-leak'), false);
});
