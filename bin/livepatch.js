#!/usr/bin/env node

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || 'help';
  const options = {
    channel: 'production',
    output: null,
    server: null,
    platform: 'all',
    port: 4200,
    upload: null, // 'github', 'vercel', or URL
  };

  for (let i = 1; i < args.length; i++) {
    if ((args[i] === '--channel' || args[i] === '-c') && args[i + 1]) {
      options.channel = args[++i];
    } else if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
      options.output = args[++i];
    } else if (args[i] === '--server' && args[i + 1]) {
      options.server = args[++i];
    } else if ((args[i] === '--platform' || args[i] === '-p') && args[i + 1]) {
      options.platform = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
      options.port = parseInt(args[++i], 10);
    } else if (args[i] === '--upload' && args[i + 1]) {
      options.upload = args[++i];
    }
  }

  return { command, options };
}

async function pushUpdate(options) {
  console.log('');
  console.log(`  ${c.bold}${c.magenta}🩹 LivePatch${c.reset} — Pushing update`);
  console.log(`  ${c.dim}Channel: ${options.channel} | Platform: ${options.platform}${c.reset}`);
  console.log('');

  // Step 1: Bundle JS
  console.log(`  ${c.bold}[1/4]${c.reset} Bundling JavaScript...`);

  const platforms = options.platform === 'all' ? ['android', 'ios'] : [options.platform];
  const outputDir = path.resolve(options.output || '.livepatch-output');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  for (const platform of platforms) {
    const bundlePath = path.join(outputDir, `${platform}.jsbundle`);
    const assetsDir = path.join(outputDir, `assets-${platform}`);
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    try {
      execSync(
        `npx react-native bundle --platform ${platform} --dev false --entry-file index.js --bundle-output "${bundlePath}" --assets-dest "${assetsDir}"`,
        { stdio: 'pipe', encoding: 'utf8' }
      );
      console.log(`  ${c.green}✔${c.reset}  ${platform} bundle created`);
    } catch (err) {
      console.error(`  ${c.red}✖${c.reset}  ${platform} bundle failed`);
      const stderr = err.stderr || err.message;
      console.error(`  ${c.dim}${stderr.split('\n').slice(0, 3).join('\n  ')}${c.reset}`);
      process.exit(1);
    }
  }

  // Step 2: Hash bundles
  console.log(`  ${c.bold}[2/4]${c.reset} Generating integrity hashes...`);

  const manifest = {
    version: generateVersion(),
    channel: options.channel,
    timestamp: new Date().toISOString(),
    bundles: {},
  };

  for (const platform of platforms) {
    const bundlePath = path.join(outputDir, `${platform}.jsbundle`);
    const content = fs.readFileSync(bundlePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const size = content.length;

    manifest.bundles[platform] = { hash, size, filename: `${platform}.jsbundle` };
    console.log(`  ${c.green}✔${c.reset}  ${platform}: ${(size / 1024).toFixed(0)} KB ${c.dim}(sha256: ${hash.substring(0, 16)}...)${c.reset}`);
  }

  // Step 3: Write manifest
  console.log(`  ${c.bold}[3/4]${c.reset} Writing manifest...`);
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  ${c.green}✔${c.reset}  manifest.json`);

  // Step 4: Upload or output
  saveHistory(manifest);

  if (options.upload === 'github') {
    console.log(`  ${c.bold}[4/4]${c.reset} Uploading to GitHub Releases...`);
    await uploadToGitHub(manifest, outputDir);
  } else if (options.upload === 'vercel') {
    console.log(`  ${c.bold}[4/4]${c.reset} Deploying to Vercel...`);
    await uploadToVercel(outputDir);
  } else if (options.upload) {
    console.log(`  ${c.bold}[4/4]${c.reset} Uploading to ${options.upload}...`);
    await uploadToCustomServer(options.upload, outputDir, manifest);
  } else {
    console.log(`  ${c.bold}[4/4]${c.reset} Done`);
    console.log('');
    console.log(`  ${c.green}${c.bold}✔ Update ready!${c.reset}`);
    console.log(`  ${c.dim}Version:  ${manifest.version}${c.reset}`);
    console.log(`  ${c.dim}Channel:  ${manifest.channel}${c.reset}`);
    console.log(`  ${c.dim}Output:   ${outputDir}${c.reset}`);
    console.log('');
    console.log(`  ${c.bold}Next:${c.reset} Upload to production:`);
    console.log(`    ${c.cyan}livepatch push --upload github${c.reset}     ${c.dim}(GitHub Releases — free)${c.reset}`);
    console.log(`    ${c.cyan}livepatch push --upload vercel${c.reset}     ${c.dim}(Vercel — free)${c.reset}`);
    console.log('');
    console.log(`  ${c.bold}Or serve locally:${c.reset}`);
    console.log(`    ${c.cyan}livepatch serve${c.reset}`);
  }
  console.log('');
}

async function serveUpdates(options) {
  const { startUpdateServer } = require(path.join(__dirname, '..', 'src', 'serve.js'));
  const dir = options.output || '.livepatch-output';

  console.log('');
  console.log(`  ${c.bold}${c.magenta}🩹 LivePatch${c.reset} — Update Server`);
  console.log('');

  try {
    const { url } = await startUpdateServer({ dir, port: options.port });
    console.log(`  ${c.green}✔${c.reset}  Server: ${c.cyan}${url}${c.reset}`);
    console.log('');
    console.log(`  ${c.bold}In your app:${c.reset}`);
    console.log(`  ${c.dim}import { LivePatch } from 'react-native-livepatch';${c.reset}`);
    console.log(`  ${c.dim}LivePatch.configure({ updateUrl: '${url}' });${c.reset}`);
    console.log('');
    console.log(`  ${c.bold}Test endpoints:${c.reset}`);
    console.log(`    ${c.dim}GET ${url}/check?platform=android&channel=production${c.reset}`);
    console.log(`    ${c.dim}GET ${url}/bundle/android${c.reset}`);
    console.log(`    ${c.dim}GET ${url}/manifest${c.reset}`);
    console.log('');
    console.log(`  ${c.dim}Ctrl+C to stop${c.reset}`);
  } catch (err) {
    console.error(`  ${c.red}✖${c.reset}  ${err.message}`);
    process.exit(1);
  }
}

function showHistory() {
  console.log('');
  console.log(`  ${c.bold}${c.magenta}🩹 LivePatch${c.reset} — Push History`);
  console.log('');

  const historyPath = path.resolve('.livepatch-history.json');
  if (!fs.existsSync(historyPath)) {
    console.log(`  ${c.dim}No updates pushed yet.${c.reset}`);
    console.log('');
    return;
  }

  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  for (const entry of history.slice(-10).reverse()) {
    const platforms = Object.keys(entry.bundles || {}).join(', ');
    console.log(`  ${c.green}•${c.reset} v${entry.version} → ${c.cyan}${entry.channel}${c.reset} ${c.dim}(${platforms}) ${entry.timestamp}${c.reset}`);
  }
  console.log('');
}

async function uploadToGitHub(manifest, outputDir) {
  // Check gh CLI
  try {
    execSync('gh --version', { stdio: 'pipe' });
  } catch {
    console.error(`  ${c.red}✖${c.reset}  GitHub CLI (gh) not installed. Install: brew install gh`);
    process.exit(1);
  }

  try {
    execSync('gh auth status', { stdio: 'pipe' });
  } catch {
    console.error(`  ${c.red}✖${c.reset}  Not logged in. Run: gh auth login`);
    process.exit(1);
  }

  const tag = `v${manifest.version}`;
  const title = `Update ${manifest.version} (${manifest.channel})`;
  const notes = `Channel: ${manifest.channel}\nPlatforms: ${Object.keys(manifest.bundles).join(', ')}\nTimestamp: ${manifest.timestamp}`;

  // Collect files to upload
  const files = [];
  files.push(path.join(outputDir, 'manifest.json'));
  for (const platform of Object.keys(manifest.bundles)) {
    files.push(path.join(outputDir, manifest.bundles[platform].filename));
  }

  const fileArgs = files.map(f => `"${f}"`).join(' ');

  try {
    execSync(`gh release create "${tag}" ${fileArgs} --title "${title}" --notes "${notes}"`, {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 60000,
    });

    // Get the release URL
    const releaseUrl = execSync(`gh release view "${tag}" --json url -q .url`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    // Get the repo info for download URL
    const repoUrl = execSync('gh repo view --json url -q .url', {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    // Construct download base URL
    const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    let downloadBase = '';
    if (repoMatch) {
      downloadBase = `https://github.com/${repoMatch[1]}/${repoMatch[2]}/releases/download/${tag}`;
    }

    console.log(`  ${c.green}✔${c.reset}  Release created: ${c.cyan}${releaseUrl}${c.reset}`);
    console.log('');
    console.log(`  ${c.green}${c.bold}✔ Update published!${c.reset}`);
    console.log(`  ${c.dim}Version: ${manifest.version}${c.reset}`);
    console.log(`  ${c.dim}Channel: ${manifest.channel}${c.reset}`);
    console.log('');
    console.log(`  ${c.bold}Configure your app with:${c.reset}`);
    console.log(`  ${c.dim}LivePatch.configure({${c.reset}`);
    console.log(`  ${c.dim}  updateUrl: '${downloadBase}'${c.reset}`);
    console.log(`  ${c.dim}});${c.reset}`);
    console.log('');

    // Save config for future pushes
    const configPath = path.resolve('.livepatch.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    config.github = { downloadBase, tag };
    config.updateUrl = downloadBase;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  } catch (err) {
    const msg = err.stderr || err.message || '';
    if (msg.includes('already exists')) {
      console.log(`  ${c.yellow}⚠${c.reset}  Release ${tag} already exists. Deleting and recreating...`);
      try {
        execSync(`gh release delete "${tag}" --yes`, { stdio: 'pipe' });
        execSync(`gh release create "${tag}" ${fileArgs} --title "${title}" --notes "${notes}"`, { stdio: 'pipe' });
        console.log(`  ${c.green}✔${c.reset}  Release recreated`);
      } catch (e2) {
        console.error(`  ${c.red}✖${c.reset}  Failed: ${e2.message}`);
        process.exit(1);
      }
    } else {
      console.error(`  ${c.red}✖${c.reset}  GitHub upload failed: ${msg.split('\n')[0]}`);
      process.exit(1);
    }
  }
}

async function uploadToVercel(outputDir) {
  // Check if vercel CLI is available
  try {
    execSync('npx vercel --version', { stdio: 'pipe' });
  } catch {
    console.error(`  ${c.red}✖${c.reset}  Vercel CLI not found. Install: npm i -g vercel`);
    process.exit(1);
  }

  try {
    // Deploy the output directory as a static site
    const result = execSync(`npx vercel "${outputDir}" --prod --yes`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 60000,
    }).trim();

    const deployUrl = result.split('\n').pop().trim();

    console.log(`  ${c.green}✔${c.reset}  Deployed to Vercel`);
    console.log('');
    console.log(`  ${c.green}${c.bold}✔ Update published!${c.reset}`);
    console.log(`  ${c.dim}URL: ${c.cyan}${deployUrl}${c.reset}`);
    console.log('');
    console.log(`  ${c.bold}Configure your app with:${c.reset}`);
    console.log(`  ${c.dim}LivePatch.configure({${c.reset}`);
    console.log(`  ${c.dim}  updateUrl: '${deployUrl}'${c.reset}`);
    console.log(`  ${c.dim}});${c.reset}`);

    // Save config
    const configPath = path.resolve('.livepatch.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    config.vercel = { url: deployUrl };
    config.updateUrl = deployUrl;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  } catch (err) {
    console.error(`  ${c.red}✖${c.reset}  Vercel deploy failed: ${err.message.split('\n')[0]}`);
    process.exit(1);
  }
}

async function uploadToCustomServer(serverUrl, outputDir, manifest) {
  // Upload manifest + bundles via HTTP PUT/POST
  const files = ['manifest.json'];
  for (const platform of Object.keys(manifest.bundles)) {
    files.push(manifest.bundles[platform].filename);
  }

  for (const filename of files) {
    const filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath);
    const uploadUrl = `${serverUrl}/${filename}`;

    try {
      execSync(`curl -s -X PUT "${uploadUrl}" --data-binary @"${filePath}" -H "Content-Type: application/octet-stream"`, {
        stdio: 'pipe',
        timeout: 60000,
      });
      console.log(`  ${c.green}✔${c.reset}  ${filename} uploaded`);
    } catch (err) {
      console.error(`  ${c.red}✖${c.reset}  Failed to upload ${filename}`);
      process.exit(1);
    }
  }

  console.log('');
  console.log(`  ${c.green}${c.bold}✔ Update published!${c.reset}`);
  console.log(`  ${c.dim}Server: ${serverUrl}${c.reset}`);
}

function showHelp() {
  console.log('');
  console.log(`  ${c.bold}${c.magenta}🩹 LivePatch${c.reset} — OTA updates for React Native`);
  console.log(`  ${c.dim}Free CodePush alternative. Self-hosted, no cloud dependency.${c.reset}`);
  console.log('');
  console.log(`  ${c.bold}COMMANDS${c.reset}`);
  console.log(`    ${c.green}push${c.reset}       Bundle JS and publish update`);
  console.log(`    ${c.green}serve${c.reset}      Start local update server (dev/testing)`);
  console.log(`    ${c.green}history${c.reset}    Show push history`);
  console.log(`    ${c.green}rollback${c.reset}   Revert to previous version`);
  console.log('');
  console.log(`  ${c.bold}OPTIONS${c.reset}`);
  console.log(`    ${c.yellow}--channel, -c <name>${c.reset}    Target channel ${c.dim}(default: production)${c.reset}`);
  console.log(`    ${c.yellow}--platform, -p <os>${c.reset}     android, ios, or all ${c.dim}(default: all)${c.reset}`);
  console.log(`    ${c.yellow}--upload <target>${c.reset}       Upload to: github, vercel, or URL`);
  console.log(`    ${c.yellow}--output, -o <dir>${c.reset}      Output directory`);
  console.log(`    ${c.yellow}--port <number>${c.reset}         Serve port ${c.dim}(default: 4200)${c.reset}`);
  console.log('');
  console.log(`  ${c.bold}EXAMPLES${c.reset}`);
  console.log(`    ${c.dim}$${c.reset} livepatch push                            ${c.dim}# bundle only${c.reset}`);
  console.log(`    ${c.dim}$${c.reset} livepatch push --upload github             ${c.dim}# push to GitHub Releases (free)${c.reset}`);
  console.log(`    ${c.dim}$${c.reset} livepatch push --upload vercel             ${c.dim}# push to Vercel (free)${c.reset}`);
  console.log(`    ${c.dim}$${c.reset} livepatch push --upload https://my.server  ${c.dim}# push to custom server${c.reset}`);
  console.log(`    ${c.dim}$${c.reset} livepatch push --channel staging -p android`);
  console.log(`    ${c.dim}$${c.reset} livepatch serve                            ${c.dim}# local dev server${c.reset}`);
  console.log('');
}

function generateVersion() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}.${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function saveHistory(manifest) {
  const historyPath = path.resolve('.livepatch-history.json');
  let history = [];
  if (fs.existsSync(historyPath)) {
    try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch {}
  }
  history.push(manifest);
  if (history.length > 50) history = history.slice(-50);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

// Main
const { command, options } = parseArgs(process.argv);

switch (command) {
  case 'push': pushUpdate(options); break;
  case 'serve': serveUpdates(options); break;
  case 'history': showHistory(); break;
  case 'rollback': console.log(`\n  ${c.yellow}⚠${c.reset}  Use LivePatch.rollback() in your app\n`); break;
  case 'help': case '--help': case '-h': showHelp(); break;
  default: showHelp(); break;
}
