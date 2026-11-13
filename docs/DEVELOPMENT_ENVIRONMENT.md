# Development environment

Audited on 14 Nov 2026 on the main development Mac. Versions are what is installed, not minimums.

## Machine and runtimes

| Tool | Version | Notes |
|---|---|---|
| macOS | 26.5.2 (Apple silicon, arm64) | |
| Node.js | 26.9.0 | npm 11.19.1 |
| Python | 3.14.2 | not used by the app |
| Git | 2.55.0 | |
| GitHub CLI (`gh`) | installed, logged in as `madhusudhan1260` (keyring) | used for repo work instead of a GitHub MCP |
| SQLite CLI | 3.51.0 | for read-only inspection of exported databases |
| ngrok | `/opt/homebrew/bin/ngrok` | https tunnel for testing browser GPS on a phone |
| Google Chrome | installed | used by the Playwright MCP |
| Docker, uv/uvx, CocoaPods, Watchman | **not installed** | CocoaPods is needed before the first iOS native build (`sudo gem install cocoapods` or `brew install cocoapods`) |

## Mobile toolchains

| Tool | Status |
|---|---|
| Xcode | 26.6 (17F113) at `/Applications/Xcode.app` |
| iOS simulators | iOS 26.5: iPhone 17, 17 Pro, 17 Pro Max, 17e, Air (all shut down) |
| Android SDK | `~/Library/Android/sdk` — platform-tools (adb 1.0.41), build-tools, NDK, CMake, emulator, one arm64-v8a system image |
| Android virtual devices | **none created** — `avdmanager create avd …` is needed before emulator testing |
| Physical Android device | none connected (`adb devices` is empty) |
| JDK for Gradle | JDK 17 at `~/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/*/Contents/Home`. The default `java` is 24, which Gradle rejects — set `JAVA_HOME` to the JDK 17 path for Android builds |

## Project stack (from `package.json`)

Expo SDK 58 (`expo` ~58.0.25), React Native 0.88, React 19.3, TypeScript 5.9 (pinned; Expo suggests 6.x
but the project is not migrated — `expo.install.exclude` keeps it), Expo Router, Reanimated 4,
Gesture Handler 3, react-native-svg, Zustand, expo-sqlite, expo-location + expo-task-manager,
expo-secure-store, expo-notifications, expo-battery, expo-network, expo-sms, react-native-ble-plx,
@noble/ciphers + @noble/hashes, and the local native module `modules/trailx-ble-peripheral`
(Kotlin + Swift).

`npx expo-doctor`: 20/20 checks pass.

## Everyday commands

```bash
npm install                      # if the npm cache errors: npm_config_cache=<some temp dir> npm install
npm test                         # Jest: pure logic + real SQLite via node:sqlite
npm run typecheck
npx expo start --web --port 8087 # web build (also launch config "trailx-web")
npx expo-doctor
npx expo export --platform android   # JS bundle check without a full native build
```

Android release APK:

```bash
npx expo prebuild --platform android
cd android && JAVA_HOME=$(ls -d ~/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/*/Contents/Home) ./gradlew assembleRelease
```

iOS (not yet done on this machine — needs CocoaPods first):

```bash
npx expo prebuild --platform ios && npx expo run:ios
```

## Known environment gotchas

- The workspace lives in iCloud Desktop. Evicted ("dataless") files can make git, Metro or Node hang;
  check with `ls -lO` and restore from git / `npm ci`.
- The shared `~/.npm` cache has permission problems; pass `npm_config_cache=<temp dir>`.
- Browsers give GPS only to https or localhost pages; test on a phone through `ngrok http 8087`.
- Changing `node_modules` while the web dev server runs can crash it — restart it afterwards.
