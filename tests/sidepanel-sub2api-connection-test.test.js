const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readFlowRegistryBundle } = require('./helpers/script-bundles.js');

const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');
const flowRegistrySource = readFlowRegistryBundle();

test('sidepanel exposes one SUB2API connection test shared by OpenAI and Grok targets', () => {
  assert.match(html, /id="row-sub2api-connection-test"/);
  assert.match(html, /id="display-sub2api-connection-test-status"/);
  assert.match(html, /id="btn-test-sub2api-connection"/);
  assert.match(html, />测试并同步分组<\/button>/);
  assert.match(source, /type: 'CHECK_SUB2API_CONNECTION'/);
  assert.match(source, /setSub2ApiConnectionTestStatus\('正在登录并获取分组\.\.\.', 'running'\)/);
  assert.match(source, /renderSub2ApiGroupOptions\(latestState, selected\)/);
  assert.match(source, /renderGrokSub2ApiGroupOptions\(latestState, selected\)/);
});

test('flow settings groups show the SUB2API connection test in both supported flows', () => {
  const flowRegistryApi = new Function(
    'self',
    `${flowRegistrySource}; return self.MultiPageFlowRegistry;`
  )({});

  assert.equal(
    flowRegistryApi.getSettingsGroupDefinition('openai-target-sub2api')?.rowIds?.includes('row-sub2api-connection-test'),
    true
  );
  assert.equal(
    flowRegistryApi.getSettingsGroupDefinition('grok-target-sub2api')?.rowIds?.includes('row-sub2api-connection-test'),
    true
  );
});
