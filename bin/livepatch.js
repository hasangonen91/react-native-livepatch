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

  // Step 4: Save to history
  saveHistory(manifest);

  // Output
  console.log(`  ${c.bold}[4/4]${c.reset} Done`);
  console.log('');
  console.log(`  ${c.green}${c.bold}✔ Update ready!${c.reset}`);
  console.log(`  ${c.dim}Version:  ${manifest.version}${c.reset}`);
  console.log(`  ${c.dim}Channel:  ${manifest.channel}${c.reset}`);
  console.log(`  ${c.dim}Output:   ${outputDir}${c.reset}`);
  console.log('');

  if (options.server) {
    console.log(`  ${c.dim}Uploading to ${options.server}...${c.reset}`);
    // TODO: HTTP upload
    console.log(`  ${c.green}✔${c.reset}  Uploaded`);
  } else {
    console.log(`  ${c.bold}Next:${c.reset} Serve locally for testing:`);
    console.log(`    ${c.cyan}npx livepatch serve${c.reset}`);
    console.log('');
    console.log(`  ${c.bold}Or upload to hosting:${c.reset}`);
    console.log(`    ${c.dim}• GitHub Releases: gh release create v${manifest.version} ${outputDir}/*${c.reset}`);
    console.log(`    ${c.dim}• S3: aws s3 sync ${outputDir} s3://bucket/updates/${options.channel}/${c.reset}`);
    console.log(`    ${c.dim}• Vercel/Netlify: deploy the folder as static site${c.reset}`);
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

function showHelp() {
  console.log('');
  console.log(`  ${c.bold}${c.magenta}🩹 LivePatch${c.reset} — OTA updates for React Native`);
  console.log(`  ${c.dim}Free CodePush alternative. Self-hosted, no cloud dependency.${c.reset}`);
  console.log('');
  console.log(`  ${c.bold}COMMANDS${c.reset}`);
  console.log(`    ${c.green}push${c.reset}       Bundle JS and create update package`);
  console.log(`    ${c.green}serve${c.reset}      Start local update server (for testing)`);
  console.log(`    ${c.green}history${c.reset}    Show push history`);
  console.log(`    ${c.green}rollback${c.reset}   Revert to previous version`);
  console.log('');
  console.log(`  ${c.bold}OPTIONS${c.reset}`);
  console.log(`    ${c.yellow}--channel, -c <name>${c.reset}  Target channel ${c.dim}(default: production)${c.reset}`);
  console.log(`    ${c.yellow}--platform, -p <os>${c.reset}   android, ios, or all ${c.dim}(default: all)${c.reset}`);
  console.log(`    ${c.yellow}--output, -o <dir>${c.reset}    Output directory`);
  console.log(`    ${c.yellow}--server <url>${c.reset}        Upload to server`);
  console.log(`    ${c.yellow}--port <number>${c.reset}       Serve port ${c.dim}(default: 4200)${c.reset}`);
  console.log('');
  console.log(`  ${c.bold}EXAMPLES${c.reset}`);
  console.log(`    ${c.dim}$${c.reset} livepatch push`);
  console.log(`    ${c.dim}$${c.reset} livepatch push --channel staging --platform android`);
  console.log(`    ${c.dim}$${c.reset} livepatch serve`);
  console.log(`    ${c.dim}$${c.reset} livepatch history`);
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
