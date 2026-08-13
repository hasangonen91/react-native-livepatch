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

  const currentVersion = await getCurrentVersion();
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

    const data = (await response.json()) as any;

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
 * The bundle is fetched, converted to base64 and written to disk by the native module.
 */
export async function downloadUpdate(onProgress?: (percent: number) => void): Promise<{ success: boolean; path?: string }> {
  const update = await checkForUpdate();

  if (!update.available || !update.url) {
    return { success: false };
  }

  try {
    const response = await fetch(update.url);
    if (!response.ok) return { success: false };

    const blob = await response.blob();
    const reader = new FileReader();

    const base64 = await new Promise<string | null>((resolve, reject) => {
      reader.onload = () => resolve((reader.result as string).split(',')[1] ?? null);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    if (!base64) return { success: false };

    // Write bundle to disk via native module (returns the real file path)
    const filePath = await LivePatchNative.writeBundle(base64, update.version!);

    _pendingUpdate = {
      version: update.version!,
      path: filePath,
      hash: update.hash,
    };

    if (onProgress) onProgress(100);

    return { success: true, path: filePath };
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
}

/**
 * Rollback to the original bundle.
 */
export async function rollback(): Promise<void> {
  await LivePatchNative.clearBundlePath();
  _pendingUpdate = null;
  LivePatchNative.restart();
}

/**
 * Gets the current running version info (from native storage).
 */
export async function getCurrentVersion(): Promise<VersionInfo> {
  const config = getConfig();

  // Read active version + bundle path from native storage
  const [activeVersion, activePath] = await Promise.all([
    LivePatchNative.getActiveVersion(),
    LivePatchNative.getActiveBundlePath(),
  ]);

  return {
    version: activeVersion || _pendingUpdate?.version || '0',
    channel: config.channel || 'production',
    isUpdate: !!activePath,
    bundlePath: activePath || _pendingUpdate?.path,
  };
}