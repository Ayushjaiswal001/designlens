'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { isPublicAddress, runAxe, extractPageData, AXE_TAGS, SCAN_STANDARDS } = require('../backend/analyzer');

test('includes WCAG 2.2 A and AA tags in the configured scan scope', () => {
  assert.ok(AXE_TAGS.includes('wcag22a'));
  assert.ok(AXE_TAGS.includes('wcag22aa'));
  assert.ok(SCAN_STANDARDS.includes('WCAG 2.2 A/AA'));
});

test('extracts focused review data for the additional analysis tools', () => {
  const html = `<!doctype html><html lang="en"><head><title>Accessible sample</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no"></head><body>
    <a href="#missing">Read more</a><a href="#section"><img src="/cat.jpg" alt="A cat"></a>
    <a href="#section">Click here</a><img src="/logo.png" alt="logo"><img src="/brand.png" alt="logo">
    <main id="section"><h1>Sample</h1><table><tr><td>Data</td></tr></table>
      <video><track kind="captions" src="captions.vtt"></video><audio></audio>
      <button></button><label for="email">Email</label><input id="email" type="email">
    </main></body></html>`;
  const data = extractPageData(html, 'https://example.com/page');

  assert.equal(data.pageBasics.title, 'Accessible sample');
  assert.equal(data.pageBasics.lang, 'en');
  assert.equal(data.pageBasics.landmarks.main, 1);
  assert.equal(data.pageBasics.viewportBlocksZoom, true);
  assert.equal(data.links[0].brokenFragment, true);
  assert.equal(data.links[0].vagueName, true);
  assert.equal(data.links[1].emptyName, false);
  assert.equal(data.tables[0].headerCount, 0);
  assert.ok(data.images[1].reviewHints.some(hint => hint.includes('Generic wording')));
  assert.ok(data.images[1].reviewHints.some(hint => hint.includes('Repeated alt text')));
  assert.equal(data.media[0].captions, true);
  assert.equal(data.media[1].kind, 'audio');
  assert.equal(data.controls.some(control => control.tag === 'button' && control.missingName), true);
  assert.equal(data.controls.some(control => control.id === 'email' && !control.missingName), true);
});

test('accepts public unicast addresses', () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('rejects loopback, private, link-local, multicast, and mapped private addresses', () => {
  for (const address of [
    '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.2', '169.254.169.254',
    '::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1'
  ]) assert.equal(isPublicAddress(address), false, `${address} must be blocked`);
});

test('rejects malformed address values', () => {
  assert.equal(isPublicAddress('not-an-ip'), false);
});

test('does not execute page scripts or load page subresources during axe scans', async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => { requests += 1; res.end('window.__pageScriptRan = true;'); });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const html = `<html lang="en"><head><title>Fixture</title></head><body>
      <script>document.body.innerHTML = '<img src="x">';</script>
      <script src="${origin}/script.js"></script><main><h1>Test</h1></main></body></html>`;
    const result = await runAxe(html, `${origin}/target`);
    assert.equal(requests, 0);
    assert.equal(result.violations.some(violation => violation.id === 'image-alt'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
