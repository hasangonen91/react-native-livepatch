/**
 * Expo Config Plugin for react-native-livepatch.
 * Automatically configures Android and iOS native modules for Expo prebuild.
 *
 * Usage in app.json or app.config.js:
 * {
 *   "plugins": ["react-native-livepatch"]
 * }
 */

const { withAppDelegate, withMainApplication, withAndroidManifest } = require('@expo/config-plugins');

function withLivePatchAndroid(config) {
  // Add cleartext traffic permission for development
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const application = manifest.application?.[0];
    if (application) {
      application.$['android:networkSecurityConfig'] = '@xml/livepatch_network_config';
    }
    return config;
  });

  // Modify MainApplication to load LivePatch bundle
  config = withMainApplication(config, (config) => {
    const content = config.modResults.contents;

    // Add import
    if (!content.includes('LivePatchModule')) {
      const importLine = 'import com.livepatch.LivePatchModule';
      const importAnchor = 'import android.app.Application';
      config.modResults.contents = content.replace(
        importAnchor,
        `${importAnchor}\n${importLine}`
      );
    }

    // Add jsBundleFilePath to getDefaultReactHost
    if (!content.includes('LivePatchModule.getCustomBundlePath')) {
      config.modResults.contents = config.modResults.contents.replace(
        'getDefaultReactHost(',
        'getDefaultReactHost(\n      jsBundleFilePath = LivePatchModule.getCustomBundlePath(this@MainApplication),'
      );
    }

    return config;
  });

  return config;
}

function withLivePatchIOS(config) {
  config = withAppDelegate(config, (config) => {
    const content = config.modResults.contents;

    // Add LivePatch bundle URL override for Swift AppDelegate
    if (!content.includes('LivePatchModule')) {
      // For Swift AppDelegate
      if (content.includes('bundleURL()')) {
        config.modResults.contents = content.replace(
          /return Bundle\.main\.url\(forResource: "main", withExtension: "jsbundle"\)/,
          'return LivePatchModule.bundleURL() ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")'
        );
      }
    }

    return config;
  });

  return config;
}

module.exports = function withLivePatch(config) {
  config = withLivePatchAndroid(config);
  config = withLivePatchIOS(config);
  return config;
};
