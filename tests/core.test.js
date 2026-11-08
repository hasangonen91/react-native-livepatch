'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LivePatchCore } = require('./.build/core');
const { createFakeNative, createFakeProvider, release, createAppState, tick } = require('./helpers');

function setup({ native = createFakeNative(), responses, config = {}, isDev = false, now } = {}) {
  const appState = createAppState();
  const provider = createFakeProvider(responses);
  const core = new LivePatchCore({ native, platform: 'ios', isDev, appState, now });
  return { core, native, provider, appState, init: () => core.init({ provider, checkOnStart: false, ...config }) };
}

test('requires a provider', () => {
  const core = new LivePatchCore({ native: createFakeNative(), platform: 'ios', isDev: false });
  assert.throws(() => core.init({}), /provider/);
});

test('up to date: nothing downloaded', async () => {
  const { core, native, provider, init } = setup({ responses: [{ status: 'up_to_date' }] });
  init();
  const r = await core.sync();
  assert.equal(r.status, 'up_to_date');
  assert.deepEqual(provider.checks[0], { platform: 'ios', appVersion: '3.1.1', channel: 'production', bundleId: null, deviceId: 'device-1' });
  assert.equal(native.calls.length, 0);
});

test('downloads every file, commits, waits for next restart by default', async () => {
  const { core, native, init } = setup({ responses: [release('r1')] });
  init();
  const r = await core.sync();
  assert.deepEqual(r, { status: 'update_installed', releaseId: 'r1', installMode: 'onNextRestart', mandatory: false });
  assert.deepEqual(native.calls.map((c) => c[0]), ['prepare', 'download', 'download', 'commit']);
  assert.equal(native.s.pending, 'r1');
  assert.equal(core.getSnapshot().phase, 'ready_to_restart');
  assert.equal(core.getSnapshot().progress, 1);
});

test('mandatory release restarts immediately', async () => {
  const { core, native, init } = setup({ responses: [release('r1', { mandatory: true })] });
  init();
  const r = await core.sync();
  assert.equal(r.installMode, 'immediate');
  assert.equal(native.calls.at(-1)[0], 'restart');
});

test('onNextResume restarts only after background + minimum duration', async () => {
  let t = 0;
  const { core, native, appState, init } = setup({
    responses: [release('r1')],
    config: { installMode: 'onNextResume', minimumBackgroundDurationMs: 1000, checkOnResume: false },
    now: () => t,
  });
  init();
  await core.sync();
  appState.emit('background'); t = 500; appState.emit('active');
  assert.ok(!native.calls.some((c) => c[0] === 'restart'), 'too short in background');
  appState.emit('background'); t = 2000; appState.emit('active');
  assert.equal(native.calls.at(-1)[0], 'restart');
});

test('does not download again when the release is already pending', async () => {
  const native = createFakeNative();
  native.s.pending = 'r1';
  const { core, init } = setup({ native, responses: [release('r1')] });
  init();
  const r = await core.sync();
  assert.equal(r.status, 'update_installed');
  assert.ok(!native.calls.some((c) => c[0] === 'download'));
});

test('skips releases that crashed on this device', async () => {
  const native = createFakeNative();
  native.s.failed = ['bad'];
  const { core, init } = setup({ native, responses: [release('bad')] });
  init();
  assert.equal((await core.sync()).status, 'up_to_date');
  assert.equal(native.calls.length, 0);
});

test('download failure discards staging, reports, returns error', async () => {
  const native = createFakeNative();
  native.downloadError = new Error('Hash mismatch for main.jsbundle');
  const { core, provider, init } = setup({ native, responses: [release('r1')] });
  init();
  const r = await core.sync();
  assert.equal(r.status, 'error');
  assert.match(r.error.message, /Hash mismatch/);
  assert.ok(native.calls.some((c) => c[0] === 'discard'));
  assert.ok(!native.calls.some((c) => c[0] === 'commit'));
  await tick();
  assert.equal(provider.reports[0].type, 'download_failed');
  assert.equal(core.getSnapshot().phase, 'error');
});

test('server rollback resets to embedded and restarts on resume', async () => {
  const native = createFakeNative({ runningId: 'r1' });
  const { core, init } = setup({ native, responses: [{ status: 'rollback' }] });
  init();
  const r = await core.sync();
  assert.deepEqual(r, { status: 'rolled_back', installMode: 'onNextResume' });
  assert.equal(native.s.current, null);
});

test('rollback when already on embedded bundle is a no-op', async () => {
  const { core, native, init } = setup({ responses: [{ status: 'rollback' }] });
  init();
  assert.equal((await core.sync()).status, 'up_to_date');
  assert.equal(native.calls.length, 0);
});

test('disabled in Metro/debug builds', async () => {
  const native = createFakeNative({ resolved: false });
  const { core, provider, init } = setup({ native, isDev: true, responses: [] });
  init();
  const r = await core.sync();
  assert.deepEqual(r, { status: 'disabled', reason: 'dev build' });
  assert.equal(provider.checks.length, 0);
});

test('missing native module never throws', async () => {
  const provider = createFakeProvider([]);
  const core = new LivePatchCore({ native: null, platform: 'android', isDev: true });
  core.init({ provider });
  assert.equal((await core.sync()).status, 'disabled');
  assert.deepEqual(await core.notifyAppReady(), {});
});

test('concurrent sync calls share one run', async () => {
  const { core, provider, init } = setup({ responses: [{ status: 'up_to_date' }] });
  init();
  const [a, b] = await Promise.all([core.sync(), core.sync()]);
  assert.equal(a, b);
  assert.equal(provider.checks.length, 1);
});

test('network error becomes an error result', async () => {
  const { core, init } = setup({ responses: [new Error('offline')] });
  init();
  const r = await core.sync();
  assert.equal(r.status, 'error');
});

test('full lifecycle: install, confirm, report; crash rolls back', async () => {
  const native = createFakeNative();
  const { core, provider, init } = setup({ native, responses: [release('r1'), release('r2'), { status: 'up_to_date' }] });
  init();
  await core.sync();
  native.coldStart(); // launches r1 as trial
  const ready = await core.notifyAppReady();
  assert.deepEqual(ready, { installed: 'r1' });
  assert.equal(native.s.current, 'r1');

  await core.sync(); // r2 downloaded
  assert.equal(provider.checks[1].bundleId, 'r1');
  native.coldStart(); // r2 launched... and crashes before notifyAppReady
  native.coldStart(); // next launch: rolled back to r1
  assert.equal(native.s.runningId, 'r1');
  assert.deepEqual(native.s.failed, ['r2']);
  const after = await core.notifyAppReady();
  assert.deepEqual(after, { rolledBack: 'r2' });
  await tick();
  assert.deepEqual(provider.reports.map((r) => [r.type, r.releaseId]), [['installed', 'r1'], ['rolled_back', 'r2']]);
});

test('init notifies app ready and checks on start', async () => {
  const native = createFakeNative();
  native.s.trial = 'r1'; native.s.runningId = 'r1';
  const provider = createFakeProvider([{ status: 'up_to_date' }]);
  const events = [];
  const core = new LivePatchCore({ native, platform: 'android', isDev: false });
  core.init({ provider, onEvent: (e) => events.push(e.type) });
  await tick(); await tick(); await tick();
  assert.equal(native.s.current, 'r1');
  assert.equal(provider.checks.length, 1);
  assert.deepEqual(events, ['installed', 'check']);
});

test('checks again on resume after the interval', async () => {
  let t = 0;
  const { core, provider, appState, init } = setup({
    responses: () => ({ status: 'up_to_date' }),
    config: { checkIntervalMs: 1000 },
    now: () => t,
  });
  init();
  await core.sync();
  appState.emit('background'); t = 500; appState.emit('active');
  await tick();
  assert.equal(provider.checks.length, 1);
  appState.emit('background'); t = 1500; appState.emit('active');
  await tick();
  assert.equal(provider.checks.length, 2);
});

test('subscribers see progress', async () => {
  const { core, init } = setup({ responses: [release('r1')] });
  init();
  const phases = [];
  core.subscribe(() => phases.push(core.getSnapshot().phase));
  await core.sync();
  assert.deepEqual([...new Set(phases)], ['checking', 'downloading', 'ready_to_restart']);
});
