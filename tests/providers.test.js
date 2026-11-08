'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { supabaseProvider, httpProvider } = require('./.build/providers');

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const { status = 200, body } = await handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body ?? '') };
  };
  f.calls = calls;
  return f;
}

const params = { platform: 'android', appVersion: '3.1.1', channel: 'production', bundleId: null, deviceId: 'd1' };

test('supabase: calls the RPC with anon key and builds file URLs', async () => {
  const fetch = fakeFetch(() => ({
    body: { status: 'update', release: { id: 'r1', bundlePath: 'index.android.bundle', mandatory: true, message: 'fix', size: 10,
      files: [{ path: 'index.android.bundle', sha256: 'ab', size: 10 }] } },
  }));
  const p = supabaseProvider({ url: 'https://proj.supabase.co/', anonKey: 'anon', fetch });
  const r = await p.check(params);
  assert.equal(fetch.calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/livepatch_check');
  assert.equal(fetch.calls[0].init.headers.apikey, 'anon');
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer anon');
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), {
    p_platform: 'android', p_app_version: '3.1.1', p_channel: 'production', p_bundle_id: null, p_device_id: 'd1',
  });
  assert.equal(r.status, 'update');
  assert.equal(r.release.mandatory, true);
  assert.equal(r.release.files[0].url, 'https://proj.supabase.co/storage/v1/object/public/livepatch/files/ab');
});

test('supabase: up_to_date / rollback / HTTP errors', async () => {
  const responses = [{ body: { status: 'up_to_date' } }, { body: { status: 'rollback' } }, { status: 500, body: { message: 'boom' } }];
  const p = supabaseProvider({ url: 'https://x.supabase.co', anonKey: 'k', fetch: fakeFetch(() => responses.shift()) });
  assert.deepEqual(await p.check(params), { status: 'up_to_date' });
  assert.deepEqual(await p.check(params), { status: 'rollback' });
  await assert.rejects(p.check(params), /HTTP 500/);
});

test('supabase: rejects malformed releases', async () => {
  const p = supabaseProvider({ url: 'https://x', anonKey: 'k', fetch: fakeFetch(() => ({ body: { status: 'update', release: { id: 1 } } })) });
  await assert.rejects(p.check(params), /invalid release/);
});

test('supabase: report', async () => {
  const fetch = fakeFetch(() => ({ body: null }));
  const p = supabaseProvider({ url: 'https://x', anonKey: 'k', fetch });
  await p.report({ type: 'installed', releaseId: 'r1', platform: 'ios', appVersion: '1', channel: 'production', deviceId: 'd' });
  assert.equal(fetch.calls[0].url, 'https://x/rest/v1/rpc/livepatch_report');
  assert.equal(JSON.parse(fetch.calls[0].init.body).p_event, 'installed');
});

test('http: query string and relative URLs', async () => {
  const fetch = fakeFetch(() => ({
    body: { status: 'update', release: { id: 'r1', bundlePath: 'main.jsbundle', files: [
      { path: 'main.jsbundle', sha256: 'a', url: 'files/a' },
      { path: 'x.png', sha256: 'b', url: '/cdn/b' },
      { path: 'y.png', sha256: 'c', url: 'https://cdn.example.com/c' },
    ] } },
  }));
  const p = httpProvider({ checkUrl: 'https://u.example.com/ota/check', fetch });
  const r = await p.check({ ...params, bundleId: 'r0' });
  assert.equal(fetch.calls[0].url, 'https://u.example.com/ota/check?platform=android&appVersion=3.1.1&channel=production&bundleId=r0&deviceId=d1');
  assert.deepEqual(r.release.files.map((f) => f.url), [
    'https://u.example.com/ota/files/a', 'https://u.example.com/cdn/b', 'https://cdn.example.com/c',
  ]);
  assert.equal(p.report, undefined);
});
