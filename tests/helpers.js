'use strict';
// In-memory stand-in for the native module, implementing the same state machine
// as ios/LivePatchStore.m and android/.../LivePatchStore.java.
function createFakeNative({ appVersion = '3.1.1', runningId = null, resolved = true } = {}) {
  const calls = [];
  const s = { current: runningId, pending: null, trial: null, failed: [], lastRollback: null, runningId, resolved };
  const native = {
    calls,
    s,
    downloadError: null,
    async getState() {
      return JSON.stringify({
        appVersion, buildNumber: '1', deviceId: 'device-1', runningId: s.runningId, resolved: s.resolved,
        currentId: s.current, pendingId: s.pending, trialId: s.trial, failed: s.failed,
      });
    },
    async prepareDownload(id) { calls.push(['prepare', id]); },
    async downloadFile(id, p, url, sha) {
      calls.push(['download', id, p, url, sha]);
      if (native.downloadError) throw native.downloadError;
      return 'downloaded';
    },
    async commitDownload(id, bundlePath) { calls.push(['commit', id, bundlePath]); s.pending = id; },
    async discardDownload(id) { calls.push(['discard', id]); },
    async notifyAppReady() {
      const r = {};
      if (s.trial && s.trial === s.runningId) { s.current = s.trial; s.trial = null; r.installed = s.current; }
      if (s.lastRollback) { r.rolledBack = s.lastRollback; s.lastRollback = null; }
      return JSON.stringify(r);
    },
    async resetToEmbedded() { calls.push(['reset']); s.current = null; s.pending = null; s.trial = null; },
    restart() { calls.push(['restart']); },
    // test helper: simulate a cold start (what resolveLaunch does natively)
    coldStart() {
      if (s.trial) { s.failed.push(s.trial); s.lastRollback = s.trial; s.trial = null; }
      if (s.pending) { s.trial = s.pending; s.pending = null; s.runningId = s.trial; }
      else s.runningId = s.current;
    },
  };
  return native;
}

function createFakeProvider(responses) {
  const provider = {
    checks: [],
    reports: [],
    async check(p) {
      provider.checks.push(p);
      const r = typeof responses === 'function' ? responses(p) : responses.shift();
      if (r instanceof Error) throw r;
      return r;
    },
    async report(e) { provider.reports.push(e); },
  };
  return provider;
}

function release(id, extra = {}) {
  return {
    status: 'update',
    release: {
      id,
      bundlePath: 'main.jsbundle',
      mandatory: false,
      message: null,
      files: [
        { path: 'main.jsbundle', sha256: 'a'.repeat(64), size: 300, url: 'https://x/files/a' },
        { path: 'assets/logo.png', sha256: 'b'.repeat(64), size: 100, url: 'https://x/files/b' },
      ],
      ...extra,
    },
  };
}

function createAppState() {
  let listener = null;
  return {
    addEventListener(_t, l) { listener = l; return { remove() { listener = null; } }; },
    emit(s) { listener && listener(s); },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

module.exports = { createFakeNative, createFakeProvider, release, createAppState, tick };
