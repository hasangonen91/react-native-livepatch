export interface LivePatchNativeModule {
    /** Get the path to the currently active bundle (or null if using default) */
    getActiveBundlePath(): Promise<string | null>;
    /** Get the version of the currently active bundle */
    getActiveVersion(): Promise<string | null>;
    /** Set the bundle path for next launch */
    setBundlePath(path: string): Promise<void>;
    /** Write bundle (base64) to disk, returns the file path */
    writeBundle(base64: string, version: string): Promise<string>;
    /** Clear custom bundle, revert to original */
    clearBundlePath(): Promise<void>;
    /** Restart the app */
    restart(): void;
    /** Get app version (native) */
    getAppVersion(): Promise<string>;
    /** Get bundle directory path */
    getBundleDirectory(): Promise<string>;
}
/**
 * Native module bridge.
 * Handles bundle file management and app restart at the native level.
 */
export declare const LivePatchNative: LivePatchNativeModule;
