package com.livepatch;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.annotations.ReactModule;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@ReactModule(name = LivePatchModule.NAME)
public class LivePatchModule extends NativeLivePatchSpec {
  public static final String NAME = "LivePatch";

  private final ExecutorService executor = Executors.newFixedThreadPool(4);

  public LivePatchModule(ReactApplicationContext context) {
    super(context);
  }

  private LivePatchStore store() {
    return LivePatchStore.get(getReactApplicationContext());
  }

  @Override
  public void getState(Promise promise) {
    try {
      promise.resolve(store().snapshot());
    } catch (Exception e) {
      promise.reject("LIVEPATCH_STATE", e.getMessage(), e);
    }
  }

  @Override
  public void prepareDownload(String releaseId, Promise promise) {
    executor.execute(() -> {
      try {
        store().prepareDownload(releaseId);
        promise.resolve(null);
      } catch (Exception e) {
        promise.reject("LIVEPATCH_PREPARE", e.getMessage(), e);
      }
    });
  }

  @Override
  public void downloadFile(String releaseId, String relativePath, String url, String sha256, Promise promise) {
    executor.execute(() -> {
      try {
        promise.resolve(store().downloadFile(releaseId, relativePath, url, sha256));
      } catch (SecurityException e) {
        promise.reject("LIVEPATCH_HASH_MISMATCH", e.getMessage(), e);
      } catch (Exception e) {
        promise.reject("LIVEPATCH_DOWNLOAD", e.getMessage(), e);
      }
    });
  }

  @Override
  public void commitDownload(String releaseId, String bundlePath, Promise promise) {
    executor.execute(() -> {
      try {
        store().commitDownload(releaseId, bundlePath);
        promise.resolve(null);
      } catch (Exception e) {
        promise.reject("LIVEPATCH_COMMIT", e.getMessage(), e);
      }
    });
  }

  @Override
  public void discardDownload(String releaseId, Promise promise) {
    executor.execute(() -> {
      store().discardDownload(releaseId);
      promise.resolve(null);
    });
  }

  @Override
  public void notifyAppReady(Promise promise) {
    try {
      promise.resolve(store().notifyAppReady());
    } catch (Exception e) {
      promise.reject("LIVEPATCH_READY", e.getMessage(), e);
    }
  }

  @Override
  public void resetToEmbedded(Promise promise) {
    store().resetToEmbedded();
    promise.resolve(null);
  }

  @Override
  public void restart() {
    LivePatchRestartActivity.restart(getReactApplicationContext());
  }

  @Override
  public void invalidate() {
    executor.shutdown();
    super.invalidate();
  }
}
