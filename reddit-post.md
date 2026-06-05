# CodePush is dead. I built a free, self-hosted replacement.

Microsoft shut down CodePush in March 2025. If you relied on it for OTA updates, your options are now:

- **EAS Update** — requires Expo account + paid tiers for serious use
- **Shorebird** — paid, limited platform support
- **Roll your own** — weeks of work

I built **LivePatch** — same concept as CodePush but free, self-hosted, no cloud lock-in.

## How it works

```bash
# Install
yarn add react-native-livepatch

# Push an update (one command)
npx livepatch push --upload github
```

That's it. Your users get the update on next app open. No app store review, no rebuild.

## In your app (2 lines):

```tsx
import { LivePatch } from 'react-native-livepatch';

LivePatch.configure({
  updateUrl: 'https://github.com/you/yourapp/releases/latest/download',
  channel: 'production',
});
```

## What makes it different:

| | CodePush | EAS Update | LivePatch |
|---|---|---|---|
| Cost | Dead | Paid | **Free** |
| Self-hosted | ❌ | ❌ | **✅** |
| Account needed | ❌ | ❌ | **✅ None** |
| Bare RN | ✅ | Needs Expo | **✅** |
| Upload target | MS servers | Expo cloud | **Anywhere** |

## Upload anywhere — no vendor lock-in:

```bash
livepatch push --upload github    # GitHub Releases (free, unlimited)
livepatch push --upload vercel    # Vercel (free tier)
livepatch push --upload https://your-s3-bucket.com
```

## Tech details:

- TypeScript + native modules (Android Kotlin + iOS Swift)
- SHA-256 bundle integrity verification
- Channel-based (dev/staging/production)
- 13 KB package size
- Rollback support
- Works offline (app functions without updates)
- Store compliant (Google Play ✅ / App Store ✅)

## Links:

- **npm:** https://www.npmjs.com/package/react-native-livepatch
- **GitHub:** https://github.com/hasangonen91/react-native-livepatch

If you're migrating from CodePush, this is a drop-in workflow replacement. Would love feedback on what else you'd need.
