"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkForUpdate = checkForUpdate;
exports.downloadUpdate = downloadUpdate;
exports.applyUpdate = applyUpdate;
exports.rollback = rollback;
exports.getCurrentVersion = getCurrentVersion;
const react_native_1 = require("react-native");
const config_1 = require("./config");
const native_1 = require("./native");
let _pendingUpdate = null;
/**
 * Checks the update server for a new version.
 */
async function checkForUpdate() {
    const config = (0, config_1.getConfig)();
    if (!config.updateUrl) {
        throw new Error('LivePatch not configured. Call LivePatch.configure() first.');
    }
    const currentVersion = await getCurrentVersion();
    const platform = react_native_1.Platform.OS;
    const channel = config.channel || 'production';
    const checkUrl = `${config.updateUrl}/check?platform=${platform}&channel=${channel}&currentVersion=${currentVersion.version}`;
    try {
        const response = await fetch(checkUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            return { available: false };
        }
        const data = await response.json();
        if (data.version && data.version !== currentVersion.version) {
            return {
                available: true,
                version: data.version,
                size: data.size || 0,
                notes: data.notes || '',
                url: data.url,
                hash: data.hash,
            };
        }
        return { available: false };
    }
    catch {
        return { available: false };
    }
}
/**
 * Downloads the update bundle to the device.
 * The bundle is fetched, converted to base64 and written to disk by the native module.
 */
async function downloadUpdate(onProgress) {
    const update = await checkForUpdate();
    if (!update.available || !update.url) {
        return { success: false };
    }
    try {
        const response = await fetch(update.url);
        if (!response.ok)
            return { success: false };
        const blob = await response.blob();
        const reader = new FileReader();
        const base64 = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result.split(',')[1] ?? null);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        if (!base64)
            return { success: false };
        // Write bundle to disk via native module (returns the real file path)
        const filePath = await native_1.LivePatchNative.writeBundle(base64, update.version);
        _pendingUpdate = {
            version: update.version,
            path: filePath,
            hash: update.hash,
        };
        if (onProgress)
            onProgress(100);
        return { success: true, path: filePath };
    }
    catch {
        return { success: false };
    }
}
/**
 * Applies a downloaded update.
 */
function applyUpdate(options = {}) {
    const immediate = options.immediate !== false;
    if (!_pendingUpdate) {
        throw new Error('No pending update to apply. Call download() first.');
    }
    if (immediate) {
        native_1.LivePatchNative.restart();
    }
}
/**
 * Rollback to the original bundle.
 */
async function rollback() {
    await native_1.LivePatchNative.clearBundlePath();
    _pendingUpdate = null;
    native_1.LivePatchNative.restart();
}
/**
 * Gets the current running version info (from native storage).
 */
async function getCurrentVersion() {
    const config = (0, config_1.getConfig)();
    // Read active version + bundle path from native storage
    const [activeVersion, activePath] = await Promise.all([
        native_1.LivePatchNative.getActiveVersion(),
        native_1.LivePatchNative.getActiveBundlePath(),
    ]);
    return {
        version: activeVersion || _pendingUpdate?.version || '0',
        channel: config.channel || 'production',
        isUpdate: !!activePath,
        bundlePath: activePath || _pendingUpdate?.path,
    };
}
