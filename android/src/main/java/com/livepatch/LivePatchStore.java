package com.livepatch;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Log;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Persistent OTA state + file management. Shared by the TurboModule and by
 * {@link LivePatchBundle} (which runs before React starts).
 *
 * State machine (one JSON object in SharedPreferences, written with commit()):
 *   pending  -> downloaded and verified, will be launched on next start
 *   trial    -> launched once, waiting for notifyAppReady() from JS
 *   current  -> confirmed good bundle
 *   failed   -> ids that crashed before notifyAppReady(); never installed again
 *
 * If the app starts while a bundle is still in "trial", the previous launch died
 * before JS confirmed it, so the bundle is rolled back automatically.
 */
final class LivePatchStore {
  private static final String TAG = "LivePatch";
  private static final String PREFS = "livepatch";
  private static final String KEY_STATE = "state";
  private static final int MAX_FAILED = 20;
  private static final Pattern ID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");

  private static LivePatchStore instance;

  static synchronized LivePatchStore get(Context context) {
    if (instance == null) instance = new LivePatchStore(context.getApplicationContext());
    return instance;
  }

  private final Context context;
  private final SharedPreferences prefs;
  private final File baseDir;
  private JSONObject state;

  private boolean resolved = false;
  @Nullable private String runningId = null;
  @Nullable private String runningPath = null;

  private LivePatchStore(Context context) {
    this.context = context;
    this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    this.baseDir = new File(context.getFilesDir(), "livepatch");
    this.state = load();
  }

  // ---------------------------------------------------------------- launch

  /** Decides which bundle this process runs. Idempotent per process. */
  synchronized @Nullable String resolveLaunch() {
    if (resolved) return runningPath;
    resolved = true;
    try {
      String binary = binaryVersion();
      if (!binary.equals(state.optString("binary", null))) {
        // Fresh install or store update: OTA bundles were built for another binary.
        String deviceId = state.optString("deviceId", null);
        state = new JSONObject();
        state.put("binary", binary);
        if (deviceId != null) state.put("deviceId", deviceId);
        save();
        deleteRecursive(releasesDir());
        deleteRecursive(stagingDir());
        return null;
      }

      JSONObject trial = state.optJSONObject("trial");
      if (trial != null) {
        String failedId = trial.optString("id");
        Log.w(TAG, "Bundle " + failedId + " was not confirmed, rolling back");
        addFailed(failedId);
        state.put("lastRollback", failedId);
        state.remove("trial");
      }

      JSONObject launch = null;
      JSONObject pending = state.optJSONObject("pending");
      if (pending != null) {
        state.remove("pending");
        if (bundleFile(pending).exists()) {
          state.put("trial", pending);
          launch = pending;
        }
      }
      if (launch == null) {
        JSONObject current = state.optJSONObject("current");
        if (current != null) {
          if (bundleFile(current).exists()) launch = current;
          else state.remove("current");
        }
      }
      save();
      collectGarbage();

      if (launch != null) {
        runningId = launch.getString("id");
        runningPath = bundleFile(launch).getAbsolutePath();
      }
    } catch (Exception e) {
      Log.e(TAG, "resolveLaunch failed, using embedded bundle", e);
      runningId = null;
      runningPath = null;
    }
    return runningPath;
  }

  /** Confirms the running trial bundle. Returns {installed, rolledBack} as JSON. */
  synchronized String notifyAppReady() throws JSONException {
    JSONObject result = new JSONObject();
    JSONObject trial = state.optJSONObject("trial");
    if (trial != null && runningId != null && runningId.equals(trial.optString("id"))) {
      state.put("current", trial);
      state.remove("trial");
      result.put("installed", runningId);
    }
    if (state.has("lastRollback")) {
      result.put("rolledBack", state.optString("lastRollback"));
      state.remove("lastRollback");
    }
    save();
    return result.toString();
  }

  synchronized String snapshot() throws JSONException {
    JSONObject s = new JSONObject();
    s.put("appVersion", appVersion());
    s.put("buildNumber", buildNumber());
    s.put("deviceId", deviceId());
    s.put("runningId", runningId == null ? JSONObject.NULL : runningId);
    s.put("resolved", resolved);
    s.put("currentId", idOf("current"));
    s.put("pendingId", idOf("pending"));
    s.put("trialId", idOf("trial"));
    JSONArray failed = state.optJSONArray("failed");
    s.put("failed", failed == null ? new JSONArray() : failed);
    return s.toString();
  }

  /** Forget all OTA bundles; the embedded bundle runs on next start. */
  synchronized void resetToEmbedded() {
    state.remove("current");
    state.remove("pending");
    state.remove("trial");
    save();
  }

  // ------------------------------------------------------------- downloads

  void prepareDownload(String id) throws IOException {
    checkId(id);
    File dir = new File(stagingDir(), id);
    deleteRecursive(dir);
    if (!dir.mkdirs()) throw new IOException("Cannot create " + dir);
  }

  /** Returns "reused" or "downloaded". Throws on HTTP error or hash mismatch. */
  String downloadFile(String id, String relativePath, String url, String sha256) throws Exception {
    checkId(id);
    File stagingRoot = new File(stagingDir(), id);
    File dest = safeChild(stagingRoot, relativePath);
    File parent = dest.getParentFile();
    // Files are downloaded in parallel: another worker may create the same
    // directory between the checks, so only fail if it still isn't there.
    if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
      throw new IOException("Cannot create " + parent);
    }
    String expected = sha256.toLowerCase();

    String reuseId = reuseCandidateId();
    if (reuseId != null) {
      File candidate = safeChild(new File(releasesDir(), reuseId), relativePath);
      if (candidate.isFile() && expected.equals(sha256Of(candidate))) {
        copy(candidate, dest);
        return "reused";
      }
    }

    File tmp = new File(dest.getPath() + ".part");
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    conn.setConnectTimeout(15000);
    conn.setReadTimeout(60000);
    conn.setInstanceFollowRedirects(true);
    try {
      int code = conn.getResponseCode();
      if (code < 200 || code >= 300) throw new IOException("HTTP " + code + " for " + url);
      try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
          digest.update(buf, 0, n);
          out.write(buf, 0, n);
        }
      }
    } finally {
      conn.disconnect();
    }
    String actual = hex(digest.digest());
    if (!expected.equals(actual)) {
      tmp.delete();
      throw new SecurityException("Hash mismatch for " + relativePath);
    }
    if (dest.exists()) dest.delete();
    if (!tmp.renameTo(dest)) throw new IOException("Cannot move " + tmp + " to " + dest);
    return "downloaded";
  }

  synchronized void commitDownload(String id, String bundlePath) throws Exception {
    checkId(id);
    File staged = new File(stagingDir(), id);
    if (!safeChild(staged, bundlePath).isFile()) {
      throw new IOException("Bundle file " + bundlePath + " missing from download");
    }
    File target = new File(releasesDir(), id);
    if (id.equals(runningId)) throw new IOException("Release " + id + " is already running");
    deleteRecursive(target);
    releasesDir().mkdirs();
    if (!staged.renameTo(target)) throw new IOException("Cannot move release into place");
    JSONObject pending = new JSONObject();
    pending.put("id", id);
    pending.put("bundlePath", bundlePath);
    state.put("pending", pending);
    save();
  }

  void discardDownload(String id) {
    if (!ID_PATTERN.matcher(id).matches()) return;
    deleteRecursive(new File(stagingDir(), id));
  }

  // --------------------------------------------------------------- helpers

  private @Nullable String reuseCandidateId() {
    synchronized (this) {
      if (runningId != null) return runningId;
      Object cur = idOf("current");
      return cur instanceof String ? (String) cur : null;
    }
  }

  private Object idOf(String key) {
    JSONObject o = state.optJSONObject(key);
    return o == null ? JSONObject.NULL : o.optString("id");
  }

  synchronized String deviceId() {
    String id = state.optString("deviceId", null);
    if (id == null) {
      id = UUID.randomUUID().toString();
      try { state.put("deviceId", id); } catch (JSONException ignored) {}
      save();
    }
    return id;
  }

  private void addFailed(String id) throws JSONException {
    JSONArray failed = state.optJSONArray("failed");
    if (failed == null) failed = new JSONArray();
    failed.put(id);
    while (failed.length() > MAX_FAILED) failed.remove(0);
    state.put("failed", failed);
  }

  private void collectGarbage() {
    Set<String> keep = new HashSet<>();
    for (String key : new String[] {"current", "pending", "trial"}) {
      JSONObject o = state.optJSONObject(key);
      if (o != null) keep.add(o.optString("id"));
    }
    File[] dirs = releasesDir().listFiles();
    if (dirs != null) {
      for (File d : dirs) if (!keep.contains(d.getName())) deleteRecursive(d);
    }
    deleteRecursive(stagingDir());
  }

  private File releasesDir() { return new File(baseDir, "releases"); }
  private File stagingDir() { return new File(baseDir, "staging"); }

  private File bundleFile(JSONObject entry) throws IOException {
    String id = entry.optString("id");
    checkId(id);
    return safeChild(new File(releasesDir(), id), entry.optString("bundlePath"));
  }

  private static void checkId(String id) throws IOException {
    if (id == null || !ID_PATTERN.matcher(id).matches()) throw new IOException("Invalid release id");
  }

  private static File safeChild(File root, String relativePath) throws IOException {
    if (relativePath == null || relativePath.isEmpty() || relativePath.startsWith("/")
        || relativePath.contains("..") || relativePath.contains("\\")) {
      throw new IOException("Invalid path: " + relativePath);
    }
    return new File(root, relativePath);
  }

  private JSONObject load() {
    String raw = prefs.getString(KEY_STATE, null);
    if (raw != null) {
      try { return new JSONObject(raw); } catch (JSONException e) { Log.w(TAG, "Corrupt state, resetting", e); }
    }
    return new JSONObject();
  }

  private void save() {
    // commit(), not apply(): the process may be killed right after (restart).
    prefs.edit().putString(KEY_STATE, state.toString()).commit();
  }

  String appVersion() {
    try {
      PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
      return info.versionName == null ? "0" : info.versionName;
    } catch (Exception e) {
      return "0";
    }
  }

  String buildNumber() {
    try {
      PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
      long code = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
      return String.valueOf(code);
    } catch (Exception e) {
      return "0";
    }
  }

  private String binaryVersion() {
    return appVersion() + "(" + buildNumber() + ")";
  }

  static String sha256Of(File f) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream in = new FileInputStream(f)) {
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = in.read(buf)) != -1) digest.update(buf, 0, n);
    }
    return hex(digest.digest());
  }

  private static String hex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) sb.append(String.format("%02x", b));
    return sb.toString();
  }

  private static void copy(File from, File to) throws IOException {
    try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
    }
  }

  static void deleteRecursive(File f) {
    if (f == null || !f.exists()) return;
    File[] children = f.listFiles();
    if (children != null) for (File c : children) deleteRecursive(c);
    f.delete();
  }
}
