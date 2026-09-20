import test from 'node:test';
import assert from 'node:assert/strict';
import { proxy } from '../cloudflare/proxy.js';

const BASE = 'https://daily-cf-problems.lucius7.dev';

test('proxy maps root, assets and data to the fixed Pages project and preserves query strings', async () => {
  for (const path of ['/', '/assets/index-abc123.js', '/data/calendar.json?version=123']) {
    let seen;
    const response = await proxy(new Request(BASE + path), async (url, init) => {
      seen = { url, init };
      return new Response('source', { headers: { 'Content-Type': 'text/plain' } });
    });
    assert.equal(seen.url, 'https://thelucius7.github.io/Daily_CF_Problems' + path);
    assert.equal(seen.init.redirect, 'manual');
    assert.equal(await response.text(), 'source');
    assert.equal(response.headers.get('Cache-Control'), path.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable' : path.startsWith('/data/') ? 'no-store' : 'no-cache');
  }
});

test('parent-domain cookies and authorization are not forwarded to GitHub', async () => {
  const request = new Request(BASE + '/', { headers: { Cookie: 'private=value', Authorization: 'Bearer private', 'If-None-Match': 'etag' } });
  const response = await proxy(request, async (_, init) => {
    assert.equal(init.headers.get('cookie'), null);
    assert.equal(init.headers.get('authorization'), null);
    assert.equal(init.headers.get('if-none-match'), 'etag');
    return new Response('ok', { headers: { 'Set-Cookie': 'upstream=ignored' } });
  });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('HTTP and project-prefixed paths redirect to HTTPS on the custom hostname', async () => {
  const response = await proxy(new Request('http://daily-cf-problems.lucius7.dev/Daily_CF_Problems/data/progress.json?v=1'));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), BASE + '/data/progress.json?v=1');
});

test('upstream redirects stay on the custom hostname and inside this project', async () => {
  const response = await proxy(new Request(BASE + '/folder'), async () => new Response(null, {
    status: 301, headers: { Location: '/Daily_CF_Problems/folder/' },
  }));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), BASE + '/folder/');
  const invalid = await proxy(new Request(BASE + '/'), async () => new Response(null, {
    status: 302, headers: { Location: 'https://example.com/' },
  }));
  assert.equal(invalid.status, 502);
});

test('HEAD, missing files and upstream failures retain useful HTTP semantics', async () => {
  const head = await proxy(new Request(BASE + '/data/progress.json', { method: 'HEAD' }), async (_, init) => {
    assert.equal(init.method, 'HEAD');
    return new Response(null, { headers: { 'Content-Length': '123' } });
  });
  assert.equal(await head.text(), '');
  const missing = await proxy(new Request(BASE + '/assets/missing-abcd.js'), async () => new Response('missing', { status: 404 }));
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');
  const failed = await proxy(new Request(BASE + '/'), async () => { throw new Error('offline'); });
  assert.equal(failed.status, 502);
});

test('proxy refuses mutations, unrelated hosts and encoded path traversal', async () => {
  const noFetch = () => { throw new Error('Upstream should not be contacted'); };
  assert.equal((await proxy(new Request(BASE + '/', { method: 'POST' }), noFetch)).status, 405);
  assert.equal((await proxy(new Request('https://example.com/'), noFetch)).status, 404);
  assert.equal((await proxy(new Request(BASE + '/%2e%2e%2fother-project'), noFetch)).status, 400);
});
