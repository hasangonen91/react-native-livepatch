# react-native-livepatch

Self-hosted over-the-air (OTA) updates for React Native. Ship JavaScript and asset changes to users without a store release, from your own Supabase project.

- **Crash-safe**: a new bundle runs on trial. If the app dies before it is confirmed, the next launch rolls back automatically and the release is never installed on that device again.
- **Binary-aware**: every release targets one native app version (e.g. `3.1.1`). A store update automatically discards older OTA bundles.
- **Assets included**: images and other assets ship with the bundle; unchanged files are reused from the previous release, not downloaded again.
- **Verified**: every file is checked against its SHA-256 before it is installed.
- **Rollout control**: staged rollouts (percent of devices), mandatory updates, and instant server-side rollback (`livepatch disable <id>`).
- **Stats**: installs, crashes-rolled-back and download failures per release.
- **New architecture**: TurboModule, works bridgeless (RN 0.76+).
- **Hermes**: the CLI compiles bundles to Hermes bytecode with the project's own `hermesc`.

> OTA updates can only change JavaScript and assets. New native modules, permissions or native config still need a store release. Apple allows interpreted-code updates that don't change the app's primary purpose (App Store Review Guideline 3.3.1(b) / 4.7).

## 1. Install

```sh
yarn add react-native-livepatch
cd ios && pod install
```

## 2. Backend (once)

Run the SQL in the Supabase SQL editor (or add it as a migration):

```sh
npx livepatch sql > supabase/migrations/20260101000000_livepatch.sql
```

It creates `livepatch_releases`, `livepatch_events` (RLS on, not readable by clients), two RPC functions the app calls with the anon key, and a public storage bucket `livepatch` where files are stored by hash.

## 3. Native setup

The app must ask LivePatch which bundle to load. Keep Metro for debug builds.

**iOS** (`AppDelegate.swift`):

```swift
import ReactNativeLivePatch

override func bundleURL() -> URL? {
#if DEBUG
  RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
  LivePatchBundle.bundleURL() ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
}
```

**Android** (`MainApplication.kt`):

```kotlin
import com.livepatch.LivePatchBundle

override val reactHost: ReactHost by lazy {
  getDefaultReactHost(
    context = applicationContext,
    packageList = PackageList(this).packages,
    jsBundleFilePath = if (BuildConfig.DEBUG) null else LivePatchBundle.getJSBundleFile(applicationContext),
  )
}
```

## 4. JavaScript

Call `init` once, after the first screen has rendered:

```tsx
import { LivePatch, supabaseProvider } from 'react-native-livepatch';

useEffect(() => {
  LivePatch.init({
    provider: supabaseProvider({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }),
    channel: 'production',
    installMode: 'onNextResume',        // or 'onNextRestart' (default) / 'immediate'
    minimumBackgroundDurationMs: 60_000,
  });
}, []);
```

`init` confirms the running bundle (`notifyAppReady`), checks for updates, and checks again when the app returns to the foreground. Mandatory releases install immediately.

Optional UI:

```tsx
const { phase, progress, pendingMessage } = useLivePatch();
if (phase === 'ready_to_restart') {
  // show "Update ready" and call LivePatch.restart()
}
```

| Method | |
|---|---|
| `LivePatch.init(config)` | configure and start |
| `LivePatch.sync({ installMode? })` | check, download, install |
| `LivePatch.checkForUpdate()` | check only |
| `LivePatch.notifyAppReady()` | confirm the running bundle (done by `init` unless `autoNotifyAppReady: false`) |
| `LivePatch.restart()` | reload now |
| `LivePatch.resetToEmbedded()` | drop OTA bundles, use the store bundle after restart |
| `LivePatch.getState()` | app version, running release id, pending id, failed ids |
| `useLivePatch()` | `{ phase, progress, pendingReleaseId, pendingMessage, mandatory, error }` |

## 5. Publish

Credentials for the CLI only (never put the service role key in the app). Use env vars or a git-ignored `.env.livepatch`:

```sh
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

```sh
npx livepatch release -m "Fix booking button"            # iOS + Android
npx livepatch release -p ios --rollout 10                 # 10% of iOS devices
npx livepatch release --mandatory -m "Critical fix"
npx livepatch release --dry-run                           # build only
npx livepatch list                                        # releases + stats
npx livepatch rollout <id> 100
npx livepatch disable <id>                                # instant rollback
```

The app version is read from `android/app/build.gradle` and the Xcode project; override with `--app-version`. Always bump the app version for store builds that change native code, so OTA releases built for one binary never reach another.

## How it works

```
release:  react-native bundle -> hermesc -> sha256 every file -> upload new files -> insert release row
device:   rpc livepatch_check(platform, appVersion, channel, runningId, deviceId)
          -> download changed files, verify sha256 -> stage -> "pending"
launch:   pending -> trial (runs) -> notifyAppReady() -> current
          trial still set on next launch -> crashed -> rollback to previous, mark failed
```

Releases select by `platform + app_version + channel`, newest enabled first, with `rollout` decided per device by a stable hash. A device whose running release was disabled is sent back to the store bundle.

### Custom backend

`httpProvider({ checkUrl })` talks to any server that returns

```json
{ "status": "update", "release": { "id": "…", "bundlePath": "main.jsbundle", "mandatory": false,
  "files": [{ "path": "main.jsbundle", "sha256": "…", "size": 123, "url": "https://…" }] } }
```

or `{ "status": "up_to_date" }` / `{ "status": "rollback" }`.

## Migrating from 0.x

1.0 is a rewrite. `LivePatch.configure({ updateUrl })` is replaced by `LivePatch.init({ provider })`, the native hooks are `LivePatchBundle.bundleURL()` (iOS) and `LivePatchBundle.getJSBundleFile(context)` (Android), and `livepatch push` is replaced by `livepatch release`. The Expo config plugin was removed for now.

## License

MIT
