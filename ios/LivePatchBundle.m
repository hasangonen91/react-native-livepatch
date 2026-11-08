#import "LivePatchBundle.h"
#import "LivePatchStore.h"

@implementation LivePatchBundle

+ (nullable NSURL *)bundleURL
{
  return [[LivePatchStore shared] resolveLaunch];
}

@end
