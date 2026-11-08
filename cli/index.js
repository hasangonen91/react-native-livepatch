'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execFileSync, spawnSync } = require('child_process');

const BUCKET = 'livepatch';
const BUNDLE_NAMES = { ios: 'main.jsbundle', android: 'index.android.bundle' };

const c = process.stdout.isTTY
  ? { b: '\x1b[1m', d: '\x1b[2m', r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', cy: '\x1b[36m', x: '\x1b[0m' }
  : { b: '', d: '', r: '', g: '', y: '', cy: '', x: '' };

const log = (...a) => console.log(...a);
const ok = (m) => log(`  ${c.g}✔${c.x} ${m}`);
const warn = (m) => log(`  ${c.y}⚠${c.x} ${m}`);

class CliError extends Error {}

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split('=', 2);
      if (inline !== undefined) flags[key] = inline;
      else if (key.startsWith('no-')) flags[key.slice(3)] = false;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) flags[key] = argv[++i];
      else flags[key] = true;
    } else if (a === '-y') {
      flags.yes = true;
    } else if (a === '-p') {
      flags.platform = argv[++i];
    } else if (a === '-c') {
      flags.channel = argv[++i];
    } else if (a === '-m') {
      flags.message = argv[++i];
    } else {
      positional.push(a);
    }
  }
  return { command: positional[0] || 'help', positional: positional.slice(1), flags };
}

// ------------------------------------------------------------------- env

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function supabaseEnv(flags) {
  const root = path.resolve(flags.root || '.');
  loadEnvFile(path.join(root, flags['env-file'] || '.env.livepatch'));
  const url = process.env.LIVEPATCH_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.LIVEPATCH_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new CliError(
      'Supabase credentials missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n' +
        '  (env vars or a git-ignored .env.livepatch file). The service role key is only\n' +
        '  used by this CLI; never ship it inside the app.',
    );
  }
  return { url: url.replace(/\/+$/, ''), key };
}

function makeApi({ url, key }, fetchImpl = globalThis.fetch) {
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  async function call(method, p, { body, headers = {}, raw = false } = {}) {
    const res = await fetchImpl(`${url}${p}`, { method, headers: { ...auth, ...headers }, body });
    if (raw) return res;
    const text = await res.text();
    if (!res.ok) throw new CliError(`Supabase ${method} ${p} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    async fileExists(sha) {
      const res = await call('HEAD', `/storage/v1/object/public/${BUCKET}/files/${sha}`, { raw: true });
      return res.ok;
    },
    async uploadFile(sha, buffer) {
      const res = await call('POST', `/storage/v1/object/${BUCKET}/files/${sha}`, {
        raw: true,
        body: buffer,
        headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new CliError(`Upload of ${sha} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
      }
    },
    insertRelease(row) {
      return call('POST', '/rest/v1/livepatch_releases', {
        body: JSON.stringify(row),
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      });
    },
    updateRelease(id, patch) {
      return call('PATCH', `/rest/v1/livepatch_releases?id=eq.${encodeURIComponent(id)}`, {
        body: JSON.stringify(patch),
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      });
    },
    listReleases(filters, limit) {
      const qs = Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`);
      qs.push('order=created_at.desc', `limit=${limit}`);
      return call('GET', `/rest/v1/livepatch_release_stats?${qs.join('&')}`);
    },
  };
}

// ------------------------------------------------------- project details

function detectAppVersion(root, platform) {
  if (platform === 'android') {
    for (const f of ['android/app/build.gradle', 'android/app/build.gradle.kts']) {
      const p = path.join(root, f);
      if (!fs.existsSync(p)) continue;
      const m = fs.readFileSync(p, 'utf8').match(/versionName\s*=?\s*["']([^"']+)["']/);
      if (m) return m[1];
    }
    return null;
  }
  const iosDir = path.join(root, 'ios');
  if (!fs.existsSync(iosDir)) return null;
  const proj = fs.readdirSync(iosDir).find((f) => f.endsWith('.xcodeproj') && !f.startsWith('Pods'));
  let marketing = null;
  if (proj) {
    const pbx = fs.readFileSync(path.join(iosDir, proj, 'project.pbxproj'), 'utf8');
    const counts = {};
    for (const m of pbx.matchAll(/MARKETING_VERSION = "?([^";]+)"?;/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 1) warn(`Several MARKETING_VERSION values in ${proj}: ${sorted.map((s) => s[0]).join(', ')}. Using ${sorted[0][0]}; pass --app-version to override.`);
    marketing = sorted[0] ? sorted[0][0] : null;
    const appName = proj.replace(/\.xcodeproj$/, '');
    const plist = path.join(iosDir, appName, 'Info.plist');
    if (fs.existsSync(plist)) {
      const m = fs.readFileSync(plist, 'utf8').match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
      if (m && !m[1].includes('$(')) return m[1].trim();
    }
  }
  return marketing;
}

function hermesEnabled(root, platform) {
  if (platform === 'android') {
    const p = path.join(root, 'android/gradle.properties');
    return !(fs.existsSync(p) && /^\s*hermesEnabled\s*=\s*false/m.test(fs.readFileSync(p, 'utf8')));
  }
  const p = path.join(root, 'ios/Podfile');
  return !(fs.existsSync(p) && /:hermes_enabled\s*=>\s*false/.test(fs.readFileSync(p, 'utf8')));
}

function findHermesc(root, platform) {
  const osDir = process.platform === 'darwin' ? 'osx-bin' : process.platform === 'win32' ? 'win64-bin' : 'linux64-bin';
  const exe = process.platform === 'win32' ? 'hermesc.exe' : 'hermesc';
  const candidates = [];
  if (platform === 'ios') candidates.push(path.join(root, 'ios/Pods/hermes-engine/destroot/bin', exe));
  for (const pkg of ['hermes-compiler', 'react-native']) {
    try {
      const dir = path.dirname(require.resolve(`${pkg}/package.json`, { paths: [root] }));
      candidates.push(path.join(dir, 'hermesc', osDir, exe), path.join(dir, 'sdks/hermesc', osDir, exe));
    } catch {}
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function gitInfo(root) {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim() !== '';
    return { commit: dirty ? `${commit}-dirty` : commit, dirty };
  } catch {
    return { commit: null, dirty: false };
  }
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildManifest(outDir, bundleName) {
  const files = walk(outDir)
    .filter((p) => !p.endsWith('.map'))
    .map((p) => {
      const buf = fs.readFileSync(path.join(outDir, p));
      return { path: p, sha256: sha256(buf), size: buf.length };
    });
  for (const f of files) {
    if (f.path.includes('..') || f.path.includes('\\')) throw new CliError(`Unsupported file name in bundle: ${f.path}`);
  }
  if (!files.some((f) => f.path === bundleName)) throw new CliError(`Bundle ${bundleName} missing from ${outDir}`);
  return files;
}

// ----------------------------------------------------------------- build

function bundle(root, platform, outDir, { entryFile, hermes, verbose }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const bundleName = BUNDLE_NAMES[platform];
  const bundlePath = path.join(outDir, bundleName);
  const args = [
    'react-native', 'bundle',
    '--platform', platform,
    '--dev', 'false',
    '--minify', hermes ? 'false' : 'true',
    '--entry-file', entryFile,
    '--bundle-output', bundlePath,
    '--assets-dest', outDir,
    '--reset-cache',
  ];
  const r = spawnSync('npx', args, { cwd: root, stdio: verbose ? 'inherit' : 'pipe', encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    throw new CliError(`react-native bundle failed for ${platform}:\n${(r.stderr || r.stdout || '').split('\n').slice(-20).join('\n')}`);
  }

  if (hermes) {
    const hermesc = findHermesc(root, platform);
    if (!hermesc) {
      warn(`hermesc not found; shipping plain JS for ${platform} (works with Hermes, slower start-up).`);
    } else {
      const hbc = `${bundlePath}.hbc`;
      const h = spawnSync(hermesc, ['-emit-binary', '-O', '-max-diagnostic-width=80', '-out', hbc, bundlePath], { encoding: 'utf8' });
      if (h.status !== 0) throw new CliError(`hermesc failed:\n${h.stderr}`);
      fs.renameSync(hbc, bundlePath);
      ok(`${platform}: compiled to Hermes bytecode`);
    }
  }
  return bundleName;
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`  ${question} [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function release(flags, deps = {}) {
  const root = path.resolve(flags.root || '.');
  const platforms = !flags.platform || flags.platform === 'all' ? ['ios', 'android'] : [flags.platform];
  for (const p of platforms) if (!BUNDLE_NAMES[p]) throw new CliError(`Unknown platform ${p}`);
  const channel = flags.channel || 'production';
  const rollout = flags.rollout === undefined ? 100 : Number(flags.rollout);
  if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) throw new CliError('--rollout must be 0..100');
  const dryRun = !!flags['dry-run'];
  const api = dryRun ? null : deps.api || makeApi(supabaseEnv(flags));
  const git = gitInfo(root);

  log(`\n  ${c.b}LivePatch release${c.x} ${c.d}channel=${channel} rollout=${rollout}%${flags.mandatory ? ' mandatory' : ''}${c.x}\n`);
  if (git.dirty) warn('Working tree has uncommitted changes; they will be included.');

  const plans = [];
  for (const platform of platforms) {
    const appVersion = flags['app-version'] || detectAppVersion(root, platform);
    if (!appVersion) throw new CliError(`Could not detect the ${platform} app version; pass --app-version`);
    const outDir = path.join(root, '.livepatch', 'build', platform);
    const builder = deps.bundle || bundle;
    const bundleName = builder(root, platform, outDir, {
      entryFile: flags['entry-file'] || 'index.js',
      hermes: flags.hermes !== false && hermesEnabled(root, platform),
      verbose: !!flags.verbose,
    });
    const files = buildManifest(outDir, bundleName);
    const total = files.reduce((s, f) => s + f.size, 0);
    ok(`${platform} ${appVersion}: ${files.length} files, ${(total / 1024 / 1024).toFixed(2)} MB`);
    plans.push({ platform, appVersion, outDir, bundleName, files, total });
  }

  if (dryRun) {
    log(`\n  Dry run: output in ${path.join(root, '.livepatch', 'build')}. Nothing uploaded.\n`);
    return plans;
  }

  if (!flags.yes) {
    const summary = plans.map((p) => `${p.platform} ${p.appVersion}`).join(', ');
    if (!(await confirm(`Publish to ${channel} for ${summary}?`))) throw new CliError('Cancelled (use --yes to skip this prompt).');
  }

  for (const plan of plans) {
    const unique = new Map(plan.files.map((f) => [f.sha256, f]));
    let uploaded = 0;
    for (const [sha, f] of unique) {
      if (await api.fileExists(sha)) continue;
      await api.uploadFile(sha, fs.readFileSync(path.join(plan.outDir, f.path)));
      uploaded++;
    }
    const id = crypto.randomUUID();
    await api.insertRelease({
      id,
      platform: plan.platform,
      app_version: plan.appVersion,
      channel,
      bundle_path: plan.bundleName,
      files: plan.files,
      total_size: plan.total,
      mandatory: !!flags.mandatory,
      rollout,
      enabled: true,
      message: typeof flags.message === 'string' ? flags.message : null,
      git_commit: git.commit,
      created_by: os.userInfo().username,
    });
    plan.id = id;
    ok(`${plan.platform}: released ${c.cy}${id}${c.x} (${uploaded} new files uploaded, ${unique.size - uploaded} already stored)`);
  }
  log(`\n  Users get it on their next check. Undo with: ${c.cy}npx livepatch disable <id>${c.x}\n`);
  return plans;
}

async function list(flags, deps = {}) {
  const api = deps.api || makeApi(supabaseEnv(flags));
  const rows = await api.listReleases(
    { platform: flags.platform, channel: flags.channel, app_version: flags['app-version'] },
    Number(flags.limit) || 20,
  );
  if (!rows.length) {
    log('\n  No releases yet.\n');
    return rows;
  }
  log('');
  for (const r of rows) {
    const state = r.enabled ? `${c.g}enabled${c.x}` : `${c.r}disabled${c.x}`;
    const flagsText = [r.mandatory ? 'mandatory' : null, r.rollout < 100 ? `rollout ${r.rollout}%` : null].filter(Boolean).join(', ');
    log(`  ${c.cy}${r.id}${c.x}  ${r.platform} ${r.app_version} ${r.channel}  ${state}${flagsText ? `  (${flagsText})` : ''}`);
    log(`    ${c.d}${new Date(r.created_at).toLocaleString()}  ${r.git_commit || ''}  installs ${r.installs}, rollbacks ${r.rollbacks}, download failures ${r.download_failures}${c.x}`);
    if (r.message) log(`    ${r.message}`);
  }
  log('');
  return rows;
}

async function update(id, patch, flags, deps = {}) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new CliError('Pass the release id (see `livepatch list`).');
  const api = deps.api || makeApi(supabaseEnv(flags));
  const rows = await api.updateRelease(id, patch);
  if (!rows || !rows.length) throw new CliError(`Release ${id} not found`);
  ok(`${id}: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  return rows[0];
}

function help() {
  log(`
  ${c.b}livepatch${c.x} — OTA updates for React Native (Supabase backend)

  ${c.b}Setup${c.x}
    livepatch sql                        Print the SQL to run once in Supabase

  ${c.b}Publish${c.x}
    livepatch release [options]          Bundle JS + assets, upload, publish
      -p, --platform ios|android|all     default all
      -c, --channel <name>               default production
      --app-version <x.y.z>              default: read from the native projects
      --mandatory                        install immediately on devices
      --rollout <0-100>                  percent of devices, default 100
      -m, --message <text>               release note
      --entry-file <file>                default index.js
      --no-hermes                        ship plain JS instead of Hermes bytecode
      --dry-run                          build only, upload nothing
      -y, --yes                          no confirmation prompt

  ${c.b}Manage${c.x}
    livepatch list [-p ios] [-c production] [--limit 20]
    livepatch disable <id>               roll back: devices leave this release
    livepatch enable <id>
    livepatch rollout <id> <0-100>
    livepatch mandatory <id> on|off

  Credentials: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env.livepatch).
`);
}

async function main(argv) {
  const { command, positional, flags } = parseArgs(argv);
  switch (command) {
    case 'release':
      return release(flags);
    case 'list':
      return list(flags);
    case 'disable':
      return update(positional[0], { enabled: false }, flags);
    case 'enable':
      return update(positional[0], { enabled: true }, flags);
    case 'rollout': {
      const pct = Number(positional[1]);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new CliError('Usage: livepatch rollout <id> <0-100>');
      return update(positional[0], { rollout: pct }, flags);
    }
    case 'mandatory': {
      const v = positional[1];
      if (v !== 'on' && v !== 'off') throw new CliError('Usage: livepatch mandatory <id> on|off');
      return update(positional[0], { mandatory: v === 'on' }, flags);
    }
    case 'sql':
      process.stdout.write(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'livepatch.sql'), 'utf8'));
      return;
    default:
      return help();
  }
}

module.exports = { main, parseArgs, detectAppVersion, buildManifest, release, list, update, makeApi, findHermesc, CliError };
