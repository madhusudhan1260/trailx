# TRAILX

**Explore without limits. Find your way back.**

An offline-first trekking app. Press START TREK, walk, and TRAILX records your route to the phone
from raw GPS — no internet, no map downloads, no account, no paid API. Press RETURN TO START and it
guides you back along the exact trail you walked.

> NO SIGNAL. NO MAP DOWNLOADS. NO LOST TRAILS.

## Run it

```bash
npm install
npm test            # 75 automated tests (pure logic + real SQLite)
npm run typecheck
```

Native build (required for background GPS, compass, Bluetooth — these do not exist in Expo Go):

```bash
npx expo prebuild
npx expo run:android      # or: npx expo run:ios  (needs full Xcode)
```

Browser preview of the UI (foreground GPS only, no Bluetooth/SMS/background):

```bash
npx expo start --web
```

Android builds need JDK 17 (`JAVA_HOME`) and `ANDROID_HOME`.

## How it is put together

```
app/                    screens (expo-router)
  onboarding.tsx          4 cinematic slides + explained permission requests
  (tabs)/index|explore|trek|return|safety
  sos.tsx                 hold-to-activate SOS
  emergency/[id].tsx      emergency record, channels, delivery status
  beacon.tsx  plan.tsx  profile.tsx  history/
src/core/               pure TypeScript — no device APIs, fully unit-tested
  geo.ts                  Haversine, bearings, local projection, simplification
  filter.ts               GPS filter: accuracy gate, anti-drift, jumps, gaps, pause segments
  stats.ts                distance / time / speed / elevation with hysteresis
  reverseNav.ts           reverse breadcrumb navigator (progress, off-route, rejoin, arrival)
  emergency.ts            message builder, delivery state machine, overdue logic
  protocol.ts             encrypted BLE packet format, relay rules, fragmentation
  exporter.ts             GPX 1.1 and JSON
src/db/                 SQLite schema, driver wrapper, queries
src/services/           device glue
  recorder.ts             transaction-safe recording, restart recovery
  tracking.ts             expo-location background task + foreground watcher
  returnNav.ts  sos.ts  ble.ts  satellite.ts  notify.ts  device.ts
src/ui/                 design system: RouteCanvas, Compass, DirectionArrow, StartButton, …
modules/trailx-ble-peripheral/   native BLE GATT server (Kotlin + Swift)
__tests__/              jest suites
```

### Recording
`START TREK` waits for a real fix (it refuses to start without one — there would be no start point
to return to), stores the start coordinates and timestamp, then starts an OS location service
(Android foreground service / iOS background location). Every batch of fixes goes through
`filterFix` and is written to `trek_locations` in one transaction together with the filter and
statistics state. Killing the app loses nothing already delivered; on relaunch `restoreTracking`
reloads the trek and checks the location service is still running.

### Return to start
`reverseNav` treats the stored trail as a polyline and tracks your progress along it in metres from
the start. It guides you toward a point slightly ahead on the trail in the reverse direction, warns
after three consecutive fixes off the trail, points to the nearest place to rejoin, flags stretches
that were never recorded (GPS gaps, pauses) and confirms arrival. It never invents a path: the only
straight-line figure shown is labelled "not a route".

### Emergency
SOS writes the event, the last reliable fixes and a delivery queue to SQLite first, then offers
whatever channels exist: SMS composer, system share sheet, clipboard, Bluetooth to nearby TRAILX
phones. Statuses are literal — *saved*, *waiting*, *opened in messaging app (not confirmed)*,
*sent (delivery not confirmed)*, and *delivery confirmed* only when a peer device returns an
encrypted acknowledgement.

## Honest limits

- **GPS accuracy** is whatever the phone reports; it is displayed, never assumed. Under canopy or
  in gorges expect ±10–30 m or worse. Elevation comes from GPS altitude and is labelled approximate.
- **Background recording** depends on the OS. iOS needs "Always" location; some Android vendors
  kill background services unless battery optimisation is disabled for the app. The app warns when
  it can only record in the foreground.
- **SMS** cannot be sent silently by any app; TRAILX opens the composer. Android never reports
  whether you pressed send.
- **Bluetooth** range is tens of metres and both phones need TRAILX running. Relaying is
  store-and-forward with a 3-hop limit, not a mesh.
- **Satellite**: no provider is bundled. `src/services/satellite.ts` is the adapter interface for
  manufacturer SDKs. A phone's GPS cannot transmit.
- **Return navigation** retraces where you walked; it cannot know whether that ground is still safe.
- The optional FastAPI/PostgreSQL sync backend from the brief is **not built**. Nothing in the app
  depends on it.

See [docs/TESTING.md](docs/TESTING.md) for what has and has not been verified.
