# Verification status

Nothing below is simulated-and-presented-as-real. Each item says how it was checked.

## Automated (run `npm test`) — 105 tests, all passing

| Area | What is covered |
|---|---|
| Distance | Haversine vs a published distance, round-trips, local projection error |
| GPS filter | no/poor accuracy rejected, zero distance while stationary with drifting fixes, duplicates, out-of-order, single teleport ignored, persistent relocation flagged as a gap, signal loss flagged, standing still is not a gap, pause/resume segments, state survives JSON round trip |
| Statistics | moving time, avg/max speed, elevation gain/loss with noise, null when no altitude, poor vertical accuracy ignored |
| Route reversal | exact reverse order, full remaining distance at the end, follows corners not the straight line, monotonic progress to arrival, GPS noise tolerated, deviation detected and rejoin point given, one stray fix ignored, loop trails, unrecorded-stretch warning, one-point trail, ETA |
| Persistence (real SQLite) | all 11 required tables, start coordinates saved, batched writes, **process restart mid-trek**, re-delivered fixes not duplicated, pause survives restart, finish/cancel, single active trek, failed batch rolls back, record → store → navigate back end to end |
| Emergency | every required message field, last-known vs live wording, unknown location, SOS with no connectivity stores event + trail + queue, delivery states cannot skip to "confirmed", resolve, safety plan attach |
| BLE protocol | encryption round trip, wrong key fails, tamper detection, unique ids, duplicate drop, expiry, hop limit, hop-cap enforcement, relay without key, fragmentation/reassembly |
| Export | GPX segments and points, JSON losslessness, file names |
| Profile & onboarding (`profile.test.ts`) | personal-detail validation (names, real dates, no future birthdays, E.164 phones, optional email), contact rules (own number refused), greeting from preferred name, UUID v4, field encryption round trip / wrong key / field swap / no plaintext on disk, v1→v2 migration keeps data, profile survives a process restart (no repeated onboarding), edit updates greeting, failed onboarding save leaves nothing half-written, lost key never overwrites encrypted details |
| GPS acquisition (`gps.test.ts`) | browser adapter + state machine: genuine fix, permission denied, timeout before first fix is *searching* not *lost*, position unavailable, poor accuracy shown weak and still rejected by the filter, interruption → probe → watch restart → reacquiring, recovery, repeated START creates one watcher / one trek, STOP clears watch + timers and ignores late callbacks, web vs native backend selection, unsupported browser, insecure http:// page, browser fixes recorded by the existing TrekRecorder |

## Checked by running the app in a browser (Expo web)

Onboarding, permission-denied path, Home, Explore, Trek (idle), Return (idle), Safety, adding an
emergency contact, safety plan, profile, history (empty), Bluetooth screen (reports unsupported),
and a complete SOS with **no location**: the record was saved with "LOCATION UNKNOWN", SMS shown as
*waiting*, Bluetooth shown as *failed — needs the installed app*.

Trek detail (route canvas, statistics, elevation chart), delete, and the active Return screen were
rendered once from a clearly-labelled synthetic trek written through the real recorder, which was
then deleted. That checks drawing only — it says nothing about real GPS behaviour.

The browser preview had location permission denied, so **no recording has been run with a live fix**.

GPS fix (Nov 2026): with a *test double* for `navigator.geolocation` injected into the preview page
(never shipped), START TREK acquired a fix, created one watcher with `enableHighAccuracy`, recorded
breadcrumbs, showed "Reacquiring GPS…" during a 38 s outage while recording continued, and
recovered by itself. The test trek was discarded. A real phone outdoors has still not been tested.

Onboarding (Nov 2026, browser preview at phone size): validation errors on empty fields, own number
refused as emergency contact, all four steps completed, profile and greeting ("Hello, Asha!")
survived a reload with no repeated onboarding, editing the preferred name changed the greeting.

### Testing GPS in a phone browser

Browsers only give GPS to **https://** pages (or `localhost` on the same device). Opening the dev
server as `http://<laptop-ip>:8087` on a phone is blocked by the browser; TRAILX now says so
("GPS needs a secure (https://) page") instead of waiting. Serve it over https, e.g.:

1. `npx expo start --web --port 8087`
2. In another terminal: `ngrok http 8087` (free account) and open the `https://…ngrok…` URL on the phone.
3. iPhone: Settings → Privacy & Security → Location Services → Chrome → *While Using the App*,
   *Precise Location* on. Allow location when the page asks.
4. Profile → **GPS diagnostics** shows secure-page, permission, state, accuracy, fix age and the last
   geolocation error code. Coordinates stay hidden unless you tap *Show coordinates*.

A browser cannot record with the screen locked or the tab in the background — use the installed app for that.

## Android build

`./gradlew assembleDebug` (arm64, JDK 17) succeeded: a 100 MB debug APK is produced at
`android/app/build/outputs/apk/debug/app-debug.apk`, including the Kotlin BLE peripheral module.
It compiles; it has **not been installed or run on a phone**.

## NOT yet verified — needs real devices

These are the field tests from the brief. None has been performed; the code paths exist and are
unit-tested where they are pure logic, but real-world behaviour is unproven until someone does them.

1. Start a trek with internet, then disable mobile data / enable airplane mode with GPS on.
2. Record for an extended period with the screen locked; reopen and confirm the trail continued.
3. Force-stop or reboot during a trek; confirm it resumes.
4. Finish at a destination, RETURN TO START, walk the trail back; check arrow, off-route warning, arrival.
5. Weak GPS (canopy, gorge) and full signal loss; check gap marking and last-known wording.
6. Low battery warning; battery-saver sampling.
7. SOS with no connectivity on a phone; then SMS composer once signal returns.
8. Bluetooth between two phones: discovery, encrypted exchange, acknowledgement, relay via a third.
9. Overdue alert via scheduled notification with the app closed.
10. iOS build: the Swift BLE peripheral module has not been compiled (no Xcode on the build machine).
11. Compass behaviour near magnetic interference.
