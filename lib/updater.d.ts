export interface UpdateInfo {
    available: boolean;
    version?: string;
    size?: number;
    notes?: string;
    url?: string;
    hash?: string;
}
export interface VersionInfo {
    version: string;
    channel: string;
    isUpdate: boolean;
    bundlePath?: string;
}
/**
 * Checks the update server for a new version.
 */
export declare function checkForUpdate(): Promise<UpdateInfo>;
/**
 * Downloads the update bundle to the device.
 * The bundle is fetched, converted to base64 and written to disk by the native module.
 */
export declare function downloadUpdate(onProgress?: (percent: number) => void): Promise<{
    success: boolean;
    path?: string;
}>;
/**
 * Applies a downloaded update.
 */
export declare function applyUpdate(options?: {
    immediate?: boolean;
}): void;
/**
 * Rollback to the original bundle.
 */
export declare function rollback(): Promise<void>;
/**
 * Gets the current running version info (from native storage).
 */
export declare function getCurrentVersion(): Promise<VersionInfo>;
