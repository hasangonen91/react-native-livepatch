# CodePush Is Dead. I Built a Free Replacement in a Week.

Microsoft shut down CodePush in March 2025. Millions of React Native apps relied on it for over-the-air updates — push a JS fix, users get it instantly, no app store review.

Now it's gone. And the alternatives want your money.

## The Problem

You have a bug in production. Fix is 1 line of JavaScript. Without OTA updates, you have to:

1. Fix the code
2. Rebuild the app
3. Submit to App Store / Play Store
4. Wait 1-3 days for review
5. Hope users update

With OTA updates, you just push — users get the fix in minutes.

## What's Left After CodePush?

| Solution | Cost | Self-hosted | Needs account |
|----------|------|-------------|---------------|
| ~~CodePush~~ | Dead | — | — |
| EAS Update | $99+/mo for teams | ❌ | Expo account |
| Shorebird | $20+/mo | ❌ | Account |
| **LivePatch** | **Free** | **✅** | **None** |

## LivePatch — What I Built

```bash
yarn add react-native-livepatch
```

### Push an update:

```bash
npx livepatch push --upload github
```

One command. Bundles your JS, creates a GitHub Release, done. Users get it on next app open.

### App integration (2 lines):

```tsx
import { LivePatch } from 'react-native-livepatch';

LivePatch.configure({
  updateUrl: 'https://github.com/you/yourapp/releases/latest/download',
});
```

That's the entire setup.

## How It Actually Works

1. You change code and run `livepatch push --upload github`
2. CLI bundles your JavaScript (same as `react-native bundle`)
3. Generates SHA-256 hash for integrity
4. Creates a GitHub Release with the bundle + manifest
5. User opens app → LivePatch checks for updates
6. New version found → downloads bundle → verifies hash → restarts with new code

The native module overrides `getJSBundleFile()` so the app loads your custom bundle instead of the one baked into the APK/IPA.

## No Vendor Lock-In

Upload your bundles anywhere:

```bash
livepatch push --upload github     # GitHub Releases (free, unlimited bandwidth)
livepatch push --upload vercel     # Vercel static hosting (free tier)
livepatch push --upload https://s3.amazonaws.com/my-bucket  # Your own infra
```

GitHub Releases is the sweet spot — free, unlimited downloads, no setup needed.

## What About Store Rules?

**Google Play** ✅ — explicitly allows updating JavaScript and assets without review, as long as you don't change native code or the app's core purpose.

**Apple App Store** ✅ — same policy. CodePush operated under this rule for 7+ years without issues. Microsoft's own docs confirmed compliance.

The rule is simple: update JS/images = fine. Change native code or app purpose = not fine.

## Technical Details

- **TypeScript** — full type definitions, IntelliSense support
- **Native modules** — Android (Kotlin) + iOS (Swift) for bundle management + app restart
- **13 KB** package size — no bloat
- **SHA-256 verification** — corrupted bundles are rejected
- **Channel-based** — push to `dev`, `staging`, `production` independently
- **Rollback** — `LivePatch.rollback()` reverts to previous version
- **Offline-safe** — app works fine without internet, just skips update check

## Migrating from CodePush

If you used CodePush, the mental model is identical:

| CodePush | LivePatch |
|----------|-----------|
| `codePush.sync()` | `LivePatch.sync()` |
| `codePush.checkForUpdate()` | `LivePatch.checkForUpdate()` |
| Deployment keys | Channels (production/staging) |
| Microsoft servers | Your own hosting (GitHub/Vercel/S3) |
| AppCenter dashboard | `livepatch history` CLI |

## Links

- **npm:** https://www.npmjs.com/package/react-native-livepatch
- **GitHub:** https://github.com/hasangonen91/react-native-livepatch
- **LinkedIn:** https://www.linkedin.com/in/hasangonen91/

---

*If you're migrating from CodePush or looking for a free OTA solution, try it out. 13 KB install, 2 lines of code, push updates in seconds.*

---

**Tags (Dev.to):** reactnative, javascript, mobile, opensource
