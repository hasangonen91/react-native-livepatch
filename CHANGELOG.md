# Changelog

## 1.0.0

Rewrite for production use.

- TurboModule (new architecture, bridgeless) for iOS and Android.
- Crash-safe installs: trial launch + `notifyAppReady()`, automatic rollback and per-device blocklist.
- Releases target a native app version; store updates discard old OTA bundles.
- Assets ship with the bundle; unchanged files are reused; SHA-256 verified downloads done natively (no base64 over the bridge).
- Reload that works in bridgeless mode (iOS reload command, Android process restart).
- Supabase backend (`supabase/livepatch.sql`): releases, staged rollouts, mandatory releases, server-side rollback, install statistics.
- New CLI: `release`, `list`, `disable`, `enable`, `rollout`, `mandatory`, `sql`. Hermes bytecode compilation.
- `useLivePatch()` hook, `httpProvider()` for custom servers.
- Removed: `configure({ updateUrl })`, `livepatch push/serve/history`, GitHub/Vercel upload, Expo plugin.

## 0.4.2

Previous release.
