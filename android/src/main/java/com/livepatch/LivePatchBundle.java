package com.livepatch;

import android.content.Context;

import androidx.annotation.Nullable;

/**
 * Entry point for MainApplication. Returns the OTA bundle path to load, or null
 * to use the bundle embedded in the APK.
 *
 * <pre>
 * override val reactHost: ReactHost by lazy {
 *   getDefaultReactHost(
 *     context = applicationContext,
 *     packageList = PackageList(this).packages,
 *     jsBundleFilePath = if (BuildConfig.DEBUG) null else LivePatchBundle.getJSBundleFile(applicationContext),
 *   )
 * }
 * </pre>
 */
public final class LivePatchBundle {
  private LivePatchBundle() {}

  public static @Nullable String getJSBundleFile(Context context) {
    return LivePatchStore.get(context).resolveLaunch();
  }
}
