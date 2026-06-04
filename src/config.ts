export interface LivePatchConfig {
  /** URL of the update server (required) */
  updateUrl: string;
  /** Update channel: 'production', 'staging', 'dev' (default: 'production') */
  channel?: string;
  /** Auto-check for updates on configure (default: true) */
  checkOnStart?: boolean;
  /** Auto-apply updates without user confirmation (default: false) */
  autoApply?: boolean;
  /** Public key for bundle signature verification */
  publicKey?: string;
  /** Minimum app version for this update to apply */
  minAppVersion?: string;
}

let _config: LivePatchConfig = {
  updateUrl: '',
  channel: 'production',
  checkOnStart: true,
  autoApply: false,
  publicKey: undefined,
  minAppVersion: undefined,
};

export function configure(options: LivePatchConfig): void {
  if (!options.updateUrl) {
    throw new Error(
      'LivePatch: updateUrl is required.\n' +
      'Example: LivePatch.configure({ updateUrl: "https://your-server.com/updates" })'
    );
  }
  _config = { ..._config, ...options };
}

export function getConfig(): LivePatchConfig {
  return { ..._config };
}

export function resetConfig(): void {
  _config = {
    updateUrl: '',
    channel: 'production',
    checkOnStart: true,
    autoApply: false,
  };
}
