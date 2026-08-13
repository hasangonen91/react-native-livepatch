import { NativeModules, Platform } from 'react-native';
const LINKING_ERROR = `The package 'react-native-livepatch' doesn't seem to be linked. Make sure: \n\n` +
    Platform.select({ ios: "- You ran 'pod install'\n", default: '' }) +
    '- You rebuilt the app after installing the package\n' +
    '- You are not using Expo Go (LivePatch requires a custom dev client)\n';
/**
 * Native module bridge.
 * Handles bundle file management and app restart at the native level.
 */
export const LivePatchNative = NativeModules.LivePatchModule
    ? NativeModules.LivePatchModule
    : new Proxy({}, {
        get() {
            throw new Error(LINKING_ERROR);
        },
    });
