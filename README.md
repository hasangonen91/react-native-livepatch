# 🩹 LivePatch

[![npm version](https://img.shields.io/npm/v/react-native-livepatch.svg)](https://npmjs.com/package/react-native-livepatch)
[![license](https://img.shields.io/npm/l/react-native-livepatch.svg)](https://github.com/hasangonen91/react-native-livepatch/blob/main/LICENSE)

### CodePush is dead. This is the free replacement.

Push JavaScript updates to your React Native app instantly. No rebuild, no app store review, no cloud dependency.

## CodePush shut down. Now what?

Microsoft killed CodePush in March 2025. Your options:

| Solution | Cost | Self-hosted | Bare RN | No account |
|----------|------|-------------|---------|------------|
| ~~CodePush~~ | Dead | — | — | — |
| EAS Update | Paid tiers | ❌ | ⚠️ needs Expo | ❌ |
| Shorebird | Paid | ❌ | Limited | ❌ |
| **LivePatch** | **Free** | **✅** | **✅** | **✅** |

## Install

```bash
yarn add react-native-livepatch
```

## Quick Start

### 1. In your app (2 lines):

```tsx
import { LivePatch } from 'react-native-livepatch';

LivePatch.configure({
  updateUrl: 'https://your-server.com/updates',
  channel: 'production',
});
```

App checks for updates on launch. If available, downloads and applies automatically.

### 2. Push an update (1 command):

```bash
npx livepatch push --upload github
```

Done. All users get the update on next app open.

## How It Works

```
You change code → livepatch push → users open app → new code running
                                    (no store update needed)
```

1. `livepatch push` bundles your JS and uploads to hosting
2. App launches → checks update server → downloads new bundle
3. App restarts with new code — instant, seamless

## Upload Options

```bash
livepatch push --upload github      # GitHub Releases (free, unlimited)
livepatch push --upload vercel      # Vercel (free tier)
livepatch push --upload https://s3.amazonaws.com/my-bucket  # Any server
livepatch push                      # Bundle only (upload manually)
```

**No paid service needed.** GitHub Releases is free and handles unlimited downloads.

## Commands

```bash
livepatch push                          # Bundle + prepare update
livepatch push --upload github          # Bundle + publish to GitHub
livepatch push --channel staging        # Push to staging channel
livepatch push --platform android       # Android only
livepatch serve                         # Local dev server (testing)
livepatch history                       # Show push history
```

## Features

- **Free forever** — no paid tiers, no limits, no accounts
- **Self-hosted** — GitHub Releases, Vercel, S3, any static host
- **TypeScript** — full type definitions included
- **Native modules** — Android (Kotlin) + iOS (Swift)
- **Channel-based** — push different updates to dev/staging/production
- **Integrity verification** — SHA-256 hash check on every bundle
- **Rollback** — revert to previous version instantly
- **Tiny** — 13 KB package size, no heavy dependencies
- **Works offline** — app functions normally without updates
- **Auto-apply** — or manual control, your choice

## Expo Support

Works with Expo prebuild (bare workflow) and Dev Client. Add to `app.json`:

```json
{
  "plugins": ["react-native-livepatch"]
}
```

Then run `npx expo prebuild` — the config plugin auto-configures native modules. No manual setup needed.

| Expo Type | Supported |
|-----------|-----------|
| Expo prebuild (bare) | ✅ |
| Expo Dev Client | ✅ |
| Expo Go | ❌ (use EAS Update) |

## Native Integration

### Android (MainApplication.kt):

```kotlin
import com.livepatch.LivePatchModule

// In getDefaultReactHost:
jsBundleFilePath = LivePatchModule.getCustomBundlePath(this@MainApplication)
```

### iOS (AppDelegate.swift):

```swift
import LivePatchModule

// In sourceURL:
return LivePatchModule.bundleURL() ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")
```

## API

```tsx
import { LivePatch } from 'react-native-livepatch';

// Configure (once on startup)
LivePatch.configure({ updateUrl: '...', channel: 'production' });

// Manual control
const update = await LivePatch.checkForUpdate();
// → { available: true, version: '2026.6.5', size: 983040 }

await LivePatch.download((percent) => console.log(percent + '%'));
LivePatch.apply({ immediate: true }); // restart with new bundle

// Rollback
await LivePatch.rollback();

// Sync (check + download + apply in one call)
await LivePatch.sync();
```

## Security

- Bundle integrity verified with SHA-256 hash before applying
- HTTPS enforced for production update URLs
- Rollback on crash detection (if app crashes after update, reverts automatically)
- No code execution from untrusted sources — only signed bundles

## Store Compliance

- **Google Play** ✅ — allows JS/asset updates without review (no native code changes)
- **Apple App Store** ✅ — same policy, CodePush used this for years without issues

The rule: you can update JavaScript and assets, but not native code or app purpose.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Your App                                        │
│  ┌────────────────────────────────────────────┐  │
│  │  LivePatch SDK (JS)                        │  │
│  │  - Check for updates                       │  │
│  │  - Download bundle                         │  │
│  │  - Trigger restart                         │  │
│  └─────────────┬──────────────────────────────┘  │
│                │                                  │
│  ┌─────────────▼──────────────────────────────┐  │
│  │  Native Module (Kotlin/Swift)              │  │
│  │  - Store bundle on filesystem              │  │
│  │  - Override bundle path on next launch     │  │
│  │  - Restart app                             │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────┐
│  Update Server       │
│  (GitHub / Vercel /  │
│   S3 / your server)  │
│                      │
│  manifest.json       │
│  android.jsbundle    │
│  ios.jsbundle        │
└──────────────────────┘
```

## License

MIT

## Author

**Hasan Gönen** — [@hasangonen91](https://github.com/hasangonen91)

- [LinkedIn](https://www.linkedin.com/in/hasangonen91/)
- [npm](https://www.npmjs.com/~hasangonen91)

---

*Also check out [react-native-starship](https://www.npmjs.com/package/react-native-starship) — wireless deploy for React Native (QR scan → install → running).*
