import { configure, getConfig, LivePatchConfig } from './config';
import { checkForUpdate, downloadUpdate, applyUpdate, rollback, getCurrentVersion, UpdateInfo, VersionInfo } from './updater';
import { LivePatchNative } from './native';

export { LivePatchConfig, UpdateInfo, VersionInfo };
export { LivePatchNativeModule } from './native';

/**
 * LivePatch — Free OTA updates for React Native.
 * CodePush alternative. Self-hosted, no cloud dependency.
 */
export const LivePatch = {
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
  configure(options: LivePatchConfig): void {
    configure(options);
    if (options.checkOnStart !== false) {
      this.sync();
    }
  },

  /**
   * Check if an update is available.
   * @returns Update info with version, size, and download URL.
   */
  async checkForUpdate(): Promise<UpdateInfo> {
    return checkForUpdate();
  },

  /**
   * Download the latest available update.
   * @param onProgress - Optional callback with download percentage (0-100).
   */
  async download(onProgress?: (percent: number) => void): Promise<{ success: boolean; path?: string }> {
    return downloadUpdate(onProgress);
  },

  /**
   * Apply a downloaded update. Restarts the app with the new bundle.
   * @param options.immediate - If true, restart now. If false, apply on next launch.
   */
  apply(options: { immediate?: boolean } = {}): void {
    applyUpdate(options);
  },

  /**
   * Full sync: check → download → apply.
   * Convenience method that handles the entire update flow.
   */
  async sync(options: { immediate?: boolean } = {}): Promise<{ status: string; version?: string; error?: string }> {
    try {
      const update = await this.checkForUpdate();
      if (!update.available) return { status: 'up-to-date' };

      const result = await this.download();
      if (!result.success) return { status: 'download-failed' };

      if (options.immediate || getConfig().autoApply) {
        this.apply({ immediate: true });
        return { status: 'applied', version: update.version };
      }

      return { status: 'pending', version: update.version };
    } catch (err: any) {
      return { status: 'error', error: err.message };
    }
  },

  /**
   * Rollback to the previous bundle version.
   */
  async rollback(): Promise<void> {
    return rollback();
  },

  /**
   * Get info about the currently running version.
   */
  getCurrentVersion(): VersionInfo {
    return getCurrentVersion();
  },

  /**
   * Access native module directly (advanced use).
   */
  native: LivePatchNative,
};

export default LivePatch;
