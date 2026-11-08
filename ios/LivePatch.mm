#import <LivePatchSpec/LivePatchSpec.h>
#import <React/RCTReloadCommand.h>
#import "LivePatchStore.h"

@interface LivePatch : NSObject <NativeLivePatchSpec>
@end

@implementation LivePatch

RCT_EXPORT_MODULE(LivePatch)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)getState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([[LivePatchStore shared] snapshot]);
}

- (void)prepareDownload:(NSString *)releaseId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSError *error = nil;
  if ([[LivePatchStore shared] prepareDownload:releaseId error:&error]) {
    resolve(nil);
  } else {
    reject(@"LIVEPATCH_PREPARE", error.localizedDescription, error);
  }
}

- (void)downloadFile:(NSString *)releaseId
        relativePath:(NSString *)relativePath
                 url:(NSString *)url
              sha256:(NSString *)sha256
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [[LivePatchStore shared] downloadFile:releaseId
                           relativePath:relativePath
                                    url:url
                                 sha256:sha256
                             completion:^(NSString *result, NSError *error) {
                               if (error) {
                                 NSString *code = error.code == 3 ? @"LIVEPATCH_HASH_MISMATCH" : @"LIVEPATCH_DOWNLOAD";
                                 reject(code, error.localizedDescription, error);
                               } else {
                                 resolve(result);
                               }
                             }];
}

- (void)commitDownload:(NSString *)releaseId
            bundlePath:(NSString *)bundlePath
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  NSError *error = nil;
  if ([[LivePatchStore shared] commitDownload:releaseId bundlePath:bundlePath error:&error]) {
    resolve(nil);
  } else {
    reject(@"LIVEPATCH_COMMIT", error.localizedDescription, error);
  }
}

- (void)discardDownload:(NSString *)releaseId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [[LivePatchStore shared] discardDownload:releaseId];
  resolve(nil);
}

- (void)notifyAppReady:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([[LivePatchStore shared] notifyAppReady]);
}

- (void)resetToEmbedded:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [[LivePatchStore shared] resetToEmbedded];
  resolve(nil);
}

- (void)restart
{
  [[LivePatchStore shared] prepareForReload];
  dispatch_async(dispatch_get_main_queue(), ^{
    // RCTHost (new architecture) listens for reload commands and asks the app
    // delegate for bundleURL() again, which now returns the pending bundle.
    RCTTriggerReloadCommandListeners(@"LivePatch update");
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeLivePatchSpecJSI>(params);
}

@end
