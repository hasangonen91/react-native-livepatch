export type Platform = 'ios' | 'android';

/**
 * When a downloaded update starts running.
 * - immediate:     reload the app right away
 * - onNextResume:  reload next time the app comes back from background
 * - onNextRestart: next cold start
 */
export type InstallMode = 'immediate' | 'onNextResume' | 'onNextRestart';

export interface ReleaseFile {
  /** Path inside the release, e.g. "main.jsbundle" or "assets/src/img/logo.png" */
  path: string;
  sha256: string;
  size?: number;
  /** Absolute download URL */
  url: string;
}

export interface Release {
  id: string;
  /** Path of the JS bundle inside the release (one of files[].path) */
  bundlePath: string;
  files: ReleaseFile[];
  mandatory: boolean;
  message?: string | null;
  size?: number;
  createdAt?: string;
}

export type CheckResult =
  | { status: 'up_to_date' }
  | { status: 'update'; release: Release }
  /** The running OTA bundle is no longer allowed; go back to the embedded bundle */
  | { status: 'rollback' };

export interface CheckParams {
  platform: Platform;
  /** Native app version (CFBundleShortVersionString / versionName), e.g. "3.1.1" */
  appVersion: string;
  channel: string;
  /** Running OTA release id, or null when the embedded bundle runs */
  bundleId: string | null;
  deviceId: string;
}

export type ReportEventType = 'installed' | 'rolled_back' | 'download_failed';

export interface ReportEvent {
  type: ReportEventType;
  releaseId: string;
  platform: Platform;
  appVersion: string;
  channel: string;
  deviceId: string;
  message?: string;
}

/** Where updates come from. See supabaseProvider() and httpProvider(). */
export interface LivePatchProvider {
  check(params: CheckParams): Promise<CheckResult>;
  report?(event: ReportEvent): Promise<void>;
}

export interface NativeState {
  appVersion: string;
  buildNumber: string;
  deviceId: string;
  /** OTA release running now (null = embedded bundle) */
  runningId: string | null;
  /** false when the app's bundleURL hook never asked LivePatch (debug/Metro builds) */
  resolved: boolean;
  currentId: string | null;
  pendingId: string | null;
  trialId: string | null;
  failed: string[];
}

export interface LivePatchConfig {
  provider: LivePatchProvider;
  /** default "production" */
  channel?: string;
  /** default "onNextRestart" */
  installMode?: InstallMode;
  /** For releases marked mandatory. default "immediate" */
  mandatoryInstallMode?: InstallMode;
  /** For server-side rollbacks (release disabled). default "onNextResume" */
  rollbackInstallMode?: InstallMode;
  /** onNextResume: minimum time in background before reloading. default 0 */
  minimumBackgroundDurationMs?: number;
  /** Check when init() is called. default true */
  checkOnStart?: boolean;
  /** Check again when the app returns to foreground. default true */
  checkOnResume?: boolean;
  /** Minimum time between automatic checks. default 15 minutes */
  checkIntervalMs?: number;
  /**
   * Confirm the running bundle inside init(). Call init() after the first
   * screen renders (e.g. in App's useEffect). If the app dies before a new
   * bundle is confirmed, it is rolled back on the next launch. default true
   */
  autoNotifyAppReady?: boolean;
  /** Parallel file downloads. default 4 */
  concurrency?: number;
  /** Also run in Metro/debug builds (normally pointless). default false */
  enabledInDev?: boolean;
  onEvent?: (event: LivePatchEvent) => void;
}

export type SyncResult =
  | { status: 'disabled'; reason: string }
  | { status: 'up_to_date' }
  | { status: 'update_installed'; releaseId: string; installMode: InstallMode; mandatory: boolean }
  | { status: 'rolled_back'; installMode: InstallMode }
  | { status: 'error'; error: Error };

export type LivePatchPhase = 'idle' | 'checking' | 'downloading' | 'ready_to_restart' | 'error';

export interface LivePatchSnapshot {
  phase: LivePatchPhase;
  /** 0..1 while downloading */
  progress: number;
  /** Release waiting to be applied, if any */
  pendingReleaseId: string | null;
  pendingMessage: string | null;
  mandatory: boolean;
  error: string | null;
}

export type LivePatchEvent =
  | { type: 'check'; result: CheckResult }
  | { type: 'download_progress'; releaseId: string; progress: number }
  | { type: 'update_ready'; releaseId: string; installMode: InstallMode }
  | { type: 'installed'; releaseId: string }
  | { type: 'rolled_back'; releaseId: string }
  | { type: 'error'; error: Error };
