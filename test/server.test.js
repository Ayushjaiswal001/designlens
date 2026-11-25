'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../server');

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('health route reports the service as ready', async () => {
  await withServer(createApp(), async base => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  });
});

test('rejects malformed, non-http, credentialed, and private scan targets', async () => {
  let calls = 0;
  await withServer(createApp({ analyze: async () => { calls += 1; return {}; }, logger: { error() {} } }), async base => {
    const samples = [
      ['not a URL', 400], ['file:///etc/passwd', 400], ['https://user:pass@example.com', 400],
      ['https://example.com:8443', 400],
      ['http://127.0.0.1', 403], ['http://[::1]/', 403], ['http://192.168.10.4', 403],
      ['http://localhost', 403]
    ];
    for (const [url, expected] of samples) {
      const response = await fetch(`${base}/api/analyze`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url })
      });
      assert.equal(response.status, expected, url);
      assert.equal(typeof (await response.json()).error, 'string');
    }
    assert.equal(calls, 0);
  });
});

test('rejects malformed and oversized JSON payloads', async () => {
  await withServer(createApp(), async base => {
    const malformed = await fetch(`${base}/api/analyze`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json'
    });
    assert.equal(malformed.status, 400);
    assert.equal(typeof (await malformed.json()).error, 'string');

    const oversized = await fetch(`${base}/api/analyze`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `https://${'a'.repeat(12000)}.com` })
    });
    assert.equal(oversized.status, 413);
    assert.equal(typeof (await oversized.json()).error, 'string');
  });
});

test('maps known analyzer failures and hides unexpected internal details', async () => {
  const cases = [
    [{ code: 'ERR_NOT_HTML', message: 'Not HTML' }, 422, 'Not HTML'],
    [{ code: 'ERR_ANALYSIS_TIMEOUT', message: 'slow' }, 504, 'timed out'],
    [{ code: 'EINTERNAL', message: 'C:\\private\\secret' }, 500, 'Analysis failed']
  ];
  for (const [failure, status, expectedText] of cases) {
    await withServer(createApp({ analyze: async () => { throw failure; }, logger: { error() {} } }), async base => {
      const response = await fetch(`${base}/api/analyze`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com' })
      });
      assert.equal(response.status, status);
      const body = await response.json();
      assert.match(body.error, new RegExp(expectedText, 'i'));
      assert.equal(JSON.stringify(body).includes('private'), false);
    });
  }
});

test('returns JSON for unknown API endpoints instead of the frontend shell', async () => {
  await withServer(createApp(), async base => {
    const response = await fetch(`${base}/api/missing`, { headers: { accept: 'application/json' } });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'API route not found.');
  });
});
