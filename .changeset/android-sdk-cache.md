---
'thumbjar': minor
---

feat: cache the Android SDK image and check the pinned emulator in the action

`portabletext/thumbjar/android` now restores the emulator's system image from the actions cache, keyed by the revision `sdkmanager` would install, and saves it from passing runs on the default branch. `thumbjar ci android sdk-cache-key` computes the key. After the runs, `thumbjar ci android check-emulator` fails the action unless the SDK's emulator is the pinned `emulator-build`.
