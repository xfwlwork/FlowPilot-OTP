(function attachSidepanelOpenAIAccountPoolManager(globalScope) {
  function createOpenAIAccountPoolManager(context = {}) {
    const { dom = {}, helpers = {}, state = {}, actions = {} } = context;
    const utils = globalScope.OpenAIAccountPoolUtils;
    let selected = new Set();
    let loading = false;

    const normalize = (entries) => typeof utils?.normalizeOpenAIAccountListEntries === 'function'
      ? utils.normalizeOpenAIAccountListEntries(entries)
      : (typeof utils?.normalizeOpenAIAccounts === 'function' ? utils.normalizeOpenAIAccounts(entries) : []);
    const listed = (entries) => typeof utils?.projectOpenAIAccountsForList === 'function'
      ? utils.projectOpenAIAccountsForList(entries) : normalize(entries).map(({ id, email, enabled, used, note, lastUsedAt }) => ({ id, email, enabled, used, note, lastUsedAt }));

    function setBusy(value) {
      loading = Boolean(value);
      [dom.importButton, dom.clearButton, dom.deleteAllButton, dom.importInput].forEach((element) => {
        if (element) element.disabled = loading;
      });
    }

    function render(entries = state.getEntries?.()) {
      if (!dom.list || !dom.summary) return;
      const rows = listed(entries);
      selected = new Set([...selected].filter((id) => rows.some((row) => String(row.id) === id)));
      dom.list.innerHTML = '';
      const enabled = rows.filter((row) => row.enabled).length;
      const used = rows.filter((row) => row.used).length;
      dom.summary.textContent = rows.length
        ? `已加载 ${rows.length} 个账号，其中 ${enabled} 个启用，${used} 个已用。`
        : '支持格式：邮箱----密码----备注；密码仅用于后台，不会显示在列表或提示中。';
      if (!rows.length) {
        dom.list.innerHTML = '<div class="luckmail-empty">还没有导入账号。</div>';
        return;
      }
      rows.forEach((row) => {
        const item = document.createElement('div');
        item.className = 'luckmail-item';
        const id = String(row.id);
        item.innerHTML = `<label class="luckmail-item-main"><input type="checkbox" data-action="select" ${selected.has(id) ? 'checked' : ''}><span class="luckmail-item-email">${helpers.escapeHtml(row.email)}</span><span class="luckmail-item-meta"><span class="luckmail-tag ${row.used ? 'used' : 'active'}">${row.used ? '已用' : '未用'}</span><span class="luckmail-tag ${row.enabled ? 'active' : 'disabled'}">${row.enabled ? '启用' : '停用'}</span>${row.note ? `<span class="luckmail-tag">${helpers.escapeHtml(row.note)}</span>` : ''}</span></label><div class="luckmail-item-actions"><button class="btn btn-outline btn-xs" data-action="toggle-used" type="button">${row.used ? '标记未用' : '标记已用'}</button><button class="btn btn-outline btn-xs" data-action="toggle-enabled" type="button">${row.enabled ? '停用' : '启用'}</button><button class="btn btn-outline btn-xs" data-action="delete" type="button">删除</button></div>`;
        item.querySelector('[data-action="select"]').addEventListener('change', (event) => event.target.checked ? selected.add(id) : selected.delete(id));
        item.querySelector('[data-action="toggle-used"]').addEventListener('click', () => patch((all) => all.map((entry) => String(entry.id) === id ? { ...entry, used: !row.used, lastUsedAt: !row.used ? Date.now() : entry.lastUsedAt } : entry)));
        item.querySelector('[data-action="toggle-enabled"]').addEventListener('click', () => patch((all) => all.map((entry) => String(entry.id) === id ? { ...entry, enabled: !row.enabled } : entry)));
        item.querySelector('[data-action="delete"]').addEventListener('click', () => patch((all) => all.filter((entry) => String(entry.id) !== id)));
        dom.list.appendChild(item);
      });
    }

    async function patch(mutator) {
      // The sidepanel only holds password-free account rows. Using the
      // credential-bearing normalizer here turns every row into an invalid
      // entry and makes any bulk action clear the whole pool.
      const before = normalize(state.getEntries?.());
      const after = normalize(mutator(before.map((entry) => ({ ...entry }))));
      setBusy(true); state.setEntries?.(after); render(after);
      try { await actions.persist?.(); } catch (error) { state.setEntries?.(before); render(before); helpers.showToast?.(`更新 OpenAI 账号池失败：${error.message}`, 'error'); } finally { setBusy(false); }
    }

    async function importEntries() {
      const text = String(dom.importInput?.value || '');
      if (!text.trim()) return helpers.showToast?.('请先粘贴账号列表。', 'warn');
      setBusy(true);
      try {
        const result = await actions.importEntries?.(text);
        if (!result) throw new Error('账号池导入未返回结果。');
        state.setEntries?.(result.accounts || []); render(result.accounts || []);
        dom.importInput.value = '';
        helpers.showToast?.(`导入完成：新增 ${result.feedback?.added || 0}，重复 ${result.feedback?.duplicate || 0}，拒绝 ${result.feedback?.rejected || 0}。`, result.feedback?.added ? 'success' : 'warn', 2600);
      } catch (error) { helpers.showToast?.(`导入 OpenAI 账号失败：${error.message}`, 'error'); } finally { setBusy(false); }
    }

    function bindEvents() {
      dom.importButton?.addEventListener('click', importEntries);
      dom.importInput?.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') importEntries(); });
      dom.refreshButton?.addEventListener('click', () => render());
      dom.clearButton?.addEventListener('click', () => patch((all) => all.filter((entry) => !entry.used)));
      dom.deleteAllButton?.addEventListener('click', () => patch(() => []));
      dom.markUnusedButton?.addEventListener('click', () => patch((all) => all.map((entry) => selected.has(String(entry.id)) ? { ...entry, used: false } : entry)));
      dom.enableButton?.addEventListener('click', () => patch((all) => all.map((entry) => selected.has(String(entry.id)) ? { ...entry, enabled: true } : entry)));
      dom.disableButton?.addEventListener('click', () => patch((all) => all.map((entry) => selected.has(String(entry.id)) ? { ...entry, enabled: false } : entry)));
      dom.source?.addEventListener('change', () => actions.persist?.());
    }
    return { bindEvents, render, refresh: render };
  }
  globalScope.SidepanelOpenAIAccountPoolManager = { createOpenAIAccountPoolManager };
})(typeof window !== 'undefined' ? window : globalThis);
