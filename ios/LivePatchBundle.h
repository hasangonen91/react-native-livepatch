#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Use from AppDelegate's bundleURL() in release builds:
///
///   import ReactNativeLivePatch
///   ...
///   return LivePatchBundle.bundleURL() ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")
@interface LivePatchBundle : NSObject

/// The OTA bundle to load, or nil to use the bundle embedded in the app.
+ (nullable NSURL *)bundleURL;

@end

NS_ASSUME_NONNULL_END
