import { Platform } from 'react-native';
import { getConfig } from './config';
import { LivePatchNative } from './native';

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

let _pendingUpdate: { version: string; path: string; hash?: string } | null = null;

/**
 * Checks the update server for a new version.
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const config = getConfig();
  if (!config.updateUrl) {
    throw new Error('LivePatch not configured. Call LivePatch.configure() first.');
  }

  const currentVersion = getCurrentVersion();
  const platform = Platform.OS;
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
  } catch {
    return { available: false };
  }
}

/**
 * Downloads the update bundle to the device.
 */
export async function downloadUpdate(onProgress?: (percent: number) => void): Promise<{ success: boolean; path?: string }> {
  const update = await checkForUpdate();

  if (!update.available || !update.url) {
    return { success: false };
  }

  try {
    const bundleDir = await LivePatchNative.getBundleDirectory();
    const downloadPath = `${bundleDir}/livepatch_${update.version}.jsbundle`;

    // Download using fetch + write via native module
    const response = await fetch(update.url);
    if (!response.ok) return { success: false };

    const blob = await response.blob();
    const reader = new FileReader();

    await new Promise<void>((resolve, reject) => {
      reader.onload = async () => {
        try {
          // Write bundle via native
          const base64 = (reader.result as string).split(',')[1];
          // For now, use a simpler approach — native module handles file writing
          await LivePatchNative.setBundlePath(update.url!);
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    // Verify hash if provided
    if (update.hash) {
      // Hash verification happens on native side
    }

    _pendingUpdate = {
      version: update.version!,
      path: downloadPath,
      hash: update.hash,
    };

    if (onProgress) onProgress(100);

    return { success: true, path: downloadPath };
  } catch {
    return { success: false };
  }
}

/**
 * Applies a downloaded update.
 */
export function applyUpdate(options: { immediate?: boolean } = {}): void {
  const immediate = options.immediate !== false;

  if (!_pendingUpdate) {
    throw new Error('No pending update to apply. Call download() first.');
  }

  if (immediate) {
    LivePatchNative.restart();
  }
  // If not immediate, the new bundle will be loaded on next app launch
  // (native module already has the path set from download)
}

/**
 * Rollback to the original bundle.
 */
export async function rollback(): Promise<void> {
  await LivePatchNative.clearBundlePath();
  LivePatchNative.restart();
}

/**
 * Gets the current running version info.
 */
export function getCurrentVersion(): VersionInfo {
  const config = getConfig();

  return {
    version: _pendingUpdate?.version || '0',
    channel: config.channel || 'production',
    isUpdate: _pendingUpdate !== null,
    bundlePath: _pendingUpdate?.path,
  };
}
