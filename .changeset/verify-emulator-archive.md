---
'thumbjar': patch
---

fix: verify the pinned emulator archive in the Android action

`portabletext/thumbjar/android` passed `emulator-build` to the emulator runner, which downloads and unpacks that emulator with no digest check. The action now pins the archive of build `16428233`, its default, by URL, size and SHA-256. For that build it streams the archive, unpacks it only once both match and swaps it in for `$ANDROID_HOME/emulator`, and the runner gets no `emulator-build`. The archive is verified before it is installed; the runner's own `sdkmanager --install emulator` still runs before launch, and on hosted runners installs into `emulator-2`. The emulator's build is checked after boot and before any test, and again after the runs. Any other `emulator-build`, or an empty one, goes to the runner as before, with a warning that it is not verified. The install runs from the action itself, so it needs nothing new from the installed thumbjar. Raise the step's `timeout-minutes` by 9 for the install.
