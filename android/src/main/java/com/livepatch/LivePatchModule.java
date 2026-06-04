package com.livepatch;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.File;

/**
 * Native module for LivePatch OTA updates.
 * Handles bundle file management, storage, and app restart.
 */
public class LivePatchModule extends ReactContextBaseJavaModule {
    private static final String MODULE_NAME = "LivePatchModule";
    private static final String PREFS_NAME = "livepatch_prefs";
    private static final String KEY_BUNDLE_PATH = "active_bundle_path";
    private static final String KEY_PENDING_PATH = "pending_bundle_path";
    private static final String KEY_VERSION = "active_version";

    private final ReactApplicationContext reactContext;

    public LivePatchModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    @NonNull
    public String getName() {
        return MODULE_NAME;
    }

    @ReactMethod
    public void getActiveBundlePath(Promise promise) {
        SharedPreferences prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String path = prefs.getString(KEY_BUNDLE_PATH, null);
        if (path != null && new File(path).exists()) {
            promise.resolve(path);
        } else {
            promise.resolve(null);
        }
    }

    @ReactMethod
    public void setBundlePath(String path, Promise promise) {
        SharedPreferences prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_PENDING_PATH, path)
            .apply();
        promise.resolve(null);
    }

    @ReactMethod
    public void clearBundlePath(Promise promise) {
        SharedPreferences prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .remove(KEY_BUNDLE_PATH)
            .remove(KEY_PENDING_PATH)
            .remove(KEY_VERSION)
            .apply();

        // Delete downloaded bundles
        File bundleDir = getBundleDir();
        if (bundleDir.exists()) {
            for (File file : bundleDir.listFiles()) {
                if (file.getName().startsWith("livepatch_")) {
                    file.delete();
                }
            }
        }
        promise.resolve(null);
    }

    @ReactMethod
    public void restart() {
        // Promote pending to active
        SharedPreferences prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String pending = prefs.getString(KEY_PENDING_PATH, null);
        if (pending != null) {
            prefs.edit()
                .putString(KEY_BUNDLE_PATH, pending)
                .remove(KEY_PENDING_PATH)
                .apply();
        }

        // Restart the activity
        Activity activity = getCurrentActivity();
        if (activity != null) {
            activity.recreate();
        }
    }

    @ReactMethod
    public void getAppVersion(Promise promise) {
        try {
            String version = reactContext.getPackageManager()
                .getPackageInfo(reactContext.getPackageName(), 0)
                .versionName;
            promise.resolve(version);
        } catch (Exception e) {
            promise.resolve("unknown");
        }
    }

    @ReactMethod
    public void getBundleDirectory(Promise promise) {
        File dir = getBundleDir();
        if (!dir.exists()) dir.mkdirs();
        promise.resolve(dir.getAbsolutePath());
    }

    private File getBundleDir() {
        return new File(reactContext.getFilesDir(), "livepatch_bundles");
    }

    /**
     * Called by the app's ReactNativeHost to get the custom bundle path.
     * Usage in MainApplication:
     *   LivePatchModule.getBundleUrl(this)
     */
    public static String getBundleUrl(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String path = prefs.getString(KEY_BUNDLE_PATH, null);
        if (path != null && new File(path).exists()) {
            return path;
        }
        return null; // Use default bundle
    }
}
