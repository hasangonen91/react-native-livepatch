#import "LivePatchStore.h"
#import <CommonCrypto/CommonDigest.h>

static NSString *const kStateKey = @"LivePatchState";
static const NSUInteger kMaxFailed = 20;

NSErrorDomain const LivePatchErrorDomain = @"LivePatch";

@implementation LivePatchStore {
  NSMutableDictionary *_state;
  BOOL _resolved;
  NSString *_runningId;
  NSURL *_runningURL;
  NSURL *_baseDir;
}

+ (instancetype)shared
{
  static LivePatchStore *instance;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ instance = [LivePatchStore new]; });
  return instance;
}

- (instancetype)init
{
  if ((self = [super init])) {
    NSURL *support = [[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory
                                                            inDomains:NSUserDomainMask].firstObject;
    _baseDir = [support URLByAppendingPathComponent:@"LivePatch" isDirectory:YES];
    NSDictionary *saved = [[NSUserDefaults standardUserDefaults] dictionaryForKey:kStateKey];
    _state = saved ? [saved mutableCopy] : [NSMutableDictionary new];
  }
  return self;
}

#pragma mark - Launch

- (nullable NSURL *)resolveLaunch
{
  @synchronized(self) {
    if (_resolved) return _runningURL;
    _resolved = YES;
    _runningId = nil;
    _runningURL = nil;

    NSString *binary = [self binaryVersion];
    if (![binary isEqualToString:_state[@"binary"]]) {
      // Fresh install or store update: drop bundles built for another binary.
      NSString *deviceId = _state[@"deviceId"];
      _state = [NSMutableDictionary dictionaryWithObject:binary forKey:@"binary"];
      if (deviceId) _state[@"deviceId"] = deviceId;
      [self save];
      [[NSFileManager defaultManager] removeItemAtURL:[self releasesDir] error:nil];
      [[NSFileManager defaultManager] removeItemAtURL:[self stagingDir] error:nil];
      return nil;
    }

    NSDictionary *trial = _state[@"trial"];
    if (trial) {
      NSString *failedId = trial[@"id"];
      NSLog(@"[LivePatch] Bundle %@ was not confirmed, rolling back", failedId);
      [self addFailed:failedId];
      _state[@"lastRollback"] = failedId;
      [_state removeObjectForKey:@"trial"];
    }

    NSDictionary *launch = nil;
    NSDictionary *pending = _state[@"pending"];
    if (pending) {
      [_state removeObjectForKey:@"pending"];
      if ([self bundleExists:pending]) {
        _state[@"trial"] = pending;
        launch = pending;
      }
    }
    if (!launch) {
      NSDictionary *current = _state[@"current"];
      if (current) {
        if ([self bundleExists:current]) launch = current;
        else [_state removeObjectForKey:@"current"];
      }
    }
    [self save];
    [self collectGarbage];

    if (launch) {
      _runningId = launch[@"id"];
      _runningURL = [self bundleURLFor:launch];
    }
    return _runningURL;
  }
}

- (void)prepareForReload
{
  @synchronized(self) {
    _resolved = NO;
  }
}

- (NSString *)notifyAppReady
{
  @synchronized(self) {
    NSMutableDictionary *result = [NSMutableDictionary new];
    NSDictionary *trial = _state[@"trial"];
    if (trial && _runningId && [_runningId isEqualToString:trial[@"id"]]) {
      _state[@"current"] = trial;
      [_state removeObjectForKey:@"trial"];
      result[@"installed"] = _runningId;
    }
    if (_state[@"lastRollback"]) {
      result[@"rolledBack"] = _state[@"lastRollback"];
      [_state removeObjectForKey:@"lastRollback"];
    }
    [self save];
    return [self json:result];
  }
}

- (NSString *)snapshot
{
  @synchronized(self) {
    NSDictionary *s = @{
      @"appVersion" : [self appVersion],
      @"buildNumber" : [self buildNumber],
      @"deviceId" : [self deviceIdLocked],
      @"runningId" : _runningId ?: [NSNull null],
      @"resolved" : @(_resolved),
      @"currentId" : _state[@"current"][@"id"] ?: [NSNull null],
      @"pendingId" : _state[@"pending"][@"id"] ?: [NSNull null],
      @"trialId" : _state[@"trial"][@"id"] ?: [NSNull null],
      @"failed" : _state[@"failed"] ?: @[],
    };
    return [self json:s];
  }
}

- (void)resetToEmbedded
{
  @synchronized(self) {
    [_state removeObjectForKey:@"current"];
    [_state removeObjectForKey:@"pending"];
    [_state removeObjectForKey:@"trial"];
    [self save];
  }
}

#pragma mark - Downloads

- (BOOL)prepareDownload:(NSString *)releaseId error:(NSError **)error
{
  if (![self validId:releaseId error:error]) return NO;
  NSURL *dir = [[self stagingDir] URLByAppendingPathComponent:releaseId isDirectory:YES];
  [[NSFileManager defaultManager] removeItemAtURL:dir error:nil];
  return [[NSFileManager defaultManager] createDirectoryAtURL:dir
                                  withIntermediateDirectories:YES
                                                   attributes:nil
                                                        error:error];
}

- (void)downloadFile:(NSString *)releaseId
        relativePath:(NSString *)relativePath
                 url:(NSString *)urlString
              sha256:(NSString *)sha256
          completion:(void (^)(NSString *_Nullable result, NSError *_Nullable error))completion
{
  NSError *error = nil;
  if (![self validId:releaseId error:&error] || ![self validPath:relativePath error:&error]) {
    completion(nil, error);
    return;
  }
  NSFileManager *fm = [NSFileManager defaultManager];
  NSURL *stagingRoot = [[self stagingDir] URLByAppendingPathComponent:releaseId isDirectory:YES];
  NSURL *dest = [stagingRoot URLByAppendingPathComponent:relativePath];
  [fm createDirectoryAtURL:[dest URLByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *expected = sha256.lowercaseString;

  NSString *reuseId;
  @synchronized(self) {
    reuseId = _runningId ?: _state[@"current"][@"id"];
  }
  if (reuseId) {
    NSURL *candidate = [[[self releasesDir] URLByAppendingPathComponent:reuseId isDirectory:YES]
        URLByAppendingPathComponent:relativePath];
    if ([fm fileExistsAtPath:candidate.path] && [expected isEqualToString:[LivePatchStore sha256OfFile:candidate]]) {
      [fm removeItemAtURL:dest error:nil];
      if ([fm copyItemAtURL:candidate toURL:dest error:&error]) {
        completion(@"reused", nil);
      } else {
        completion(nil, error);
      }
      return;
    }
  }

  NSURL *url = [NSURL URLWithString:urlString];
  if (!url) {
    completion(nil, [self errorWithCode:1 message:[NSString stringWithFormat:@"Invalid URL %@", urlString]]);
    return;
  }
  NSURLSessionConfiguration *config = [NSURLSessionConfiguration defaultSessionConfiguration];
  config.timeoutIntervalForRequest = 60;
  config.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
  NSURLSession *session = [NSURLSession sessionWithConfiguration:config];
  NSURLSessionDownloadTask *task = [session
      downloadTaskWithURL:url
        completionHandler:^(NSURL *location, NSURLResponse *response, NSError *taskError) {
          [session finishTasksAndInvalidate];
          if (taskError) {
            completion(nil, taskError);
            return;
          }
          NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]]
              ? ((NSHTTPURLResponse *)response).statusCode
              : 200;
          if (status < 200 || status >= 300) {
            completion(nil, [self errorWithCode:2 message:[NSString stringWithFormat:@"HTTP %ld for %@", (long)status, urlString]]);
            return;
          }
          NSString *actual = [LivePatchStore sha256OfFile:location];
          if (![expected isEqualToString:actual]) {
            completion(nil, [self errorWithCode:3 message:[NSString stringWithFormat:@"Hash mismatch for %@", relativePath]]);
            return;
          }
          NSError *moveError = nil;
          [fm removeItemAtURL:dest error:nil];
          if (![fm moveItemAtURL:location toURL:dest error:&moveError]) {
            completion(nil, moveError);
            return;
          }
          completion(@"downloaded", nil);
        }];
  [task resume];
}

- (BOOL)commitDownload:(NSString *)releaseId bundlePath:(NSString *)bundlePath error:(NSError **)error
{
  if (![self validId:releaseId error:error] || ![self validPath:bundlePath error:error]) return NO;
  NSFileManager *fm = [NSFileManager defaultManager];
  NSURL *staged = [[self stagingDir] URLByAppendingPathComponent:releaseId isDirectory:YES];
  if (![fm fileExistsAtPath:[staged URLByAppendingPathComponent:bundlePath].path]) {
    if (error) *error = [self errorWithCode:4 message:[NSString stringWithFormat:@"Bundle file %@ missing from download", bundlePath]];
    return NO;
  }
  @synchronized(self) {
    if ([releaseId isEqualToString:_runningId]) {
      if (error) *error = [self errorWithCode:5 message:@"Release is already running"];
      return NO;
    }
    NSURL *target = [[self releasesDir] URLByAppendingPathComponent:releaseId isDirectory:YES];
    [fm removeItemAtURL:target error:nil];
    [fm createDirectoryAtURL:[self releasesDir] withIntermediateDirectories:YES attributes:nil error:nil];
    if (![fm moveItemAtURL:staged toURL:target error:error]) return NO;
    [target setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
    _state[@"pending"] = @{@"id" : releaseId, @"bundlePath" : bundlePath};
    [self save];
  }
  return YES;
}

- (void)discardDownload:(NSString *)releaseId
{
  if (![self validId:releaseId error:nil]) return;
  [[NSFileManager defaultManager] removeItemAtURL:[[self stagingDir] URLByAppendingPathComponent:releaseId] error:nil];
}

#pragma mark - Helpers

- (NSURL *)releasesDir { return [_baseDir URLByAppendingPathComponent:@"releases" isDirectory:YES]; }
- (NSURL *)stagingDir { return [_baseDir URLByAppendingPathComponent:@"staging" isDirectory:YES]; }

- (NSURL *)bundleURLFor:(NSDictionary *)entry
{
  NSString *releaseId = entry[@"id"];
  NSString *bundlePath = entry[@"bundlePath"];
  if (![self validId:releaseId error:nil] || ![self validPath:bundlePath error:nil]) return nil;
  return [[[self releasesDir] URLByAppendingPathComponent:releaseId isDirectory:YES] URLByAppendingPathComponent:bundlePath];
}

- (BOOL)bundleExists:(NSDictionary *)entry
{
  NSURL *url = [self bundleURLFor:entry];
  return url && [[NSFileManager defaultManager] fileExistsAtPath:url.path];
}

- (void)collectGarbage
{
  NSMutableSet *keep = [NSMutableSet new];
  for (NSString *key in @[ @"current", @"pending", @"trial" ]) {
    NSString *releaseId = _state[key][@"id"];
    if (releaseId) [keep addObject:releaseId];
  }
  NSFileManager *fm = [NSFileManager defaultManager];
  for (NSURL *dir in [fm contentsOfDirectoryAtURL:[self releasesDir] includingPropertiesForKeys:nil options:0 error:nil]) {
    if (![keep containsObject:dir.lastPathComponent]) [fm removeItemAtURL:dir error:nil];
  }
  [fm removeItemAtURL:[self stagingDir] error:nil];
}

- (void)addFailed:(NSString *)releaseId
{
  NSMutableArray *failed = [(_state[@"failed"] ?: @[]) mutableCopy];
  [failed addObject:releaseId];
  while (failed.count > kMaxFailed) [failed removeObjectAtIndex:0];
  _state[@"failed"] = failed;
}

- (NSString *)deviceIdLocked
{
  NSString *deviceId = _state[@"deviceId"];
  if (!deviceId) {
    deviceId = [NSUUID UUID].UUIDString.lowercaseString;
    _state[@"deviceId"] = deviceId;
    [self save];
  }
  return deviceId;
}

- (void)save
{
  [[NSUserDefaults standardUserDefaults] setObject:[_state copy] forKey:kStateKey];
}

- (NSString *)appVersion
{
  return [NSBundle mainBundle].infoDictionary[@"CFBundleShortVersionString"] ?: @"0";
}

- (NSString *)buildNumber
{
  return [NSBundle mainBundle].infoDictionary[@"CFBundleVersion"] ?: @"0";
}

- (NSString *)binaryVersion
{
  return [NSString stringWithFormat:@"%@(%@)", [self appVersion], [self buildNumber]];
}

- (BOOL)validId:(NSString *)releaseId error:(NSError **)error
{
  static NSRegularExpression *regex;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    regex = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{1,64}$" options:0 error:nil];
  });
  BOOL ok = releaseId.length > 0 &&
      [regex numberOfMatchesInString:releaseId options:0 range:NSMakeRange(0, releaseId.length)] == 1;
  if (!ok && error) *error = [self errorWithCode:6 message:@"Invalid release id"];
  return ok;
}

- (BOOL)validPath:(NSString *)path error:(NSError **)error
{
  BOOL ok = path.length > 0 && ![path hasPrefix:@"/"] && ![path containsString:@".."] && ![path containsString:@"\\"];
  if (!ok && error) *error = [self errorWithCode:7 message:[NSString stringWithFormat:@"Invalid path %@", path]];
  return ok;
}

- (NSError *)errorWithCode:(NSInteger)code message:(NSString *)message
{
  return [NSError errorWithDomain:LivePatchErrorDomain code:code userInfo:@{NSLocalizedDescriptionKey : message}];
}

- (NSString *)json:(NSDictionary *)object
{
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

+ (nullable NSString *)sha256OfFile:(NSURL *)url
{
  NSInputStream *stream = [NSInputStream inputStreamWithURL:url];
  if (!stream) return nil;
  [stream open];
  CC_SHA256_CTX ctx;
  CC_SHA256_Init(&ctx);
  uint8_t buffer[64 * 1024];
  NSInteger read;
  while ((read = [stream read:buffer maxLength:sizeof(buffer)]) > 0) {
    CC_SHA256_Update(&ctx, buffer, (CC_LONG)read);
  }
  [stream close];
  if (read < 0) return nil;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &ctx);
  NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [hex appendFormat:@"%02x", digest[i]];
  return hex;
}

@end
