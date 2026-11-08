require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-livepatch"
  s.module_name  = "ReactNativeLivePatch"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => package["repository"]["url"], :tag => s.version.to_s }

  s.source_files = "ios/**/*.{h,m,mm}"
  # Only the plain Objective-C header is public, so Swift AppDelegates can
  # `import ReactNativeLivePatch` without pulling in C++ headers.
  s.public_header_files = "ios/LivePatchBundle.h"
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }

  install_modules_dependencies(s)
end
