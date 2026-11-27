---
'thumbjar': minor
---

feat: add the Android GitHub action and thumbjar ci android

`portabletext/thumbjar/android` runs a device test file on an Android emulator in GitHub Actions. It runs `thumbjar ci android run` inside the emulator runner. If the first emulator never booted, adb lost the device, or Gboard's Japanese dictionary never loaded, `thumbjar ci android retry` has the action retry once on a fresh emulator. A test failure is never retried.
