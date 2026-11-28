# thumbjar

## 1.1.1

### Patch Changes

- [#15](https://github.com/portabletext/thumbjar/pull/15) [`5c83096`](https://github.com/portabletext/thumbjar/commit/5c830967f7591230d4f2bc91aaad2a55ca7ed0db) Thanks [@christianhg](https://github.com/christianhg)! - fix: pass the Android action's inputs to its scripts through env

- [#15](https://github.com/portabletext/thumbjar/pull/15) [`aea81ce`](https://github.com/portabletext/thumbjar/commit/aea81ced27f0bab390807339a82c3924be1e7468) Thanks [@christianhg](https://github.com/christianhg)! - fix: serve test pages on loopback only

## 1.1.0

### Minor Changes

- [#9](https://github.com/portabletext/thumbjar/pull/9) [`28b76a1`](https://github.com/portabletext/thumbjar/commit/28b76a148d3aaac00725be6df19f6892f34f6244) Thanks [@christianhg](https://github.com/christianhg)! - feat: add the Android GitHub action and thumbjar ci android

  `portabletext/thumbjar/android` runs a device test file on an Android emulator in GitHub Actions. It runs `thumbjar ci android run` inside the emulator runner. If the first emulator never booted, adb lost the device, or Gboard's Japanese dictionary never loaded, `thumbjar ci android retry` has the action retry once on a fresh emulator. A test failure is never retried.

- [#12](https://github.com/portabletext/thumbjar/pull/12) [`6ce6d1d`](https://github.com/portabletext/thumbjar/commit/6ce6d1dfa330856216fe54e70dac5b3fcf035352) Thanks [@christianhg](https://github.com/christianhg)! - feat: cache the Android SDK image and check the pinned emulator in the action

  `portabletext/thumbjar/android` now restores the emulator's system image from the actions cache, keyed by the revision `sdkmanager` would install, and saves it from passing runs on the default branch. `thumbjar ci android sdk-cache-key` computes the key. After the runs, `thumbjar ci android check-emulator` fails the action unless the SDK's emulator is the pinned `emulator-build`.

## 1.0.1

### Patch Changes

- [#5](https://github.com/portabletext/thumbjar/pull/5) [`6bdc798`](https://github.com/portabletext/thumbjar/commit/6bdc7983e52a6eadcbbace47db0d78ada38257e8) Thanks [@christianhg](https://github.com/christianhg)! - fix: add npm keywords
