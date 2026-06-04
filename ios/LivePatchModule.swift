import Foundation
import React

@objc(LivePatchModule)
class LivePatchModule: NSObject {
    private static let prefsKey = "livepatch_active_bundle"
    private static let pendingKey = "livepatch_pending_bundle"

    @objc static func requiresMainQueueSetup() -> Bool { return false }

    @objc func getActiveBundlePath(_ resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        let path = UserDefaults.standard.string(forKey: LivePatchModule.prefsKey)
        if let path = path, FileManager.default.fileExists(atPath: path) {
            resolve(path)
        } else {
            resolve(nil)
        }
    }

    @objc func setBundlePath(_ path: String,
                              resolver resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        UserDefaults.standard.set(path, forKey: LivePatchModule.pendingKey)
        resolve(nil)
    }

    @objc func clearBundlePath(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
        UserDefaults.standard.removeObject(forKey: LivePatchModule.prefsKey)
        UserDefaults.standard.removeObject(forKey: LivePatchModule.pendingKey)

        // Delete bundle files
        if let dir = bundleDirectory() {
            try? FileManager.default.removeItem(at: dir)
        }
        resolve(nil)
    }

    @objc func restart() {
        // Promote pending to active
        if let pending = UserDefaults.standard.string(forKey: LivePatchModule.pendingKey) {
            UserDefaults.standard.set(pending, forKey: LivePatchModule.prefsKey)
            UserDefaults.standard.removeObject(forKey: LivePatchModule.pendingKey)
        }

        DispatchQueue.main.async {
            // Trigger reload via RCTBridge
            if let bridge = RCTBridge.current() {
                bridge.reload()
            }
        }
    }

    @objc func getAppVersion(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        resolve(version)
    }

    @objc func getBundleDirectory(_ resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        if let dir = bundleDirectory() {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            resolve(dir.path)
        } else {
            reject("ERROR", "Cannot access bundle directory", nil)
        }
    }

    private func bundleDirectory() -> URL? {
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
            .first?.appendingPathComponent("livepatch_bundles")
    }

    /// Static method for AppDelegate to get custom bundle URL.
    /// Usage: LivePatchModule.bundleURL() ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    @objc static func bundleURL() -> URL? {
        guard let path = UserDefaults.standard.string(forKey: prefsKey),
              FileManager.default.fileExists(atPath: path) else {
            return nil
        }
        return URL(fileURLWithPath: path)
    }
}
