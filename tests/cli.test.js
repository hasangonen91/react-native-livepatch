'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseArgs, detectAppVersion, buildManifest, release, update } = require('../cli');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-cli-'));
  fs.mkdirSync(path.join(root, 'android/app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'android/app/build.gradle'), 'android { defaultConfig { versionCode 45\n versionName "3.1.0" } }');
  fs.mkdirSync(path.join(root, 'ios/Ustaro.xcodeproj'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ios/Ustaro'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ios/Ustaro.xcodeproj/project.pbxproj'),
    'MARKETING_VERSION = 3.1.1;\nMARKETING_VERSION = 3.1.1;\nMARKETING_VERSION = 1.0;\n');
  fs.writeFileSync(path.join(root, 'ios/Ustaro/Info.plist'),
    '<key>CFBundleShortVersionString</key>\n\t<string>$(MARKETING_VERSION)</string>');
  return root;
}

function fakeApi() {
  const api = {
    stored: new Set(['already']),
    uploads: [],
    rows: [],
    patches: [],
    async fileExists(sha) { return api.stored.has(sha); },
    async uploadFile(sha, buf) { api.uploads.push(sha); api.stored.add(sha); assert.ok(Buffer.isBuffer(buf)); },
    async insertRelease(row) { api.rows.push(row); },
    async updateRelease(id, patch) { api.patches.push([id, patch]); return [{ id, ...patch }]; },
  };
  return api;
}

function fakeBundle(root, platform, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'assets/img'), { recursive: true });
  const name = platform === 'ios' ? 'main.jsbundle' : 'index.android.bundle';
  fs.writeFileSync(path.join(outDir, name), `bundle-${platform}`);
  fs.writeFileSync(path.join(outDir, 'assets/img/logo.png'), 'same-logo');
  fs.writeFileSync(path.join(outDir, `${name}.map`), 'sourcemap');
  return name;
}

test('parseArgs', () => {
  const a = parseArgs(['release', '-p', 'ios', '--mandatory', '--rollout', '20', '-m', 'fix login', '--no-hermes', '-y', '--app-version=3.1.1']);
  assert.equal(a.command, 'release');
  assert.deepEqual(a.flags, { platform: 'ios', mandatory: true, rollout: '20', message: 'fix login', hermes: false, yes: true, 'app-version': '3.1.1' });
  assert.deepEqual(parseArgs(['rollout', 'abc', '50']).positional, ['abc', '50']);
});

test('detectAppVersion reads gradle and the most common MARKETING_VERSION', () => {
  const root = tmpProject();
  assert.equal(detectAppVersion(root, 'android'), '3.1.0');
  assert.equal(detectAppVersion(root, 'ios'), '3.1.1');
  fs.writeFileSync(path.join(root, 'ios/Ustaro/Info.plist'), '<key>CFBundleShortVersionString</key><string>9.9</string>');
  assert.equal(detectAppVersion(root, 'ios'), '9.9');
});

test('buildManifest hashes files and skips source maps', () => {
  const root = tmpProject();
  const out = path.join(root, 'out');
  fakeBundle(root, 'ios', out);
  const files = buildManifest(out, 'main.jsbundle');
  assert.deepEqual(files.map((f) => f.path), ['assets/img/logo.png', 'main.jsbundle']);
  assert.equal(files[1].sha256, crypto.createHash('sha256').update('bundle-ios').digest('hex'));
  assert.throws(() => buildManifest(out, 'missing.bundle'), /missing/);
});

test('release uploads each unique file once and inserts one row per platform', async () => {
  const root = tmpProject();
  const api = fakeApi();
  const plans = await release({ root, yes: true, rollout: '25', mandatory: true, message: 'fix' }, { api, bundle: fakeBundle });
  assert.equal(api.rows.length, 2);
  const ios = api.rows.find((r) => r.platform === 'ios');
  const android = api.rows.find((r) => r.platform === 'android');
  assert.equal(ios.app_version, '3.1.1');
  assert.equal(android.app_version, '3.1.0');
  assert.equal(ios.bundle_path, 'main.jsbundle');
  assert.equal(android.bundle_path, 'index.android.bundle');
  assert.equal(ios.rollout, 25);
  assert.equal(ios.mandatory, true);
  assert.equal(ios.message, 'fix');
  assert.equal(ios.channel, 'production');
  // logo is identical on both platforms -> uploaded once (content addressed)
  assert.equal(api.uploads.length, 3);
  assert.ok(plans.every((p) => /^[0-9a-f-]{36}$/.test(p.id)));
});

test('release refuses without confirmation when not a TTY', async () => {
  const root = tmpProject();
  const api = fakeApi();
  await assert.rejects(release({ root, platform: 'ios' }, { api, bundle: fakeBundle }), /Cancelled/);
  assert.equal(api.rows.length, 0);
});

test('release validates rollout and platform', async () => {
  const root = tmpProject();
  await assert.rejects(release({ root, rollout: '150', yes: true }, { api: fakeApi(), bundle: fakeBundle }), /rollout/);
  await assert.rejects(release({ root, platform: 'web', yes: true }, { api: fakeApi(), bundle: fakeBundle }), /Unknown platform/);
});

test('dry run uploads nothing', async () => {
  const root = tmpProject();
  const plans = await release({ root, 'dry-run': true }, { bundle: fakeBundle });
  assert.equal(plans.length, 2);
  assert.equal(plans[0].id, undefined);
});

test('update validates the id', async () => {
  const api = fakeApi();
  await assert.rejects(update('nope', { enabled: false }, {}, { api }), /release id/);
  const id = crypto.randomUUID();
  await update(id, { enabled: false }, {}, { api });
  assert.deepEqual(api.patches[0], [id, { enabled: false }]);
});
