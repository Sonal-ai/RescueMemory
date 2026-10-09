// Screen size does not identify an APK. Mobile browsers still get the responsive landing.
export function homeRoute(isNative) {
  return isNative ? '/chat' : '/';
}
