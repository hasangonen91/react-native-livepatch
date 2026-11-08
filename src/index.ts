import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import NativeLivePatch from './NativeLivePatch';
import { LivePatchCore } from './core';
import type { LivePatchSnapshot } from './types';

export * from './types';
export { supabaseProvider, httpProvider } from './providers';
export type { SupabaseProviderOptions, HttpProviderOptions } from './providers';
export { LivePatchCore } from './core';

declare const __DEV__: boolean;

/**
 * OTA updates for React Native.
 *
 * ```tsx
 * import { LivePatch, supabaseProvider } from 'react-native-livepatch';
 *
 * useEffect(() => {
 *   LivePatch.init({ provider: supabaseProvider({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }) });
 * }, []);
 * ```
 */
export const LivePatch = new LivePatchCore({
  native: NativeLivePatch,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  appState: AppState,
});

/** Live update status for UI (e.g. an "Update ready, restart?" banner). */
export function useLivePatch(): LivePatchSnapshot {
  return useSyncExternalStore(LivePatch.subscribe, LivePatch.getSnapshot, LivePatch.getSnapshot);
}

export default LivePatch;
