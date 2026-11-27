# Host setup

thumbjar runs on Linux and macOS. It needs no GNU coreutils.

## What to install

- Node 24 or later.
- The Android SDK, with `adb` and `emulator` on your `PATH`.
- An API 36 Play Store system image. Play Store images come with Chrome and Gboard.

thumbjar prepares a booted device but never boots one. Create and start the emulator yourself.

## Linux

On Linux x86_64, use an x86_64 emulator image. The emulator needs KVM. See [ci.md](ci.md) for the settings thumbjar's own CI uses.

## macOS

On Apple Silicon, use an ARM64 image and start the emulator with `-gpu swiftshader_indirect`.

Gboard's language download may need a proxy for QUIC on macOS.

## Keyboards

The `keyboard` option is `ja` for Gboard's Japanese QWERTY layout or `en` for English. `thumbjar prepare` adds the Japanese layout for you.
