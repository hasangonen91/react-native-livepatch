package com.livepatch;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Process;

/**
 * Runs in a separate process (see AndroidManifest). Kills the main app process
 * and starts it again, so MainApplication creates a fresh ReactHost that loads
 * the newly installed bundle. Same approach as ProcessPhoenix.
 */
public final class LivePatchRestartActivity extends Activity {
  private static final String KEY_PID = "livepatch_main_pid";

  static void restart(Context context) {
    Intent intent = new Intent(context, LivePatchRestartActivity.class);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    intent.putExtra(KEY_PID, Process.myPid());
    context.startActivity(intent);
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    int pid = getIntent().getIntExtra(KEY_PID, -1);
    if (pid > 0) Process.killProcess(pid);
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launch != null) {
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
      startActivity(launch);
    }
    finish();
    Runtime.getRuntime().exit(0);
  }
}
