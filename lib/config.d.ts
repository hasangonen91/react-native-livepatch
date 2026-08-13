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
export declare function configure(options: LivePatchConfig): void;
export declare function getConfig(): LivePatchConfig;
export declare function resetConfig(): void;
