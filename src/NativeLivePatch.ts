import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * TurboModule spec (React Native codegen reads this file).
 * Structured values cross the boundary as JSON strings to keep the spec simple.
 */
export interface Spec extends TurboModule {
  /** JSON: NativeState */
  getState(): Promise<string>;
  prepareDownload(releaseId: string): Promise<void>;
  /** Resolves "reused" or "downloaded"; rejects on HTTP error or sha256 mismatch. */
  downloadFile(releaseId: string, relativePath: string, url: string, sha256: string): Promise<string>;
  /** Moves the staged release into place and marks it pending for next launch. */
  commitDownload(releaseId: string, bundlePath: string): Promise<void>;
  discardDownload(releaseId: string): Promise<void>;
  /** JSON: { installed?: string, rolledBack?: string } */
  notifyAppReady(): Promise<string>;
  resetToEmbedded(): Promise<void>;
  /** Reloads the app so a pending bundle starts running. */
  restart(): void;
}

export default TurboModuleRegistry.get<Spec>('LivePatch');
