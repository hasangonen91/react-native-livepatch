require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = "react-native-livepatch"
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.authors      = package['author']
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => package['repository']['url'], :tag => s.version }
  s.source_files = "ios/**/*.{h,m,swift}"
  s.dependency   "React-Core"
  s.swift_version = "5.0"
end
