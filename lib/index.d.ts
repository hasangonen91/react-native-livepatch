import { LivePatchConfig } from './config';
import { UpdateInfo, VersionInfo } from './updater';
export { LivePatchConfig, UpdateInfo, VersionInfo };
export { LivePatchNativeModule } from './native';
/**
 * LivePatch — Free OTA updates for React Native.
 * CodePush alternative. Self-hosted, no cloud dependency.
 */
export declare const LivePatch: {
    /**
     * Configure LivePatch with update server URL and options.
     * Call once on app startup (e.g., in App.tsx or index.js).
     *
     * @example
     * ```tsx
     * LivePatch.configure({
     *   updateUrl: 'https://your-server.com/updates',
     *   channel: 'production',
     * });
     * ```
     */
    configure(options: LivePatchConfig): void;
    /**
     * Check if an update is available.
     * @returns Update info with version, size, and download URL.
     */
    checkForUpdate(): Promise<UpdateInfo>;
    /**
     * Download the latest available update.
     * @param onProgress - Optional callback with download percentage (0-100).
     */
    download(onProgress?: (percent: number) => void): Promise<{
        success: boolean;
        path?: string;
    }>;
    /**
     * Apply a downloaded update. Restarts the app with the new bundle.
     * @param options.immediate - If true, restart now. If false, apply on next launch.
     */
    apply(options?: {
        immediate?: boolean;
    }): void;
    /**
     * Full sync: check → download → apply.
     * Convenience method that handles the entire update flow.
     */
    sync(options?: {
        immediate?: boolean;
    }): Promise<{
        status: string;
        version?: string;
        error?: string;
    }>;
    /**
     * Rollback to the previous bundle version.
     */
    rollback(): Promise<void>;
    /**
     * Get info about the currently running version.
     */
    getCurrentVersion(): Promise<VersionInfo>;
    /**
     * Access native module directly (advanced use).
     */
    native: import("./native").LivePatchNativeModule;
};
export default LivePatch;
