#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

extern NSErrorDomain const LivePatchErrorDomain;

/// Persistent OTA state and file management (see android/.../LivePatchStore.java
/// for the state machine; both platforms behave the same).
@interface LivePatchStore : NSObject

+ (instancetype)shared;

/// Bundle to run for this boot, or nil for the embedded bundle. Idempotent per boot.
- (nullable NSURL *)resolveLaunch;
/// Next resolveLaunch() call decides again (used before an in-process reload).
- (void)prepareForReload;

- (NSString *)notifyAppReady;
- (NSString *)snapshot;
- (void)resetToEmbedded;

- (BOOL)prepareDownload:(NSString *)releaseId error:(NSError **)error;
- (void)downloadFile:(NSString *)releaseId
        relativePath:(NSString *)relativePath
                 url:(NSString *)url
              sha256:(NSString *)sha256
          completion:(void (^)(NSString *_Nullable result, NSError *_Nullable error))completion;
- (BOOL)commitDownload:(NSString *)releaseId bundlePath:(NSString *)bundlePath error:(NSError **)error;
- (void)discardDownload:(NSString *)releaseId;

@end

NS_ASSUME_NONNULL_END
