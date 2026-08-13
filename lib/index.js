"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LivePatch = void 0;
const config_1 = require("./config");
const updater_1 = require("./updater");
const native_1 = require("./native");
/**
 * LivePatch — Free OTA updates for React Native.
 * CodePush alternative. Self-hosted, no cloud dependency.
 */
exports.LivePatch = {
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
    configure(options) {
        (0, config_1.configure)(options);
        if (options.checkOnStart !== false) {
            this.sync();
        }
    },
    /**
     * Check if an update is available.
     * @returns Update info with version, size, and download URL.
     */
    async checkForUpdate() {
        return (0, updater_1.checkForUpdate)();
    },
    /**
     * Download the latest available update.
     * @param onProgress - Optional callback with download percentage (0-100).
     */
    async download(onProgress) {
        return (0, updater_1.downloadUpdate)(onProgress);
    },
    /**
     * Apply a downloaded update. Restarts the app with the new bundle.
     * @param options.immediate - If true, restart now. If false, apply on next launch.
     */
    apply(options = {}) {
        (0, updater_1.applyUpdate)(options);
    },
    /**
     * Full sync: check → download → apply.
     * Convenience method that handles the entire update flow.
     */
    async sync(options = {}) {
        try {
            const update = await this.checkForUpdate();
            if (!update.available)
                return { status: 'up-to-date' };
            const result = await this.download();
            if (!result.success)
                return { status: 'download-failed' };
            if (options.immediate || (0, config_1.getConfig)().autoApply) {
                this.apply({ immediate: true });
                return { status: 'applied', version: update.version };
            }
            return { status: 'pending', version: update.version };
        }
        catch (err) {
            return { status: 'error', error: err.message };
        }
    },
    /**
     * Rollback to the previous bundle version.
     */
    async rollback() {
        return (0, updater_1.rollback)();
    },
    /**
     * Get info about the currently running version.
     */
    async getCurrentVersion() {
        return (0, updater_1.getCurrentVersion)();
    },
    /**
     * Access native module directly (advanced use).
     */
    native: native_1.LivePatchNative,
};
exports.default = exports.LivePatch;
