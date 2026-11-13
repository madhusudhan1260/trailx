/**
 * Minimal driver contract. The app uses expo-sqlite; the automated tests run the very same SQL
 * against Node's built-in SQLite, so persistence is tested for real rather than mocked.
 */
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<{ lastId: number; changes: number }>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Runs `fn` atomically: either every statement inside is committed or none is. */
  tx<T>(fn: () => Promise<T>): Promise<T>;
}

export const SCHEMA_VERSION = 2;

const V1 = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  blood_group TEXT,
  medical TEXT,
  allergies TEXT,
  party_code TEXT,
  onboarded INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trek_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('recording','paused','finished')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  start_lat REAL NOT NULL,
  start_lon REAL NOT NULL,
  start_acc REAL,
  start_alt REAL,
  destination TEXT,
  sampling_mode TEXT NOT NULL DEFAULT 'balanced',
  tracking_mode TEXT NOT NULL DEFAULT 'background',
  paused_ms INTEGER NOT NULL DEFAULT 0,
  paused_at INTEGER,
  filter_state TEXT NOT NULL,
  stats_state TEXT NOT NULL,
  last_fix TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON trek_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON trek_sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS trek_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES trek_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  seg INTEGER NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  t INTEGER NOT NULL,
  acc REAL,
  alt REAL,
  alt_acc REAL,
  speed REAL,
  course REAL,
  dist REAL NOT NULL,
  gap INTEGER NOT NULL DEFAULT 0,
  UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS trek_statistics (
  session_id INTEGER PRIMARY KEY REFERENCES trek_sessions(id) ON DELETE CASCADE,
  distance REAL NOT NULL,
  estimated_distance REAL NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  active_ms INTEGER NOT NULL,
  moving_ms INTEGER NOT NULL,
  avg_speed REAL NOT NULL,
  max_speed REAL NOT NULL,
  elevation_gain REAL,
  elevation_loss REAL,
  max_altitude REAL,
  min_altitude REAL,
  altitude_coverage REAL NOT NULL,
  point_count INTEGER NOT NULL,
  gap_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relation TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS emergency_events (
  id TEXT PRIMARY KEY,
  session_id INTEGER REFERENCES trek_sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sos','overdue')),
  created_at INTEGER NOT NULL,
  lat REAL,
  lon REAL,
  acc REAL,
  alt REAL,
  fix_t INTEGER,
  position_live INTEGER NOT NULL DEFAULT 0,
  battery REAL,
  start_lat REAL,
  start_lon REAL,
  start_t INTEGER,
  message TEXT NOT NULL,
  short_message TEXT NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_session ON emergency_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON emergency_events(created_at DESC);

CREATE TABLE IF NOT EXISTS emergency_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  t INTEGER NOT NULL,
  acc REAL,
  alt REAL
);
CREATE INDEX IF NOT EXISTS idx_emloc_event ON emergency_locations(event_id, t);

CREATE TABLE IF NOT EXISTS pending_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  recipient TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  msg_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_event ON pending_alerts(event_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON pending_alerts(status);

CREATE TABLE IF NOT EXISTS safety_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES trek_sessions(id) ON DELETE CASCADE,
  expected_return_at INTEGER,
  destination TEXT,
  notes TEXT,
  notification_id TEXT,
  overdue_event_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_session ON safety_plans(session_id);

CREATE TABLE IF NOT EXISTS saved_waypoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES trek_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  alt REAL,
  acc REAL,
  t INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_waypoints_session ON saved_waypoints(session_id);

CREATE TABLE IF NOT EXISTS trek_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES trek_sessions(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  text TEXT,
  photo_uri TEXT,
  lat REAL,
  lon REAL
);
CREATE INDEX IF NOT EXISTS idx_notes_session ON trek_notes(session_id, t);

CREATE TABLE IF NOT EXISTS ble_messages (
  msg_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  hops INTEGER NOT NULL,
  readable INTEGER NOT NULL,
  payload TEXT,
  packet TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

/** v2: full one-time onboarding profile. Existing rows keep their data; new columns start empty. */
const V2_USER_COLUMNS = [
  'uid TEXT', 'preferred_name TEXT', 'photo_uri TEXT', 'dob TEXT', 'phone TEXT', 'email TEXT', 'gender TEXT', 'language TEXT',
  'emergency_notes TEXT', 'experience TEXT', 'difficulty TEXT', 'typical_duration TEXT', 'profile_created_at INTEGER', 'updated_at INTEGER',
];

export async function migrate(db: Db, now = Date.now()): Promise<void> {
  await db.exec('PRAGMA journal_mode = WAL;');
  await db.exec('PRAGMA foreign_keys = ON;');
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  const v = row?.user_version ?? 0;
  if (v < 1) {
    await db.tx(async () => {
      await db.exec(V1);
      await db.run('INSERT OR IGNORE INTO users (id, created_at) VALUES (1, ?)', [now]);
    });
    await db.exec('PRAGMA user_version = 1');
  }
  if (v < 2) {
    await db.tx(async () => {
      const have = new Set((await db.all<{ name: string }>("SELECT name FROM pragma_table_info('users')")).map((c) => c.name));
      for (const col of V2_USER_COLUMNS) if (!have.has(col.split(' ')[0])) await db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    });
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}
