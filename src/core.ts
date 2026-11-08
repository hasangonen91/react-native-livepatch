import type { Spec } from './NativeLivePatch';
import type {
  CheckResult,
  InstallMode,
  LivePatchConfig,
  LivePatchEvent,
  LivePatchSnapshot,
  NativeState,
  Platform,
  Release,
  ReportEventType,
  SyncResult,
} from './types';

type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension' | string;

export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

export interface CoreDeps {
  native: Spec | null | undefined;
  platform: Platform;
  isDev: boolean;
  appState?: AppStateLike;
  now?: () => number;
}

type Resolved = Required<Omit<LivePatchConfig, 'onEvent'>> & Pick<LivePatchConfig, 'onEvent'>;

const DEFAULTS = {
  channel: 'production',
  installMode: 'onNextRestart' as InstallMode,
  mandatoryInstallMode: 'immediate' as InstallMode,
  rollbackInstallMode: 'onNextResume' as InstallMode,
  minimumBackgroundDurationMs: 0,
  checkOnStart: true,
  checkOnResume: true,
  checkIntervalMs: 15 * 60 * 1000,
  autoNotifyAppReady: true,
  concurrency: 4,
  enabledInDev: false,
};

const INITIAL_SNAPSHOT: LivePatchSnapshot = {
  phase: 'idle',
  progress: 0,
  pendingReleaseId: null,
  pendingMessage: null,
  mandatory: false,
  error: null,
};

export class LivePatchCore {
  private config: Resolved | null = null;
  private syncing: Promise<SyncResult> | null = null;
  private lastCheckAt = 0;
  private backgroundAt: number | null = null;
  private restartOnResume = false;
  private appStateSub: { remove(): void } | null = null;
  private snapshot: LivePatchSnapshot = INITIAL_SNAPSHOT;
  private listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(private readonly deps: CoreDeps) {
    this.now = deps.now ?? Date.now;
  }

  // ------------------------------------------------------------ lifecycle

  /** Configure and start. Safe to call more than once (later calls replace the config). */
  init(config: LivePatchConfig): void {
    if (!config || !config.provider) {
      throw new Error('LivePatch.init: `provider` is required, e.g. supabaseProvider({ url, anonKey })');
    }
    this.config = { ...DEFAULTS, ...config } as Resolved;

    if (!this.appStateSub && this.deps.appState) {
      this.appStateSub = this.deps.appState.addEventListener('change', (s) => this.onAppStateChange(s));
    }
    if (!this.deps.native) {
      if (!this.deps.isDev) {
        console.warn('[LivePatch] Native module not found. Rebuild the app after installing react-native-livepatch.');
      }
      return;
    }
    const start = async () => {
      if (this.config!.autoNotifyAppReady) await this.notifyAppReady();
      if (this.config!.checkOnStart) await this.sync();
    };
    start().catch((e) => this.emit({ type: 'error', error: toError(e) }));
  }

  destroy(): void {
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.config = null;
  }

  // ----------------------------------------------------------------- API

  async getState(): Promise<NativeState | null> {
    if (!this.deps.native) return null;
    return JSON.parse(await this.deps.native.getState()) as NativeState;
  }

  /**
   * Confirms that the running bundle works. Until this is called, a freshly
   * installed bundle is rolled back automatically if the app dies.
   */
  async notifyAppReady(): Promise<{ installed?: string; rolledBack?: string }> {
    const native = this.deps.native;
    if (!native) return {};
    const result = JSON.parse(await native.notifyAppReady()) as { installed?: string; rolledBack?: string };
    if (result.installed) {
      this.emit({ type: 'installed', releaseId: result.installed });
      void this.report('installed', result.installed);
    }
    if (result.rolledBack) {
      this.emit({ type: 'rolled_back', releaseId: result.rolledBack });
      void this.report('rolled_back', result.rolledBack, 'crashed before notifyAppReady');
    }
    return result;
  }

  async checkForUpdate(): Promise<CheckResult> {
    const cfg = this.requireConfig();
    const state = await this.getState();
    if (!state) return { status: 'up_to_date' };
    return cfg.provider.check({
      platform: this.deps.platform,
      appVersion: state.appVersion,
      channel: cfg.channel,
      bundleId: state.runningId,
      deviceId: state.deviceId,
    });
  }

  /** Check → download → install according to installMode. Concurrent calls share one run. */
  sync(options: { installMode?: InstallMode } = {}): Promise<SyncResult> {
    if (!this.syncing) {
      this.syncing = this.runSync(options).finally(() => {
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  /** Reload now (applies a downloaded update). */
  restart(): void {
    this.deps.native?.restart();
  }

  /** Drop all OTA bundles; the store build's bundle runs after the next restart. */
  async resetToEmbedded(): Promise<void> {
    await this.deps.native?.resetToEmbedded();
    this.setSnapshot({ ...INITIAL_SNAPSHOT });
  }

  getSnapshot = (): LivePatchSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ------------------------------------------------------------ internals

  private async runSync(options: { installMode?: InstallMode }): Promise<SyncResult> {
    const cfg = this.config;
    const native = this.deps.native;
    if (!cfg) return { status: 'disabled', reason: 'LivePatch.init() was not called' };
    if (!native) return { status: 'disabled', reason: 'native module missing' };

    this.lastCheckAt = this.now();
    try {
      const state = await this.getState();
      if (!state) return { status: 'disabled', reason: 'native module missing' };
      if (!state.resolved && !cfg.enabledInDev) {
        // Bundle comes from Metro (or the bundleURL hook is not installed).
        return { status: 'disabled', reason: this.deps.isDev ? 'dev build' : 'bundleURL hook not installed' };
      }

      this.setSnapshot({ ...this.snapshot, phase: 'checking', error: null });
      const result = await cfg.provider.check({
        platform: this.deps.platform,
        appVersion: state.appVersion,
        channel: cfg.channel,
        bundleId: state.runningId,
        deviceId: state.deviceId,
      });
      this.emit({ type: 'check', result });

      if (result.status === 'rollback') {
        if (!state.runningId && !state.pendingId) return this.idle({ status: 'up_to_date' });
        await native.resetToEmbedded();
        const mode = options.installMode ?? cfg.rollbackInstallMode;
        this.setSnapshot({ ...INITIAL_SNAPSHOT });
        if (state.runningId) this.install(mode);
        return { status: 'rolled_back', installMode: mode };
      }

      if (result.status !== 'update') return this.idle({ status: 'up_to_date' });

      const release = result.release;
      if (release.id === state.runningId || state.failed.includes(release.id)) {
        return this.idle({ status: 'up_to_date' });
      }

      const mode = options.installMode ?? (release.mandatory ? cfg.mandatoryInstallMode : cfg.installMode);
      if (release.id !== state.pendingId) {
        await this.download(release, cfg.concurrency);
      }
      this.setSnapshot({
        phase: 'ready_to_restart',
        progress: 1,
        pendingReleaseId: release.id,
        pendingMessage: release.message ?? null,
        mandatory: release.mandatory,
        error: null,
      });
      this.emit({ type: 'update_ready', releaseId: release.id, installMode: mode });
      this.install(mode);
      return { status: 'update_installed', releaseId: release.id, installMode: mode, mandatory: release.mandatory };
    } catch (e) {
      const error = toError(e);
      this.setSnapshot({ ...this.snapshot, phase: 'error', error: error.message });
      this.emit({ type: 'error', error });
      return { status: 'error', error };
    }
  }

  private async download(release: Release, concurrency: number): Promise<void> {
    const native = this.deps.native!;
    if (!release.files.some((f) => f.path === release.bundlePath)) {
      throw new Error(`Release ${release.id} does not contain its bundle ${release.bundlePath}`);
    }
    const total = release.files.reduce((sum, f) => sum + (f.size ?? 1), 0) || 1;
    let done = 0;
    this.setSnapshot({ ...this.snapshot, phase: 'downloading', progress: 0 });

    try {
      await native.prepareDownload(release.id);
      const queue = [...release.files];
      const worker = async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          await native.downloadFile(release.id, file.path, file.url, file.sha256);
          done += file.size ?? 1;
          const progress = Math.min(1, done / total);
          this.setSnapshot({ ...this.snapshot, progress });
          this.emit({ type: 'download_progress', releaseId: release.id, progress });
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
      await native.commitDownload(release.id, release.bundlePath);
    } catch (e) {
      await native.discardDownload(release.id).catch(() => {});
      void this.report('download_failed', release.id, toError(e).message);
      throw e;
    }
  }

  private install(mode: InstallMode): void {
    if (mode === 'immediate') {
      this.deps.native?.restart();
    } else if (mode === 'onNextResume') {
      this.restartOnResume = true;
    }
  }

  private onAppStateChange(status: AppStateStatus): void {
    if (status === 'background') {
      this.backgroundAt = this.now();
      return;
    }
    if (status !== 'active' || this.backgroundAt === null || !this.config) return;
    const away = this.now() - this.backgroundAt;
    this.backgroundAt = null;

    if (this.restartOnResume && away >= this.config.minimumBackgroundDurationMs) {
      this.restartOnResume = false;
      this.deps.native?.restart();
      return;
    }
    if (this.config.checkOnResume && this.now() - this.lastCheckAt >= this.config.checkIntervalMs) {
      void this.sync();
    }
  }

  private idle(result: SyncResult): SyncResult {
    if (this.snapshot.phase !== 'ready_to_restart') {
      this.setSnapshot({ ...this.snapshot, phase: 'idle', progress: 0 });
    }
    return result;
  }

  private async report(type: ReportEventType, releaseId: string, message?: string): Promise<void> {
    const cfg = this.config;
    if (!cfg?.provider.report) return;
    try {
      const state = await this.getState();
      if (!state) return;
      await cfg.provider.report({
        type,
        releaseId,
        platform: this.deps.platform,
        appVersion: state.appVersion,
        channel: cfg.channel,
        deviceId: state.deviceId,
        message,
      });
    } catch {
      // Reporting is best effort.
    }
  }

  private requireConfig(): Resolved {
    if (!this.config) throw new Error('LivePatch.init() was not called');
    return this.config;
  }

  private setSnapshot(next: LivePatchSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }

  private emit(event: LivePatchEvent): void {
    try {
      this.config?.onEvent?.(event);
    } catch {
      // never let a listener break updates
    }
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
