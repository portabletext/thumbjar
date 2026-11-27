import {describe, expect, test} from 'vitest'
import {sdkCacheKey, systemImagePath} from './sdk-cache.ts'

// What `sdkmanager --list` from cmdline-tools 12.0 printed for an SDK with only `platform-tools`, cut to the rows
// around the system image and without the padding after each row, as recorded in portabletext/editor.
const recordedList = [
  'Loading package information...\rLoading local repository...\r[=========                              ] 25% Loading local repository...\r[=======================================] 100% Computing updates...',
  'Installed packages:',
  '  Path           | Version | Description                | Location',
  '  -------        | ------- | -------                    | -------',
  '  platform-tools | 37.0.1  | Android SDK Platform-Tools | platform-tools',
  '',
  'Available Packages:',
  '  Path                                                                            | Version           | Description',
  '  -------                                                                         | -------           | -------',
  '  emulator                                                                        | 37.2.13           | Android Emulator',
  '  platform-tools                                                                  | 37.0.1            | Android SDK Platform-Tools',
  '  system-images;android-36-ext19;google_apis_playstore;x86_64                     | 1                 | Google Play Intel x86_64 Atom System Image',
  '  system-images;android-36;google_apis;x86_64                                     | 7                 | Google APIs Intel x86_64 Atom System Image',
  '  system-images;android-36;google_apis_playstore;x86_64                           | 7                 | Google Play Intel x86_64 Atom System Image',
  '  system-images;android-36;google_apis_playstore_ps16k;x86_64                     | 7                 | 16 KB Page Size Google Play Intel x86_64 Atom System Image',
  '',
].join('\n')

describe(sdkCacheKey.name, () => {
  test('keys the cache by the OS, API level and available system image revision', () => {
    expect(sdkCacheKey(recordedList, '36', 'Linux')).toEqual(
      'thumbjar-android-sdk-Linux-api36-google_apis_playstore-x86_64-image7',
    )
  })

  test('reads the available revision, not an older installed one', () => {
    expect(
      sdkCacheKey(
        recordedList.replace(
          '  platform-tools | 37.0.1  | Android SDK Platform-Tools | platform-tools',
          '  system-images;android-36;google_apis_playstore;x86_64 | 5 | Google Play Intel x86_64 Atom System Image | system-images/android-36/google_apis_playstore/x86_64',
        ),
        '36',
        'Linux',
      ),
    ).toEqual(
      'thumbjar-android-sdk-Linux-api36-google_apis_playstore-x86_64-image7',
    )
  })

  test('gives no key when the image is not available, so the action skips the cache', () => {
    expect([
      sdkCacheKey(recordedList, '35', 'Linux'),
      sdkCacheKey(recordedList.split('Available Packages:')[0]!, '36', 'Linux'),
      sdkCacheKey(
        'Available Packages:\n system-images;android-36;google_apis_playstore;x86_64 |  | image',
        '36',
        'Linux',
      ),
      sdkCacheKey('', '36', 'Linux'),
    ]).toEqual([undefined, undefined, undefined, undefined])
  })

  test('never takes a sibling image for the one the action boots', () => {
    expect(
      sdkCacheKey(
        'Available Packages:\n  system-images;android-36;google_apis_playstore_ps16k;x86_64 | 7 | image\n  system-images;android-36-ext19;google_apis_playstore;x86_64 | 1 | image',
        '36',
        'Linux',
      ),
    ).toEqual(undefined)
  })
})

describe(systemImagePath.name, () => {
  test('is the directory sdkmanager installs the image into', () => {
    expect(systemImagePath('36')).toEqual(
      'system-images/android-36/google_apis_playstore/x86_64',
    )
  })
})
