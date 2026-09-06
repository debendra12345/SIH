const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');

const {
  app,
  extractDocumentText,
  getProviderStatus,
  buildFallbackClinicalResponse
} = require('../server');

test('provider status is explicit and does not expose credentials', () => {
  const status = getProviderStatus();
  assert.ok(status.ai);
  assert.ok(['none', 'groq', 'gemini'].includes(status.ai.provider));
  assert.equal(Object.prototype.hasOwnProperty.call(status.ai, 'key'), false);
  assert.equal(status.integrations.abdm.status, 'not_connected');
});

test('clinical fallback is honest about missing AI', () => {
  const result = buildFallbackClinicalResponse({ chiefComplaint: 'Cough' });
  assert.equal(result.chiefComplaint, 'Cough');
  assert.equal(result.aiStatus, 'unavailable');
  assert.equal(result.provider, 'none');
  assert.match(result.status, /fallback/i);
});

test('unsupported documents are rejected by the extraction layer', async () => {
  const result = await extractDocumentText({ mimetype: 'text/plain', buffer: Buffer.from('not medical') });
  assert.equal(result.status, 'UNSUPPORTED_DOCUMENT_TYPE');
  assert.equal(result.text, '');
});

test('status endpoint reports demo integration boundaries', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/status`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.providers.integrations.fhir.status, 'local_mapping_only');
  assert.equal(body.providers.persistence.durable, true);
});
