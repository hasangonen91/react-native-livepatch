import { NativeModules, Platform } from 'react-native';

export interface LivePatchNativeModule {
  /** Get the path to the currently active bundle (or null if using default) */
  getActiveBundlePath(): Promise<string | null>;
  /** Set the bundle path for next launch */
  setBundlePath(path: string): Promise<void>;
  /** Clear custom bundle, revert to original */
  clearBundlePath(): Promise<void>;
  /** Restart the app */
  restart(): void;
  /** Get app version (native) */
  getAppVersion(): Promise<string>;
  /** Get bundle directory path */
  getBundleDirectory(): Promise<string>;
}

const LINKING_ERROR =
  `The package 'react-native-livepatch' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You ran 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go (LivePatch requires a custom dev client)\n';

/**
 * Native module bridge.
 * Handles bundle file management and app restart at the native level.
 */
export const LivePatchNative: LivePatchNativeModule = NativeModules.LivePatchModule
  ? NativeModules.LivePatchModule
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      },
    ) as LivePatchNativeModule;
