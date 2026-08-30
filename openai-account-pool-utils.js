(function openAIAccountPoolUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  const api = factory();
  root.OpenAIAccountPoolUtils = api;
  root.MultiPageOpenAIAccountPoolUtils = api;
})(typeof self !== 'undefined' ? self : globalThis, function createOpenAIAccountPoolUtils() {
  function createAccountId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `openai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeTimestamp(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isValidEmail(value) {
    const email = normalizeEmail(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function normalizeBoolean(value, defaultValue) {
    if (value === undefined) return defaultValue;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'false' || normalized === '0' || normalized === '') return false;
      if (normalized === 'true' || normalized === '1') return true;
    }
    return Boolean(value);
  }

  function normalizeOtpSecret(value) {
    return String(value || '').toUpperCase().replace(/[\s-]/g, '');
  }

  function isValidOtpSecret(value) {
    return /^[A-Z2-7]{16,}$/.test(normalizeOtpSecret(value));
  }

  function decodeBase32(value) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const secret = normalizeOtpSecret(value);
    if (!isValidOtpSecret(secret)) {
      throw new Error('OTP Secret 格式无效：仅支持 Base32 密钥。');
    }
    let bits = 0;
    let buffer = 0;
    const bytes = [];
    for (const character of secret) {
      buffer = (buffer << 5) | alphabet.indexOf(character);
      bits += 5;
      if (bits >= 8) {
        bytes.push((buffer >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(bytes);
  }

  async function generateTotpCode(secret, options = {}) {
    if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持生成 OTP 验证码。');
    const periodSeconds = Math.max(1, Math.floor(Number(options.periodSeconds) || 30));
    const timestamp = Number(options.timestamp === undefined ? Date.now() : options.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('OTP 时间戳无效。');
    let counter = Math.floor(timestamp / 1000 / periodSeconds);
    const counterBytes = new Uint8Array(8);
    for (let index = 7; index >= 0; index -= 1) {
      counterBytes[index] = counter & 0xff;
      counter = Math.floor(counter / 256);
    }
    const key = await globalThis.crypto.subtle.importKey(
      'raw', decodeBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const signature = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, counterBytes));
    const offset = signature[signature.length - 1] & 0x0f;
    const binary = ((signature[offset] & 0x7f) << 24)
      | (signature[offset + 1] << 16) | (signature[offset + 2] << 8) | signature[offset + 3];
    return String(binary % 1000000).padStart(6, '0');
  }

  function normalizeOpenAIAccount(account = {}) {
    const source = account && typeof account === 'object' && !Array.isArray(account)
      ? account
      : {};
    return {
      id: String(source.id || createAccountId()),
      email: normalizeEmail(source.email),
      password: String(source.password || ''),
      ...(normalizeOtpSecret(source.otpSecret) ? { otpSecret: normalizeOtpSecret(source.otpSecret) } : {}),
      enabled: normalizeBoolean(source.enabled, true),
      used: normalizeBoolean(source.used, false),
      note: String(source.note || '').trim(),
      lastUsedAt: normalizeTimestamp(source.lastUsedAt),
    };
  }

  function normalizeOpenAIAccounts(accounts) {
    if (!Array.isArray(accounts)) return [];

    const deduped = new Map();
    for (const account of accounts) {
      const normalized = normalizeOpenAIAccount(account);
      if (!isValidEmail(normalized.email) || !normalized.password.trim() || deduped.has(normalized.email)) continue;
      deduped.set(normalized.email, normalized);
    }
    return [...deduped.values()];
  }

  // Public state intentionally omits passwords. Keep those rows usable by the
  // management UI without weakening the credential-bearing normalizer.
  function normalizeOpenAIAccountListEntries(accounts) {
    if (!Array.isArray(accounts)) return [];
    const deduped = new Map();
    for (const account of accounts) {
      const normalized = normalizeOpenAIAccount(account);
      if (!isValidEmail(normalized.email) || deduped.has(normalized.email)) continue;
      deduped.set(normalized.email, {
        ...normalized,
        hasOtpSecret: Boolean(account?.hasOtpSecret || normalized.otpSecret),
      });
    }
    return [...deduped.values()];
  }

  function parseOpenAIAccountImportText(rawText) {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const accounts = [];
    const rejected = [];

    lines.forEach((line, index) => {
      if (
        index === 0
        && /^(?:邮箱|email)\s*----\s*(?:密码|password)(?:\s*----\s*(?:(?:OTP\s*Secret|otp)|(?:备注|note)))?(?:\s*----\s*(?:备注|note))?$/i.test(line)
      ) return;

      const parts = line.split('----');
      const email = String(parts.shift() || '').trim();
      const password = String(parts.shift() || '').trim();
      const thirdField = String(parts.shift() || '').trim();
      const otpSecret = isValidOtpSecret(thirdField) ? normalizeOtpSecret(thirdField) : '';
      const note = (otpSecret ? parts : [thirdField, ...parts]).join('----').trim();
      if (!email || !password) {
        rejected.push({ lineNumber: index + 1, reason: 'invalid_format' });
        return;
      }
      if (!isValidEmail(email)) {
        rejected.push({ lineNumber: index + 1, reason: 'invalid_email' });
        return;
      }
      accounts.push({
        email: normalizeEmail(email),
        password,
        ...(otpSecret ? { otpSecret } : {}),
        note,
      });
    });

    return { accounts, rejected };
  }

  function importOpenAIAccounts(existingAccounts, rawText) {
    const accounts = normalizeOpenAIAccounts(existingAccounts);
    const parsed = parseOpenAIAccountImportText(rawText);
    const knownEmails = new Set(accounts.map((account) => account.email));
    const added = [];
    const duplicate = [];

    for (const candidate of parsed.accounts) {
      if (knownEmails.has(candidate.email)) {
        // Re-importing an existing account is how users add or replace an OTP
        // secret after initially importing email/password only. Keep runtime
        // status, but refresh the credential fields from the explicit import.
        const existingIndex = accounts.findIndex((account) => account.email === candidate.email);
        if (existingIndex >= 0) {
          accounts[existingIndex] = normalizeOpenAIAccount({
            ...accounts[existingIndex],
            password: candidate.password || accounts[existingIndex].password,
            ...(candidate.otpSecret ? { otpSecret: candidate.otpSecret } : {}),
            ...(candidate.note ? { note: candidate.note } : {}),
          });
        }
        duplicate.push({ email: candidate.email, note: candidate.note });
        continue;
      }
      const account = normalizeOpenAIAccount(candidate);
      accounts.push(account);
      added.push(account);
      knownEmails.add(account.email);
    }

    return {
      accounts,
      added,
      duplicate,
      rejected: parsed.rejected,
      feedback: { added: added.length, duplicate: duplicate.length, rejected: parsed.rejected.length },
    };
  }

  function isEligibleOpenAIAccount(account) {
    if (!account) return false;
    const normalized = normalizeOpenAIAccount(account);
    return isValidEmail(normalized.email)
      && Boolean(normalized.password.trim())
      && normalized.enabled === true
      && normalized.used === false;
  }

  function getEligibleOpenAIAccounts(accounts) {
    return normalizeOpenAIAccounts(accounts).filter(isEligibleOpenAIAccount);
  }

  function getEligibleOpenAIOtpAccounts(accounts) {
    return getEligibleOpenAIAccounts(accounts).filter((account) => isValidOtpSecret(account.otpSecret));
  }

  function pickEligibleOpenAIAccount(accounts) {
    return getEligibleOpenAIAccounts(accounts)
      .slice()
      .sort((left, right) => {
        if (left.lastUsedAt !== right.lastUsedAt) return left.lastUsedAt - right.lastUsedAt;
        return left.email.localeCompare(right.email);
      })[0] || null;
  }

  function projectOpenAIAccountForList(account) {
    const normalized = normalizeOpenAIAccount(account);
    return {
      id: normalized.id,
      email: normalized.email,
      enabled: normalized.enabled,
      used: normalized.used,
      note: normalized.note,
      lastUsedAt: normalized.lastUsedAt,
      hasOtpSecret: Boolean(account?.hasOtpSecret || normalized.otpSecret),
    };
  }

  function projectOpenAIAccountsForList(accounts) {
    return normalizeOpenAIAccountListEntries(accounts).map(projectOpenAIAccountForList);
  }

  return {
    getEligibleOpenAIAccounts,
    getEligibleOpenAIOtpAccounts,
    generateTotpCode,
    importOpenAIAccounts,
    isEligibleOpenAIAccount,
    isValidEmail,
    isValidOtpSecret,
    normalizeEmail,
    normalizeOpenAIAccount,
    normalizeOpenAIAccounts,
    normalizeOpenAIAccountListEntries,
    normalizeOtpSecret,
    normalizeTimestamp,
    parseOpenAIAccountImportText,
    pickEligibleOpenAIAccount,
    projectOpenAIAccountForList,
    projectOpenAIAccountsForList,
  };
});
